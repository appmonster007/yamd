import * as vscode from 'vscode';
import type { NoteSummary } from '../core/notes';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath } from '../workspace/index';
import {
  blockAttributesLine,
  blockIdSuffix,
  codeBlockSnippet,
  COMMENT_SNIPPET,
  CODE_LANGUAGES,
  crossRefLabel,
  crossRefOrCitation,
  CROSS_REF_KINDS,
  DIAGRAM_BLOCK_SNIPPET,
  embedLink,
  findCrossRefLabels,
  FLASHCARD_BLOCK_SNIPPET,
  footnoteDefinition,
  footnoteMarker,
  frontMatterBlock,
  headingAnchorSuffix,
  highlightWithComment,
  HORIZONTAL_RULE_SNIPPET,
  inlineFootnote,
  MATH_BLOCK_SNIPPET,
  newBlockId,
  QUERY_BLOCK_SNIPPET,
  reviewCommentSnippet,
  TABLE_SNIPPET,
  tagSnippet,
  TOC_SNIPPET,
  trackedDeletion,
  trackedInsertion,
  trackedSubstitution,
  variableSnippet,
  wikiLink,
  wikiLinkWithAlias,
  wrapInAttributes,
} from './insert';

function activeYamdEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.languageId === 'yamd' ? editor : undefined;
}

async function pickNoteSummary(index: WorkspaceIndex, placeHolder: string): Promise<NoteSummary | undefined> {
  await index.whenReady();
  const items = index.store
    .summaries()
    .map((s) => ({ label: s.title || s.path, description: s.path, summary: s }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pick = await vscode.window.showQuickPick(items, { placeHolder });
  return pick?.summary;
}

async function pickNote(index: WorkspaceIndex, placeHolder: string): Promise<string | undefined> {
  return (await pickNoteSummary(index, placeHolder))?.path;
}

/** Optional "note#Heading" / "note#^id" anchor, picked from the target note's own headings/block ids. */
async function pickAnchor(summary: NoteSummary): Promise<string> {
  if (summary.headings.length === 0 && summary.blocks.length === 0) return summary.path;
  const items = [
    { label: '$(file) Whole note', target: summary.path },
    ...summary.headings.map((h) => ({ label: `$(symbol-field) ${h.text}`, target: `${summary.path}#${h.text}` })),
    ...summary.blocks.map((b) => ({ label: `$(symbol-misc) ^${b.id}`, target: `${summary.path}#^${b.id}` })),
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Link to the whole note, a heading, or a block?' });
  return pick?.target ?? summary.path;
}

async function insertLink(index: WorkspaceIndex): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const summary = await pickNoteSummary(index, 'Link to which note?');
  if (!summary) return;
  const target = await pickAnchor(summary);
  const alias = await vscode.window.showInputBox({ prompt: 'Alias (optional, Enter to skip)', placeHolder: 'display text' });
  await editor.insertSnippet(new vscode.SnippetString(wikiLinkWithAlias(target, alias || undefined)));
}

async function insertEmbed(index: WorkspaceIndex): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const summary = await pickNoteSummary(index, 'Embed which note?');
  if (!summary) return;
  const target = await pickAnchor(summary);
  await editor.insertSnippet(new vscode.SnippetString(embedLink(target)));
}

/** "YAMD: Copy Link to This Block": adds a `^id` to the current line if it doesn't have one, and copies the wikilink. */
async function copyBlockLink(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const doc = editor.document;
  const line = doc.lineAt(editor.selection.active.line);
  const existing = /\^([\w-]+)\s*$/.exec(line.text);
  let id = existing?.[1];
  if (!id) {
    id = newBlockId();
    await editor.edit((b) => b.insert(line.range.end, blockIdSuffix(id as string)));
  }
  const path = notePath(doc.uri);
  await vscode.env.clipboard.writeText(`${wikiLink(`${path}#^${id}`)}`);
  void vscode.window.showInformationMessage('YAMD: Link to this block copied to the clipboard.');
}

async function insertFootnote(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const label = await vscode.window.showInputBox({ prompt: 'Footnote label', placeHolder: '1' });
  if (!label) return;
  const doc = editor.document;
  const end = doc.lineAt(doc.lineCount - 1).range.end;
  await editor.edit((b) => {
    b.insert(editor.selection.active, footnoteMarker(label));
    b.insert(end, footnoteDefinition(label));
  });
}

async function insertTag(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const name = await vscode.window.showInputBox({ prompt: 'Tag name', placeHolder: 'project/web' });
  if (!name) return;
  await editor.insertSnippet(new vscode.SnippetString(tagSnippet(name)));
}

async function insertVariable(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const path = await vscode.window.showInputBox({ prompt: 'Variable path', placeHolder: 'vars.course' });
  if (!path) return;
  await editor.insertSnippet(new vscode.SnippetString(variableSnippet(path)));
}

async function insertFrontMatter(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const doc = editor.document;
  if (/^---\r?\n/.test(doc.getText())) {
    void vscode.window.showInformationMessage('YAMD: This note already has front matter.');
    return;
  }
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), frontMatterBlock({ title: '' })));
}

