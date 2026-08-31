/**
 * FlowGraph <-> ELK JSON. Pure, so the layout can be exercised and timed in
 * Node without a worker or a browser.
 *
 * The graph is handed to ELK *hierarchically*: each container becomes an ELK
 * node holding its children. That is what makes a sequence read as a block
 * rather than dissolving into one long chain, and it lets ELK size the group
 * boxes for us. Child coordinates come back relative to the parent, which is
 * exactly what React Flow wants for a node with a `parentId`.
 */

import { SIZE, type FlowEdge, type FlowNode } from '../emit/flow';

export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  /** Filled in by the layout. One section per edge for a simple edge. */
  sections?: ElkSection[];
}

export interface Point {
  x: number;
  y: number;
}

export interface ElkSection {
  startPoint: Point;
  endPoint: Point;
  bendPoints?: Point[];
}

export interface ElkLike {
  layout(graph: ElkNode, opts?: { layoutOptions?: Record<string, string> }): Promise<ElkNode>;
}

/**
 * How to arrange the graph.
 *
 * `grouped` draws each sequence as a labelled box, nested. True to the file,
 * and the pulses read as blocks — but the sequence is a linear chain, so the
 * result is tall: roughly 1000 x 8900 px on the sample.
 *
 * `compact` drops the boxes and lets ELK wrap that chain into columns
 * (roughly 3600 x 2000 px on the sample). No edge changes meaning; it is the
 * same graph folded to a readable aspect ratio, the way text wraps.
 */
export type LayoutMode = 'grouped' | 'compact';

/**
 * Layered, top-down. `INCLUDE_CHILDREN` is the setting that matters: without
 * it ELK lays each container out in isolation and the cross-container edges —
 * every jump in the file — are routed as an afterthought.
 */
export const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '34',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  // Orthogonal routing reads as a wiring diagram, which is what this is.
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.mergeEdges': 'true',
  'elk.padding': `[top=${SIZE.groupHeader + SIZE.groupPadding},left=${SIZE.groupPadding},bottom=${SIZE.groupPadding},right=${SIZE.groupPadding}]`,
};

/**
 * Wrapping only engages on a flat graph — ELK does not wrap a hierarchical
 * one. That is the whole reason `compact` drops the group boxes.
 */
export const COMPACT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
  'elk.aspectRatio': '1.6',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '34',
  'elk.spacing.edgeNode': '24',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/**
 * The nodes a mode actually lays out. `compact` keeps the leaves only and
 * detaches them from their groups, so React Flow stops treating their
 * positions as parent-relative.
 */
export function nodesForMode(nodes: readonly FlowNode[], mode: LayoutMode): FlowNode[] {
  if (mode === 'grouped') return [...nodes];
  return nodes
    .filter((n) => n.type === 'seqNode')
    .map(({ parentId: _parentId, extent: _extent, ...rest }) => rest);
}

