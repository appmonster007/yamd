import * as vscode from 'vscode';
import { parse } from '../core';
import { applyReveal, computeDecorations } from '../core/livePreview';
import type { Deco, LineStyleKey, StyleKey } from '../core/livePreview';

/** Notes larger than this are left undecorated, so typing stays responsive. */
const MAX_CHARS = 512 * 1024;
const DEBOUNCE_MS = 120;

const color = (id: string) => new vscode.ThemeColor(id);
/** `textDecoration` is the one decoration property that lets extra CSS through, which VS Code decorations need for sizes and weights. */
const css = (rules: string) => `none; ${rules}`;

const STYLES: Record<StyleKey, vscode.DecorationRenderOptions> = {
  h1: { textDecoration: css('font-size: 1.8em; font-weight: 700;') },
  h2: { textDecoration: css('font-size: 1.5em; font-weight: 700;') },
  h3: { textDecoration: css('font-size: 1.3em; font-weight: 700;') },
  h4: { textDecoration: css('font-size: 1.15em; font-weight: 700;') },
  h5: { textDecoration: css('font-weight: 700;') },
  h6: { textDecoration: css('font-weight: 700;'), opacity: '0.8' },
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  boldItalic: { fontWeight: 'bold', fontStyle: 'italic' },
  underline: { textDecoration: 'underline' },
  strike: { textDecoration: 'line-through', opacity: '0.7' },
  highlight: { backgroundColor: color('editor.findMatchHighlightBackground') },
  sub: { textDecoration: css('font-size: 0.8em; vertical-align: sub;') },
  sup: { textDecoration: css('font-size: 0.8em; vertical-align: super;') },
  code: { backgroundColor: color('textCodeBlock.background'), color: color('textPreformat.foreground') },
  link: { color: color('textLink.foreground'), textDecoration: 'underline' },
  math: { color: color('textPreformat.foreground'), fontStyle: 'italic' },
  tag: { color: color('textLink.activeForeground') },
  ref: { color: color('textLink.foreground') },
  dim: { opacity: '0.55' },
  taskDone: { textDecoration: 'line-through', opacity: '0.6' },
};

const LINE_STYLES: Record<LineStyleKey, vscode.DecorationRenderOptions> = {
  quote: { isWholeLine: true, borderColor: color('textBlockQuote.border'), borderWidth: '0 0 0 3px', borderStyle: 'solid', backgroundColor: color('textBlockQuote.background') },
  codeLine: { isWholeLine: true, backgroundColor: color('textCodeBlock.background') },
  mathLine: { isWholeLine: true, backgroundColor: color('textCodeBlock.background') },
  container: { isWholeLine: true, borderColor: color('textLink.foreground'), borderWidth: '0 0 0 2px', borderStyle: 'solid', backgroundColor: color('textBlockQuote.background') },
  rule: { isWholeLine: true, borderColor: color('editorWidget.border'), borderWidth: '0 0 1px 0', borderStyle: 'solid' },
};

const GLYPHS = ['•', '☐ ', '☑ '];

interface Cached {
  version: number;
  decos: Deco[];
}

/**
 * Obsidian-style live preview for `.yamd` text editors: markup is hidden or restyled away from the
 * cursor and shown as source where it is. The editor stays VS Code's own text editor, so completion,
 * diagnostics, commands and other extensions all keep working.
 */
