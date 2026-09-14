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
  ports?: ElkPort[];
  layoutOptions?: Record<string, string>;
}

export interface ElkPort {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
 * Space reserved inside a group for its own title bar — `SIZE.groupHeader`
 * (the title) plus `SIZE.groupPadding` (margin on every other side).
 *
 * Set below both on the *root* `layoutOptions` (which is what gives the whole
 * diagram its own outer margin — the root's `elk.padding` governs the padding
 * the root itself reserves for its direct children, the top-level sequences)
 * and, in `toElk`, directly on every individual group `ElkNode`. Both are
 * required: a `layoutOptions` default set at the root does **not** cascade
 * down through nested hierarchy levels in elkjs — confirmed by measuring a
 * real layout, where a group two levels deep placed its first child only
 * 12px from its own top edge (ELK's own built-in default padding,
 * `[top=12,left=12,bottom=12,right=12]`) rather than the 52px this app
 * configures for a title bar. Setting it per-node in `toElk` is what makes
 * nesting depth stop mattering.
 */
const GROUP_PADDING = `[top=${SIZE.groupHeader + SIZE.groupPadding},left=${SIZE.groupPadding},bottom=${SIZE.groupPadding},right=${SIZE.groupPadding}]`;

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
  // Both already match elkjs's own computed defaults for ORTHOGONAL +
  // NETWORK_SIMPLEX — set explicitly so a future elkjs upgrade can't
  // silently change them out from under the bend-minimization guarantee
  // `collapseCollinear` below relies on.
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.unnecessaryBendpoints': 'false',
  'elk.padding': GROUP_PADDING,
};

/**
 * A diamond is inscribed in its box, so the only points it has on any edge of
 * that box are its four apexes. Left to itself ELK spreads a node's attach
 * points along the full width of the top and bottom edges — measured on the
 * fixture, a `ConditionStep`'s two branch exits left the bottom edge 28.5px
 * either side of centre, which on a diamond is empty space: each line started
 * in the notch beside the shape and read as detached from it.
 *
 * So a diamond gets four explicit ports, one per apex, and every edge touching
 * it is attached to one of them. `FIXED_POS` is what makes ELK honour the
 * coordinates rather than treat them as a hint.
 *
 * **The exits are spread across apexes rather than stacked on one.** Both
 * leaving the south apex is geometrically correct and still reads badly: the
 * two lines overlap until the router pulls them apart, so at the diamond
 * itself a decision looks like a single exit that forks somewhere below. One
 * exit down and the next out the side is the convention every flowchart uses,
 * and it says "this is a branch" at the shape rather than a rank later.
 *
 * The assignment is by position in the edge list, never by label: which exit
 * means what is rule-file content (invariant 2), and the edge order is already
 * deterministic — `parse` sorts on `(src, reason, dst)` and `collapse` re-sorts
 * on the same key, which is what invariant 6 rests on. So the first exit takes
 * south, the second east, the third west, and a fourth or later falls back to
 * south, where ELK's own spreading takes over again.
 *
 * Only the diamond needs any of this. A rect attaches across its whole edge,
 * and a hexagon's top and bottom run from 12% to 88% of its width — wide
 * enough that ELK's own spread stays on the shape.
 */
const APEX_PORTS = { 'elk.portConstraints': 'FIXED_POS' } as const;

/** South, then east, then west: the order exits are handed out in. */
const EXIT_SIDES = ['s', 'e', 'w'] as const;

const apexPort = (id: string, side: string): string => `${id}::apex-${side}`;

function apexPorts(id: string, width: number, height: number): ElkPort[] {
  const at = (side: string, x: number, y: number, elkSide: string): ElkPort => ({
    id: apexPort(id, side),
    x,
    y,
    width: 0,
    height: 0,
    layoutOptions: { 'elk.port.side': elkSide },
  });
  return [
    at('n', width / 2, 0, 'NORTH'),
    at('s', width / 2, height, 'SOUTH'),
    at('e', width, height / 2, 'EAST'),
    at('w', 0, height / 2, 'WEST'),
  ];
}

