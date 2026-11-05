import * as vscode from 'vscode';
import { calloutProblems } from '../../core/build/callouts';
import { scanWidgets } from '../../core/widgets/fences';
import { lintWidgets, setIdChange, suggestId, usedIds, widgetTemplate, WIDGET_TEMPLATES } from '../../core/widgets/widgetLint';
import type { LineChange } from '../../core/widgets/widgetLint';
import { linesOf, MARKDOWN } from './widgets';

const SEVERITY = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, hint: vscode.DiagnosticSeverity.Hint };

function lineEdit(doc: vscode.TextDocument, change: LineChange): vscode.TextEdit {
  return vscode.TextEdit.replace(doc.lineAt(change.line).range, change.text);
}

/** Widget diagnostics in the Problems panel, with quick fixes for naming and renaming blocks. */
class WidgetDiagnostics implements vscode.CodeActionProvider, vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('yamd-widgets');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [this.collection];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.refresh(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
    );
    for (const d of vscode.workspace.textDocuments) this.refresh(d);
  }

  private schedule(doc: vscode.TextDocument) {
    if (doc.languageId !== 'markdown') return;
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.refresh(doc), 300));
  }

  refresh(doc: vscode.TextDocument) {
    if (doc.languageId !== 'markdown') return;
    const lines = linesOf(doc);
    const diagnostics = lintWidgets(lines).map((p) => {
      const d = new vscode.Diagnostic(doc.lineAt(p.line).range, p.message, SEVERITY[p.severity]);
      d.code = p.code;
      d.source = 'YAMD';
      if (p.startLine !== p.line) d.relatedInformation = [];
      return d;
    });
    for (const c of calloutProblems(lines)) {
      const d = new vscode.Diagnostic(doc.lineAt(c.line).range, c.message, c.code === 'C001' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Warning);
      d.code = c.code;
      d.source = 'YAMD';
      diagnostics.push(d);
    }
    this.collection.set(doc.uri, diagnostics);
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const lines = linesOf(doc);
    for (const d of context.diagnostics) {
      if (d.source === 'YAMD' && d.code === 'C002') {
        const fix = new vscode.CodeAction('Add a blank line after the callout', vscode.CodeActionKind.QuickFix);
        fix.diagnostics = [d];
        fix.isPreferred = true;
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.insert(doc.uri, doc.lineAt(d.range.start.line).range.end, '\n');
        actions.push(fix);
        continue;
      }
      if (d.source !== 'YAMD' || (d.code !== 'W001' && d.code !== 'W002' && d.code !== 'W003')) continue;
      const block = scanWidgets(lines).find((w) => w.startLine === d.range.start.line);
      if (!block) continue;
      const id = suggestId(block.type, usedIds(lines));
      const action = new vscode.CodeAction(d.code === 'W002' ? `Name this block "${id}"` : `Rename this block to "${id}"`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [d];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      action.edit.set(doc.uri, [lineEdit(doc, setIdChange(lines, block, id))]);
      actions.push(action);
    }
    return actions;
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}

export function registerWidgetDiagnostics(context: vscode.ExtensionContext): void {
  const diagnostics = new WidgetDiagnostics();
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeActionsProvider(MARKDOWN, diagnostics, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand('yamd.nameBlock', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') return;
      const doc = editor.document;
      const lines = linesOf(doc);
      const widgets = scanWidgets(lines);
      const at = editor.selection.active.line;
      let block = widgets.find((w) => w.startLine <= at && at <= w.endLine);
      if (!block) {
        const pick = await vscode.window.showQuickPick(widgets.map((w) => ({ label: w.label, description: `line ${w.startLine + 1}`, w })), { placeHolder: 'Name which block?' });
        block = pick?.w;
      }
      if (!block) return;
      const id = await vscode.window.showInputBox({
        prompt: `Id for this ${block.type} block (lowercase letters, digits and "-")`,
        value: block.id ?? suggestId(block.type, usedIds(lines)),
        validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : 'Use lowercase letters, digits and "-".'),
      });
      if (!id) return;
      const edit = new vscode.WorkspaceEdit();
      edit.set(doc.uri, [lineEdit(doc, setIdChange(lines, block, id))]);
      await vscode.workspace.applyEdit(edit);
    }),
    vscode.commands.registerCommand('yamd.insertWidget', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
        return;
      }
      const type = await vscode.window.showQuickPick(Object.keys(WIDGET_TEMPLATES), { placeHolder: 'Widget type' });
      if (!type) return;
      const text = widgetTemplate(type, usedIds(linesOf(editor.document)));
      await editor.edit((b) => b.insert(editor.selection.active, `${text}\n`));
    }),
  );
}
