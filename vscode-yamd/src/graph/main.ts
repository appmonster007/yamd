// Runs inside the graph webview. Layout with d3-force, drawn on a canvas.
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface RawNode {
  id: string;
  label: string;
  missing: boolean;
  tags: string[];
  /** Path relative to the workspace folder (empty for notes that don't exist yet). */
  path: string;
  /** Folder of the note, relative to the workspace folder. */
  folder: string;
}

interface Node extends SimulationNodeDatum, RawNode {
  degree: number;
  /** Index into the legend's colors, or -1 for "other". */
  group: number;
  pinned: boolean;
}
type Link = SimulationLinkDatum<Node>;

interface DataMessage {
  type: 'data';
  nodes: RawNode[];
  edges: { source: string; target: string }[];
  focus: string | null;
  mode: 'global' | 'local';
  depth: number;
}

interface Settings {
  labels: 'auto' | 'always' | 'never';
  color: 'folder' | 'tag' | 'none';
  arrows: boolean;
  orphans: boolean;
  missing: boolean;
  distance: number;
  repel: number;
}

const DEFAULTS: Settings = { labels: 'auto', color: 'folder', arrows: false, orphans: true, missing: true, distance: 80, repel: 240 };

/** Colors for the legend's groups, readable on both light and dark themes. */
const PALETTE = ['#3794ff', '#2ea043', '#d29922', '#f85149', '#a371f7', '#1abc9c', '#db61a2', '#e0823d'];

/** Above this many nodes the layout is computed up front and then left alone. */
const LARGE = 1500;

const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('graph');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const tooltip = $('tooltip');
const legend = $('legend');
const empty = $('empty');

let settings: Settings = { ...DEFAULTS, ...((vscode.getState() as { settings?: Partial<Settings> } | undefined)?.settings ?? {}) };
let raw: DataMessage | undefined;
let scope: 'global' | 'local' = 'global';
let depth = 1;
let focus: string | null = null;
let query = '';

let nodes: Node[] = [];
let links: Link[] = [];
let byId = new Map<string, Node>();
let neighbors = new Map<string, Set<string>>();
let matches: Set<string> | undefined;
let groups: { name: string; count: number }[] = [];
let simulation: Simulation<Node, Link> | undefined;
let view = { x: 0, y: 0, k: 1 };
let hover: Node | undefined;
let labelDegree = 0;
/** Positions kept across updates, so editing a note doesn't scramble the layout. */
const positions = new Map<string, { x: number; y: number; pinned: boolean }>();
let fitNext = true;

// ---- Drawing ----

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

let drawQueued = false;
function schedule() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    draw();
  });
}

