/**
 * The recorder as one self-contained page: used inside a VS Code panel and, when VS Code blocks the
 * microphone there, served to a browser by the local upload server. No external resources.
 */
export interface RecorderPageOptions {
  /** `panel` posts to VS Code; `browser` uploads to the local server that served it. */
  mode: 'panel' | 'browser';
  /** For the panel: the nonce and CSP source of the webview. */
  nonce?: string;
  cspSource?: string;
}

const STYLE = `
:root { color-scheme: light dark; --fg: var(--vscode-editor-foreground, #1f2328); --bg: var(--vscode-editor-background, #fff); --muted: var(--vscode-descriptionForeground, #656d76);
  --border: var(--vscode-panel-border, #d0d7de); --accent: var(--vscode-textLink-foreground, #0969da); --danger: var(--vscode-editorError-foreground, #cf222e); --surface: var(--vscode-textCodeBlock-background, #f6f8fa); }
@media (prefers-color-scheme: dark) { :root { --fg: var(--vscode-editor-foreground, #e6edf3); --bg: var(--vscode-editor-background, #0d1117); --muted: var(--vscode-descriptionForeground, #8b949e);
  --border: var(--vscode-panel-border, #30363d); --accent: var(--vscode-textLink-foreground, #58a6ff); --surface: var(--vscode-textCodeBlock-background, #161b22); } }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 var(--vscode-font-family, system-ui, sans-serif); }
main { max-width: 440px; margin: 0 auto; }
h1 { font-size: 1.15rem; margin: 0 0 4px; }
p.hint { margin: 0 0 16px; color: var(--muted); }
.card { border: 1px solid var(--border); border-radius: 10px; padding: 18px; background: var(--surface); }
.time { font-size: 2.2rem; font-variant-numeric: tabular-nums; text-align: center; margin: 4px 0 10px; }
.meter { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; margin-bottom: 16px; }
.meter span { display: block; height: 100%; width: 0; background: var(--accent); transition: width 60ms linear; }
.row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
button.rec { background: var(--danger); color: #fff; border-color: var(--danger); }
button[hidden], [hidden] { display: none !important; }
audio { width: 100%; margin: 4px 0 12px; }
label.name { display: block; margin: 0 0 12px; color: var(--muted); font-size: 0.9em; }
label.name input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 5px 8px; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.status { min-height: 1.5em; margin-top: 12px; text-align: center; color: var(--muted); }
.status.error { color: var(--danger); }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--danger); margin-right: 6px; animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
body:not([data-state="recording"]) .dot, body:not([data-state="paused"]) .paused-note { display: none; }
`;

