/**
 * Where the tool stops being fast, measured rather than guessed.
 *
 * 133 nodes is the small case. The corpus is a database of sequences and the
 * cliff is somewhere above the fixture, so this runs the whole pipeline over
 * generated graphs at 500 / 2 000 / 5 000 leaves and reports each stage
 * separately: parse, every whole-file analysis, the flow adapter, and ELK.
 *
 * Two jobs, and the split between them matters:
 *
 * - **A guard**, in `npm test`. One modest size, grouped layout only, generous
 *   ceilings. It is there to fail on an accidental quadratic, not to police a
 *   few milliseconds.
 * - **A report**, under `SEQVIZ_BENCH=1`. The full sweep, both layout modes,
 *   and it prints the table.
 *
 * The sweep is not in the default run because it takes **ten minutes** —
 * compact layout at 5 000 leaves is minutes on its own. A test suite that slow
 * is a test suite nobody runs, which would cost far more than the coverage is
 * worth.
 *
 * The numbers this produced are recorded in CLAUDE.md. They are what decided
 * which optimisations were worth having and which were not — and they are the
 * reason `autoCollapse` and the layout cache exist at all.
 */

import { describe, expect, test } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { criteriaTable, failEdges } from '../src/core/criteria';
import { durations, offsets } from '../src/core/duration';
import { lint } from '../src/core/lint';
import { parse } from '../src/core/parse';
import { adjacency, pathSet, terminals, unreachable } from '../src/core/paths';
import { profile } from '../src/core/profile';
import { signalIndex } from '../src/core/signals';
import { similarGroups } from '../src/core/similarity';
import { toFlow } from '../src/emit/flow';
import { nodesForMode, toElk, type ElkLike } from '../src/layout/elkGraph';
import { generateSequence } from './generate';
import { domParser, rules } from './helpers';

const REPORT = process.env['SEQVIZ_BENCH'] === '1';

/**
 * Above this, compact layout is not measured. See the note in `measure`: it is
 * not slow, it is unbounded, and it cannot be interrupted from here.
 */
const COMPACT_CEILING = 500;
const elk = new ELK() as ElkLike;

interface Row {
  leaves: number;
  nodes: number;
  edges: number;
  stages: Record<string, number>;
}

function time<T>(fn: () => T): [T, number] {
  const started = performance.now();
  const value = fn();
  return [value, performance.now() - started];
}

async function measure(leaves: number, bothModes: boolean): Promise<Row> {
  const { xml } = generateSequence({ leaves });
  const stages: Record<string, number> = {};

  const [graph, parseMs] = time(() => parse(xml, { rules, domParser }));
  stages['parse'] = parseMs;

  // The analyses the app runs on load, each on its own so the table names the
  // expensive one rather than a total nobody can act on.
  const [adj, adjMs] = time(() => adjacency(graph));
  stages['adjacency'] = adjMs;
  stages['signals'] = time(() => signalIndex(graph, rules))[1];
  stages['similarity'] = time(() => similarGroups(graph))[1];
  stages['lint'] = time(() => lint(graph, rules))[1];
  stages['criteria'] = time(() => criteriaTable(graph, rules))[1];
  stages['failEdges'] = time(() => failEdges(graph))[1];
  stages['duration'] = time(() => durations(graph, rules, adj))[1];
  stages['offsets'] = time(() => offsets(graph, rules, adj))[1];
  stages['profile'] = time(() =>
    profile(domParser.parseFromString(xml, 'application/xml'), rules),
  )[1];

  // One selection: what a click costs before any rendering happens.
  stages['pathSet'] = time(() => pathSet(graph, graph.entry, adj))[1];

  const [flow, flowMs] = time(() => toFlow(graph, rules));
  stages['toFlow'] = flowMs;

  // Both layout modes. They are not close: compact drops the group boxes and
  // asks ELK to wrap one long chain into columns, which on a graph where 250
  // edges converge on a single node is a different problem entirely.
  const grouped = performance.now();
  await elk.layout(toElk(nodesForMode(flow.nodes, 'grouped'), flow.edges, 'grouped'));
  stages['elk grouped'] = performance.now() - grouped;

  // Compact layout is measured only up to COMPACT_CEILING leaves.
  //
  // It cannot be bounded by a timeout here, and the reason is worth writing
  // down: `elk.bundled.js` runs on the main thread in Node, so it blocks the
  // event loop and a `Promise.race` against a timer can never fire. The app's
  // `LAYOUT_TIMEOUT_MS` works *because* the app runs ELK in a web worker — the
  // guard exists there and cannot exist here.
  //
  // Measured, compact took 60 s on a 295-node graph and had not finished after
  // forty minutes at 5 000 leaves. That is the finding; waiting it out again on
  // every sweep adds nothing.
  if (bothModes && leaves <= COMPACT_CEILING) {
    const compact = performance.now();
    await elk.layout(toElk(nodesForMode(flow.nodes, 'compact'), flow.edges, 'compact'));
    stages['elk compact'] = performance.now() - compact;
  }

  expect(unreachable(graph, adj).size).toBe(0);
  expect(terminals(graph, adj).size).toBeGreaterThan(0);

  return { leaves, nodes: graph.nodes.size, edges: graph.edges.length, stages };
}

