/**
 * Path sets — spec 7.3.
 *
 * "How do I reach this step" and "what happens after it" are the two questions
 * a 107-node flowchart cannot answer by eye. Both are a traversal of the edge
 * list, forwards or backwards.
 *
 * The sample file is a DAG, and nothing here assumes it stays one: every walk
 * carries a visited set. A future file with a retry loop must dim the rest of
 * the canvas, not hang the tab.
 *
 * Pure functions over the Graph. No DOM, no React.
 */

import type { Graph, SeqEdge } from './types';

/**
 * Whether an edge is a route *through* the sequence rather than the same route
 * taken again.
 *
 * A loop back edge is the one edge in the graph that closes a cycle. Following
 * it makes every step in a loop both upstream and downstream of every other,
 * which is true and useless: it lights the whole body in both directions and
 * leaves nothing to compare it against. Excluded from the path walks and from
 * the timing arithmetic — `duration.ts` needs exactly the same predicate and
 * imports this one rather than keeping its own.
 *
 * It is deliberately *not* excluded from `adjacency`: the edge is real, it is
 * drawn, and the inspector lists it. Only traversal skips it.
 */
export function isFlow(e: SeqEdge): boolean {
  return e.reason !== 'loop';
}

export interface PathSet {
  /** Nodes on some path to (or from) the subject. Excludes the subject itself
   *  unless a cycle genuinely leads back to it. */
  nodes: Set<string>;
  /** The edges joining them, in the graph's own sorted order. */
  edges: SeqEdge[];
}

/**
 * A path set that has kept the two directions apart.
 *
 * `pathSet` used to merge them and hand back one blob, which is unreadable on a
 * linear sequence: upstream union downstream is very nearly the whole file, so
 * one highlight colour lights everything and says nothing. Kept separate, the
 * same walk answers "what runs before this" and "what runs after this", which
 * is a useful thing to know on every file including a straight chain.
 */
export interface SplitPathSet extends PathSet {
  up: PathSet;
  down: PathSet;
}

/** Outbound and inbound edges per node. Build once, reuse across queries. */
export interface Adjacency {
  out: Map<string, SeqEdge[]>;
  in: Map<string, SeqEdge[]>;
}

export function adjacency(graph: Graph): Adjacency {
  const out = new Map<string, SeqEdge[]>();
  const inn = new Map<string, SeqEdge[]>();
  const bucket = (m: Map<string, SeqEdge[]>, key: string): SeqEdge[] => {
    const existing = m.get(key);
    if (existing !== undefined) return existing;
    const fresh: SeqEdge[] = [];
    m.set(key, fresh);
    return fresh;
  };
  for (const e of graph.edges) {
    bucket(out, e.src).push(e);
    bucket(inn, e.dst).push(e);
  }
  return { out, in: inn };
}

/**
 * Breadth-first in one direction. `step` picks the edges to follow and `end`
 * picks which endpoint to advance to, which is the only difference between
 * upstream and downstream.
 */
function walk(
  adj: Adjacency,
  from: string,
  direction: 'up' | 'down',
): PathSet {
  const nodes = new Set<string>();
  const edges: SeqEdge[] = [];
  const seenEdge = new Set<SeqEdge>();
  const queue: string[] = [from];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const uid = queue.shift()!;
    const outgoing = ((direction === 'down' ? adj.out : adj.in).get(uid) ?? []).filter(isFlow);
    for (const e of outgoing) {
      if (!seenEdge.has(e)) {
        seenEdge.add(e);
        edges.push(e);
      }
      const next = direction === 'down' ? e.dst : e.src;
      nodes.add(next);
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  // `from` lands in `nodes` only when a cycle genuinely reaches it back.
  return { nodes, edges };
}

/** Every node from which the flow can reach `uid`, and the edges between them. */
export function upstream(graph: Graph, uid: string, adj = adjacency(graph)): PathSet {
  return walk(adj, uid, 'up');
}

/** Every node the flow can reach from `uid`, and the edges between them. */
export function downstream(graph: Graph, uid: string, adj = adjacency(graph)): PathSet {
  return walk(adj, uid, 'down');
}

/**
 * Both directions plus the subject: what path highlighting draws. Everything
 * outside this set dims rather than disappearing — context is the point.
 */
export function pathSet(graph: Graph, uid: string, adj = adjacency(graph)): SplitPathSet {
  const up = upstream(graph, uid, adj);
  const down = downstream(graph, uid, adj);
  const nodes = new Set<string>([uid, ...up.nodes, ...down.nodes]);
  const seen = new Set<SeqEdge>([...up.edges, ...down.edges]);
  return { nodes, edges: graph.edges.filter((e) => seen.has(e)), up, down };
}

/**
 * The first executable leaf inside a container, over a `Graph` rather than a
 * DOM element — the graph-level twin of `resolve.firstLeaf`.
 *
 * A container carries no flow, so asking for the path through one returns
 * nothing and dims the entire canvas. Its first leaf is where the flow actually
 * enters it, and is what a reader means by "trace this sequence". Returns `uid`
 * unchanged for a leaf, and null for an empty or cyclic container.
 */
export function firstLeafOf(graph: Graph, uid: string): string | null {
  const seen = new Set<string>();
  let current: string | undefined = uid;

  while (current !== undefined) {
    if (seen.has(current)) return null;
    seen.add(current);
    const children = graph.containers.get(current);
    if (children === undefined) return graph.nodes.has(current) ? current : null;
    // Skip children that are themselves empty containers.
    let next: string | undefined;
    for (const child of children) {
      const leaf = firstLeafOf(graph, child);
      if (leaf !== null) {
        next = leaf;
        break;
      }
    }
    if (next === undefined) return null;
    current = next;
  }
  return null;
}

/** Direct predecessors of a node — one hop, not the transitive set. */
export function predecessors(graph: Graph, uid: string, adj = adjacency(graph)): string[] {
  return (adj.in.get(uid) ?? []).map((e) => e.src);
}

/** Direct successors of a node — one hop. */
export function successors(graph: Graph, uid: string, adj = adjacency(graph)): string[] {
  return (adj.out.get(uid) ?? []).map((e) => e.dst);
}

/**
 * Leaves with no outbound edge: where the flow stops. Containers carry no
 * flow, so they are never terminals.
 */
export function terminals(graph: Graph, adj = adjacency(graph)): Set<string> {
  const out = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.kind === 'container') continue;
    if ((adj.out.get(node.uid) ?? []).length === 0) out.add(node.uid);
  }
  return out;
}

/**
 * Leaves the flow can never reach from `graph.entry`. Zero on the fixture; a
 * non-zero count is a real finding about the sequence, not a parser fault.
 */
export function unreachable(graph: Graph, adj = adjacency(graph)): Set<string> {
  const reached = downstream(graph, graph.entry, adj).nodes;
  const out = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.kind === 'container' || node.uid === graph.entry) continue;
    if (!reached.has(node.uid)) out.add(node.uid);
  }
  return out;
}