const SCRIPT = `
(function () {
  var api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  var token = new URLSearchParams(location.search).get('token');
  var $ = function (id) { return document.getElementById(id); };
  var stream, recorder, chunks = [], blob, ticker, startedAt = 0, banked = 0, audioCtx, analyser, raf;
  var MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); })[0];

  function state(s) { document.body.dataset.state = s; $('rec').hidden = s !== 'idle'; $('pause').hidden = s !== 'recording' && s !== 'paused'; $('stop').hidden = s !== 'recording' && s !== 'paused'; $('review').hidden = s !== 'review'; $('pause').textContent = s === 'paused' ? 'Resume' : 'Pause'; }
  function say(text, error) { var el = $('status'); el.textContent = text; el.className = 'status' + (error ? ' error' : ''); }
  function elapsed() { return banked + (startedAt ? Date.now() - startedAt : 0); }
  function showTime() { var s = Math.floor(elapsed() / 1000); $('time').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

  function fail(e) {
    var name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') say('The microphone is blocked here. Allow it when asked, or record in your browser instead.', true);
    else if (name === 'NotFoundError') say('No microphone was found.', true);
    else say('Could not start recording: ' + (e && e.message ? e.message : e), true);
    if ($('browser')) $('browser').hidden = false;
    state('idle');
  }

  function meter() {
    var data = new Uint8Array(analyser.fftSize);
    (function loop() {
      analyser.getByteTimeDomainData(data);
      var peak = 0; for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
      $('level').style.width = Math.min(100, peak * 1.6) + '%';
      raf = requestAnimationFrame(loop);
    })();
  }

  async function start() {
    say('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw { name: 'NotSupportedError', message: 'this page has no microphone access' };
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) { return fail(e); }
    recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
    chunks = []; banked = 0; startedAt = Date.now();
    recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
    recorder.onstop = finish;
    recorder.start(250);
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser); meter();
    ticker = setInterval(showTime, 200); showTime(); state('recording');
  }
  function pause() {
    if (recorder.state === 'recording') { recorder.pause(); banked = elapsed(); startedAt = 0; state('paused'); }
    else if (recorder.state === 'paused') { recorder.resume(); startedAt = Date.now(); state('recording'); }
  }
  function stop() { banked = elapsed(); startedAt = 0; clearInterval(ticker); cancelAnimationFrame(raf); $('level').style.width = '0'; recorder.stop(); stream.getTracks().forEach(function (t) { t.stop(); }); if (audioCtx) audioCtx.close(); }
  function finish() {
    blob = new Blob(chunks, { type: recorder.mimeType || MIME || 'audio/webm' });
    $('player').src = URL.createObjectURL(blob); showTime(); state('review');
  }
  function discard() { blob = null; $('player').removeAttribute('src'); banked = 0; showTime(); say(''); state('idle'); }

  function save() {
    if (!blob) return;
    var label = $('name').value.trim();
    say('Saving…');
    if (api) {
      var reader = new FileReader();
      reader.onload = function () { api.postMessage({ type: 'save', mime: blob.type, label: label, data: String(reader.result).split(',')[1] }); };
      reader.readAsDataURL(blob);
    } else {
      fetch('/upload?token=' + encodeURIComponent(token) + (label ? '&label=' + encodeURIComponent(label) : ''), { method: 'POST', headers: { 'content-type': blob.type }, body: blob })
        .then(function (r) { if (!r.ok) throw new Error('upload failed (' + r.status + ')'); document.body.dataset.state = 'saved'; $('review').hidden = true; say('Saved. You can close this tab and go back to VS Code.'); })
        .catch(function (e) { say(String(e.message || e), true); });
    }
  }

  $('rec').onclick = start; $('pause').onclick = pause; $('stop').onclick = stop; $('discard').onclick = discard; $('save').onclick = save;
  if ($('browser')) $('browser').onclick = function () { api.postMessage({ type: 'browser' }); say('Opening your browser…'); };
  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    if (m.type === 'saved') { say('Saved ' + m.path + ' and linked it in the note.'); $('review').hidden = true; document.body.dataset.state = 'saved'; }
    else if (m.type === 'browser-started') { say('Recording continues in your browser. Save it there and the link will appear in the note.'); state('idle'); $('rec').hidden = true; if ($('browser')) $('browser').hidden = true; }
    else if (m.type === 'error') say(m.message, true);
  });
  state('idle'); showTime();
})();
`;

export function recorderHtml(o: RecorderPageOptions): string {
  const csp =
    o.mode === 'panel'
      ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${o.nonce ?? ''}'; media-src blob: data:; img-src data:">`
      : '';
  const nonce = o.mode === 'panel' ? ` nonce="${o.nonce ?? ''}"` : '';
  const browserButton = o.mode === 'panel' ? '<button id="browser" type="button" hidden>Record in browser instead</button>' : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${csp}<meta name="viewport" content="width=device-width, initial-scale=1"><title>Record audio</title><style>${STYLE}</style></head>
<body data-state="idle"><main>
<h1>Record audio</h1><p class="hint">The recording is saved next to your note and linked where you started.</p>
<div class="card">
<div class="time" id="time" aria-live="off">00:00</div>
<div class="meter" aria-hidden="true"><span id="level"></span></div>
<div class="row"><button id="rec" class="rec" type="button"><span class="dot"></span>Record</button><button id="pause" type="button" hidden>Pause</button><button id="stop" type="button" hidden>Stop</button>${browserButton}</div>
<div id="review" hidden><audio id="player" controls></audio><label class="name">Name (optional)<input id="name" type="text" placeholder="e.g. standup"></label>
<div class="row"><button id="save" class="primary" type="button">Save and add link</button><button id="discard" type="button">Discard</button></div></div>
<div id="status" class="status" role="status"></div>
</div></main><script${nonce}>${SCRIPT}</script></body></html>`;
}
