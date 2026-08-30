/**
 * Structural comparison of sibling sequences — PHASE2-TASKS task 10.
 *
 * The four Pulse sequences in the sample are 28 nodes each with identical
 * structure. They differ only in setpoints: 6C, 12C, 24C, 36C. The file is
 * really about 35 distinct nodes plus four parameterised repeats, and saying
 * so compresses it harder than any navigation feature in Phase 2.
 *
 * The engine is deliberately aimed both ways. Pointed at two sequences in one
 * file it answers "how do these siblings differ"; pointed at the same uid in
 * two revisions it is the Phase 4 diff view (spec 7.7). Nothing here knows
 * which of those it is doing.
 *
 * Pure functions over the Graph. No element of the source schema is named.
 */

import { displayName } from './ancestry';
import type { Graph, SeqNode } from './types';

/**
 * A canonical description of a subtree's shape: element names and nesting,
 * nothing else.
 *
 * Names are excluded on purpose. "Discharge at 6C" and "Discharge at 12C" are
 * the same step parameterised differently, and a key that included the name
 * would call them different structures and report nothing. Names come back as
 * a difference, which is what they are.
 */
export function structureKey(graph: Graph, uid: string): string {
  const seen = new Set<string>();

  const walk = (id: string): string => {
    if (seen.has(id)) return '…'; // malformed containment; do not recurse forever
    seen.add(id);
    const node = graph.nodes.get(id);
    if (node === undefined) return '?';
    const children = graph.containers.get(id);
    if (children === undefined) return node.element;
    return `${node.element}(${children.map(walk).join(',')})`;
  };

  return walk(uid);
}

/** Nodes in a subtree, document order, the root first. */
export function subtree(graph: Graph, uid: string): SeqNode[] {
  const out: SeqNode[] = [];
  const seen = new Set<string>();

  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = graph.nodes.get(id);
    if (node === undefined) return;
    out.push(node);
    for (const child of graph.containers.get(id) ?? []) walk(child);
  };

  walk(uid);
  return out;
}

export interface SimilarGroup {
  /** The shared structure key. */
  key: string;
  /** The sibling container uids, document order. */
  members: string[];
  /** Nodes in each member's subtree — the same count for every member. */
  size: number;
  /** Their common parent, or null when they are not siblings. */
  parent: string | null;
}

/**
 * Containers that share a structure with at least one other container.
 *
 * Restricted to siblings by default: two sequences under the same parent are a
 * repeat, whereas two that merely rhyme across the file usually are not.
 */
export function similarGroups(graph: Graph, siblingsOnly = true): SimilarGroup[] {
  const buckets = new Map<string, string[]>();

  for (const uid of graph.containers.keys()) {
    const node = graph.nodes.get(uid);
    if (node === undefined) continue;
    const key = siblingsOnly
      ? `${node.parent ?? '-'}|${structureKey(graph, uid)}`
      : structureKey(graph, uid);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [uid]);
    else bucket.push(uid);
  }

  const out: SimilarGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const first = members[0]!;
    out.push({
      key: siblingsOnly ? (key.split('|').slice(1).join('|') ?? key) : key,
      members,
      size: subtree(graph, first).length,
      parent: graph.nodes.get(first)?.parent ?? null,
    });
  }

  // Biggest repeat first: that is the one worth knowing about.
  return out.sort((a, b) => b.size * b.members.length - a.size * a.members.length);
}

export interface Difference {
  /** Position within the shared structure, 0 being the group root. */
  position: number;
  /** The first member's name for that position, for a readable row. */
  label: string;
  element: string;
  /** The attribute that differs. Prefixed `Child.attr` when lifted. */
  attr: string;
  /** One value per member, in `members` order. Empty string for absent. */
  values: string[];
  /** uid of the node at this position, per member — for click-through. */
  uids: string[];
}

/** `uid` always differs and says nothing; it is never reported. */
const IGNORED_ATTRS = new Set(['uid']);

/**
 * Flatten a node's own attributes plus those lifted from its inspector
 * children, so a ConditionStep's threshold is compared alongside its own
 * attributes rather than being invisible.
 *
 * Exported because it is the definition of "this node's attributes" that every
 * comparison in the tool has to agree on — the sibling table here and the
 * revision diff in `core/diff.ts` are the same question asked twice.
 */
export function flatAttrs(node: SeqNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(node.attrs)) {
    if (!IGNORED_ATTRS.has(k)) out.set(k, v);
  }
  for (const [element, rows] of Object.entries(node.childAttrs ?? {})) {
    rows.forEach((row, i) => {
      const prefix = rows.length === 1 ? element : `${element}[${i}]`;
      for (const [k, v] of Object.entries(row)) {
        if (!IGNORED_ATTRS.has(k)) out.set(`${prefix}.${k}`, v);
      }
    });
  }
  return out;
}

export interface Comparison {
  members: string[];
  /** Member display names, for column headings. */
  names: string[];
  /** True when every member walks the same structure. */
  identical: boolean;
  /** Nodes compared per member. */
  size: number;
  differences: Difference[];
}

/**
 * Walk a set of structurally identical containers in lockstep and report every
 * attribute whose value is not the same across all of them.
 *
 * `identical` is about *structure*: four sequences can be structurally
 * identical and still differ in every setpoint, which is exactly the finding
 * this exists to produce.
 */
export function compare(graph: Graph, members: readonly string[]): Comparison {
  const trees = members.map((uid) => subtree(graph, uid));
  const first = trees[0] ?? [];
  const identical =
    trees.length > 1 &&
    trees.every(
      (t) => t.length === first.length && t.every((n, i) => n.element === first[i]?.element),
    );

  const differences: Difference[] = [];
  if (identical) {
    const flat = trees.map((t) => t.map(flatAttrs));

    for (let position = 0; position < first.length; position++) {
      // Every attribute any member carries at this position.
      const keys = new Set<string>();
      for (const member of flat) {
        for (const key of member[position]?.keys() ?? []) keys.add(key);
      }

      for (const attr of [...keys].sort()) {
        const values = flat.map((member) => member[position]?.get(attr) ?? '');
        if (new Set(values).size < 2) continue;
        differences.push({
          position,
          label: displayName(first[position]!),
          element: first[position]!.element,
          attr,
          values,
          uids: trees.map((t) => t[position]?.uid ?? ''),
        });
      }
    }
  }

  return {
    members: [...members],
    names: members.map((uid) => {
      const node = graph.nodes.get(uid);
      return node === undefined ? uid : displayName(node);
    }),
    identical,
    size: first.length,
    differences,
  };
}
