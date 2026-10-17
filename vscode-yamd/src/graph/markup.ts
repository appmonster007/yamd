/** The graph view's markup. `main.ts` wires it up and `media/graph.css` styles it. */
export const GRAPH_BODY = `
<canvas id="graph" role="img" aria-label="Graph of your notes"></canvas>

<div id="toolbar" class="card" role="toolbar" aria-label="Graph controls">
  <div class="segmented" role="group" aria-label="Scope">
    <button type="button" id="scope-global" aria-pressed="true" title="Every note in the workspace">Workspace</button>
    <button type="button" id="scope-local" aria-pressed="false" title="The active note and the notes around it">Local</button>
  </div>
  <div class="stepper" id="depth-control" hidden>
    <button type="button" class="icon-button" id="depth-down" aria-label="Fewer link steps" title="Fewer link steps"><svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg></button>
    <output id="depth" aria-live="polite" title="Link steps from the active note">1</output>
    <button type="button" class="icon-button" id="depth-up" aria-label="More link steps" title="More link steps"><svg viewBox="0 0 16 16"><path d="M4 8h8M8 4v8"/></svg></button>
  </div>
  <div class="divider"></div>
  <label class="search">
    <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
    <input id="search" type="search" placeholder="Find notes, #tags" aria-label="Find notes by name, path or #tag" autocomplete="off" spellcheck="false">
  </label>
  <span class="count" id="count" role="status"></span>
</div>

<div id="actions" class="card" role="toolbar" aria-label="View controls">
  <button type="button" class="icon-button" id="zoom-in" aria-label="Zoom in" title="Zoom in"><svg viewBox="0 0 16 16"><path d="M3.5 8h9M8 3.5v9"/></svg></button>
  <button type="button" class="icon-button" id="zoom-out" aria-label="Zoom out" title="Zoom out"><svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg></button>
  <button type="button" class="icon-button" id="fit" aria-label="Fit all notes in view" title="Fit all notes in view"><svg viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button>
  <div class="divider"></div>
  <button type="button" class="icon-button" id="settings-toggle" aria-label="Graph settings" aria-expanded="false" aria-controls="settings" title="Graph settings"><svg viewBox="0 0 16 16"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg></button>
</div>

<div id="settings" class="card" hidden>
  <section>
    <h2>Display</h2>
    <div class="field"><label for="labels">Labels</label>
      <select id="labels"><option value="auto">Automatic</option><option value="always">Always</option><option value="never">Never</option></select></div>
    <div class="field"><label for="color">Color by</label>
      <select id="color"><option value="folder">Folder</option><option value="tag">Tag</option><option value="none">Nothing</option></select></div>
    <div class="field"><label for="arrows">Arrows</label><input type="checkbox" id="arrows"></div>
    <div class="field"><label for="orphans">Notes without links</label><input type="checkbox" id="orphans" checked></div>
    <div class="field"><label for="missing">Notes that don't exist yet</label><input type="checkbox" id="missing" checked></div>
  </section>
  <section>
    <h2>Forces</h2>
    <div class="slider"><label for="distance">Link distance</label><output id="distance-value"></output><input type="range" id="distance" min="20" max="240" step="5"></div>
    <div class="slider"><label for="repel">Repel force</label><output id="repel-value"></output><input type="range" id="repel" min="20" max="800" step="10"></div>
    <button type="button" class="link-button" id="reset">Restore defaults</button>
  </section>
</div>

<div id="legend" class="card" hidden aria-label="Legend"></div>
<div id="tooltip" role="tooltip" hidden></div>
<div id="empty" hidden><strong>No notes to show</strong><span id="empty-hint">Create a note, or clear the search.</span></div>
`;
