/**
 * Search by name, filter by element type — spec 7.2.
 *
 * 27 names cover 106 of the 133 nodes in the sample. "Turn off Load" appears
 * five times, "Charge to Desired Voltage" four. A flat list of matching names
 * is therefore ambiguous for 80% of this file, so every result carries the
 * path that disambiguates it: `Main › Pulse 3 - 24C › Charge to Desired
 * Voltage`.
 *
 * A query also matches a *step number* by prefix. That is the point of having
 * numbers at all: someone holding a report that failed at `2.3.6.8` can paste
 * it, and `2.3.6` selects the whole discharge block. A number query is
 * recognised by shape — digits and dots — so it can never shadow a name.
 *
 * Pure functions over the Graph, so the ranking is testable without a UI.
 */

import { ancestors, displayName } from './ancestry';
import type { Graph, NodeKind, SeqNode } from './types';

export interface SearchResult {
  uid: string;
  /** The node's own display name. */
  name: string;
  /** `2.1.6.7`. Empty on the root. */
  stepNumber: string;
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
 * Whether a query is a step number rather than a name: digits separated by
 * dots, and nothing else. `2.3.6` and `2.3.6.` both qualify — a trailing dot
 * is what someone typing their way down the tree leaves behind.
 */
export function isStepNumberQuery(text: string): boolean {
  return /^\d+(\.\d+)*\.?$/.test(text.trim());
}

/**
 * Prefix match on the dotted number, respecting segment boundaries: `2.1`
 * matches `2.1` and `2.1.6.7` but never `2.10`. That distinction does not
 * arise on the sample and will the first time a sequence has ten children.
 */
function numberMatches(stepNumber: string, needle: string): boolean {
  if (stepNumber === '') return false;
  const want = needle.endsWith('.') ? needle.slice(0, -1) : needle;
  return stepNumber === want || stepNumber.startsWith(`${want}.`);
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
  const byNumber = needle !== '' && isStepNumberQuery(needle);

  const out: SearchResult[] = [];
  for (const node of graph.nodes.values()) {
    if (byElement && !elements.has(node.element)) continue;

    const name = displayName(node);
    // A number query matches the number and nothing else — `at` stays -1, so
    // the result list highlights no span of the name. There is none to
    // highlight; the match was on the address, not on the text.
    const at = needle === '' || byNumber ? -1 : name.toLowerCase().indexOf(needle);
    if (byNumber) {
      if (!numberMatches(node.stepNumber, needle)) continue;
    } else if (needle !== '' && at < 0) continue;

    const chain = ancestors(graph, node.uid);
    out.push({
      uid: node.uid,
      name,
      stepNumber: node.stepNumber,
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