async function wrapSelectionInAttributes(editor: vscode.TextEditor): Promise<void> {
  const attrs = await vscode.window.showInputBox({ prompt: 'Attributes', placeHolder: '#id .class key=value' });
  if (attrs === undefined) return;
  const doc = editor.document;
  await editor.edit((b) => {
    for (const sel of editor.selections) b.replace(sel, wrapInAttributes(doc.getText(sel), attrs));
  });
}

async function insertCodeBlock(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const langPick = await vscode.window.showQuickPick(
    [...CODE_LANGUAGES.map((l) => ({ label: l })), { label: 'Other…' }],
    { placeHolder: 'Language?' },
  );
  if (!langPick) return;
  const lang =
    langPick.label === 'Other…'
      ? await vscode.window.showInputBox({ prompt: 'Language', placeHolder: 'kotlin' })
      : langPick.label;
  if (!lang) return;
  const attrs = await vscode.window.showInputBox({
    prompt: 'Attributes (optional, Enter to skip)',
    placeHolder: 'title="app.py" lines=10-20 highlight=12',
  });
  const { text, cursorOffset } = codeBlockSnippet(lang, attrs || undefined);
  const snippet = new vscode.SnippetString();
  snippet.appendText(text.slice(0, cursorOffset));
  snippet.appendTabstop();
  snippet.appendText(text.slice(cursorOffset));
  await editor.insertSnippet(snippet);
}

async function insertHeadingAnchor(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const doc = editor.document;
  const line = doc.lineAt(editor.selection.active.line);
  if (!/^#{1,6}\s/.test(line.text)) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor on a heading line first.');
    return;
  }
  const suffix = headingAnchorSuffix(line.text);
  if (!suffix) {
    void vscode.window.showInformationMessage('YAMD: This heading already has an anchor.');
    return;
  }
  const slug = suffix.slice(3, -1);
  const edited = await vscode.window.showInputBox({ prompt: 'Anchor id', value: slug });
  if (edited === undefined) return;
  await editor.edit((b) => b.insert(line.range.end, ` {#${edited}}`));
}

async function insertBlockAttributes(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const attrs = await vscode.window.showInputBox({ prompt: 'Block attributes', placeHolder: '#id .class key=value' });
  if (attrs === undefined) return;
  const line = editor.document.lineAt(editor.selection.active.line);
  await editor.edit((b) => b.insert(line.range.start, blockAttributesLine(attrs)));
}

async function insertCrossRefLabel(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const kind = await vscode.window.showQuickPick([...CROSS_REF_KINDS], { placeHolder: 'Label kind?' });
  if (!kind) return;
  const name = await vscode.window.showInputBox({ prompt: 'Name', placeHolder: 'arch' });
  if (!name) return;
  await editor.insertSnippet(new vscode.SnippetString(` ${crossRefLabel(kind, name)}`));
}

async function insertCrossRef(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const labels = findCrossRefLabels(editor.document.getText());
  if (labels.length === 0) {
    void vscode.window.showInformationMessage('YAMD: No cross-reference labels ({#fig:…}, {#tbl:…}, {#eq:…}, {#sec:…}) found in this note.');
    return;
  }
  const key = await vscode.window.showQuickPick(labels, { placeHolder: 'Reference which label?' });
  if (!key) return;
  await editor.insertSnippet(new vscode.SnippetString(crossRefOrCitation(key)));
}

