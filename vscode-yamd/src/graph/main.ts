// Runs inside the graph webview. Layout with d3-force, drawn on a canvas.
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Node extends SimulationNodeDatum {
  id: string;
  label: string;
  missing: boolean;
  degree: number;
}
type Link = SimulationLinkDatum<Node>;

interface DataMessage {
  type: 'data';
  nodes: { id: string; label: string; missing: boolean }[];
  edges: { source: string; target: string }[];
  focus: string | null;
  mode: 'global' | 'local';
  depth: number;
  filter: string;
}

/** Above this many nodes, the layout runs a fixed number of ticks and stops. */
const LARGE = 2000;

const vscode = acquireVsCodeApi();
const canvas = document.getElementById('graph') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const mode = document.getElementById('mode') as HTMLSelectElement;
const depth = document.getElementById('depth') as HTMLInputElement;
const depthLabel = document.getElementById('depthLabel') as HTMLElement;
const filter = document.getElementById('filter') as HTMLInputElement;
const count = document.getElementById('count') as HTMLElement;

let nodes: Node[] = [];
let links: Link[] = [];
let focus: string | null = null;
let simulation: Simulation<Node, Link> | undefined;
let view = { x: 0, y: 0, k: 1 };
let hover: Node | undefined;
const positions = new Map<string, { x: number; y: number }>();

const css = (name: string, fallback: string) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function radius(n: Node) {
  return 4 + Math.min(8, Math.sqrt(n.degree) * 2);
}

function draw() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2 + view.x, h / 2 + view.y);
  ctx.scale(view.k, view.k);
  const fg = css('--vscode-foreground', '#ccc');
  const muted = css('--vscode-descriptionForeground', '#888');
  const accent = css('--vscode-textLink-foreground', '#3794ff');
  const neighbors = new Set<string>();
  if (hover) {
    for (const l of links) {
      const s = l.source as Node;
      const t = l.target as Node;
      if (s === hover) neighbors.add(t.id);
      if (t === hover) neighbors.add(s.id);
    }
  }
  ctx.lineWidth = 1 / view.k;
  for (const l of links) {
    const s = l.source as Node;
    const t = l.target as Node;
    const lit = hover && (s === hover || t === hover);
    ctx.strokeStyle = lit ? accent : muted;
    ctx.globalAlpha = hover && !lit ? 0.15 : 0.45;
    ctx.beginPath();
    ctx.moveTo(s.x ?? 0, s.y ?? 0);
    ctx.lineTo(t.x ?? 0, t.y ?? 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const n of nodes) {
    const r = radius(n);
    const dim = hover && n !== hover && !neighbors.has(n.id);
    ctx.globalAlpha = dim ? 0.3 : 1;
    ctx.beginPath();
    ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
    const color = n.id === focus ? accent : fg;
    if (n.missing) {
      // Notes that don't exist yet are hollow.
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1.5 / view.k;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (view.k > 0.6 || n === hover || n.id === focus || nodes.length < 60) {
      ctx.fillStyle = n.missing ? muted : fg;
      ctx.font = `${12 / Math.max(view.k, 0.6)}px ${css('--vscode-font-family', 'sans-serif')}`;
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x ?? 0, (n.y ?? 0) + r + 12 / Math.max(view.k, 0.6));
    }
  }
  ctx.restore();
}

function toWorld(clientX: number, clientY: number) {
  return {
    x: (clientX - window.innerWidth / 2 - view.x) / view.k,
    y: (clientY - window.innerHeight / 2 - view.y) / view.k,
  };
}

function nodeAt(clientX: number, clientY: number): Node | undefined {
  const p = toWorld(clientX, clientY);
  let best: Node | undefined;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
    if (d <= radius(n) + 4 / view.k && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

function load(m: DataMessage) {
  focus = m.focus;
  mode.value = m.mode;
  depth.value = String(m.depth);
  depthLabel.style.display = m.mode === 'local' ? '' : 'none';
  if (document.activeElement !== filter) filter.value = m.filter;
  for (const n of nodes) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  const degree = new Map<string, number>();
  for (const e of m.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  nodes = m.nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0, ...positions.get(n.id) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  links = m.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: e.source, target: e.target }));
  count.textContent = `${nodes.length} notes · ${links.length} links`;
  simulation?.stop();
  simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links).id((n) => n.id).distance(90))
    .force('charge', forceManyBody().strength(-260))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.04))
    .on('tick', draw);
  if (nodes.length > LARGE) {
    simulation.stop();
    simulation.tick(150);
    draw();
  }
}

// Pan by dragging the background, zoom with the wheel, click a node to open it.
let drag: { x: number; y: number; moved: boolean } | undefined;
canvas.addEventListener('mousedown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
});
window.addEventListener('mousemove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    view = { ...view, x: view.x + dx, y: view.y + dy };
    drag.x = e.clientX;
    drag.y = e.clientY;
    draw();
    return;
  }
  const n = nodeAt(e.clientX, e.clientY);
  if (n !== hover) {
    hover = n;
    canvas.style.cursor = n ? 'pointer' : 'grab';
    canvas.title = n ? n.label : '';
    draw();
  }
});
window.addEventListener('mouseup', (e) => {
  const wasDrag = drag?.moved;
  drag = undefined;
  if (wasDrag) return;
  const n = nodeAt(e.clientX, e.clientY);
  if (n) vscode.postMessage({ type: 'open', id: n.id });
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const before = toWorld(e.clientX, e.clientY);
    const k = Math.min(4, Math.max(0.1, view.k * Math.exp(-e.deltaY * 0.001)));
    view = {
      k,
      x: e.clientX - window.innerWidth / 2 - before.x * k,
      y: e.clientY - window.innerHeight / 2 - before.y * k,
    };
    draw();
  },
  { passive: false },
);

function settings() {
  vscode.postMessage({ type: 'settings', mode: mode.value, depth: Number(depth.value), filter: filter.value });
}
mode.addEventListener('change', settings);
depth.addEventListener('change', settings);
let filterTimer: ReturnType<typeof setTimeout> | undefined;
filter.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(settings, 250);
});

window.addEventListener('resize', resize);
window.addEventListener('message', (e: MessageEvent<DataMessage>) => {
  if (e.data.type === 'data') load(e.data);
});
resize();
vscode.postMessage({ type: 'ready' });
