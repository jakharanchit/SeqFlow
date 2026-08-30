/**
 * Where a node sits in the sequence tree.
 *
 * Names are not unique in this file — "Turn off Load" appears five times and
 * "Charge to Desired Voltage" four. 27 names cover 106 of the 133 nodes, so
 * any list of nodes that shows names alone is ambiguous for 80% of the file.
 * Every such list carries the parent path instead: `Main › Pulse 3 - 24C ›
 * Charge to Desired Voltage`.
 *
 * Pure functions over the Graph. Shared by the inspector, the outline, the
 * search results and the signal drawer, so they all agree on the wording.
 */

import type { Graph, SeqNode } from './types';

/** Containers above a node, outermost first. Cycle-guarded. */
export function ancestors(graph: Graph, uid: string): SeqNode[] {
  const chain: SeqNode[] = [];
  const seen = new Set<string>([uid]);
  let cursor = graph.nodes.get(uid)?.parent ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    const parent = graph.nodes.get(cursor);
    if (parent === undefined) break;
    chain.unshift(parent);
    seen.add(cursor);
    cursor = parent.parent;
  }
  return chain;
}

/** Ancestor uids as a set — for "is this node inside a collapsed sequence". */
export function ancestorUids(graph: Graph, uid: string): Set<string> {
  return new Set(ancestors(graph, uid).map((n) => n.uid));
}

/** `Main › Pulse 3 - 24C`. Empty string at the root. */
export function pathLabel(graph: Graph, uid: string, separator = ' › '): string {
  return ancestors(graph, uid)
    .map((n) => (n.name === '' ? n.element : n.name))
    .join(separator);
}

/** The node's own display name — its `name`, or the element when unnamed. */
export function displayName(node: SeqNode): string {
  return node.name === '' ? node.element : node.name;
}

/**
 * `2.1.6.7 - 6C Pulse (10s)` — the name with its step number, in the notation
 * the authoring tool's own text export uses, separator included.
 *
 * The number is what makes a step addressable: 27 names cover 106 of the 133
 * nodes, and a reader holding a test report that failed at 2.3.6.8 has nothing
 * else to search for. Falls back to the bare name on the root and on anything
 * a malformed file has orphaned, so it is always safe to call.
 */
export function numberedName(node: SeqNode): string {
  return node.stepNumber === ''
    ? displayName(node)
    : `${node.stepNumber} - ${displayName(node)}`;
}

/**
 * Every node in document order: containers depth-first with their children
 * beneath them. This is the outline's row order, and `graph.nodes` insertion
 * order already matches it — but the outline needs the tree, so walk it.
 */
export function outlineOrder(graph: Graph): SeqNode[] {
  const out: SeqNode[] = [];
  const seen = new Set<string>();

  const visit = (uid: string): void => {
    if (seen.has(uid)) return;
    seen.add(uid);
    const node = graph.nodes.get(uid);
    if (node === undefined) return;
    out.push(node);
    for (const child of graph.containers.get(uid) ?? []) visit(child);
  };

  for (const node of graph.nodes.values()) {
    if (node.parent === null) visit(node.uid);
  }
  // Anything orphaned by a malformed file still appears rather than vanishing.
  for (const node of graph.nodes.values()) if (!seen.has(node.uid)) out.push(node);
  return out;
}
