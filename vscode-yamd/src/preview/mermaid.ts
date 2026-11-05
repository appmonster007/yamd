// Runs inside VS Code's Markdown preview and inside exported pages: draws ```mermaid blocks as diagrams.
import mermaid from 'mermaid';

const SELECTOR = 'pre.yamd-mermaid > code, code.language-mermaid';
let counter = 0;

function isDark(): boolean {
  const body = document.body.classList;
  if (body.contains('vscode-light')) return false;
  if (body.contains('vscode-dark') || body.contains('vscode-high-contrast')) return true;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

async function draw(): Promise<void> {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter((c) => !c.closest('.yamd-mermaid-done'));
  if (!blocks.length) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' });
  for (const code of blocks) {
    const holder = code.closest<HTMLElement>('.code-block') ?? code.closest<HTMLElement>('pre') ?? code;
    const source = code.textContent ?? '';
    const id = `yamd-mermaid-${counter++}`;
    try {
      const { svg } = await mermaid.render(id, source);
      const figure = document.createElement('div');
      figure.className = 'yamd-mermaid-done';
      figure.innerHTML = svg;
      const line = holder.getAttribute('data-line');
      if (line) figure.setAttribute('data-line', line);
      figure.title = 'Mermaid diagram';
      holder.replaceWith(figure);
    } catch (err) {
      // Mermaid leaves its own error drawing in the page.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      holder.classList.add('yamd-mermaid-error');
      holder.insertAdjacentHTML('beforebegin', `<div class="yamd-mermaid-message" style="color:#d73a49;font-size:12px">Mermaid: ${String(err instanceof Error ? err.message : err).split('\n')[0]?.replace(/</g, '&lt;')}</div>`);
    }
  }
}

const style = document.createElement('style');
style.textContent = '.yamd-mermaid-done{margin:1em 0;text-align:center;overflow-x:auto}.yamd-mermaid-done svg{max-width:100%;height:auto}';
document.head.append(style);

const start = () => void draw();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
// VS Code's preview announces new content after every edit.
window.addEventListener('vscode.markdown.updateContent', start);