async function insertCitation(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const key = await vscode.window.showInputBox({ prompt: 'Citation key', placeHolder: 'smith2020' });
  if (!key) return;
  await editor.insertSnippet(new vscode.SnippetString(crossRefOrCitation(key)));
}

async function insertInlineFootnote(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const text = await vscode.window.showInputBox({ prompt: 'Footnote text' });
  if (text === undefined) return;
  await editor.insertSnippet(new vscode.SnippetString(inlineFootnote(text)));
}

function selectedTextOrEmpty(editor: vscode.TextEditor): string {
  return editor.document.getText(editor.selection);
}

async function insertTrackedInsertion(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const text = await vscode.window.showInputBox({ prompt: 'Inserted text', value: selectedTextOrEmpty(editor) });
  if (!text) return;
  await editor.insertSnippet(new vscode.SnippetString(trackedInsertion(text)));
}

async function insertTrackedDeletion(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const text = await vscode.window.showInputBox({ prompt: 'Deleted text', value: selectedTextOrEmpty(editor) });
  if (!text) return;
  await editor.insertSnippet(new vscode.SnippetString(trackedDeletion(text)));
}

async function insertTrackedSubstitution(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const oldText = await vscode.window.showInputBox({ prompt: 'Old text', value: selectedTextOrEmpty(editor) });
  if (oldText === undefined) return;
  const newText = await vscode.window.showInputBox({ prompt: 'New text' });
  if (newText === undefined) return;
  await editor.insertSnippet(new vscode.SnippetString(trackedSubstitution(oldText, newText)));
}

async function insertHighlightWithComment(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const text = await vscode.window.showInputBox({ prompt: 'Highlighted text', value: selectedTextOrEmpty(editor) });
  if (!text) return;
  const comment = await vscode.window.showInputBox({ prompt: 'Comment' });
  if (comment === undefined) return;
  await editor.insertSnippet(new vscode.SnippetString(highlightWithComment(text, comment)));
}

async function insertReviewComment(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) return;
  const comment = await vscode.window.showInputBox({ prompt: 'Comment' });
  if (!comment) return;
  await editor.insertSnippet(new vscode.SnippetString(reviewCommentSnippet(comment)));
}

async function insertReviewMarkup(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(diff-added) Tracked Insertion…', command: 'yamd.insertTrackedInsertion' },
      { label: '$(diff-removed) Tracked Deletion…', command: 'yamd.insertTrackedDeletion' },
      { label: '$(diff-modified) Tracked Substitution…', command: 'yamd.insertTrackedSubstitution' },
      { label: '$(symbol-color) Highlight with Comment…', command: 'yamd.insertHighlightWithComment' },
      { label: '$(comment-discussion) Standalone Review Comment…', command: 'yamd.insertReviewComment' },
    ],
    { title: 'YAMD: Insert Review Markup', placeHolder: 'What kind of review markup?' },
  );
  if (!pick) return;
  await vscode.commands.executeCommand(pick.command);
}

function snippetCommand(text: string) {
  return async () => {
    const editor = activeYamdEditor();
    if (!editor) return;
    await editor.insertSnippet(new vscode.SnippetString(text));
  };
}

