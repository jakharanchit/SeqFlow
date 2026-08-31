/**
 * Graph -> React Flow nodes and edges.
 *
 * A pure function with no React import, so it is unit-testable in Node. The
 * shapes here are structurally what @xyflow/react expects; Canvas.tsx feeds
 * them straight in.
 *
 * Containers become React Flow group nodes, giving ELK a hierarchy to lay out
 * and the reader a visible boundary around each sequence. Flow edges only ever
 * run between leaves — see the Graph contract.
 */

import type { Graph, NodeKind, NodeShape, Rules, SeqNode } from '../core/types';

/** Node box sizes, in px. ELK needs a size before it can place anything. */
export const SIZE = {
  charWidth: 7.2,
  paddingX: 34,
  minWidth: 150,
  maxWidth: 300,
  /**
   * Three lines: the step number, the name over up to two lines, and the
   * params. 52 before the number line was added, and already tight.
   */
  height: 66,
  /** Diamonds carry their text badly; give them room. */
  decisionHeight: 88,
  /** Space reserved inside a group for its title bar. */
  groupHeader: 30,
  groupPadding: 22,
} as const;

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  /**
   * `2.1.6.7` — the address the file's own tooling uses. Empty on the root.
   * Rendered as its own line above the name, and by the SVG exporter too, so
   * a picture of the canvas can be cross-referenced against a test report.
   */
  stepNumber: string;
  /** Rule-file selected attributes, e.g. "drive_source_enable_output = TRUE". */
  params: string;
  element: string;
  kind: NodeKind;
  shape: NodeShape;
  uid: string;
  depth: number;
  /** True where inbound convergence exceeds the rule-file threshold. */
  convergent: boolean;
  /**
   * Steps hidden inside this node, when it is a collapsed sequence. Absent on
   * an ordinary step and on an expanded group.
   */
  collapsed?: number;
}

export interface FlowNode {
  id: string;
  type: 'seqNode' | 'seqGroup';
  position: { x: number; y: number };
  data: FlowNodeData;
  width: number;
  height: number;
  parentId?: string;
  extent?: 'parent';
  /** Groups sit behind their children and must not intercept clicks. */
  zIndex: number;
  selectable: boolean;
  draggable: boolean;
  /** Driven from app state, so outline and canvas agree on the selection. */
  selected?: boolean;
  /** Highlight/dim classes. Applied by the UI, never by the emitter. */
  className?: string;
}

export interface FlowEdgeData extends Record<string, unknown> {
  reason: string;
  convergent: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /**
   * Always `routed` — the canvas edge that follows ELK's own polyline, falling
   * back to a smoothstep curve when there is no route for it. See ui/edges.tsx.
   */
  type: 'routed';
  label?: string;
  data: FlowEdgeData;
  style: { stroke: string; strokeWidth: number; strokeDasharray?: string };
  zIndex: number;
  /** Highlight/dim classes. Applied by the UI, never by the emitter. */
  className?: string;
  animated?: boolean;
}

/** Edge colour by reason. Kept here so the emitter owns the whole visual map. */
export const EDGE_COLOR: Record<string, string> = {
  fallthrough: '#8a94a6',
  criteria: '#d4544a',
  branch: '#3b82c4',
  goto: '#9a6bd0',
  // A loop back edge runs against the flow, up the page past everything it
  // repeats. Warm and distinctly not one of the forward colours, so it reads
  // as "again" rather than as one more branch.
  loop: '#c9821f',
};

function measure(label: string, params: string, stepNumber: string): number {
  // The number is monospace and a third smaller, so it counts for less per
  // character — but `2.1.6.11` on a 150px minimum still has to fit.
  const widest = Math.max(label.length, params.length * 0.9, stepNumber.length * 0.85);
  const w = widest * SIZE.charWidth + SIZE.paddingX;
  return Math.round(Math.min(SIZE.maxWidth, Math.max(SIZE.minWidth, w)));
}

/**
 * The attributes the rule file marks worth showing on the label. Empty values
 * are dropped — the sample file is full of `sensorTag=""`.
 */
