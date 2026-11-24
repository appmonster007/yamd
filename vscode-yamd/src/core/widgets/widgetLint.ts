/**
 * Problems in widget fences: duplicate or malformed ids, unclosed fences, incomplete query headers.
 * Pure functions over a note's lines; the extension turns them into diagnostics and quick fixes.
 */
import { ID_PATTERN, scanFences, scanWidgets, sqlHeader, parseAttributes } from './fences';
import type { Fence, WidgetBlock } from './fences';

type WidgetSeverity = 'error' | 'warning' | 'hint';

interface WidgetProblem {
  code: 'W001' | 'W002' | 'W003' | 'W004' | 'W005' | 'W006' | 'W007';
  severity: WidgetSeverity;
  message: string;
  /** Line the problem is reported on. */
  line: number;
  /** The widget the problem concerns, when it is about one block. */
  startLine: number;
}

const QUERY_VIEWS = ['table', 'board', 'chart'] as const;

/** Every problem in a note, in line order. */
export function lintWidgets(lines: string[]): WidgetProblem[] {
  const out: WidgetProblem[] = [];
  const seen = new Map<string, number>();
  for (const w of scanWidgets(lines)) {
    const at = w.startLine;
    if (!w.closed) out.push({ code: 'W004', severity: 'error', message: `This ${w.type} block is never closed.`, line: at, startLine: at });
    if (w.id === undefined) {
      out.push({ code: 'W002', severity: 'hint', message: `This ${w.type} block has no id, so it is labelled "${w.label}". Name it to open it reliably.`, line: at, startLine: at });
    } else if (!ID_PATTERN.test(w.id)) {
      out.push({ code: 'W003', severity: 'error', message: `"${w.id}" is not a valid id. Use lowercase letters, digits and "-".`, line: at, startLine: at });
    } else if (seen.has(`${w.id}`)) {
      out.push({ code: 'W001', severity: 'error', message: `The id "${w.id}" is already used on line ${(seen.get(w.id) ?? 0) + 1}. Ids must be unique in a note.`, line: at, startLine: at });
    } else seen.set(w.id, at);
    if (w.type === 'sql') queryProblems(w, lines, out);
  }
  // A sql block that names an id or view but no source was probably meant to be a widget.
  for (const f of scanFences(lines)) {
    if (f.type !== 'sql' || f.attrs['source'] !== undefined) continue;
    const header = sqlHeader(lines[f.bodyStartLine]);
    if (header !== undefined && (f.attrs['id'] !== undefined || f.attrs['view'] !== undefined)) {
      out.push({ code: 'W005', severity: 'error', message: 'This query block has no source. Add source="file.csv" to its first line.', line: f.bodyStartLine, startLine: f.startLine });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function queryProblems(w: WidgetBlock, lines: string[], out: WidgetProblem[]): void {
  const view = w.attrs['view'] ?? 'table';
  const line = w.bodyStartLine;
  if (!(QUERY_VIEWS as readonly string[]).includes(view)) {
    out.push({ code: 'W006', severity: 'error', message: `Unknown view "${view}". Use ${QUERY_VIEWS.join(', ')}.`, line, startLine: w.startLine });
  } else if (view === 'board' && !w.attrs['group']) {
    out.push({ code: 'W007', severity: 'error', message: 'A board view needs group="column".', line, startLine: w.startLine });
  } else if (view === 'chart' && (!w.attrs['x'] || !w.attrs['y'])) {
    out.push({ code: 'W007', severity: 'error', message: 'A chart view needs x="column" and y="column".', line, startLine: w.startLine });
  }
}

/** A free id for a block: `kanban-1`, `kanban-2`, … or the next unused one. */
export function suggestId(type: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** The ids already used in a note. */
export function usedIds(lines: string[]): string[] {
  return scanWidgets(lines).flatMap((w) => (w.id === undefined ? [] : [w.id]));
}

export interface LineChange {
  line: number;
  /** The new full text of the line. */
  text: string;
}

/** The change that gives a widget the id `id` (replacing an existing one, if any). */
export function setIdChange(lines: string[], w: Fence, id: string): LineChange {
  if (w.type === 'sql') {
    const line = w.bodyStartLine;
    const text = lines[line] ?? '';
    const header = sqlHeader(text) ?? '';
    const attrs = parseAttributes(header).attrs;
    const rest = header.replace(/\bid=(?:"[^"]*"|'[^']*'|\S+)\s*/, '').trim();
    void attrs;
    return { line, text: `-- id="${id}"${rest ? ` ${rest}` : ''}` };
  }
  const text = lines[w.startLine] ?? '';
  const m = /^(.*?)(`{3,}|~{3,})\s*(.*)$/.exec(text);
  const prefix = m?.[1] ?? '';
  const ticks = m?.[2] ?? '```';
  const info = (m?.[3] ?? '').trim();
  const [type = '', ...rest] = info.split(/\s+/);
  const cleaned = rest.join(' ').replace(/\bid=(?:"[^"]*"|'[^']*'|\S+)\s*/, '').trim();
  const bareId = rest.length === 1 && !rest[0]?.includes('=') ? '' : cleaned;
  return { line: w.startLine, text: `${prefix}${ticks}${type} id=${id}${bareId ? ` ${bareId}` : ''}` };
}

export const WIDGET_TEMPLATES: Record<string, string> = {
  kanban: '```kanban {id}\n## Todo\n- [ ] First task\n\n## Doing\n\n## Done\n```',
  calendar: '```calendar {id}\n- [ ] Event {due=YYYY-MM-DD}\n```',
  timeline: '```timeline {id}\n## Phase 1\n- [ ] Task {start=YYYY-MM-DD end=YYYY-MM-DD}\n```',
  gallery: '```gallery {id}\n- ![Caption](path/to/image.png)\n```',
  sql: '```sql\n-- id="{id}" source="data.csv" view="table"\nSELECT * FROM data;\n```',
};

/** The text to insert for a new widget of `type`, with a free id. */
export function widgetTemplate(type: string, taken: Iterable<string>): string {
  const id = suggestId(type, taken);
  return (WIDGET_TEMPLATES[type] ?? '').replace('{id}', type === 'sql' ? id : id);
}