// One size in the default run; the sweep only when asked for.
const sizes = REPORT ? [500, 2000, 5000] : [500];
const rows: Row[] = [];
for (const n of sizes) rows.push(await measure(n, REPORT));

describe('scale', () => {
  test('the generated graph is what it claims to be', () => {
    // A benchmark over a graph that failed to parse measures nothing.
    for (const row of rows) {
      expect(row.nodes).toBeGreaterThan(row.leaves);
      expect(row.edges).toBeGreaterThan(row.leaves);
    }
    const parsed = parse(generateSequence({ leaves: 500 }).xml, { rules, domParser });
    expect(parsed.warnings).toEqual([]);
    // The shared abort target is what makes this worth measuring: a graph with
    // no convergence is the easy case for layout and for every path walk.
    const inbound = new Map<string, number>();
    for (const e of parsed.edges) inbound.set(e.dst, (inbound.get(e.dst) ?? 0) + 1);
    expect(Math.max(...inbound.values())).toBeGreaterThan(10);
  });

  test('nothing in the core is superlinear in a way that bites', () => {
    // Generous on purpose. This fails on an accidental quadratic, not on a
    // regression of a few milliseconds — that is what the printed table is for.
    const biggest = rows[rows.length - 1]!;
    for (const [stage, ms] of Object.entries(biggest.stages)) {
      if (stage.startsWith('elk')) continue; // layout has its own ceiling below
      if (!Number.isFinite(ms)) continue;
      expect(ms, `${stage} at ${biggest.leaves} leaves`).toBeLessThan(4000);
    }
  });

  test('grouped layout stays within the timeout the app enforces', () => {
    // Not a target — a ceiling, and the same one `LAYOUT_TIMEOUT_MS` gives the
    // app. What matters is that layout finishes at all at this size; the app
    // additionally never hands ELK a graph this big, because `autoCollapse`
    // folds one down to the layout budget first.
    for (const row of rows) {
      expect(row.stages['elk grouped'], `${row.leaves} leaves`).toBeLessThan(60000);
    }
  });

  test('reports the table', () => {
    if (!REPORT) return;
    const stages = Object.keys(rows[0]!.stages);
    const head = ['leaves', 'nodes', 'edges', ...stages];
    const body = rows.map((r) => [
      String(r.leaves),
      String(r.nodes),
      String(r.edges),
      // An unmeasured stage prints as a dash. Printing 0.0 would read as
      // "instant", which is the opposite of why compact is missing.
      ...stages.map((s) => (r.stages[s] === undefined ? '—' : r.stages[s].toFixed(1))),
    ]);
    const width = head.map((h, i) =>
      Math.max(h.length, ...body.map((row) => (row[i] ?? '').length)),
    );
    const line = (cells: string[]): string =>
      cells.map((c, i) => c.padStart(width[i] ?? 0)).join('  ');
    process.stdout.write(`\n${line(head)}\n`);
    for (const row of body) process.stdout.write(`${line(row)}\n`);
    process.stdout.write('\nmilliseconds\n\n');
  });
});
