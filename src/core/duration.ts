/**
 * Duration estimate — PHASE4-TASKS task 3. Spec 7.6.
 *
 * A range, never a figure. The arithmetic on the fixture is why:
 *
 *   16 waits            120 s exactly          2.0 minutes
 *   8 polling timeouts  4800 s                80.0 minutes
 *   nominal 2.0 min, worst case 82.0 min      a ratio of 41
 *
 * A single number 41x out is worse than no number in a change-controlled
 * environment. Spec 7.6 says "range, clearly labelled an estimate, ignoring
 * polling waits"; that is read here as *reporting* the polling separately, not
 * dropping it, because 80 of the 82 minutes are polling and a reader told
 * "2 minutes" will plan a shift around it.
 *
 * Per path, not per file. There are 136 distinct entry-to-terminal paths on
 * the fixture and the abort path is far shorter than the pass path, so a
 * whole-file sum answers a question nobody asked.
 *
 * Which attributes hold a duration is rule-file knowledge — `durations.waits`
 * and `durations.timeouts`. This module names no attribute of the sequence
 * schema. Note the gate is a *non-zero value*, not attribute presence: 125 of
 * the fixture's 133 elements carry a zero timeout, and "steps with a timeout"
 * selects all of them.
 *
 * Pure. No DOM, no React.
 */

import { adjacency, terminals, type Adjacency } from './paths';
import type { Graph, Rules, SeqNode } from './types';

/* ------------------------------------------------------------------ */
/* Per-step seconds                                                    */
/* ------------------------------------------------------------------ */

export interface StepSeconds {
  /** Time the step spends on purpose. */
  wait: number;
  /** Additional time it can spend before giving up. */
  timeout: number;
}

const ZERO: StepSeconds = { wait: 0, timeout: 0 };

/**
 * Seconds from a node's own attributes.
 *
 * A value that is absent, empty, unparseable, negative or zero contributes
 * nothing. Zero is deliberate: it is the fixture's way of saying "no timeout",
 * not a timeout of no length.
 */
