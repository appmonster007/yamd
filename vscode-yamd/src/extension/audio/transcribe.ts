import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { diffLines } from '../../core/build/diff';
import { audioLinks, cleanTranscript, commandWords, placeTranscript } from '../../core/audio/transcript';
import { lineDiffEdit } from '../build/buildCommands';
import { linesOf } from '../widgets/widgets';

function run(words: string[], cwd: string): Promise<string> {
  const [cmd, ...args] = words;
  if (!cmd) return Promise.reject(new Error('The transcription command is empty.'));
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || err.message));
      else resolve(stdout);
    });
  });
}

/** `YAMD: Transcribe Audio`: runs the tool named in `yamd.audio.transcribeCommand` on a linked recording and writes the text under the link. */
export function registerTranscribe(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.transcribeAudio', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown' || editor.document.uri.scheme !== 'file') {
        void vscode.window.showInformationMessage('YAMD: Open a saved Markdown note with a linked recording.');
        return;
      }
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('YAMD: Trust this workspace to run a transcription tool.');
        return;
      }
      const template = vscode.workspace.getConfiguration('yamd.audio').get<string>('transcribeCommand', '').trim();
      if (!template) {
        const pick = await vscode.window.showInformationMessage('YAMD: Set "yamd.audio.transcribeCommand" to a speech-to-text tool that prints the text, for example: whisper-cli -m ~/models/ggml-base.en.bin -nt -f {file}', 'Open Setting');
        if (pick) void vscode.commands.executeCommand('workbench.action.openSettings', 'yamd.audio.transcribeCommand');
        return;
      }
      const doc = editor.document;
      const found = audioLinks(linesOf(doc));
      if (!found.length) {
        void vscode.window.showInformationMessage('YAMD: No linked recordings in this note.');
        return;
      }
      const at = editor.selection.active.line;
      let target = found.find((f) => f.line === at);
      if (!target) target = (await vscode.window.showQuickPick(found.map((f) => ({ label: path.basename(f.path), description: `line ${f.line + 1}`, f })), { placeHolder: 'Transcribe which recording?' }))?.f;
      if (!target) return;
      const file = path.resolve(path.dirname(doc.uri.fsPath), target.path);
      if (!existsSync(file)) {
        void vscode.window.showErrorMessage(`YAMD: ${target.path} does not exist.`);
        return;
      }
      const line = target.line;
      try {
        const text = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Transcribing ${path.basename(file)}…` }, () => run(commandWords(template, file), path.dirname(file)));
        const clean = cleanTranscript(text);
        if (!clean) throw new Error('The tool printed no text.');
        const before = linesOf(doc);
        const diff = diffLines(before, placeTranscript(before, line, clean));
        if (diff) {
          const edit = new vscode.WorkspaceEdit();
          edit.set(doc.uri, [lineDiffEdit(doc, diff)]);
          await vscode.workspace.applyEdit(edit);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`YAMD: Transcription failed. ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}
