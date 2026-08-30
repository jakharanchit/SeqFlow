/**
 * Revision diff — PHASE4-TASKS task 5. Spec 7.7.
 *
 * "What actually changed in this revision" without reading a GUID-heavy XML
 * diff. The engine for it already existed: `core/similarity.ts` compares any
 * set of subtrees and does not care whether they came from one file or two.
 * Phase 2 pointed it at four siblings; this points it at two roots.
 *
 * ## What this is validated against, and what it is not
 *
 * **There is still only one sequence XML.** Everything below is pinned by
 * `tests/diff.test.ts`, which mutates a known set of steps in the fixture and
 * asserts the diff finds exactly those, and by the identity case: a file
 * diffed against itself reports nothing. That is a real test of the engine and
 * it is not a test of the feature. Two genuine revisions of one sequence would
 * be, and when one arrives this comment should be the first thing to change.
 *
 * ## Q5, and why the matcher is a parameter
 *
 * Spec 7.7 matches "by `uid`", and `match` below defaults to exactly that: a
 * `Map` lookup, the whole matcher. It is right if and only if the authoring
 * tool keeps a step's GUID when the step is edited — open question Q5, still
 * unanswered.
 *
 * If it does not, every edited step reads as one deletion plus one addition
 * and the diff degenerates into the XML diff it exists to avoid. The fallback
 * is position-plus-structure, which is `structureKey` again, and it is
 * deliberately **not** written here: the shape of that matcher depends on how
 * uids actually behave, and guessing now means writing it twice. `match` is
 * the seam it will slot into. Nothing else in this module knows how the two
 * sides were paired.
 *
 * Pure. No DOM, no React. Names no element of the sequence schema.
 */

import { displayName, outlineOrder } from './ancestry';
import { flatAttrs } from './similarity';
import type { Graph, SeqEdge, SeqNode } from './types';

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'same';

export interface AttrChange {
  attr: string;
  /** Empty string where the attribute is absent on that side. */
  before: string;
  after: string;
}

export interface NodeDiff {
  uid: string;
  kind: ChangeKind;
  /** Display name, preferring the new revision's. */
  name: string;
  /** Step number in the revision this record belongs to. */
  stepNumber: string;
  /**
   * The number this step had in the baseline, when that differs from
   * `stepNumber`. Empty otherwise, and always empty on an addition.
   *
   * Inserting one step renumbers every step after it, so this is what lets the
   * change list say `2.1.6 (was 2.1.5)` instead of leaving a reader to work out
   * why an address they wrote down last week now points somewhere else.
   *
   * A renumbered *descendant* is deliberately not promoted to `changed` on
   * this account. Inserting one sequence at the top of Main renumbers thirty
   * steps beneath it that are otherwise untouched, and reporting all thirty is
   * the same failure "moved is rank, not raw index" exists to avoid. The moved
   * parent is what explains the renumber; this field annotates the rows that
   * are already being reported.
   */
  wasStepNumber: string;
  element: string;
  /** Attribute changes, sorted by name. Empty for added and removed. */
  attrs: AttrChange[];
  /** True when the step's parent changed, or its position under it did. */
  moved: boolean;
  /** Parent uid before and after, when moved. */
  before?: string | null;
  after?: string | null;
}

export interface EdgeDiff {
  kind: 'added' | 'removed';
  edge: SeqEdge;
}

export interface DiffCounts {
  added: number;
  removed: number;
  changed: number;
  /** Moved steps. A move is also counted under `changed` when attrs differ. */
  moved: number;
  same: number;
  edgesAdded: number;
  edgesRemoved: number;
}

export interface GraphDiff {
  /** Every uid on either side -> what happened to it. */
  status: Map<string, ChangeKind>;
  /** Added, removed and changed only, in new-revision document order. */
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  counts: DiffCounts;
  /** True when nothing at all differs. */
  identical: boolean;
  /** How the two sides were paired. Recorded so a report can say. */
  matcher: string;
}

/**
 * Pairs a uid in the base revision with its uid in the new one.
 *
 * The default is identity — see the Q5 note at the top of this file. A matcher
 * returns null when the step has no counterpart.
 */
export interface Matcher {
  name: string;
  match: (uid: string, base: Graph, next: Graph) => string | null;
}

export const BY_UID: Matcher = {
  name: 'uid',
  match: (uid, _base, next) => (next.nodes.has(uid) ? uid : null),
};

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

/**
 * Rank among the siblings that exist on *both* sides.
 *
 * Not the raw index. Inserting one step at the top of a sequence shifts the
 * raw index of every step below it, and reporting 12 moves for one insertion
 * is noise that buries the insertion. What a reader means by "moved" is that
 * the order changed relative to the steps that are still there.
 */
function commonRanks(
  graph: Graph,
  survives: (uid: string) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, children] of graph.containers) {
    let rank = 0;
    for (const child of children) {
      if (!survives(child)) continue;
      out.set(child, rank++);
    }
  }
  return out;
}

