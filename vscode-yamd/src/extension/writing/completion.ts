import * as path from 'node:path';
import * as vscode from 'vscode';
import { collectTargets } from '../../core/build/refs';
import { scanCallouts, CALLOUT_TYPES } from '../../core/build/callouts';
import { completionContext } from '../../core/completion/context';
import type { WidgetBlock } from '../../core/widgets/fences';
import { describeSource } from '../query/queryWidget';
import { linesOf, MARKDOWN, widgetsOf } from '../widgets/widgets';
import { bibEntries } from './commands';

const WIDGET_SNIPPETS: Record<string, string> = {
  kanban: 'kanban ${1:board}\n## ${2:Todo}\n- [ ] ${3:First card}\n\n## ${4:Done}\n```',
  calendar: 'calendar ${1:plan}\n- [ ] ${2:Event} {due=${3:2026-01-01}}\n```',
  timeline: 'timeline ${1:roadmap}\n## ${2:Lane}\n- [ ] ${3:Item} {start=${4:2026-01-01} due=${5:2026-02-01}}\n```',
  gallery: 'gallery ${1:photos}\n- ![${2:Caption}](${3:image.png})\n```',
  sql: 'sql\n-- id="${1:query}" source="${2:data.csv}" view="${3:table}"\nSELECT ${4:*} FROM ${5:data};\n```',
};
const MARKERS = ['toc', 'bibliography', 'pagebreak', 'attrs', 'query:'];

/** Completion and hover for the YAMD syntax: fence types, callout types, references, query headers and columns. */
export function registerCompletion(context: vscode.ExtensionContext): void {
  const blockAt = (doc: vscode.TextDocument, startLine: number): WidgetBlock | undefined => widgetsOf(doc).find((w) => w.startLine === startLine) ?? undefined;

  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(doc, position) {
      const lines = linesOf(doc);
      const ctx = completionContext(lines, position.line, position.character);
      if (!ctx) return undefined;
      const range = new vscode.Range(position.line, position.character - ctx.prefix.length, position.line, position.character);
      const item = (label: string, kind: vscode.CompletionItemKind, extra: Partial<vscode.CompletionItem> = {}) => Object.assign(new vscode.CompletionItem(label, kind), { range }, extra);

      switch (ctx.kind) {
        case 'widget-type':
          return Object.entries(WIDGET_SNIPPETS).map(([type, body]) => item(type, vscode.CompletionItemKind.Snippet, { insertText: new vscode.SnippetString(body), detail: type === 'sql' ? 'query block' : `${type} widget`, sortText: type }));
        case 'callout-type':
          return CALLOUT_TYPES.map((t) => item(t, vscode.CompletionItemKind.EnumMember, { insertText: new vscode.SnippetString(`${t}] \${1:Title}`) }));
        case 'marker':
          return MARKERS.map((m) => item(m, vscode.CompletionItemKind.Keyword, { insertText: new vscode.SnippetString(m === 'query:' ? 'query:${1:id}' : m) }));
        case 'reference': {
          const items = collectTargets(lines).map((t) => item(t.id, vscode.CompletionItemKind.Reference, { detail: t.label }));
          const callouts = scanCallouts(lines).filter((c) => c.id && !items.some((i) => i.label === c.id));
          items.push(...callouts.map((c) => item(c.id as string, vscode.CompletionItemKind.Reference, { detail: c.title || c.type })));
          const bib = await bibEntries(doc, false);
          items.push(...(bib?.entries ?? []).map((e) => item(e.key, vscode.CompletionItemKind.Reference, { detail: [e.fields['author'], e.fields['year']].filter(Boolean).join(' · '), documentation: e.fields['title'] })));
          return items;
        }
        case 'header-value': {
          if (ctx.attr === 'view') return ['table', 'board', 'chart'].map((v) => item(v, vscode.CompletionItemKind.EnumMember));
          if (ctx.attr === 'type') return ['bar', 'line'].map((v) => item(v, vscode.CompletionItemKind.EnumMember));
          const fence = widgetsOf(doc).find((w) => w.type === 'sql' && w.bodyStartLine === position.line);
          if (ctx.attr === 'source') {
            const files = await vscode.workspace.findFiles('**/*.{csv,json,sqlite,sqlite3,db}', '**/{node_modules,.git}/**', 200);
            return files.map((u) => {
              const rel = path.relative(path.dirname(doc.uri.fsPath), u.fsPath).split(path.sep).join('/');
              return item(rel, vscode.CompletionItemKind.File, { detail: path.extname(u.fsPath).slice(1) });
            });
          }
          if (!fence) return undefined;
          const tables = await describeSource(doc, fence);
          return (tables ?? []).flatMap((t) => t.columns.map((c) => item(c.name, vscode.CompletionItemKind.Field, { detail: `${t.table} · ${c.type || 'text'}` })));
        }
        case 'sql-body': {
          const block = blockAt(doc, ctx.blockLine);
          if (!block) return undefined;
          const tables = await describeSource(doc, block);
          return (tables ?? []).flatMap((t) => [
            item(t.table, vscode.CompletionItemKind.Struct, { detail: 'table' }),
            ...t.columns.map((c) => item(c.name, vscode.CompletionItemKind.Field, { detail: `${t.table} · ${c.type || 'text'}` })),
          ]);
        }
        default:
          return undefined;
      }
    },
  };

  const hover: vscode.HoverProvider = {
    async provideHover(doc, position) {
      const line = doc.lineAt(position.line).text;
      const block = widgetsOf(doc).find((w) => w.type === 'sql' && w.bodyStartLine === position.line);
      if (!block) return undefined;
      const m = /source="([^"]*)"/.exec(line);
      if (!m || position.character < (m.index ?? 0) || position.character > (m.index ?? 0) + m[0].length) return undefined;
      const tables = await describeSource(doc, block);
      if (!tables?.length) return new vscode.Hover(new vscode.MarkdownString(`Could not read \`${m[1]}\`.`));
      const md = new vscode.MarkdownString();
      for (const t of tables) md.appendMarkdown(`**${t.table}**\n\n${t.columns.map((c) => `- \`${c.name}\` ${c.type || 'text'}`).join('\n')}\n\n`);
      return new vscode.Hover(md);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(MARKDOWN, provider, '`', '~', '!', '@', ':', '"', '-'),
    vscode.languages.registerHoverProvider(MARKDOWN, hover),
  );
}
