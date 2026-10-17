/** Pure text logic for the editing commands, kept free of `vscode` so it can be unit-tested. */

export interface TextChange {
  /** Range to replace, as offsets into the original text. */
  start: number;
  end: number;
  text: string;
  /** Selection after the change, as offsets into the new text. */
  selection: [number, number];
}

/**
 * Toggles `marker` around the selection [start, end).
 * - Selection already wrapped (inside or including the markers): remove the markers.
 * - Empty selection between a pair of markers: remove the pair.
 * - Otherwise: wrap the selection (or insert a pair with the cursor between).
 */
export function toggleMarker(text: string, start: number, end: number, marker: string): TextChange {
  const m = marker.length;
  const selected = text.slice(start, end);
  const ch = marker[0] ?? '';

  // The selection includes the markers.
  if (selected.length >= 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    const sameRun = m === 1 && (inner.startsWith(ch) || inner.endsWith(ch));
    if (!sameRun) return { start, end, text: inner, selection: [start, start + inner.length] };
  }

  // The markers surround the selection.
  const before = text.slice(start - m, start);
  const after = text.slice(end, end + m);
  const outerBefore = text[start - m - 1];
  const outerAfter = text[end + m];
  if (before === marker && after === marker && !(m === 1 && (outerBefore === ch || outerAfter === ch))) {
    return { start: start - m, end: end + m, text: selected, selection: [start - m, end - m] };
  }

  return {
    start,
    end,
    text: marker + selected + marker,
    selection: [start + m, end + m],
  };
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(\[[ xX]\][ \t]+)?|$)(.*)$/;

export type EnterAction =
  /** Insert a newline followed by `prefix`. */
  | { kind: 'continue'; prefix: string }
  /** Clear the line: it only contains an empty marker. */
  | { kind: 'end' }
  /** Not a list item: do a normal newline. */
  | { kind: 'default' };

/** Decides what Enter does at the end of `line`. */
export function onEnter(line: string): EnterAction {
  const m = LIST_ITEM.exec(line);
  if (!m) return { kind: 'default' };
  const [, indent = '', bullet, num, delim, , task, content = ''] = m;
  if (content.trim() === '') return { kind: 'end' };
  const marker = bullet ?? `${Number(num) + 1}${delim}`;
  return { kind: 'continue', prefix: `${indent}${marker} ${task ? '[ ] ' : ''}` };
}