export function paramText(node: SeqNode, rules: Rules): string {
  const keys = rules.labels[node.element];
  if (keys === undefined) return '';
  const parts: string[] = [];
  for (const key of keys) {
    const value = node.attrs[key];
    if (value === undefined || value === '') continue;
    parts.push(`${key} = ${value}`);
  }
  return parts.join('  ·  ');
}

/** Inbound edge count per node. */
export function inboundCounts(graph: Graph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of graph.edges) counts.set(e.dst, (counts.get(e.dst) ?? 0) + 1);
  return counts;
}

/**
 * Nodes that more than `convergence_threshold` edges converge on. Spec 4.5:
 * drawn normally, the 16 abort edges dominate the layout, so their inbound
 * edges are styled dotted and de-emphasised.
 */
export function convergentNodes(graph: Graph, rules: Rules): Set<string> {
  const out = new Set<string>();
  for (const [uid, count] of inboundCounts(graph)) {
    if (count > rules.convergenceThreshold) out.add(uid);
  }
  return out;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  convergent: Set<string>;
}

export interface FlowOptions {
  /**
   * Collapsed sequence uid -> steps hidden inside it. A collapsed sequence
   * draws as one opaque node rather than as a box around nothing.
   */
  collapsedCounts?: ReadonlyMap<string, number>;
}

/** Converts a parsed `Graph` into React Flow's node/edge shape. Pure — no React import here. */
export function toFlow(graph: Graph, rules: Rules, opts: FlowOptions = {}): FlowGraph {
  const convergent = convergentNodes(graph, rules);
  const collapsedCounts = opts.collapsedCounts;

  const nodes: FlowNode[] = [];
  for (const node of graph.nodes.values()) {
    // A group is a container that still has its children on the canvas. A
    // collapsed one has none, so it is drawn as a node — see collapse.ts.
    const isGroup = graph.containers.has(node.uid);
    const hidden = collapsedCounts?.get(node.uid);
    const params =
      hidden === undefined
        ? isGroup
          ? ''
          : paramText(node, rules)
        : `${hidden} step${hidden === 1 ? '' : 's'}`;
    const height = node.kind === 'decision' ? SIZE.decisionHeight : SIZE.height;

    nodes.push({
      id: node.uid,
      type: isGroup ? 'seqGroup' : 'seqNode',
      position: { x: 0, y: 0 }, // ELK fills these in
      data: {
        label: node.name === '' ? node.element : node.name,
        stepNumber: node.stepNumber,
        params,
        element: node.element,
        kind: node.kind,
        shape: node.shape,
        uid: node.uid,
        depth: node.depth,
        convergent: convergent.has(node.uid),
        ...(hidden === undefined ? {} : { collapsed: hidden }),
      },
      // Groups are resized by the layout pass; these are placeholders.
      width: isGroup ? SIZE.minWidth : measure(node.name, params, node.stepNumber),
      height: isGroup ? SIZE.height : height,
      ...(node.parent === null ? {} : { parentId: node.parent, extent: 'parent' as const }),
      zIndex: isGroup ? -node.depth : 1,
      selectable: true,
      draggable: !isGroup,
    });
  }

  // React Flow requires a parent to be listed before its children.
  nodes.sort((a, b) => a.data.depth - b.data.depth);

  const edges: FlowEdge[] = graph.edges.map((e, i) => {
    const isConvergent = convergent.has(e.dst);
    const dotted = e.style === 'dotted' || isConvergent;
    const color = EDGE_COLOR[e.reason] ?? EDGE_COLOR['fallthrough']!;
    return {
      // Names collide and a pair can be joined twice; the index keeps ids unique.
      id: `e${i}-${e.src}-${e.dst}`,
      source: e.src,
      target: e.dst,
      type: 'routed' as const,
      ...(e.label === undefined ? {} : { label: e.label }),
      data: { reason: e.reason, convergent: isConvergent },
      style: {
        stroke: color,
        strokeWidth: dotted ? 1.2 : 1.7,
        ...(dotted ? { strokeDasharray: '5 4' } : {}),
      },
      zIndex: 2,
    };
  });

  return { nodes, edges, convergent };
}
