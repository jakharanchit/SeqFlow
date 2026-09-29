/**
 * Where the tool stops being fast, measured rather than guessed.
 *
 * 133 nodes is the small case. The corpus is a database of sequences and the
 * cliff is somewhere above the fixture, so this runs the whole pipeline over
 * generated graphs at 500 / 2 000 / 5 000 leaves and reports each stage
 * separately: parse, the schema profile, the flow adapter, and ELK.
 *
 * Two jobs, and the split between them matters:
 *
 * - **A guard**, in `npm test`. One modest size, generous ceilings. It is
 *   there to fail on an accidental quadratic, not to police a few
 *   milliseconds.
 * - **A report**, under `SEQVIZ_BENCH=1`. The full sweep, and it prints the
 *   table.
 *
 * The sweep is not in the default run because it takes real time at the
 * largest size. A test suite that slow is a test suite nobody runs, which
 * would cost far more than the coverage is worth.
 *
 * The numbers this produced are recorded in CLAUDE.md. They are what decided
 * which optimisations were worth having and which were not — and they are the
 * reason `autoCollapse` and the layout cache exist at all.
 */

import { describe, expect, test } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { profile } from '../src/core/profile';
import { toFlow } from '../src/emit/flow';
import { toElk, type ElkLike } from '../src/layout/elkGraph';
import { generateSequence } from './generate';
import { domParser, rules } from './helpers';

const REPORT = process.env['SEQVIZ_BENCH'] === '1';

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

async function measure(leaves: number): Promise<Row> {
  const { xml } = generateSequence({ leaves });
  const stages: Record<string, number> = {};

  const [graph, parseMs] = time(() => parse(xml, { rules, domParser }));
  stages['parse'] = parseMs;

  stages['profile'] = time(() =>
    profile(domParser.parseFromString(xml, 'application/xml'), rules),
  )[1];

  const [flow, flowMs] = time(() => toFlow(graph, rules));
  stages['toFlow'] = flowMs;

  const grouped = performance.now();
  await elk.layout(toElk(flow.nodes, flow.edges));
  stages['elk grouped'] = performance.now() - grouped;

  return { leaves, nodes: graph.nodes.size, edges: graph.edges.length, stages };
}

// One size in the default run; the sweep only when asked for.
const sizes = REPORT ? [500, 2000, 5000] : [500];
const rows: Row[] = [];
for (const n of sizes) rows.push(await measure(n));

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
