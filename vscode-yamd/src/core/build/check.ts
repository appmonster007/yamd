/**
 * "What's wrong with this note": one list of every problem Build and the editor know about, plus
 * the checks that need the file system (images, data files) or the bibliography. Pure: the caller
 * says which files exist and which citation keys are known.
 */
import { lintWidgets } from '../widgets/widgetLint';
import { scanWidgets } from '../widgets/fences';
import { calloutProblems, fencedLines } from './callouts';
import { lintMarkers } from './markers';
import { collectTargets } from './refs';
import { parseCitation } from '../citations/bibtex';

export interface NoteProblem {
  line: number;
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'hint';
  /** A change that is always safe: replace the line with this text. */
  fix?: { label: string; text: string };
}

export interface CheckContext {
  /** True when a path (relative to the note) names an existing file or folder. */
  exists: (relative: string) => boolean;
  /** Known bibliography keys; undefined when the note has no readable bibliography. */
  bibKeys?: Set<string>;
}

const IMAGE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const isLocal = (p: string) => !/^([a-z][a-z0-9+.-]*:|#|\/\/|data:)/i.test(p);

export function checkNote(lines: string[], ctx: CheckContext): NoteProblem[] {
  const out: NoteProblem[] = [];
  for (const p of lintWidgets(lines)) out.push({ line: p.line, code: p.code, message: p.message, severity: p.severity });
  for (const c of calloutProblems(lines)) {
    out.push({ line: c.line, code: c.code, message: c.message, severity: 'warning', ...(c.code === 'C002' ? { fix: { label: 'Add a blank line', text: `${lines[c.line] ?? ''}\n` } } : {}) });
  }
  for (const m of lintMarkers(lines)) out.push({ line: m.line, code: m.code, message: m.message, severity: m.severity === 'error' ? 'error' : 'warning' });

  for (const w of scanWidgets(lines)) {
    const source = w.attrs['source'];
    if (!source || !w.closed || !isLocal(source)) continue;
    if (!ctx.exists(source)) out.push({ line: w.type === 'sql' ? w.bodyStartLine : w.startLine, code: 'N002', message: `The ${w.type === 'sql' ? 'data file' : 'folder'} "${source}" does not exist.`, severity: 'error' });
  }

  const fenced = fencedLines(lines);
  const targets = new Set(collectTargets(lines).map((t) => t.id));
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    for (const m of line.matchAll(IMAGE)) {
      const raw = (m[1] as string).replace(/^<|>$/g, '');
      if (isLocal(raw) && !ctx.exists(decodeURI(raw.split('#')[0] ?? ''))) out.push({ line: i, code: 'N001', message: `The image "${raw}" does not exist.`, severity: 'error' });
    }
  });
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\[(@[^\]\n]+)\](?!\()/g)) {
      for (const c of parseCitation(m[1] as string)) {
        if (targets.has(c.key)) continue;
        if (/^(fig|tbl|eq)-/.test(c.key)) out.push({ line: i, code: 'N003', message: `"${c.key}" refers to a figure, table or equation that has no target. Add "^${c.key}" under it.`, severity: 'error' });
        else if (ctx.bibKeys && !ctx.bibKeys.has(c.key)) out.push({ line: i, code: 'N004', message: `The citation key "${c.key}" is not in the bibliography file.`, severity: 'warning' });
      }
    }
  });
  return out.sort((a, b) => a.line - b.line);
}

/** Human-readable summary: counts by severity. */
export function summarize(problems: NoteProblem[]): string {
  if (!problems.length) return 'No problems found.';
  const n = (s: NoteProblem['severity']) => problems.filter((p) => p.severity === s).length;
  return [`${n('error')} error${n('error') === 1 ? '' : 's'}`, `${n('warning')} warning${n('warning') === 1 ? '' : 's'}`, n('hint') ? `${n('hint')} hint${n('hint') === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
}
