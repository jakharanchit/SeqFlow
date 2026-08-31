/**
 * Criteria — PHASE4-TASKS tasks 2 and 4. Spec 7.x and 7.5.
 *
 * "What can reject this unit" is the operative question about a battery test,
 * and spec 7.5 answers it with a filter: show only the paths that reach a
 * terminal abort. Measured on the fixture, that filter dims four steps out of
 * 107. 102 of 107 can reach the abort, because almost every step precedes a
 * criterion — which is what a linear test with a single abort route looks
 * like, not a defect in the sequence.
 *
 * So the question is answered here instead, by the 16 fail edges and the four
 * definitions behind them:
 *
 *   - `criteriaTable`  — one row per distinct definition. Four rows, not 16.
 *   - `failEdges`      — the 16 diverting exits, as one highlightable set.
 *   - `criteriaAhead`  — from a step, which criteria still lie in front of it.
 *                        16 at the entry, 0 after the last one. *That* is the
 *                        discriminating question, and it is per-step.
 *
 * The 102-node path filter is deliberately not built. `pathSet` in paths.ts
 * stays general enough to express it if a sequence with several independent
 * abort routes ever turns up.
 *
 * Pure. No DOM, no React. Names no element and no attribute of the sequence
 * schema: the reference attributes come from `rules.externalRefs`, and a fail
 * exit is identified by the rule file's own styling of it — see `failEdges`.
 */

import { displayName, outlineOrder } from './ancestry';
import { referenceId, referenceMembers } from './lint';
import { adjacency, downstream, type Adjacency } from './paths';
import type { Graph, Rules, SeqEdge } from './types';

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

export interface CriterionUse {
  uid: string;
  /** The step's display name. Identical across all four uses in the fixture. */
  name: string;
  /** The reference verbatim, before it was split into id and members. */
  raw: string;
}

export interface Criterion {
  /** `attr|id` — the row key. Unique within a table. */
  key: string;
  /** The rule-file attribute the reference was found under. */
  attr: string;
  /** The definition id: everything before the `=`, or the whole value. */
  id: string;
  /**
   * A name for the row. The step name where every use agrees on one, which is
   * how the fixture reads — four uses of "Acceptance Criteria - Assembly".
   * Where they disagree, the id has to stand for itself.
   */
  name: string;
  /** What the reference's `=` list names, when it carries one. */
  members: string[];
  uses: CriterionUse[];
  /** Distinct steps carrying this definition. */
  uids: string[];
  /**
   * The limits this criterion tests against.
   *
   * Always null today, and that is the answer to open question Q3 rather than
   * a gap in this module: the names are in the sequence file and the limits
   * are not. A row says so in words rather than showing an empty cell.
   */
  limits: string | null;
}

/**
 * One row per distinct external definition, most-used first.
 *
 * Driven entirely by `external_refs` in the rule file. On the fixture that is
 * `criteriaMap`, 16 references, four definitions, four uses each.
 */
export function criteriaTable(graph: Graph, rules: Rules): Criterion[] {
  const rows = new Map<string, Criterion>();

  for (const node of outlineOrder(graph)) {
    for (const attr of rules.externalRefs) {
      const raw = node.attrs[attr];
      if (raw === undefined || raw === '') continue;

      const id = referenceId(raw);
      const key = `${attr}|${id}`;
      const use: CriterionUse = { uid: node.uid, name: displayName(node), raw };

      const existing = rows.get(key);
      if (existing === undefined) {
        rows.set(key, {
          key,
          attr,
          id,
          name: use.name,
          members: referenceMembers(raw),
          uses: [use],
          uids: [node.uid],
          limits: null,
        });
        continue;
      }
      existing.uses.push(use);
      if (!existing.uids.includes(node.uid)) existing.uids.push(node.uid);
      // Agreement is the common case and the readable one; disagreement means
      // the id is the only honest label for the row.
      if (existing.name !== use.name) existing.name = existing.id;
      for (const member of referenceMembers(raw)) {
        if (!existing.members.includes(member)) existing.members.push(member);
      }
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.uses.length - a.uses.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** The steps carrying a criterion, for the canvas spotlight. */
export function nodesForCriterion(table: readonly Criterion[], key: string): Set<string> {
  return new Set(table.find((c) => c.key === key)?.uids ?? []);
}

/* ------------------------------------------------------------------ */
/* Fail routes                                                         */
/* ------------------------------------------------------------------ */

export interface FailRoutes {
  /** The diverting exits of every criteria step. 16 on the fixture. */
  edges: SeqEdge[];
  /** The steps those edges leave. */
  sources: Set<string>;
  /** The steps they arrive at — one on the fixture, "Turn off Load". */
  targets: Set<string>;
  /** Sources and targets together: what the canvas lights up. */
  nodes: Set<string>;
}

/**
 * The edges that divert the flow when a criterion is not met.
 *
 * Identified as criteria-reason edges the rule file styles dotted. That is not
 * a guess: spec 4.5 has the rule file style the failure exit dotted and the
 * continuing exit solid, precisely so a reader can tell them apart, and
 * `SeqEdge.style` carries the rule's own choice untouched — the parser never
 * writes it and only `collapse.ts` ever promotes one, on a merged bundle this
 * function is not given. Reading the label instead would mean hard-coding the
 * string "fail", which is rule-file content and does not belong in source.
 */
export function failEdges(graph: Graph): FailRoutes {
  const edges = graph.edges.filter((e) => e.reason === 'criteria' && e.style === 'dotted');
  const sources = new Set(edges.map((e) => e.src));
  const targets = new Set(edges.map((e) => e.dst));
  return { edges, sources, targets, nodes: new Set([...sources, ...targets]) };
}

/* ------------------------------------------------------------------ */
/* Criteria ahead                                                      */
/* ------------------------------------------------------------------ */

export interface CriteriaAhead {
  /** Criteria steps reachable from the subject, document order. */
  uids: string[];
  /** Their distinct definitions, by `Criterion.key`. */
  keys: string[];
  /** True when the subject is itself a criteria step. */
  isCriterion: boolean;
}

/**
 * Which criteria still lie in front of a step.
 *
 * This is the question the failure-path filter was reaching for, and unlike
 * the filter it discriminates: 16 near the entry, 0 after the last one. A step
 * with 0 criteria ahead cannot cause a rejection no matter what it does, which
 * is a real thing to know about a step and cannot be seen on the canvas.
 *
 * The subject itself is excluded — a criterion does not lie ahead of itself —
 * unless a cycle genuinely leads back to it.
 */
export function criteriaAhead(
  graph: Graph,
  uid: string,
  table: readonly Criterion[] = [],
  adj: Adjacency = adjacency(graph),
): CriteriaAhead {
  const reachable = downstream(graph, uid, adj).nodes;
  const uids = outlineOrder(graph)
    .filter((n) => n.kind === 'criteria' && reachable.has(n.uid) && n.uid !== uid)
    .map((n) => n.uid);

  const keys: string[] = [];
  for (const row of table) {
    if (row.uids.some((u) => uids.includes(u))) keys.push(row.key);
  }

  return { uids, keys, isCriterion: graph.nodes.get(uid)?.kind === 'criteria' };
}

/** Every criteria step in the file, document order. */
export function criteriaSteps(graph: Graph): string[] {
  return outlineOrder(graph)
    .filter((n) => n.kind === 'criteria')
    .map((n) => n.uid);
}