function resize() {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(window.innerWidth * ratio));
  const h = Math.max(1, Math.floor(window.innerHeight * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  schedule();
}

const radius = (n: Node) => 4 + Math.min(9, Math.sqrt(n.degree) * 2.2);
const colorOf = (n: Node, muted: string) => (n.group >= 0 ? (PALETTE[n.group % PALETTE.length] as string) : muted);

/** The nodes drawn at full strength: the hovered one and its neighbors, or the search matches. */
function emphasized(): Set<string> | undefined {
  if (hover) return new Set([hover.id, ...(neighbors.get(hover.id) ?? [])]);
  return matches;
}

function showLabel(n: Node, strong: Set<string> | undefined): boolean {
  if (settings.labels === 'never') return n === hover || n.id === focus;
  if (settings.labels === 'always') return true;
  if (n === hover || n.id === focus || strong?.has(n.id)) return true;
  if (nodes.length <= 40 || view.k >= 1.1) return true;
  return n.degree >= labelDegree && view.k >= 0.45;
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.width / ratio;
  const h = canvas.height / ratio;
  const fg = cssVar('--vscode-foreground', '#ccc');
  const muted = cssVar('--vscode-descriptionForeground', '#888');
  const accent = cssVar('--vscode-textLink-foreground', '#3794ff');
  const bg = cssVar('--vscode-editor-background', '#1e1e1e');

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2 + view.x, h / 2 + view.y);
  ctx.scale(view.k, view.k);

  const strong = emphasized();
  const dim = strong !== undefined;
  const px = 1 / view.k;

  // Links.
  for (const l of links) {
    const s = l.source as Node;
    const t = l.target as Node;
    const lit = strong ? (hover ? s === hover || t === hover : strong.has(s.id) && strong.has(t.id)) : false;
    ctx.strokeStyle = lit ? accent : muted;
    ctx.globalAlpha = dim ? (lit ? 0.9 : 0.06) : Math.min(0.5, 0.18 + view.k * 0.2);
    ctx.lineWidth = (lit ? 1.6 : 1) * px;
    ctx.beginPath();
    ctx.moveTo(s.x ?? 0, s.y ?? 0);
    ctx.lineTo(t.x ?? 0, t.y ?? 0);
    ctx.stroke();
    if (settings.arrows) {
      // A small arrowhead where the link meets its target.
      const dx = (t.x ?? 0) - (s.x ?? 0);
      const dy = (t.y ?? 0) - (s.y ?? 0);
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const r = Math.max(radius(t), 2.5 * px) + 1.5 * px;
        const ux = dx / len;
        const uy = dy / len;
        const tipX = (t.x ?? 0) - ux * r;
        const tipY = (t.y ?? 0) - uy * r;
        const size = 6 * px;
        ctx.fillStyle = lit ? accent : muted;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * size - uy * size * 0.45, tipY - uy * size + ux * size * 0.45);
        ctx.lineTo(tipX - ux * size + uy * size * 0.45, tipY - uy * size - ux * size * 0.45);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Nodes.
  for (const n of nodes) {
    const r = Math.max(radius(n), 2.5 * px);
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    ctx.globalAlpha = dim && !strong.has(n.id) ? 0.18 : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (n.missing) {
      // Notes that don't exist yet are hollow and dashed.
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([3 * px, 2.5 * px]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = colorOf(n, muted);
      ctx.fill();
      // A thin edge in the background color keeps overlapping nodes apart.
      ctx.strokeStyle = bg;
      ctx.lineWidth = 1 * px;
      ctx.stroke();
    }
    if (n.id === focus) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (n === hover) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5 * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (n.pinned) {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2 * px, r * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Labels last, with a halo in the background color so they stay readable over links.
  ctx.font = `${12 * px}px ${cssVar('--vscode-font-family', 'sans-serif')}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const n of nodes) {
    if (!showLabel(n, strong)) continue;
    const faded = dim && !strong.has(n.id);
    ctx.globalAlpha = faded ? 0.25 : 1;
    const text = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
    const x = n.x ?? 0;
    const y = (n.y ?? 0) + Math.max(radius(n), 2.5 * px) + 13 * px;
    ctx.lineWidth = 3.5 * px;
    ctx.strokeStyle = bg;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = n.missing ? muted : fg;
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

// ---- Data ----

function groupName(n: RawNode): string {
  if (settings.color === 'tag') return (n.tags[0] ?? '').split('/')[0] || '';
  // Notes directly in the workspace folder are a group of their own.
  return n.folder.split('/')[0] || 'Workspace root';
}

function rebuild() {
  if (!raw) return;
  scope = raw.mode;
  depth = raw.depth;
  focus = raw.focus;
  for (const n of nodes) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, pinned: n.pinned });

  // Which notes are shown: optionally without orphans and notes that don't exist yet.
  const degree = new Map<string, number>();
  for (const e of raw.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const visible = raw.nodes.filter((n) => {
    if (n.missing && !settings.missing) return false;
    if (!settings.orphans && (degree.get(n.id) ?? 0) === 0 && n.id !== raw?.focus) return false;
    return true;
  });
  const shown = new Set(visible.map((n) => n.id));
  const edges = raw.edges.filter((e) => shown.has(e.source) && shown.has(e.target));
  const shownDegree = new Map<string, number>();
  for (const e of edges) {
    shownDegree.set(e.source, (shownDegree.get(e.source) ?? 0) + 1);
    shownDegree.set(e.target, (shownDegree.get(e.target) ?? 0) + 1);
  }

  // Groups: the biggest few get colors, the rest share one.
  const counts = new Map<string, number>();
  if (settings.color !== 'none') for (const n of visible) if (!n.missing) counts.set(groupName(n), (counts.get(groupName(n)) ?? 0) + 1);
  const ranked = [...counts].filter(([name]) => name !== '').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PALETTE.length);
  groups = ranked.map(([name, count]) => ({ name, count }));
  const groupIndex = new Map(ranked.map(([name], i) => [name, i]));

  nodes = visible.map((n) => {
    const kept = positions.get(n.id);
    return {
      ...n,
      degree: shownDegree.get(n.id) ?? 0,
      group: settings.color === 'none' || n.missing ? -1 : (groupIndex.get(groupName(n)) ?? -1),
      pinned: kept?.pinned ?? false,
      ...(kept ? { x: kept.x, y: kept.y, ...(kept.pinned ? { fx: kept.x, fy: kept.y } : {}) } : {}),
    };
  });
  byId = new Map(nodes.map((n) => [n.id, n]));
  links = edges.map((e) => ({ source: e.source, target: e.target }));
  neighbors = new Map();
  for (const e of edges) {
    (neighbors.get(e.source) ?? neighbors.set(e.source, new Set()).get(e.source))?.add(e.target);
    (neighbors.get(e.target) ?? neighbors.set(e.target, new Set()).get(e.target))?.add(e.source);
  }
  const degrees = nodes.map((n) => n.degree).sort((a, b) => a - b);
  labelDegree = Math.max(2, degrees[Math.floor(degrees.length * 0.9)] ?? 2);
  hover = undefined;
  hideTooltip();
  applySearch();
  startSimulation();
  updateChrome();
}

function startSimulation() {
  simulation?.stop();
  const sim = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links).id((n) => n.id).distance(settings.distance).strength(0.6))
    .force('charge', forceManyBody().strength(-settings.repel))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.035))
    .force('y', forceY(0).strength(0.035))
    .on('tick', schedule);
  simulation = sim;
  const fresh = nodes.filter((n) => !positions.has(n.id)).length;
  if (fresh > 0) {
    // New notes get a decent layout straight away instead of flying in from the middle.
    sim.stop();
    sim.tick(nodes.length > LARGE ? 120 : Math.min(300, 60 + fresh * 2));
    if (nodes.length <= LARGE) sim.alpha(0.25).restart();
  } else {
    sim.alpha(0.15).restart();
  }
  if (fitNext && nodes.length) {
    fitNext = false;
    fit(false);
  }
  schedule();
}

// ---- Search ----

function applySearch() {
  const q = query.trim().toLowerCase();
  if (!q) {
    matches = undefined;
    return;
  }
  const tag = q.startsWith('#') ? q.slice(1) : undefined;
  matches = new Set(
    nodes
      .filter((n) =>
        tag !== undefined
          ? n.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`))
          : n.label.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
      )
      .map((n) => n.id),
  );
}

