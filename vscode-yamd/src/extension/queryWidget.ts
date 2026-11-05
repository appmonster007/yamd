import * as vscode from 'vscode';
import { escapeHtml } from '../core';
import type { WidgetBlock } from '../core/fences';

/** Placeholder until the query widget lands (Phase 4). */
export async function renderQueryWidget(_doc: vscode.TextDocument, block: WidgetBlock): Promise<string> {
  return `<div class="db-error" role="alert"><span class="db-error-code">Soon</span> Query widgets are not available yet (${escapeHtml(block.label)}).</div>`;
}
