/**
 * Collapse: a view over the graph, never a mutation of it.
 *
 * Collapsing a sequence hides its descendants and folds their edges onto it.
 * The work is edge lifting: an edge touching a hidden node re-points to the
 * node's nearest visible ancestor. Both ends lifting to the same node means
 * the edge was internal to a collapsed block, and it is dropped.
 *
 * Deduplication is the part that matters. On the fixture, collapsing the four
 * Pulse sequences lifts 16 individual `fail` edges onto 4 — without the dedupe
 * the canvas gains a dozen parallel edges that all say the same thing.
 *
 * Pure, no React, no DOM. Lives in emit/ rather than core/ because it is a
 * presentation concern: the parse result is unchanged and unchangeable.
 */

import type { Graph, SeqEdge, SeqNode } from '../core/types';

export interface CollapsedView {
  /** Visible nodes only, keyed by uid. Same node objects as the source graph. */
  nodes: Map<string, SeqNode>;
  /** Lifted, deduplicated, sorted by (src, reason, dst). */
  edges: SeqEdge[];
  /**
   * Visible *expanded* containers -> their visible children. A collapsed
   * container is not a container in this view: it is one opaque node, so it
   * has no entry here.
   */
  containers: Map<string, string[]>;
  /** Visible collapsed container uid -> how many nodes it is hiding. */
  collapsedCounts: Map<string, number>;
  /** uid -> the visible node standing in for it. Identity for visible nodes. */
  lifted: Map<string, string>;
  root: string;
  entry: string;
}

/**
 * The visible node standing in for each uid: the *outermost* collapsed
 * ancestor, or the node itself when none of its ancestors is collapsed.
 *
 * Outermost, not nearest — collapsing an inner sequence must not un-hide it
 * when an outer one is collapsed too.
 */
function liftMap(graph: Graph, collapsed: ReadonlySet<string>): Map<string, string> {
  const lifted = new Map<string, string>();

  for (const uid of graph.nodes.keys()) {
    // Walk to the root collecting ancestors, cycle-guarded: `parent` comes
    // from the parser and cannot cycle today, but this must not hang if it
    // ever does.
    const chain: string[] = [];
    const seen = new Set<string>([uid]);
    let cursor = graph.nodes.get(uid)?.parent ?? null;
    while (cursor !== null && !seen.has(cursor)) {
      chain.push(cursor);
      seen.add(cursor);
      cursor = graph.nodes.get(cursor)?.parent ?? null;
    }

    // chain runs inward-to-outward; the last collapsed entry is the outermost.
    let stand = uid;
    for (const ancestor of chain) {
      if (collapsed.has(ancestor)) stand = ancestor;
    }
    lifted.set(uid, stand);
  }

  return lifted;
}

/**
 * The visible graph for a set of collapsed container uids.
 *
 * Passing an empty set returns the whole graph, so callers never need a
 * special case for "nothing collapsed".
 */
/**
 * Containers to fold so the first layout is not a ten-second freeze.
 *
 * ELK is the whole cost of opening a file and it scales badly: measured over
 * generated graphs, 581 nodes lay out in 1.2 s, 2 295 in 2.9 s and 5 733 in
 * **10.7 s**. Every other stage in the pipeline put together is under 200 ms at
 * that size, so nothing else is worth optimising until this is answered, and
 * the only thing that answers it is giving ELK fewer nodes.
 *
 * Folds the *deepest* containers first and stops the moment the budget is met.
 * Deepest-first hides the least: an inner group folds to one box inside a
 * structure the reader can still see and open, where folding from the top would
 * present a file as three rectangles. It is also why this returns as soon as it
 * is under budget rather than folding everything it can.
 *
 * Returns an empty set for any graph already under budget — which is every file
 * of the size this tool was built on, so the common case is untouched.
 */
export function autoCollapse(graph: Graph, budget: number): Set<string> {
  if (graph.nodes.size <= budget) return new Set();

  const depths = new Map<number, string[]>();
  let deepest = 0;
  for (const uid of graph.containers.keys()) {
    const node = graph.nodes.get(uid);
    if (node === undefined) continue;
    const bucket = depths.get(node.depth) ?? [];
    bucket.push(uid);
    depths.set(node.depth, bucket);
    if (node.depth > deepest) deepest = node.depth;
  }

  const collapsed = new Set<string>();
  // Depth 1 is the document root: folding it leaves a single box and no
  // document, which is not a view of anything.
  for (let depth = deepest; depth >= 2; depth--) {
    for (const uid of depths.get(depth) ?? []) collapsed.add(uid);
    if (visibleGraph(graph, collapsed).nodes.size <= budget) break;
  }
  return collapsed;
}

export function visibleGraph(graph: Graph, collapsed: ReadonlySet<string>): CollapsedView {
  const lifted = liftMap(graph, collapsed);

  const nodes = new Map<string, SeqNode>();
  const collapsedCounts = new Map<string, number>();
  for (const [uid, node] of graph.nodes) {
    const stand = lifted.get(uid) ?? uid;
    if (stand === uid) {
      nodes.set(uid, node);
      // Collapsing something that holds nothing is a no-op, but it still
      // reads as collapsed in the outline, so record the zero.
      if (collapsed.has(uid) && graph.containers.has(uid)) collapsedCounts.set(uid, 0);
    } else {
      collapsedCounts.set(stand, (collapsedCounts.get(stand) ?? 0) + 1);
    }
  }

  const containers = new Map<string, string[]>();
  for (const [uid, children] of graph.containers) {
    if (!nodes.has(uid) || collapsed.has(uid)) continue;
    containers.set(
      uid,
      children.filter((c) => nodes.has(c)),
    );
  }

  /* Edge lifting. Merged edges keep their label only where they agree on it,
     and go dotted if any member was — a bundle is a de-emphasised thing. */
  const merged = new Map<string, SeqEdge>();
  const disagreed = new Set<string>();

  for (const e of graph.edges) {
    const src = lifted.get(e.src) ?? e.src;
    const dst = lifted.get(e.dst) ?? e.dst;
    if (src === dst) continue; // internal to a collapsed block
    if (!nodes.has(src) || !nodes.has(dst)) continue;

    const key = `${src}|${e.reason}|${dst}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        src,
        dst,
        ...(e.label === undefined ? {} : { label: e.label }),
        style: e.style,
        reason: e.reason,
      });
      continue;
    }
    if (existing.label !== e.label) disagreed.add(key);
    if (e.style === 'dotted') existing.style = 'dotted';
  }

  for (const key of disagreed) {
    const edge = merged.get(key);
    if (edge !== undefined) delete edge.label;
  }

  const edges = [...merged.values()].sort((a, b) => {
    const ka = `${a.src}|${a.reason}|${a.dst}`;
    const kb = `${b.src}|${b.reason}|${b.dst}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    nodes,
    edges,
    containers,
    collapsedCounts,
    lifted,
    root: lifted.get(graph.root) ?? graph.root,
    entry: lifted.get(graph.entry) ?? graph.entry,
  };
}

/**
 * The view as a `Graph`, so it can be handed to `toFlow` and the layout
 * unchanged. Warnings come from the parse and are carried through untouched.
 */
export function asGraph(graph: Graph, view: CollapsedView): Graph {
  return {
    root: view.root,
    entry: view.entry,
    nodes: view.nodes,
    edges: view.edges,
    containers: view.containers,
    warnings: graph.warnings,
  };
}

/** Every container in the graph — the toggleable set. */
export function collapsibleUids(graph: Graph): string[] {
  return [...graph.containers.keys()];
}
