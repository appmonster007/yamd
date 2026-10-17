/** Markup for the SQL Console view; `console.ts` wires it up. */
export const CONSOLE_BODY = `
<button type="button" class="picker" id="pick" title="Choose a database">
  <span class="name placeholder" id="db-name">Choose a database…</span><span class="kind" id="db-kind"></span><span class="chevron">▾</span>
</button>
<textarea class="textarea" id="sql" aria-label="SQL query" spellcheck="false" placeholder="Choose a database, then write SQL here."></textarea>
<div class="actions-bar">
  <button type="button" class="button" id="run">Run <span class="shortcut" id="run-shortcut"></span></button>
  <label class="checkbox" title="When on, statements that change data are refused"><input type="checkbox" id="ro" checked> Read-only</label>
  <span class="spacer"></span>
  <select class="select" id="history" aria-label="Query history"><option value="">History</option></select>
</div>
<div class="status" id="status" role="status"></div>
<div class="results" id="results"></div>
<p><button type="button" class="link" id="viewer" hidden>Open in SQLite Viewer</button></p>`;

/** Markup for the Properties view; `properties.ts` fills it. */
export const PROPERTIES_BODY = '<div id="root"><div class="empty">Open a YAMD note to see its properties.</div></div>';