// ---- View ----

let animation = 0;

function setView(target: { x: number; y: number; k: number }, animate: boolean) {
  cancelAnimationFrame(animation);
  if (!animate) {
    view = target;
    schedule();
    return;
  }
  const from = { ...view };
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 260);
    const e = 1 - (1 - t) ** 3;
    view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
    schedule();
    if (t < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

/** Frames the given notes (all of them by default) with room for the toolbars. */
function fit(animate = true, only?: Node[]) {
  const list = only?.length ? only : nodes;
  if (!list.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of list) {
    minX = Math.min(minX, n.x ?? 0);
    maxX = Math.max(maxX, n.x ?? 0);
    minY = Math.min(minY, n.y ?? 0);
    maxY = Math.max(maxY, n.y ?? 0);
  }
  const top = 70;
  const w = Math.max(1, window.innerWidth - 80);
  const h = Math.max(1, window.innerHeight - top - 50);
  const bw = Math.max(maxX - minX, 60);
  const bh = Math.max(maxY - minY, 60);
  const k = Math.min(w / bw, h / bh, only?.length === 1 ? 1.5 : 2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  setView({ k, x: -cx * k, y: -cy * k + (top - 50) / 2 }, animate);
}

function zoomBy(factor: number, cx = window.innerWidth / 2, cy = window.innerHeight / 2) {
  const before = toWorld(cx, cy);
  const k = Math.min(5, Math.max(0.08, view.k * factor));
  setView({ k, x: cx - window.innerWidth / 2 - before.x * k, y: cy - window.innerHeight / 2 - before.y * k }, false);
}

function toWorld(clientX: number, clientY: number) {
  return { x: (clientX - window.innerWidth / 2 - view.x) / view.k, y: (clientY - window.innerHeight / 2 - view.y) / view.k };
}

function nodeAt(clientX: number, clientY: number): Node | undefined {
  const p = toWorld(clientX, clientY);
  let best: Node | undefined;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
    if (d <= Math.max(radius(n), 2.5 / view.k) + 5 / view.k && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

// ---- Tooltip ----

function showTooltip(n: Node, clientX: number, clientY: number) {
  tooltip.replaceChildren();
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = n.label;
  tooltip.append(title);
  if (n.missing) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Doesn't exist yet. Click to create it. Linked from ${n.degree} note${n.degree === 1 ? '' : 's'}.`;
    tooltip.append(meta);
  } else {
    const path = document.createElement('div');
    path.className = 'path';
    path.textContent = n.path;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${n.degree} link${n.degree === 1 ? '' : 's'}${n.pinned ? ' · pinned (double-click to release)' : ''}`;
    tooltip.append(path, meta);
    if (n.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      for (const t of n.tags.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = `#${t}`;
        tags.append(chip);
      }
      tooltip.append(tags);
    }
  }
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const left = Math.min(clientX + 14, window.innerWidth - box.width - 8);
  const top = Math.min(clientY + 14, window.innerHeight - box.height - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

// ---- Interaction ----

let press: { node?: Node; x: number; y: number; moved: boolean; viewX: number; viewY: number } | undefined;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  press = { node: nodeAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY, moved: false, viewX: view.x, viewY: view.y };
  hideTooltip();
});

canvas.addEventListener('pointermove', (e) => {
  if (press) {
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      press.moved = true;
      canvas.classList.add('dragging');
      if (press.node) simulation?.alphaTarget(0.3).restart();
    }
    if (press.moved) {
      if (press.node) {
        // Dragging a note moves it and pins it where it is dropped.
        const p = toWorld(e.clientX, e.clientY);
        press.node.fx = p.x;
        press.node.fy = p.y;
        press.node.pinned = true;
      } else {
        setView({ ...view, x: press.viewX + dx, y: press.viewY + dy }, false);
      }
      schedule();
    }
    return;
  }
  const n = nodeAt(e.clientX, e.clientY);
  if (n !== hover) {
    hover = n;
    canvas.classList.toggle('over-node', Boolean(n));
    schedule();
  }
  if (n) showTooltip(n, e.clientX, e.clientY);
  else hideTooltip();
});

