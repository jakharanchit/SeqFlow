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
