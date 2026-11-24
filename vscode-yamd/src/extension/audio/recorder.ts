import * as vscode from 'vscode';
import { placeLink, shiftOffset } from '../../core/audio/audio';
import { nonce } from '../shared/webviewShell';
import { recorderHtml } from './recorderPage';
import { saveRecording } from './save';
import { startUploadServer } from './uploadServer';
import type { Upload, UploadServer } from './uploadServer';

/**
 * `YAMD: Record Audio`: a recorder panel (or, if VS Code blocks the microphone there, a recorder in the
 * browser) saves the recording as a file next to the note and puts a link to it where the command started.
 */
export function registerAudio(context: vscode.ExtensionContext): void {
  let open: { panel: vscode.WebviewPanel; server?: UploadServer } | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.recordAudio', async () => {
      if (open) {
        open.panel.reveal();
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note to record into.');
        return;
      }
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('YAMD: Trust this workspace to save recordings next to your notes.');
        return;
      }
      let doc = editor.document;
      if (doc.isUntitled || doc.uri.scheme !== 'file') {
        const choice = await vscode.window.showInformationMessage('YAMD: Save the note first, so the recording can be saved next to it.', 'Save');
        if (choice !== 'Save' || !(await doc.save()) || doc.isUntitled) return;
        doc = editor.document;
      }
      const noteUri = doc.uri;
      // The link goes where the cursor was when recording started, however the note changes meanwhile.
      let offset = doc.offsetAt(editor.selection.active);
      const track = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === noteUri.toString()) offset = shiftOffset(offset, e.contentChanges.map((c) => ({ rangeOffset: c.rangeOffset, rangeLength: c.rangeLength, textLength: c.text.length })));
      });

      const panel = vscode.window.createWebviewPanel('yamd.audio', 'Record audio', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
      const session: { panel: vscode.WebviewPanel; server?: UploadServer } = { panel };
      open = session;
      panel.webview.html = recorderHtml({ mode: 'panel', nonce: nonce(), cspSource: panel.webview.cspSource });
      panel.onDidDispose(() => {
        track.dispose();
        session.server?.close();
        open = undefined;
      });

      const finish = async (upload: Upload) => {
        try {
          const folder = vscode.workspace.getConfiguration('yamd.audio').get<string>('folder', 'audio');
          const saved = saveRecording({ noteFile: noteUri.fsPath, folder, bytes: upload.bytes, mime: upload.mime, ...(upload.label ? { label: upload.label } : {}) });
          const current = await vscode.workspace.openTextDocument(noteUri);
          const edit = placeLink(current.getText(), Math.min(offset, current.getText().length), saved.link);
          const workspaceEdit = new vscode.WorkspaceEdit();
          workspaceEdit.replace(noteUri, new vscode.Range(current.positionAt(edit.offset), current.positionAt(edit.offset + edit.remove)), edit.insert);
          await vscode.workspace.applyEdit(workspaceEdit);
          void panel.webview.postMessage({ type: 'saved', path: saved.relativePath });
          const choice = await vscode.window.showInformationMessage(`YAMD: Saved ${saved.relativePath} and linked it in the note.`, 'Reveal File');
          if (choice === 'Reveal File') void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(saved.file));
          panel.dispose();
        } catch (err) {
          void panel.webview.postMessage({ type: 'error', message: `Could not save the recording: ${err instanceof Error ? err.message : String(err)}` });
        }
      };

      panel.webview.onDidReceiveMessage(async (m: { type: string; mime?: string; data?: string; label?: string }) => {
        if (m.type === 'save' && m.data) {
          await finish({ mime: m.mime || 'audio/webm', bytes: new Uint8Array(Buffer.from(m.data, 'base64')), ...(m.label ? { label: m.label } : {}) });
        } else if (m.type === 'browser') {
          try {
            session.server?.close();
            const server = await startUploadServer(() => recorderHtml({ mode: 'browser' }));
            session.server = server;
            const external = await vscode.env.asExternalUri(vscode.Uri.parse(server.url));
            await vscode.env.openExternal(external);
            void panel.webview.postMessage({ type: 'browser-started' });
            const upload = await server.upload;
            await finish(upload);
          } catch (err) {
            if (!(err instanceof Error && err.message === 'closed')) void panel.webview.postMessage({ type: 'error', message: `Could not record in the browser: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
      });
    }),
  );
}
