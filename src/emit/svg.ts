/**
 * Laid-out graph -> SVG. Phase 3 task 4.
 *
 * The fork this task named was DOM or graph, and this is the graph. Serialising
 * the React Flow canvas would preserve its smoothstep curves for free, but the
 * shapes there are CSS `clip-path` and the colours are custom properties, so
 * every style would have to be inlined anyway — and the result would need a
 * browser, which puts the whole of Phase 3's most testable output out of reach
 * of Node.
 *
 * Drawing from the graph costs the edge routing, and that turned out to be
 * free: ELK was already configured `elk.edgeRouting: ORTHOGONAL` and returns a
 * polyline per edge that React Flow throws away. This emitter draws it. The
 * result is a wiring diagram with straight segments rather than curves, which
 * is what the file is.
 *
 * Pure. No DOM, no React, no measurement — sizes and positions come from ELK,
 * so nothing here has to wait for a layout pass or a `ResizeObserver`.
 */

import { EDGE_COLOR, SIZE, type FlowEdge, type FlowNode } from './flow';
import type { Point } from '../layout/elkGraph';

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export interface Palette {
  bg: string;
  node: string;
  nodeCollapsed: string;
  group: string;
  groupLine: string;
  line: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  action: string;
  decision: string;
  criteria: string;
  jump: string;
}

/** The canvas, exactly. An export that does not look like the screen is a bug. */
export const DARK: Palette = {
  bg: '#12151b',
  node: '#1e232d',
  nodeCollapsed: '#1b212b',
  group: 'rgba(255,255,255,0.018)',
  groupLine: '#2a313d',
  line: '#2a313d',
  text: '#dfe4ec',
  textDim: '#98a1b2',
  textFaint: '#6b7688',
  accent: '#5aa2e8',
  action: '#3c86c9',
  decision: '#c98f2e',
  criteria: '#cf5b52',
  jump: '#9a6bd0',
};

/**
 * For a printed traveller or a report, where a dark page is a waste of toner.
 * Same hues, darkened enough to hold contrast on white.
 */
export const LIGHT: Palette = {
  bg: '#ffffff',
  node: '#ffffff',
  nodeCollapsed: '#f2f4f7',
  group: 'rgba(0,0,0,0.02)',
  groupLine: '#c9d0da',
  line: '#aeb7c4',
  text: '#1b2027',
  textDim: '#4d5766',
  textFaint: '#6b7688',
  accent: '#2f6fb5',
  action: '#2f6fb5',
  decision: '#9a6c12',
  criteria: '#b03a31',
  jump: '#6f45a8',
};

export type Theme = 'dark' | 'light';

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface SvgOptions {
  theme?: Theme;
  /** Blank margin around the drawing, in px. */
  padding?: number;
  /** ELK's orthogonal routes, by edge id. Without them, edges are elbows. */
  routes?: ReadonlyMap<string, Point[]>;
  /**
   * Honour the `dimmed` / `on-path` classes the app puts on nodes and edges,
   * so the export carries whatever highlight is set up on screen. Off exports
   * the graph plain — see the note in Export.tsx about saying which.
   */
  highlight?: boolean;
  /** Drawn bottom-left. Deterministic: never a timestamp. */
  title?: string;
}

export interface SvgResult {
  text: string;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

interface Placed extends FlowNode {
  ax: number;
  ay: number;
}

/**
 * Absolute positions. A node inside a group carries a parent-relative
 * position, exactly as `graphBounds` handles it. Cycle-guarded.
 */
function place(nodes: readonly FlowNode[]): Placed[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((node) => {
    let x = 0;
    let y = 0;
    let cursor: FlowNode | undefined = node;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      x += cursor.position.x;
      y += cursor.position.y;
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
    return { ...node, ax: x, ay: y };
  });
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** XML text content. Attributes are quoted with `"`, so that is escaped too. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Greedy word wrap to at most `lines`, ellipsising the overflow.
 *
 * Character counting rather than real measurement: the same estimate
 * `flow.ts` used to size the box in the first place, so the text and the box
 * agree. Real metrics need a DOM, and this file does not have one.
 */
export function wrapText(text: string, width: number, lines = 2): string[] {
  const perLine = Math.max(4, Math.floor(width / (SIZE.charWidth * 0.92)));
  if (text.length <= perLine) return [text];

  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current !== '') out.push(current);
    current = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && current !== '') out.push(current);

