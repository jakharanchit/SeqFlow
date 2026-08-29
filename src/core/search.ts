/**
 * Search by name, filter by element type — spec 7.2.
 *
 * 27 names cover 106 of the 133 nodes in the sample. "Turn off Load" appears
 * five times, "Charge to Desired Voltage" four. A flat list of matching names
 * is therefore ambiguous for 80% of this file, so every result carries the
 * path that disambiguates it: `Main › Pulse 3 - 24C › Charge to Desired
 * Voltage`.
 *
 * Pure functions over the Graph, so the ranking is testable without a UI.
 */

import { ancestors, displayName } from './ancestry';
import type { Graph, NodeKind, SeqNode } from './types';

export interface SearchResult {
  uid: string;
  /** The node's own display name. */
  name: string;
  element: string;
  kind: NodeKind;
  /** Ancestor names, outermost first: `HLB Battery ESR › Main › Pulse 1 - 6C`. */
  path: string;
  /** Ancestor uids, for revealing a hit inside a collapsed sequence. */
  ancestors: string[];
  /** Where the query matched in `name`, for highlighting. -1 when unmatched. */
  at: number;
}

export interface Query {
  /** Case-insensitive substring of the node name. Empty matches everything. */
  text: string;
  /** Element types to keep. Empty or null keeps every type. */
  elements?: ReadonlySet<string> | null;
}

export function isActive(query: Query): boolean {
  return query.text.trim() !== '' || (query.elements?.size ?? 0) > 0;
}

/**
 * Matching nodes, in document order.
 *
 * Document order rather than relevance: the reader is looking for a step in a
 * sequence, and the order they already know is the order it runs in.
 */
export function search(graph: Graph, query: Query): SearchResult[] {
  const needle = query.text.trim().toLowerCase();
  const elements = query.elements ?? null;
  const byElement = elements !== null && elements.size > 0;

  const out: SearchResult[] = [];
  for (const node of graph.nodes.values()) {
    if (byElement && !elements.has(node.element)) continue;

    const name = displayName(node);
    const at = needle === '' ? -1 : name.toLowerCase().indexOf(needle);
    if (needle !== '' && at < 0) continue;

    const chain = ancestors(graph, node.uid);
    out.push({
      uid: node.uid,
      name,
      element: node.element,
      kind: node.kind,
      path: chain.map(displayName).join(' › '),
      ancestors: chain.map((n) => n.uid),
      at,
    });
  }
  return out;
}

/** Just the uids, for dimming everything else. */
export function matchSet(results: readonly SearchResult[]): Set<string> {
  return new Set(results.map((r) => r.uid));
}

export interface ElementCount {
  element: string;
  count: number;
}

/** Every element type present, most common first — the filter's menu. */
export function elementCounts(graph: Graph): ElementCount[] {
  const counts = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    counts.set(node.element, (counts.get(node.element) ?? 0) + 1);
  }
  return [...counts]
    .map(([element, count]) => ({ element, count }))
    .sort((a, b) => b.count - a.count || (a.element < b.element ? -1 : 1));
}

/** Distinct names in the file, with how many nodes share each. */
export function nameCounts(graph: Graph): Map<string, SeqNode[]> {
  const out = new Map<string, SeqNode[]>();
  for (const node of graph.nodes.values()) {
    const name = displayName(node);
    const bucket = out.get(name);
    if (bucket === undefined) out.set(name, [node]);
    else bucket.push(node);
  }
  return out;
}
