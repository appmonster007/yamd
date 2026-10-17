import * as vscode from 'vscode';

/** A random value for the Content Security Policy's script nonce. */
export function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * The HTML for a sidebar webview: the shared stylesheet, `body`, and one bundled script from
 * `dist/`. Nothing loads from the network.
 */
export function sidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri, script: string, body: string): string {
  const n = nonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', script));
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head><body>${body}<script nonce="${n}" src="${js}"></script></body></html>`;
}

export { CONSOLE_BODY, PROPERTIES_BODY } from '../sidebar/markup';