  if (out.length === 0) out.push(text.slice(0, perLine));
  // A single word longer than the line still has to be cut somewhere.
  const last = out.length - 1;
  const tail = out[last] ?? '';
  const consumed = out.join(' ').length;
  if (tail.length > perLine || consumed < text.length) {
    out[last] = `${tail.slice(0, Math.max(1, perLine - 1))}…`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Outline colour per shape, matching the canvas CSS. */
function strokeFor(node: FlowNode, p: Palette): string {
  if (node.data.collapsed !== undefined) return p.textFaint;
  switch (node.data.shape) {
    case 'diamond':
      return p.decision;
    case 'hexagon':
      return p.criteria;
    case 'rounded':
      return p.jump;
    default:
      return p.line;
  }
}

function shapeOf(node: Placed, p: Palette): string {
  const { ax: x, ay: y, width: w, height: h } = node;
  const fill = node.data.collapsed === undefined ? p.node : p.nodeCollapsed;
  const stroke = strokeFor(node, p);
  const dash = node.data.collapsed === undefined ? '' : ' stroke-dasharray="5 4"';

  switch (node.data.shape) {
    case 'diamond':
      return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    case 'hexagon': {
      const i = w * 0.12;
      return `<polygon points="${x + i},${y} ${x + w - i},${y} ${x + w},${y + h / 2} ${x + w - i},${y + h} ${x + i},${y + h} ${x},${y + h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    }
    case 'rounded':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(26, h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    default: {
      const radius = node.data.collapsed === undefined ? 4 : 8;
      const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`;
      // The 3 px left accent bar the canvas draws on every plain step.
      const accent = `<rect x="${x}" y="${y + 1}" width="3" height="${h - 2}" fill="${node.data.collapsed === undefined ? p.action : p.textDim}"/>`;
      return `${box}${accent}`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

/**
 * A three-segment elbow, used only when ELK gave no route for an edge —
 * a hand-laid-out node, or a route ELK declined to compute.
 */
function elbow(a: Placed, b: Placed): Point[] {
  const from = { x: a.ax + a.width / 2, y: a.ay + a.height };
  const to = { x: b.ax + b.width / 2, y: b.ay };
  const mid = (from.y + to.y) / 2;
  if (Math.abs(from.x - to.x) < 0.5) return [from, to];
  return [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to];
}

function polyline(points: readonly Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

function round(n: number): number {
  // Two decimals: enough for sub-pixel routing, and it keeps the file — and
  // any diff of it — from filling with float noise.
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Emitter                                                             */
/* ------------------------------------------------------------------ */

export function toSvg(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  options: SvgOptions = {},
): SvgResult {
  const p = options.theme === 'light' ? LIGHT : DARK;
  const padding = options.padding ?? 24;
  const routes = options.routes;
  const honour = options.highlight ?? true;

  const placed = place(nodes);
  const byId = new Map(placed.map((n) => [n.id, n]));

  /* The origin is ELK's, not the first node's.
     `graphBounds` measures from the topmost node, which sits 22 px in and 52 px
     down inside the outer group's padding — measuring from there would crop
     that padding off two sides and leave it on the other two. Keeping ELK's
     origin gives the fixture 975 x 8886, the size the canvas reports, and the
     group boxes keep the breathing room they were laid out with. Negative
     coordinates are still honoured, in case a hand-dragged node goes there. */
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const n of placed) {
    minX = Math.min(minX, n.ax);
    minY = Math.min(minY, n.ay);
    maxX = Math.max(maxX, n.ax + n.width);
    maxY = Math.max(maxY, n.ay + n.height);
  }

  const width = Math.round(maxX - minX + padding * 2);
  const height = Math.round(maxY - minY + padding * 2);
  const shift = `translate(${round(padding - minX)}, ${round(padding - minY)})`;

  const dim = (className: string | undefined): boolean =>
    honour && (className ?? '').includes('dimmed');
  const onPath = (className: string | undefined): boolean =>
    honour && (className ?? '').includes('on-path');

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, Segoe UI, Inter, Roboto, sans-serif">`,
  );

  // One marker per edge colour. Markers cannot inherit `stroke`, so an
  // arrowhead that matched its line would otherwise need one marker per edge.
  out.push('<defs>');
  for (const [reason, colour] of Object.entries(EDGE_COLOR)) {
    const fill = options.theme === 'light' ? darken(colour) : colour;
    out.push(
      `<marker id="a-${reason}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`,
    );
  }
  out.push('</defs>');
  out.push(`<rect width="${width}" height="${height}" fill="${p.bg}"/>`);
  out.push(`<g transform="${shift}">`);

  /* Groups first, behind everything. They never dim — they carry no flow, so
     they are never "on a path", and dimming them deletes the context that
     makes a highlight readable. Same rule as the canvas. */
  const groups = placed.filter((n) => n.type === 'seqGroup');
  groups.sort((a, b) => a.data.depth - b.data.depth);
  for (const g of groups) {
    out.push(
      `<rect x="${round(g.ax)}" y="${round(g.ay)}" width="${g.width}" height="${g.height}" rx="8" fill="${p.group}" stroke="${p.groupLine}" stroke-width="1"/>`,
    );
    out.push(
      `<text x="${round(g.ax + 11)}" y="${round(g.ay + 19)}" font-size="11" font-weight="600" letter-spacing="0.33" fill="${p.textFaint}">${esc(g.data.label.toUpperCase())}</text>`,
    );
  }

  /* Edges, under the nodes. */
  for (const edge of edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (a === undefined || b === undefined) continue;

    const points = routes?.get(edge.id) ?? elbow(a, b);
    const faded = dim(edge.className);
    const lit = onPath(edge.className);
    const reason = String(edge.data.reason);
    const base = EDGE_COLOR[reason] ?? EDGE_COLOR['fallthrough']!;
    const colour = options.theme === 'light' ? darken(base) : base;
    const dashed = edge.style.strokeDasharray !== undefined;

    out.push(
      `<polyline points="${polyline(points)}" fill="none" stroke="${lit ? p.accent : colour}" stroke-width="${lit ? 2.4 : edge.style.strokeWidth}"${dashed ? ' stroke-dasharray="5 4"' : ''}${faded ? ' opacity="0.16"' : ''} marker-end="url(#a-${reason})"/>`,
    );

    if (edge.label !== undefined && !faded) {
      const mid = points[Math.floor(points.length / 2)] ?? points[0]!;
      const w = edge.label.length * 6 + 8;
      out.push(
        `<rect x="${round(mid.x - w / 2)}" y="${round(mid.y - 8)}" width="${w}" height="14" rx="3" fill="${p.bg}" opacity="0.86"/>`,
      );
      out.push(
        `<text x="${round(mid.x)}" y="${round(mid.y + 2.5)}" font-size="9.5" text-anchor="middle" fill="${colour}">${esc(edge.label)}</text>`,
      );
    }
  }

  /* Steps, on top. */
  for (const node of placed) {
    if (node.type === 'seqGroup') continue;
    const faded = dim(node.className);
    const lit = onPath(node.className);
    out.push(`<g${faded ? ' opacity="0.2"' : ''}>`);
    out.push(shapeOf(node, p));
    if (lit) {
      out.push(
        `<rect x="${round(node.ax - 2)}" y="${round(node.ay - 2)}" width="${node.width + 4}" height="${node.height + 4}" rx="6" fill="none" stroke="${p.accent}" stroke-width="2"/>`,
      );
    }

    const lines = wrapText(node.data.label, node.width - 24, 2);
    const hasParams = node.data.params !== '';
    // Centre the label block, leaving room for the params line beneath it.
    const blockHeight = lines.length * 14 + (hasParams ? 12 : 0);
    let y = node.ay + node.height / 2 - blockHeight / 2 + 11;
    const cx = round(node.ax + node.width / 2);
    for (const line of lines) {
      out.push(
        `<text x="${cx}" y="${round(y)}" font-size="11.5" font-weight="550" text-anchor="middle" fill="${p.text}">${esc(line)}</text>`,
      );
      y += 14;
    }
    if (hasParams) {
      out.push(
        `<text x="${cx}" y="${round(y - 1)}" font-size="9.5" font-family="ui-monospace, Consolas, monospace" text-anchor="middle" fill="${p.textFaint}">${esc(wrapText(node.data.params, node.width - 12, 1)[0] ?? '')}</text>`,
      );
    }
    out.push('</g>');
  }

  out.push('</g>');
  if (options.title !== undefined && options.title !== '') {
    out.push(
      `<text x="${padding}" y="${height - 8}" font-size="10" fill="${p.textFaint}">${esc(options.title)}</text>`,
    );
  }
  out.push('</svg>');

  return { text: `${out.join('\n')}\n`, width, height };
}

/** Push a canvas colour dark enough to read on white. */
function darken(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) return hex;
  const n = parseInt(m[1] as string, 16);
  const f = 0.72;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
