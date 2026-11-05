// Runs inside the preview webview. Shared by every preview module.

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
export const root = document.getElementById('root') as HTMLElement;

/** Sends an edit made on a board or task; the extension turns it into a change to the note's text. */
export function boardEdit(kind: string, op: string, board: HTMLElement | null, card: { line: number; hash: string } | undefined, args: Record<string, unknown>, source?: string) {
  vscode.postMessage({ type: 'boardEdit', kind, op, board: board ? Number(board.dataset['board']) : 0, card, args, source });
}

export interface State {
  /** Collapsed columns, as `boardLine:columnTitle`. */
  collapsed?: string[];
}

export const state = (): State => (vscode.getState() as State | undefined) ?? {};