/** Build the ELK request from flow nodes and edges. */
export function toElk(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): ElkNode {
  const elkById = new Map<string, ElkNode>();
  const roots: ElkNode[] = [];

  // Nodes arrive parent-first (toFlow sorts by depth), so a parent always
  // exists by the time its children are attached.
  const apexed = new Set<string>();

  for (const n of nodes) {
    const isGroup = n.type === 'seqGroup';
    const elk: ElkNode = isGroup
      ? { id: n.id, children: [], layoutOptions: { 'elk.padding': GROUP_PADDING } }
      : { id: n.id, width: n.width, height: n.height };

    if (!isGroup && n.data.shape === 'diamond') {
      elk.ports = apexPorts(n.id, n.width, n.height);
      elk.layoutOptions = { ...APEX_PORTS };
      apexed.add(n.id);
    }

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

  /**
   * Which apex this diamond's next exit leaves by. Counted as the edge list is
   * walked, so the assignment follows the list's own deterministic order.
   */
  const exitsSoFar = new Map<string, number>();
  const exitSide = (id: string): string => {
    const n = exitsSoFar.get(id) ?? 0;
    exitsSoFar.set(id, n + 1);
    return EXIT_SIDES[n] ?? 's';
  };

  return {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: roots,
    // With INCLUDE_CHILDREN, edges declared on the root may cross container
    // boundaries freely.
    edges: edges.map((e) => ({
      id: e.id,
      sources: [apexed.has(e.source) ? apexPort(e.source, exitSide(e.source)) : e.source],
      targets: [apexed.has(e.target) ? apexPort(e.target, 'n') : e.target],
    })),
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
/**
 * Collapses a run of collinear points to its two endpoints.
 *
 * This app always configures `elk.edgeRouting: ORTHOGONAL` (see
 * `LAYOUT_OPTIONS` above), so every real bend is a 90° turn — three
 * consecutive points that share an x *or* a y coordinate are the same
 * straight run split into two segments for no reason, and dropping the
 * middle one changes nothing about the line actually drawn. Walks the points
 * once, extending the last-kept point in place whenever the next point is
 * still collinear with the previous two, so a run of any length collapses to
 * its endpoints rather than only catching isolated triples.
 */
export function collapseCollinear(points: readonly Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const EPSILON = 1e-6;
  const out: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Point;
    if (out.length >= 2) {
      const a = out[out.length - 2] as Point;
      const b = out[out.length - 1] as Point;
      const sameX = Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - p.x) < EPSILON;
      const sameY = Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - p.y) < EPSILON;
      if (sameX || sameY) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function edgeRoutes(result: ElkNode): Map<string, Point[]> {
  /* Absolute position and parent of every node in the result. */
  const absolute = new Map<string, Point>([[result.id, { x: 0, y: 0 }]]);
  const parentOf = new Map<string, string>();

  /**
   * An edge that ends on a diamond names one of its apex ports, not the node
   * (see `apexPorts`). The LCA walk below is over nodes, so a port id has to
   * resolve to the node that owns it or the edge falls back to the root frame
   * and lands wherever the outermost group is not.
   */
  const ownerOfPort = new Map<string, string>();

  const walkNodes = (node: ElkNode, x: number, y: number): void => {
    for (const port of node.ports ?? []) ownerOfPort.set(port.id, node.id);
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
      const rawSrc = edge.sources[0];
      const rawDst = edge.targets[0];
      const src = rawSrc === undefined ? undefined : (ownerOfPort.get(rawSrc) ?? rawSrc);
      const dst = rawDst === undefined ? undefined : (ownerOfPort.get(rawDst) ?? rawDst);
      const off = src === undefined || dst === undefined ? { x: 0, y: 0 } : origin(src, dst);
      const points: Point[] = [];
      for (const section of edge.sections ?? []) {
        points.push({ x: section.startPoint.x + off.x, y: section.startPoint.y + off.y });
        for (const bend of section.bendPoints ?? []) {
          points.push({ x: bend.x + off.x, y: bend.y + off.y });
        }
        points.push({ x: section.endPoint.x + off.x, y: section.endPoint.y + off.y });
      }
      const simplified = collapseCollinear(points);
      if (simplified.length > 1) out.set(edge.id, simplified);
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