/** Build the ELK request from flow nodes and edges. */
export function toElk(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  mode: LayoutMode = 'grouped',
): ElkNode {
  if (mode === 'compact') {
    return {
      id: 'root',
      layoutOptions: COMPACT_OPTIONS,
      children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
  }
  return toElkGrouped(nodes, edges);
}

function toElkGrouped(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): ElkNode {
  const elkById = new Map<string, ElkNode>();
  const roots: ElkNode[] = [];

  // Nodes arrive parent-first (toFlow sorts by depth), so a parent always
  // exists by the time its children are attached.
  for (const n of nodes) {
    const isGroup = n.type === 'seqGroup';
    const elk: ElkNode = isGroup
      ? { id: n.id, children: [] }
      : { id: n.id, width: n.width, height: n.height };

    elkById.set(n.id, elk);
    const parent = n.parentId === undefined ? undefined : elkById.get(n.parentId);
    if (parent === undefined) {
      roots.push(elk);
    } else {
      (parent.children ??= []).push(elk);
    }
  }

  // A container that ended up with no children still needs a size, or ELK
  // collapses it to a point.
  for (const elk of elkById.values()) {
    if (elk.children !== undefined && elk.children.length === 0) {
      elk.width = SIZE.minWidth;
      elk.height = SIZE.height;
      delete elk.children;
    }
  }

  return {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: roots,
    // With INCLUDE_CHILDREN, edges declared on the root may cross container
    // boundaries freely.
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

export interface Positioned {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** Flatten an ELK result into per-node positions and sizes. */
export function fromElk(result: ElkNode): Map<string, Positioned> {
  const out = new Map<string, Positioned>();

  const walk = (node: ElkNode): void => {
    for (const child of node.children ?? []) {
      out.set(child.id, {
        id: child.id,
        position: { x: child.x ?? 0, y: child.y ?? 0 },
        width: child.width ?? SIZE.minWidth,
        height: child.height ?? SIZE.height,
      });
      walk(child);
    }
  };

  walk(result);
  return out;
}

/**
 * The orthogonal route ELK computed for each edge, as an absolute polyline.
 *
 * The canvas and the SVG export both draw these, which is the whole reason
 * `elk.edgeRouting: ORTHOGONAL` was worth configuring. Left to itself React
 * Flow routes handle to handle and puts a straight line through every node a
 * jump skips — see `ui/edges.tsx`.
 *
 * **The coordinates are not absolute as they arrive.** ELK routes an edge in
 * the coordinate system of the lowest common ancestor of its two endpoints,
 * and elkjs then reports every edge on the root node regardless — so the
 * container an edge is *listed* in says nothing about the frame its points are
 * in. Reading them as absolute puts a jump between two Pulses 314 px above
 * where it belongs, and the arrowhead lands in mid-air. This walks the result
 * tree for absolute node positions, finds each edge's LCA, and adds it.
 */
export function edgeRoutes(result: ElkNode): Map<string, Point[]> {
  /* Absolute position and parent of every node in the result. */
  const absolute = new Map<string, Point>([[result.id, { x: 0, y: 0 }]]);
  const parentOf = new Map<string, string>();

  const walkNodes = (node: ElkNode, x: number, y: number): void => {
    for (const child of node.children ?? []) {
      const cx = x + (child.x ?? 0);
      const cy = y + (child.y ?? 0);
      absolute.set(child.id, { x: cx, y: cy });
      parentOf.set(child.id, node.id);
      walkNodes(child, cx, cy);
    }
  };
  walkNodes(result, 0, 0);

  /** Root-first ancestor chain, ending with the node itself. Cycle-guarded. */
  const chain = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      out.unshift(cursor);
      cursor = parentOf.get(cursor);
    }
    return out;
  };

  const origin = (a: string, b: string): Point => {
    const ca = chain(a);
    const cb = chain(b);
    let shared: string | null = null;
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      if (ca[i] !== cb[i]) break;
      shared = ca[i] as string;
    }
    return (shared === null ? undefined : absolute.get(shared)) ?? { x: 0, y: 0 };
  };

  const out = new Map<string, Point[]>();
  const walkEdges = (node: ElkNode): void => {
    for (const edge of node.edges ?? []) {
      const src = edge.sources[0];
      const dst = edge.targets[0];
      const off = src === undefined || dst === undefined ? { x: 0, y: 0 } : origin(src, dst);
      const points: Point[] = [];
      for (const section of edge.sections ?? []) {
        points.push({ x: section.startPoint.x + off.x, y: section.startPoint.y + off.y });
        for (const bend of section.bendPoints ?? []) {
          points.push({ x: bend.x + off.x, y: bend.y + off.y });
        }
        points.push({ x: section.endPoint.x + off.x, y: section.endPoint.y + off.y });
      }
      if (points.length > 1) out.set(edge.id, points);
    }
    for (const child of node.children ?? []) walkEdges(child);
  };
  walkEdges(result);

  return out;
}

/** Apply a layout result to flow nodes, returning new node objects. */
export function applyLayout(
  nodes: readonly FlowNode[],
  layout: Map<string, Positioned>,
): FlowNode[] {
  return nodes.map((n) => {
    const placed = layout.get(n.id);
    if (placed === undefined) return n;
    return {
      ...n,
      position: placed.position,
      width: Math.round(placed.width),
      height: Math.round(placed.height),
    };
  });
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The extent of a laid-out graph, in absolute coordinates.
 *
 * A node inside a group carries a parent-relative position, so this walks up
 * the parent chain to place it. Cycle-guarded; a malformed parent chain must
 * not hang the canvas.
 */
export function graphBounds(nodes: readonly FlowNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
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
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + node.width);
    maxY = Math.max(maxY, y + node.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The zoom that fits `box` into a viewport of `width` x `height`, with a
 * fractional margin, clamped to the canvas zoom limits.
 */
export function fitZoom(
  box: Bounds,
  width: number,
  height: number,
  padding: number,
  minZoom: number,
  maxZoom: number,
): number {
  const w = box.width * (1 + padding * 2);
  const h = box.height * (1 + padding * 2);
  if (w <= 0 || h <= 0 || width <= 0 || height <= 0) return 1;
  return Math.min(maxZoom, Math.max(minZoom, Math.min(width / w, height / h)));
}