canvas.addEventListener('pointerup', (e) => {
  const p = press;
  press = undefined;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (!p) return;
  if (p.node && p.moved) simulation?.alphaTarget(0);
  else if (p.node) vscode.postMessage({ type: 'open', id: p.node.id });
});

canvas.addEventListener('pointerleave', () => {
  if (press) return;
  hover = undefined;
  canvas.classList.remove('over-node');
  hideTooltip();
  schedule();
});

canvas.addEventListener('dblclick', (e) => {
  const n = nodeAt(e.clientX, e.clientY);
  if (n?.pinned) {
    n.fx = null;
    n.fy = null;
    n.pinned = false;
    simulation?.alpha(0.4).restart();
    schedule();
  } else if (!n) fit();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), e.clientX, e.clientY);
  },
  { passive: false },
);

canvas.tabIndex = 0;
canvas.addEventListener('keydown', (e) => {
  const step = 60;
  if (e.key === '+' || e.key === '=') zoomBy(1.25);
  else if (e.key === '-') zoomBy(0.8);
  else if (e.key === '0') fit();
  else if (e.key === 'ArrowLeft') setView({ ...view, x: view.x + step }, false);
  else if (e.key === 'ArrowRight') setView({ ...view, x: view.x - step }, false);
  else if (e.key === 'ArrowUp') setView({ ...view, y: view.y + step }, false);
  else if (e.key === 'ArrowDown') setView({ ...view, y: view.y - step }, false);
  else return;
  e.preventDefault();
});

// ---- Controls ----

const search = $<HTMLInputElement>('search');
search.addEventListener('input', () => {
  query = search.value;
  applySearch();
  updateChrome();
  schedule();
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && matches?.size) {
    // Bring the matches into view.
    fit(true, nodes.filter((n) => matches?.has(n.id)));
  } else if (e.key === 'Escape') {
    search.value = '';
    query = '';
    applySearch();
    updateChrome();
    schedule();
  }
});

function postScope(nextScope: 'global' | 'local', nextDepth: number) {
  fitNext = true;
  vscode.postMessage({ type: 'settings', mode: nextScope, depth: nextDepth });
}
$('scope-global').addEventListener('click', () => postScope('global', depth));
$('scope-local').addEventListener('click', () => postScope('local', depth));
$('depth-down').addEventListener('click', () => postScope('local', Math.max(1, depth - 1)));
$('depth-up').addEventListener('click', () => postScope('local', Math.min(5, depth + 1)));
$('zoom-in').addEventListener('click', () => zoomBy(1.3));
$('zoom-out').addEventListener('click', () => zoomBy(1 / 1.3));
$('fit').addEventListener('click', () => fit());

const panel = $('settings');
const toggle = $('settings-toggle');
toggle.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  toggle.setAttribute('aria-expanded', String(!panel.hidden));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden && document.activeElement !== search) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }
});

function save() {
  vscode.setState({ settings });
}