export function stepSeconds(node: SeqNode, rules: Rules): StepSeconds {
  const sum = (attrs: readonly string[]): number => {
    let total = 0;
    for (const attr of attrs) {
      const raw = node.attrs[attr];
      if (raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      total += value;
    }
    return total;
  };
  return { wait: sum(rules.durations.waits), timeout: sum(rules.durations.timeouts) };
}

/* ------------------------------------------------------------------ */
/* Path arithmetic                                                     */
/* ------------------------------------------------------------------ */

export interface Range {
  min: number;
  max: number;
}

export interface DurationReport {
  /**
   * False when nothing in the file carries a duration. The UI says "no timed
   * waits" rather than "0.0 minutes", which would read as a measurement.
   */
  timed: boolean;
  /** The rule-file attributes these numbers came from. */
  waitAttrs: string[];
  timeoutAttrs: string[];

  /** Steps carrying a non-zero wait, and their total. 16 and 120 s. */
  waitSteps: number;
  waitSeconds: number;
  /** Steps carrying a non-zero timeout, and their total. 8 and 4800 s. */
  pollingSteps: number;
  pollingSeconds: number;

  /** Distinct entry-to-terminal paths. 136 on the fixture. */
  paths: number;
  /** True when the graph has a cycle, so path arithmetic cannot terminate. */
  cyclic: boolean;

  /** Nominal seconds along a path: waits only. */
  nominal: Range;
  /** Worst case along a path: waits plus every timeout on it. */
  worst: Range;
  /** `worst.max / nominal.max`. 41 on the fixture. Infinity with no waits. */
  ratio: number;
}

interface Totals {
  /** Distinct paths from this node to a terminal. */
  paths: number;
  nominal: Range;
  worst: Range;
}

/**
 * Reverse topological order over the reachable subgraph, terminals first.
 *
 * Kahn from the far end. A node left unvisited sits on a cycle; the caller
 * reports the graph as cyclic rather than looping or inventing a number.
 */
function reverseTopo(
  adj: Adjacency,
  reachable: ReadonlySet<string>,
): { order: string[]; cyclic: boolean } {
  const remaining = new Map<string, number>();
  for (const uid of reachable) {
    remaining.set(uid, (adj.out.get(uid) ?? []).filter((e) => reachable.has(e.dst)).length);
  }

  const order: string[] = [];
  const queue = [...remaining].filter(([, n]) => n === 0).map(([uid]) => uid);
  while (queue.length > 0) {
    const uid = queue.shift()!;
    order.push(uid);
    for (const e of adj.in.get(uid) ?? []) {
      if (!reachable.has(e.src)) continue;
      const left = (remaining.get(e.src) ?? 0) - 1;
      remaining.set(e.src, left);
      if (left === 0) queue.push(e.src);
    }
  }

  return { order, cyclic: order.length !== reachable.size };
}

/**
 * Every reachable step's totals, computed once.
 *
 * Exported because two answers come out of the same walk: the file's range,
 * and — read from the other end, in `offsets` — how far into the test any one
 * step sits.
 */
export function pathTotals(
  graph: Graph,
  rules: Rules,
  adj: Adjacency = adjacency(graph),
): { totals: Map<string, Totals>; cyclic: boolean; reachable: Set<string> } {
  // Forward reachability from the entry, cycle-guarded by the visited set.
  const reachable = new Set<string>([graph.entry]);
  const stack = [graph.entry];
  while (stack.length > 0) {
    const uid = stack.pop()!;
    for (const e of adj.out.get(uid) ?? []) {
      if (reachable.has(e.dst)) continue;
      reachable.add(e.dst);
      stack.push(e.dst);
    }
  }

  const { order, cyclic } = reverseTopo(adj, reachable);
  const totals = new Map<string, Totals>();

  for (const uid of order) {
    const node = graph.nodes.get(uid);
    const own = node === undefined ? ZERO : stepSeconds(node, rules);
    const outgoing = (adj.out.get(uid) ?? []).filter((e) => reachable.has(e.dst));

    if (outgoing.length === 0) {
      totals.set(uid, {
        paths: 1,
        nominal: { min: own.wait, max: own.wait },
        worst: { min: own.wait + own.timeout, max: own.wait + own.timeout },
      });
      continue;
    }

    let paths = 0;
    let nMin = Infinity;
    let nMax = -Infinity;
    let wMin = Infinity;
    let wMax = -Infinity;
    // A pair of nodes can be joined twice; each edge is still one route only
    // where its target differs, so count distinct successors, not edges.
    for (const dst of new Set(outgoing.map((e) => e.dst))) {
      const next = totals.get(dst);
      if (next === undefined) continue; // only when cyclic
      paths += next.paths;
      nMin = Math.min(nMin, next.nominal.min);
      nMax = Math.max(nMax, next.nominal.max);
      wMin = Math.min(wMin, next.worst.min);
      wMax = Math.max(wMax, next.worst.max);
    }
    if (paths === 0) {
      totals.set(uid, {
        paths: 1,
        nominal: { min: own.wait, max: own.wait },
        worst: { min: own.wait + own.timeout, max: own.wait + own.timeout },
      });
      continue;
    }

    totals.set(uid, {
      paths,
      nominal: { min: own.wait + nMin, max: own.wait + nMax },
      worst: { min: own.wait + own.timeout + wMin, max: own.wait + own.timeout + wMax },
    });
  }

  return { totals, cyclic, reachable };
}

/**
 * The file's estimate.
 *
 * `nominal` and `worst` are ranges across the entry-to-terminal paths, so the
 * abort route and the pass route both show. On the fixture the longest path
 * carries all 16 waits, which is why `nominal.max` equals the whole-file wait
 * total — a coincidence of this file's shape, not an identity.
 */
export function durations(
  graph: Graph,
  rules: Rules,
  adj: Adjacency = adjacency(graph),
): DurationReport {
  let waitSteps = 0;
  let waitSeconds = 0;
  let pollingSteps = 0;
  let pollingSeconds = 0;
  for (const node of graph.nodes.values()) {
    if (node.kind === 'container') continue;
    const own = stepSeconds(node, rules);
    if (own.wait > 0) {
      waitSteps += 1;
      waitSeconds += own.wait;
    }
    if (own.timeout > 0) {
      pollingSteps += 1;
      pollingSeconds += own.timeout;
    }
  }

  const { totals, cyclic } = pathTotals(graph, rules, adj);
  const entry = totals.get(graph.entry);
  const nominal = entry?.nominal ?? { min: 0, max: 0 };
  const worst = entry?.worst ?? { min: 0, max: 0 };

  return {
    timed: waitSteps > 0 || pollingSteps > 0,
    waitAttrs: [...rules.durations.waits],
    timeoutAttrs: [...rules.durations.timeouts],
    waitSteps,
    waitSeconds,
    pollingSteps,
    pollingSeconds,
    paths: entry?.paths ?? 0,
    cyclic,
    nominal,
    worst,
    ratio: nominal.max > 0 ? worst.max / nominal.max : Infinity,
  };
}

/* ------------------------------------------------------------------ */
/* Where a step sits                                                   */
/* ------------------------------------------------------------------ */

export interface Offset {
  /** Nominal seconds from the entry to the *start* of this step. */
  nominal: Range;
  /** Worst case from the entry to the start of this step. */
  worst: Range;
  /** Nominal seconds from the start of this step to a terminal. */
  remaining: Range;
  /** True when the flow cannot reach this step at all. */
  unreachable: boolean;
}

/**
 * How far into the test a step sits, and how much is left after it.
 *
 * A range on both sides, for the same reason as everything else here: a step
 * inside Pulse 3 is reached at one offset on the pass route and never on the
 * abort route, and the two are both true.
 *
 * The forward number is a walk from the entry; the remaining number is read
 * straight off `pathTotals`, which already has it.
 */
export function offsets(
  graph: Graph,
  rules: Rules,
  adj: Adjacency = adjacency(graph),
): Map<string, Offset> {
  const { totals, reachable } = pathTotals(graph, rules, adj);

  // Forward relaxation, in topological order this time: the reverse of the
  // reverse order is a valid forward order wherever the graph is acyclic.
  const { order } = reverseTopo(adj, reachable);
  const forward = [...order].reverse();

  const before = new Map<string, { nominal: Range; worst: Range }>();
  before.set(graph.entry, {
    nominal: { min: 0, max: 0 },
    worst: { min: 0, max: 0 },
  });

  for (const uid of forward) {
    const here = before.get(uid);
    if (here === undefined) continue;
    const node = graph.nodes.get(uid);
    const own = node === undefined ? ZERO : stepSeconds(node, rules);
    const afterNominal = { min: here.nominal.min + own.wait, max: here.nominal.max + own.wait };
    const afterWorst = {
      min: here.worst.min + own.wait + own.timeout,
      max: here.worst.max + own.wait + own.timeout,
    };

    for (const e of adj.out.get(uid) ?? []) {
      if (!reachable.has(e.dst)) continue;
      const existing = before.get(e.dst);
      if (existing === undefined) {
        before.set(e.dst, {
          nominal: { ...afterNominal },
          worst: { ...afterWorst },
        });
        continue;
      }
      existing.nominal.min = Math.min(existing.nominal.min, afterNominal.min);
      existing.nominal.max = Math.max(existing.nominal.max, afterNominal.max);
      existing.worst.min = Math.min(existing.worst.min, afterWorst.min);
      existing.worst.max = Math.max(existing.worst.max, afterWorst.max);
    }
  }

  const out = new Map<string, Offset>();
  for (const node of graph.nodes.values()) {
    if (node.kind === 'container') continue;
    const here = before.get(node.uid);
    const total = totals.get(node.uid);
    if (here === undefined) {
      out.set(node.uid, {
        nominal: { min: 0, max: 0 },
        worst: { min: 0, max: 0 },
        remaining: { min: 0, max: 0 },
        unreachable: true,
      });
      continue;
    }
    out.set(node.uid, {
      nominal: here.nominal,
      worst: here.worst,
      remaining: total?.nominal ?? { min: 0, max: 0 },
      unreachable: false,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Seconds as the reader's unit. Under two minutes stays in seconds; anything
 * longer is minutes to one decimal, which is the precision the inputs have.
 */
export function humanSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds === 0) return '0 s';
  if (seconds < 120) return `${round(seconds, 1)} s`;
  if (seconds < 7200) return `${round(seconds / 60, 1)} min`;
  return `${round(seconds / 3600, 2)} h`;
}

/** A range, collapsed to one figure where both ends agree. */
export function humanRange(range: Range): string {
  if (range.min === range.max) return humanSeconds(range.min);
  return `${humanSeconds(range.min)} to ${humanSeconds(range.max)}`;
}

function round(n: number, places: number): string {
  const factor = 10 ** places;
  return String(Math.round(n * factor) / factor);
}

/** How many terminals the estimate's paths end at. Reported beside the range. */
export function terminalCount(graph: Graph, adj: Adjacency = adjacency(graph)): number {
  return terminals(graph, adj).size;
}