async function insertMenu(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(link) Link…', command: 'yamd.insertLink' },
      { label: '$(file-symlink-file) Embed…', command: 'yamd.insertEmbed' },
      { label: '$(symbol-misc) Block…', command: 'yamd.insertBlock' },
      { label: '$(code) Code Block…', command: 'yamd.insertCodeBlock' },
      { label: '$(note) Footnote…', command: 'yamd.insertFootnote' },
      { label: '$(note) Inline Footnote…', command: 'yamd.insertInlineFootnote' },
      { label: '$(tag) Tag…', command: 'yamd.insertTag' },
      { label: '$(variable) Variable…', command: 'yamd.insertVariable' },
      { label: '$(table) Table', command: 'yamd.insertTable' },
      { label: '$(symbol-operator) Math Block', command: 'yamd.insertMathBlock' },
      { label: '$(type-hierarchy) Diagram Block', command: 'yamd.insertDiagramBlock' },
      { label: '$(comment) Comment', command: 'yamd.insertComment' },
      { label: '$(list-unordered) Front Matter', command: 'yamd.insertFrontMatter' },
      { label: '$(bracket) Wrap in Attributes', command: 'yamd.wrapInAttributes' },
      { label: '$(symbol-field) Block Attributes…', command: 'yamd.insertBlockAttributes' },
      { label: '$(symbol-field) Heading Anchor', command: 'yamd.insertHeadingAnchor' },
      { label: '$(horizontal-rule) Horizontal Rule', command: 'yamd.insertHorizontalRule' },
      { label: '$(list-tree) Table of Contents', command: 'yamd.insertTableOfContents' },
      { label: '$(database) Database View…', command: 'yamd.insertDatabaseView' },
      { label: '$(mortar-board) Flashcard Block', command: 'yamd.insertFlashcardBlock' },
      { label: '$(search) Query Block', command: 'yamd.insertQueryBlock' },
      { label: '$(symbol-numeric) Cross-reference Label…', command: 'yamd.insertCrossRefLabel' },
      { label: '$(symbol-numeric) Cross-reference…', command: 'yamd.insertCrossRef' },
      { label: '$(quote) Citation…', command: 'yamd.insertCitation' },
      { label: '$(git-compare) Review Markup…', command: 'yamd.insertReviewMarkup' },
    ],
    { title: 'YAMD: Insert', placeHolder: 'What do you want to insert?' },
  );
  if (!pick) return;
  await vscode.commands.executeCommand(pick.command);
}

export function registerInsertCommands(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.insertLink', () => insertLink(index)),
    vscode.commands.registerCommand('yamd.insertEmbed', () => insertEmbed(index)),
    vscode.commands.registerCommand('yamd.copyBlockLink', () => copyBlockLink()),
    vscode.commands.registerCommand('yamd.insertFootnote', () => insertFootnote()),
    vscode.commands.registerCommand('yamd.insertTag', () => insertTag()),
    vscode.commands.registerCommand('yamd.insertVariable', () => insertVariable()),
    vscode.commands.registerCommand('yamd.insertFrontMatter', () => insertFrontMatter()),
    vscode.commands.registerTextEditorCommand('yamd.wrapInAttributes', (editor) => void wrapSelectionInAttributes(editor)),
    vscode.commands.registerCommand('yamd.insertTable', snippetCommand(TABLE_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertMathBlock', snippetCommand(MATH_BLOCK_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertDiagramBlock', snippetCommand(DIAGRAM_BLOCK_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertComment', snippetCommand(COMMENT_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertHorizontalRule', snippetCommand(HORIZONTAL_RULE_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertTableOfContents', snippetCommand(TOC_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertQueryBlock', snippetCommand(QUERY_BLOCK_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertFlashcardBlock', snippetCommand(FLASHCARD_BLOCK_SNIPPET)),
    vscode.commands.registerCommand('yamd.insertCodeBlock', () => insertCodeBlock()),
    vscode.commands.registerCommand('yamd.insertHeadingAnchor', () => insertHeadingAnchor()),
    vscode.commands.registerCommand('yamd.insertBlockAttributes', () => insertBlockAttributes()),
    vscode.commands.registerCommand('yamd.insertCrossRefLabel', () => insertCrossRefLabel()),
    vscode.commands.registerCommand('yamd.insertCrossRef', () => insertCrossRef()),
    vscode.commands.registerCommand('yamd.insertCitation', () => insertCitation()),
    vscode.commands.registerCommand('yamd.insertInlineFootnote', () => insertInlineFootnote()),
    vscode.commands.registerCommand('yamd.insertTrackedInsertion', () => insertTrackedInsertion()),
    vscode.commands.registerCommand('yamd.insertTrackedDeletion', () => insertTrackedDeletion()),
    vscode.commands.registerCommand('yamd.insertTrackedSubstitution', () => insertTrackedSubstitution()),
    vscode.commands.registerCommand('yamd.insertHighlightWithComment', () => insertHighlightWithComment()),
    vscode.commands.registerCommand('yamd.insertReviewComment', () => insertReviewComment()),
    vscode.commands.registerCommand('yamd.insertReviewMarkup', () => insertReviewMarkup()),
    vscode.commands.registerCommand('yamd.insertMenu', () => insertMenu()),
  );
}