function syncSettings() {
  $<HTMLSelectElement>('labels').value = settings.labels;
  $<HTMLSelectElement>('color').value = settings.color;
  $<HTMLInputElement>('arrows').checked = settings.arrows;
  $<HTMLInputElement>('orphans').checked = settings.orphans;
  $<HTMLInputElement>('missing').checked = settings.missing;
  $<HTMLInputElement>('distance').value = String(settings.distance);
  $<HTMLInputElement>('repel').value = String(settings.repel);
  $('distance-value').textContent = String(settings.distance);
  $('repel-value').textContent = String(settings.repel);
}

function onSetting<K extends keyof Settings>(id: string, key: K, read: (el: HTMLInputElement & HTMLSelectElement) => Settings[K], rebuilds: boolean) {
  const el = $<HTMLInputElement & HTMLSelectElement>(id);
  el.addEventListener('input', () => {
    settings = { ...settings, [key]: read(el) };
    save();
    syncSettings();
    if (rebuilds) rebuild();
    else schedule();
    updateChrome();
  });
}
onSetting('labels', 'labels', (el) => el.value as Settings['labels'], false);
onSetting('color', 'color', (el) => el.value as Settings['color'], true);
onSetting('arrows', 'arrows', (el) => el.checked, false);
onSetting('orphans', 'orphans', (el) => el.checked, true);
onSetting('missing', 'missing', (el) => el.checked, true);

function applyForces() {
  (simulation?.force('link') as ReturnType<typeof forceLink<Node, Link>> | undefined)?.distance(settings.distance);
  (simulation?.force('charge') as ReturnType<typeof forceManyBody> | undefined)?.strength(-settings.repel);
  simulation?.alpha(0.6).restart();
}
for (const [id, key] of [['distance', 'distance'], ['repel', 'repel']] as const) {
  $<HTMLInputElement>(id).addEventListener('input', (e) => {
    settings = { ...settings, [key]: Number((e.target as HTMLInputElement).value) };
    save();
    syncSettings();
    applyForces();
  });
}
$('reset').addEventListener('click', () => {
  settings = { ...DEFAULTS };
  save();
  syncSettings();
  rebuild();
});

// ---- Chrome: counts, legend, empty state ----

function updateChrome() {
  const local = scope === 'local';
  $('scope-global').setAttribute('aria-pressed', String(!local));
  $('scope-local').setAttribute('aria-pressed', String(local));
  $('depth-control').hidden = !local;
  $('depth').textContent = String(depth);

  const total = nodes.length;
  $('count').textContent = matches ? `${matches.size} of ${total} match` : `${total} note${total === 1 ? '' : 's'} · ${links.length} link${links.length === 1 ? '' : 's'}`;
  canvas.setAttribute('aria-label', `Graph of ${total} notes and ${links.length} links. Click a note to open it. Press 0 to fit, plus and minus to zoom.`);

  // Legend.
  legend.replaceChildren();
  const rows: { color?: string; hollow?: boolean; text: string }[] = groups.map((g, i) => ({ color: PALETTE[i], text: `${g.name} (${g.count})` }));
  const others = nodes.filter((n) => !n.missing && n.group < 0).length;
  if (settings.color !== 'none' && rows.length && others) rows.push({ text: `Other (${others})` });
  if (nodes.some((n) => n.missing)) rows.push({ hollow: true, text: `Doesn't exist yet (${nodes.filter((n) => n.missing).length})` });
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const swatch = document.createElement('span');
    swatch.className = `swatch${r.hollow ? ' hollow' : ''}`;
    swatch.style.background = r.color ?? (r.hollow ? '' : cssVar('--vscode-descriptionForeground', '#888'));
    const label = document.createElement('span');
    label.textContent = r.text;
    label.title = r.text;
    row.append(swatch, label);
    legend.append(row);
  }
  legend.hidden = rows.length === 0;

  // Empty state.
  empty.hidden = nodes.length > 0;
  if (!empty.hidden) {
    $('empty-hint').textContent = local && !focus ? 'Open a note to see the notes around it.' : raw && raw.nodes.length ? 'Everything is hidden by the display settings.' : 'Create a note, then link to it with [[double brackets]].';
  }
}

// ---- Messages ----

window.addEventListener('message', (e: MessageEvent<DataMessage>) => {
  if (e.data.type !== 'data') return;
  const scopeChanged = raw !== undefined && (raw.mode !== e.data.mode || raw.focus !== e.data.focus) && e.data.mode === 'local';
  raw = e.data;
  if (scopeChanged) fitNext = true;
  rebuild();
});

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.body);
syncSettings();
resize();
vscode.postMessage({ type: 'ready' });
