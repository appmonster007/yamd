// Runs inside the Properties view: the active note's front matter as typed fields.
export {};

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Property {
  key: string;
  value: unknown;
}

type ToView = {
  type: 'update';
  note: string | null;
  error: string | null;
  properties: Property[];
  readonly: boolean;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;
let adding = false;
let last: ToView | undefined;

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

/** A short glyph for each value type, like the type icons in Notion and Obsidian. */
function glyph(v: unknown): { text: string; title: string } {
  if (typeof v === 'boolean') return { text: '☑', title: 'Checkbox' };
  if (typeof v === 'number') return { text: '#', title: 'Number' };
  if (isDate(v)) return { text: '◷', title: 'Date' };
  if (isList(v)) return { text: '≡', title: 'List' };
  if (v !== null && typeof v === 'object') return { text: '{}', title: 'Nested value' };
  return { text: 'Aa', title: 'Text' };
}

function send(key: string, value: unknown) {
  vscode.postMessage({ type: 'set', key, value });
}

function editor(p: Property, readonly: boolean): HTMLElement {
  const v = p.value;
  const label = { 'aria-label': p.key };
  let input: HTMLInputElement;
  if (typeof v === 'boolean') {
    input = el('input', { type: 'checkbox', checked: v });
    input.onchange = () => send(p.key, input.checked);
  } else if (typeof v === 'number') {
    input = el('input', { type: 'number', value: String(v), class: 'input' });
    input.onchange = () => send(p.key, Number(input.value));
  } else if (isDate(v)) {
    input = el('input', { type: 'date', value: v, class: 'input' });
    input.onchange = () => send(p.key, input.value);
  } else if (isList(v)) {
    input = el('input', { value: v.join(', '), class: 'input', title: 'Comma-separated list', placeholder: 'a, b, c' });
    input.onchange = () => send(p.key, input.value.split(',').map((s) => s.trim()).filter(Boolean));
  } else if (v !== null && typeof v === 'object') {
    input = el('input', { value: JSON.stringify(v), class: 'input', disabled: true, title: 'Edit nested values in the source' });
  } else {
    input = el('input', { value: v === null || v === undefined ? '' : String(v), class: 'input', placeholder: 'Empty' });
    input.onchange = () => send(p.key, input.value);
  }
  input.setAttribute('aria-label', label['aria-label']);
  // Enter commits the value, like a settings field.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  if (readonly) input.disabled = true;
  return input;
}

function addForm(): HTMLElement {
  const name = el('input', { class: 'input', placeholder: 'Property name' });
  name.setAttribute('aria-label', 'New property name');
  const type = el('select', { class: 'select' });
  type.setAttribute('aria-label', 'Property type');
  for (const t of ['Text', 'Number', 'Checkbox', 'Date', 'List']) type.append(new Option(t, t.toLowerCase()));
  const cancel = el('button', { type: 'button', class: 'button secondary', textContent: 'Cancel' });
  const submit = el('button', { type: 'submit', class: 'button', textContent: 'Add' });
  const form = el('form', { class: 'add-form' }, name, type, el('div', { class: 'actions' }, cancel, submit));
  cancel.onclick = () => {
    adding = false;
    if (last) draw(last);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const key = name.value.trim();
    if (!key) {
      name.focus();
      return;
    }
    const initial: Record<string, unknown> = { text: '', number: 0, checkbox: false, date: new Date().toISOString().slice(0, 10), list: [] };
    adding = false;
    send(key, initial[type.value]);
  };
  setTimeout(() => name.focus());
  return form;
}

function draw(m: ToView) {
  last = m;
  root.replaceChildren();
  if (!m.note) {
    root.append(el('div', { class: 'empty' }, el('p', { textContent: 'Open a YAMD note to see its properties.' }), el('p', { class: 'hint', textContent: 'Properties are the keys in the front matter between the --- lines at the top of a note.' })));
    return;
  }
  root.append(el('div', { class: 'note-name', title: m.note, textContent: m.note }));
  if (m.error) {
    root.append(el('div', { class: 'empty' }, el('p', { textContent: 'The front matter is not valid YAML, so it can’t be edited here.' }), el('p', { class: 'hint', textContent: m.error })));
    return;
  }
  const list = el('div', { class: 'properties' });
  for (const p of m.properties) {
    const g = glyph(p.value);
    const key = el('div', { class: 'property-key', title: p.key }, el('span', { class: 'type-glyph', title: g.title, textContent: g.text }), el('span', { textContent: p.key }));
    const remove = el('button', { type: 'button', class: 'icon-button', textContent: '×', title: `Remove ${p.key}`, disabled: m.readonly });
    remove.setAttribute('aria-label', `Remove ${p.key}`);
    remove.onclick = () => vscode.postMessage({ type: 'remove', key: p.key });
    list.append(el('div', { class: 'property' }, key, editor(p, m.readonly), m.readonly ? el('span') : remove));
  }
  if (!m.properties.length) list.append(el('div', { class: 'empty', textContent: 'No properties yet.' }));
  root.append(list);
  if (m.readonly) {
    root.append(el('p', { class: 'hint', textContent: 'Properties are read-only in Restricted Mode.' }));
    return;
  }
  if (adding) root.append(addForm());
  else {
    const add = el('button', { type: 'button', class: 'link add-property', textContent: '+ Add property' });
    add.onclick = () => {
      adding = true;
      draw(m);
    };
    root.append(add);
  }
}

window.addEventListener('message', (e: MessageEvent<ToView>) => {
  if (e.data.type === 'update') draw(e.data);
});
vscode.postMessage({ type: 'ready' });