export class LivePreview implements vscode.Disposable {
  private readonly styleTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly hideType: vscode.TextEditorDecorationType;
  private readonly dimHideType: vscode.TextEditorDecorationType;
  private readonly glyphTypes = new Map<string, vscode.TextEditorDecorationType>();
  private readonly cache = new Map<string, Cached>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.hideType = vscode.window.createTextEditorDecorationType({ textDecoration: css('display: none;') });
    this.dimHideType = vscode.window.createTextEditorDecorationType({ opacity: '0.4' });
    for (const [key, options] of Object.entries(STYLES)) this.styleTypes.set(`s:${key}`, vscode.window.createTextEditorDecorationType(options));
    for (const [key, options] of Object.entries(LINE_STYLES)) this.styleTypes.set(`l:${key}`, vscode.window.createTextEditorDecorationType(options));
    for (const glyph of GLYPHS) {
      this.glyphTypes.set(glyph, vscode.window.createTextEditorDecorationType({ before: { contentText: glyph, color: color('textLink.foreground') } }));
    }

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeTextEditorSelection((e) => this.render(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId !== 'yamd') return;
        const key = e.document.uri.toString();
        clearTimeout(this.timers.get(key));
        this.timers.set(
          key,
          setTimeout(() => {
            this.timers.delete(key);
            for (const editor of vscode.window.visibleTextEditors) if (editor.document === e.document) this.render(editor);
          }, DEBOUNCE_MS),
        );
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.cache.delete(doc.uri.toString())),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('yamd.livePreview')) this.refreshAll();
      }),
    );
    this.refreshAll();
  }

  private get config() {
    const c = vscode.workspace.getConfiguration('yamd.livePreview');
    return { enabled: c.get<boolean>('enabled', true), dimOnly: c.get<string>('markers', 'hide') === 'dim' };
  }

  /** Turns live preview on or off for all notes. */
  async toggle(): Promise<boolean> {
    const next = !this.config.enabled;
    await vscode.workspace.getConfiguration('yamd.livePreview').update('enabled', next, vscode.ConfigurationTarget.Global);
    return next;
  }

  private refreshAll() {
    for (const editor of vscode.window.visibleTextEditors) this.render(editor);
  }

  private decorationsFor(doc: vscode.TextDocument): Deco[] | undefined {
    const key = doc.uri.toString();
    const cached = this.cache.get(key);
    if (cached?.version === doc.version) return cached.decos;
    const text = doc.getText();
    if (text.length > MAX_CHARS) return undefined;
    const decos = computeDecorations(parse(text));
    this.cache.set(key, { version: doc.version, decos });
    return decos;
  }

  private clear(editor: vscode.TextEditor) {
    for (const t of [...this.styleTypes.values(), ...this.glyphTypes.values(), this.hideType, this.dimHideType]) editor.setDecorations(t, []);
  }

  private render(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (doc.languageId !== 'yamd') return;
    const { enabled, dimOnly } = this.config;
    const decos = enabled ? this.decorationsFor(doc) : undefined;
    if (!decos) {
      this.clear(editor);
      return;
    }
    const selections = editor.selections.map((s) => ({ start: doc.offsetAt(s.start), end: doc.offsetAt(s.end) }));
    const visible = applyReveal(decos, selections);

    const buckets = new Map<vscode.TextEditorDecorationType, vscode.Range[]>();
    const add = (type: vscode.TextEditorDecorationType | undefined, range: vscode.Range) => {
      if (!type) return;
      const list = buckets.get(type);
      if (list) list.push(range);
      else buckets.set(type, [range]);
    };
    const at = (offset: number) => doc.positionAt(offset);
    for (const d of visible) {
      switch (d.kind) {
        case 'hide':
          add(dimOnly ? this.dimHideType : this.hideType, new vscode.Range(at(d.start), at(d.end)));
          break;
        case 'style':
          add(this.styleTypes.get(`s:${d.style}`), new vscode.Range(at(d.start), at(d.end)));
          break;
        case 'line':
          add(this.styleTypes.get(`l:${d.line}`), new vscode.Range(at(d.start), at(d.start)));
          break;
        case 'glyph':
          if (!dimOnly) add(this.glyphTypes.get(d.glyph), new vscode.Range(at(d.start), at(d.start)));
          break;
      }
    }
    // Every type is set each time, so ranges that no longer apply are cleared.
    for (const t of [...this.styleTypes.values(), ...this.glyphTypes.values(), this.hideType, this.dimHideType]) {
      editor.setDecorations(t, buckets.get(t) ?? []);
    }
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of [...this.styleTypes.values(), ...this.glyphTypes.values(), this.hideType, this.dimHideType]) t.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