function attrChanges(before: SeqNode, after: SeqNode): AttrChange[] {
  const a = flatAttrs(before);
  const b = flatAttrs(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  const out: AttrChange[] = [];
  for (const attr of keys) {
    const from = a.get(attr) ?? '';
    const to = b.get(attr) ?? '';
    if (from !== to) out.push({ attr, before: from, after: to });
  }
  return out;
}

function edgeKey(e: SeqEdge): string {
  return `${e.src}|${e.reason}|${e.dst}|${e.label ?? ''}`;
}

/**
 * Two revisions, compared.
 *
 * The result is ordered by the *new* revision's document order, with removed
 * steps slotted where they used to be, so the list reads like the file rather
 * than like a hash table.
 */
export function diffGraphs(base: Graph, next: Graph, matcher: Matcher = BY_UID): GraphDiff {
  const status = new Map<string, ChangeKind>();

  /* Pair first: ranks and parents can only be compared once both sides know
     which steps survived. */
  const paired = new Map<string, string>();
  for (const uid of base.nodes.keys()) {
    const to = matcher.match(uid, base, next);
    if (to !== null && next.nodes.has(to)) paired.set(uid, to);
  }
  const matched = new Set(paired.values());
  const baseRank = commonRanks(base, (uid) => paired.has(uid));
  const nextRank = commonRanks(next, (uid) => matched.has(uid));

  /* Base side: removed, changed, moved, same. Removals are kept in their own
     list — a matcher that declines to pair two nodes sharing a uid would
     otherwise have the addition overwrite the removal in a uid-keyed map. */
  const removedDiffs: NodeDiff[] = [];
  const liveDiffs = new Map<string, NodeDiff>();

  for (const node of outlineOrder(base)) {
    const to = paired.get(node.uid);
    if (to === undefined) {
      status.set(node.uid, 'removed');
      removedDiffs.push({
        uid: node.uid,
        kind: 'removed',
        name: displayName(node),
        // A ghost keeps the number it had: it is a fact about the baseline.
        stepNumber: node.stepNumber,
        wasStepNumber: '',
        element: node.element,
        attrs: [],
        moved: false,
        before: node.parent,
        after: null,
      });
      continue;
    }

    const other = next.nodes.get(to)!;
    const attrs = attrChanges(node, other);
    const wasUnder = node.parent === null ? null : (paired.get(node.parent) ?? node.parent);
    const moved =
      wasUnder !== other.parent || (baseRank.get(node.uid) ?? -1) !== (nextRank.get(to) ?? -1);

    if (attrs.length === 0 && !moved) {
      status.set(to, 'same');
      continue;
    }
    status.set(to, 'changed');
    liveDiffs.set(to, {
      uid: to,
      kind: 'changed',
      name: displayName(other),
      stepNumber: other.stepNumber,
      wasStepNumber: node.stepNumber === other.stepNumber ? '' : node.stepNumber,
      element: other.element,
      attrs,
      moved,
      before: wasUnder,
      after: other.parent,
    });
  }

  /* New side: anything nothing was paired to is an addition. */
  for (const node of outlineOrder(next)) {
    if (matched.has(node.uid)) continue;
    status.set(node.uid, 'added');
    liveDiffs.set(node.uid, {
      uid: node.uid,
      kind: 'added',
      name: displayName(node),
      stepNumber: node.stepNumber,
      wasStepNumber: '',
      element: node.element,
      attrs: [],
      moved: false,
      before: null,
      after: node.parent,
    });
  }

  /* Edges. Compared on (src, reason, dst, label) in the new revision's own
     terms, which is only meaningful once the nodes have been paired. */
  const baseEdges = new Map(base.edges.map((e) => [edgeKey(e), e]));
  const nextEdges = new Map(next.edges.map((e) => [edgeKey(e), e]));
  const edges: EdgeDiff[] = [];
  for (const [key, edge] of baseEdges) {
    if (!nextEdges.has(key)) edges.push({ kind: 'removed', edge });
  }
  for (const [key, edge] of nextEdges) {
    if (!baseEdges.has(key)) edges.push({ kind: 'added', edge });
  }
  edges.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'removed' ? -1 : 1;
    const ka = edgeKey(a.edge);
    const kb = edgeKey(b.edge);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  /* Order the node list the way the file reads. */
  const order = new Map<string, number>();
  outlineOrder(next).forEach((n, i) => order.set(n.uid, i));
  // A removed step sorts just after whatever preceded it in the base file and
  // survived, so it appears where it used to be rather than at the end.
  const baseOrder = new Map<string, number>();
  outlineOrder(base).forEach((n, i) => baseOrder.set(n.uid, i));
  const anchor = (uid: string): number => {
    const own = paired.get(uid) === undefined ? undefined : order.get(paired.get(uid)!);
    if (own !== undefined) return own;
    const direct = order.get(uid);
    if (direct !== undefined && matched.has(uid)) return direct;
    let best = -1;
    const mine = baseOrder.get(uid) ?? 0;
    for (const [id, i] of baseOrder) {
      if (i >= mine) continue;
      const to = paired.get(id);
      const pos = to === undefined ? undefined : order.get(to);
      if (pos !== undefined && pos > best) best = pos;
    }
    return best + 0.5;
  };

  const nodes = [...removedDiffs, ...liveDiffs.values()].sort(
    (a, b) => anchor(a.uid) - anchor(b.uid),
  );

  const counts: DiffCounts = {
    added: nodes.filter((n) => n.kind === 'added').length,
    removed: nodes.filter((n) => n.kind === 'removed').length,
    changed: nodes.filter((n) => n.kind === 'changed').length,
    moved: nodes.filter((n) => n.moved).length,
    same: [...status.values()].filter((k) => k === 'same').length,
    edgesAdded: edges.filter((e) => e.kind === 'added').length,
    edgesRemoved: edges.filter((e) => e.kind === 'removed').length,
  };

  return {
    status,
    nodes,
    edges,
    counts,
    identical: nodes.length === 0 && edges.length === 0,
    matcher: matcher.name,
  };
}

/* ------------------------------------------------------------------ */
/* The merged graph                                                    */
/* ------------------------------------------------------------------ */

/**
 * The new revision with the removed steps put back as ghosts.
 *
 * A split view of two 8886 px columns is not something anyone can align by
 * eye, so the canvas shows one graph: the new revision, with what was deleted
 * still drawn in the place it used to occupy. A removed step has to be
 * *visible*, not merely absent — an absence is exactly what a reader cannot
 * see.
 *
 * The result is an ordinary `Graph`. Everything downstream — the flow adapter,
 * the layout, the Mermaid and SVG emitters — needs no diff awareness at all;
 * the UI paints the three classes from `diff.status`.
 *
 * Warnings come from the new revision. A ghost's warnings are about a file
 * that is no longer the subject.
 */
export function mergedGraph(base: Graph, next: Graph, diff: GraphDiff): Graph {
  const nodes = new Map(next.nodes);
  const containers = new Map<string, string[]>();
  for (const [uid, children] of next.containers) containers.set(uid, [...children]);

  const removed = outlineOrder(base).filter((n) => diff.status.get(n.uid) === 'removed');

  // Outermost first, so a removed sequence exists before its removed children
  // look for it.
  removed.sort((a, b) => a.depth - b.depth);

  for (const node of removed) {
    nodes.set(node.uid, node);
    if (base.containers.has(node.uid)) containers.set(node.uid, []);
  }

  for (const node of removed) {
    const parent = node.parent;
    if (parent === null || !containers.has(parent)) continue;
    const siblings = containers.get(parent)!;
    if (siblings.includes(node.uid)) continue;

    // Land after the nearest preceding sibling that still exists, so the ghost
    // keeps its place in the sequence rather than piling up at the end.
    const wasAmong = base.containers.get(parent) ?? [];
    const mine = wasAmong.indexOf(node.uid);
    let at = 0;
    for (let i = mine - 1; i >= 0; i--) {
      const before = wasAmong[i]!;
      const pos = siblings.indexOf(before);
      if (pos !== -1) {
        at = pos + 1;
        break;
      }
    }
    siblings.splice(at, 0, node.uid);
  }

  /* Edges: the new revision's, plus the ones a ghost needs to hang from.
     Only those. A removed edge between two steps that both survived is a
     rerouting, and drawing it would put a line on the canvas that no longer
     exists and looks exactly like one that does — the edge table says it
     instead. An edge to a step gone from both sides has nowhere to point. */
  const ghost = (uid: string): boolean => diff.status.get(uid) === 'removed';
  const seen = new Set(next.edges.map((e) => `${e.src}|${e.reason}|${e.dst}|${e.label ?? ''}`));
  const edges = [...next.edges];
  for (const { kind, edge } of diff.edges) {
    if (kind !== 'removed') continue;
    if (!ghost(edge.src) && !ghost(edge.dst)) continue;
    const key = `${edge.src}|${edge.reason}|${edge.dst}|${edge.label ?? ''}`;
    if (seen.has(key)) continue;
    if (!nodes.has(edge.src) || !nodes.has(edge.dst)) continue;
    seen.add(key);
    edges.push(edge);
  }
  edges.sort((a, b) => {
    const ka = `${a.src}|${a.reason}|${a.dst}`;
    const kb = `${b.src}|${b.reason}|${b.dst}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    root: next.root,
    entry: next.entry,
    nodes,
    edges,
    containers,
    warnings: next.warnings,
  };
}

/**
 * A one-line summary. Used by the drawer heading and by anything that has to
 * say what the diff found without rendering the table.
 */
export function summarise(diff: GraphDiff): string {
  if (diff.identical) return 'No differences.';
  const { added, removed, changed, moved } = diff.counts;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (moved > 0) parts.push(`${moved} moved`);
  return parts.join(', ');
}
