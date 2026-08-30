/**
 * The authoring tool's own text export, as a second oracle.
 *
 * `fixtures/Sequence_Text.txt` is the tool's rendering of the byte-identical
 * XML in `fixtures/Sequence_XML.xml`. It is not a second sequence — it is a
 * second *view* of the one we have, written by the program that wrote the file.
 * That makes it the first correctness target here that nobody in this repo
 * hand-computed, and it checks four things `golden.test.ts` cannot:
 *
 *   1. the tree shape and document order, against an independent renderer;
 *   2. that a `Comparison` is lifted onto the right step, with the right value;
 *   3. that a jump resolves *through* a container to its first leaf (rule 4.3),
 *      because the export names the container and we point at the leaf;
 *   4. that the duration model's two totals are the ones the tool reports.
 *
 * It does not settle spec Q1 — `Variables`, `Timers`, `StatisticsCalculators`
 * and `SubSequences` are empty in this file and the export cannot show what an
 * empty collection would look like populated. That still needs a second XML.
 *
 * The export is trusted for structure, names and numbers, and *not* for values:
 * `interval_s="0.5"` prints as `at every "00:00:00"`, so it is lossy where we
 * are not. Nothing below reads a rendered duration except the two totals, which
 * are whole seconds.
 */

import { describe, expect, it } from 'vitest';

import { numberedName } from '../src/core/ancestry';
import { durations } from '../src/core/duration';
import { parse } from '../src/core/parse';
import type { Graph, SeqNode } from '../src/core/types';
import { domParser, fixtureXml, read, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

/* ------------------------------------------------------------------ */
/* The export, parsed                                                  */
/* ------------------------------------------------------------------ */

interface Row {
  /** Indent in spaces. The tool indents four per level. */
  indent: number;
  /** `2.1.6.7`, or `''` on the two unnumbered rows. */
  number: string;
  name: string;
  /** The second column: the tool's rendered sentence. Often empty. */
  description: string;
}

function parseExport(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const [label = '', ...rest] = line.split('\t');
    const indent = label.length - label.trimStart().length;
    const trimmed = label.trim();
    const numbered = /^(\d+(?:\.\d+)*) - (.*)$/.exec(trimmed);
    rows.push({
      indent,
      number: numbered?.[1] ?? '',
      name: numbered?.[2] ?? trimmed,
      description: rest.join('\t').trim(),
    });
  }
  return rows;
}

const rows = parseExport(read('fixtures', 'Sequence_Text.txt'));
const numbered = rows.filter((r) => r.number !== '');

const byNumber = new Map<string, SeqNode>();
for (const node of graph.nodes.values()) {
  if (node.stepNumber !== '') byNumber.set(node.stepNumber, node);
}

/** `2.1.6.7` -> `2.1.6`. Empty at the top level. */
function parentNumber(number: string): string {
  const at = number.lastIndexOf('.');
  return at === -1 ? '' : number.slice(0, at);
}

/* ------------------------------------------------------------------ */

describe('the text export reconciles with the graph', () => {
  it('has 146 rows: 2 unnumbered at the top and 144 numbered', () => {
    expect(rows).toHaveLength(146);
    expect(numbered).toHaveLength(144);
    const top = rows.filter((r) => r.indent === 0);
    expect(top.map((r) => r.name)).toEqual(['HLB Battery ESR', 'Abort']);
    expect(top.every((r) => r.number === '')).toBe(true);
  });

  /**
   * The reconciliation, and the reason this file exists:
   *
   *     144 numbered rows
   *     − 12 Comparison rows   (4 pulses × 3 conditions)
   *     = 132 = 133 nodes − 1 unnumbered root
   *
   * Exact, with nothing left over.
   */
  it('accounts for every numbered row exactly once', () => {
    const ours = numbered.filter((r) => byNumber.has(r.number));
    const theirs = numbered.filter((r) => !byNumber.has(r.number));
    expect(ours).toHaveLength(132);
    expect(theirs).toHaveLength(12);
    expect(ours.length).toBe(graph.nodes.size - 1);
  });

  it('names the root, and Abort has no counterpart in the XML', () => {
    // The tool shows the outer Sequence as the document title rather than as
    // step 1, which is why its children are 1, 2, 3 and it is unnumbered.
    expect(graph.nodes.get(graph.root)?.name).toBe('HLB Battery ESR');
    // `Abort` is a concept of the tool's tree view that this file does not
    // serialise — there is no such element anywhere in the XML. Recorded
    // rather than explained away; it goes to spec Q1 with the four empty
    // collections.
    expect(fixtureXml).not.toContain('"Abort"');
  });

  it('agrees on the name of all 132 nodes', () => {
    const mismatches: string[] = [];
    for (const row of numbered) {
      const node = byNumber.get(row.number);
      if (node === undefined) continue;
      if (node.name !== row.name) mismatches.push(`${row.number}: ${node.name} != ${row.name}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees with numberedName, separator included', () => {
    const pulse = byNumber.get('2.1.6.7');
    expect(pulse?.name).toBe('6C Pulse (10s)');
    expect(numberedName(pulse!)).toBe('2.1.6.7 - 6C Pulse (10s)');
    // The root falls back to the bare name rather than printing a stray dash.
    expect(numberedName(graph.nodes.get(graph.root)!)).toBe('HLB Battery ESR');
  });

  it('numbers every node exactly once, with no collisions', () => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes.values()) {
      if (node.stepNumber === '') continue;
      counts.set(node.stepNumber, (counts.get(node.stepNumber) ?? 0) + 1);
    }
    expect([...counts].filter(([, n]) => n > 1)).toEqual([]);
    expect(counts.size).toBe(132);
  });
});

describe('the 12 rows we do not model as nodes', () => {
  /**
   * The tool numbers a `ConditionStep`'s `Comparison` child as a sub-step;
   * we carry it as `childAttrs`. That costs nothing — a Comparison is always
   * the only child of a leaf, so it never displaces a sibling and every node
   * number still agrees. This test is what proves the lift lands on the right
   * step, which nothing else in the suite checks.
   */
  it('are all Comparisons, each on the step the export nests it under', () => {
    const extra = numbered.filter((r) => !byNumber.has(r.number));
    expect(extra).toHaveLength(12);

    for (const row of extra) {
      const parent = byNumber.get(parentNumber(row.number));
      expect(parent, `no step numbered ${parentNumber(row.number)}`).toBeDefined();

      const comparisons = parent!.childAttrs?.['Comparison'];
      expect(comparisons, `${parentNumber(row.number)} carries no Comparison`).toHaveLength(1);
      expect(comparisons![0]!['name']).toBe(row.name);

      // The export renders the condition as `Is "PackVoltage" >= 53.2?`. The
      // tag is a display name we cannot derive, but the value is verbatim —
      // so the value is what this asserts.
      expect(row.description).toContain(comparisons![0]!['value']);
    }
  });
});

describe('jump targets, as the export quotes them', () => {
  /** The first executable leaf under a node — what a jump actually lands on. */
  function firstLeaf(graph: Graph, uid: string): string {
    let cursor = uid;
    for (;;) {
      const children = graph.containers.get(cursor);
      if (children === undefined || children.length === 0) return cursor;
      cursor = children[0]!;
    }
  }

  const references = numbered.flatMap((row) =>
    [...row.description.matchAll(/Go [Tt]o "(\d+(?:\.\d+)*) - [^"]*"/g)].map((m) => ({
      from: row.number,
      to: m[1]!,
    })),
  );

  it('finds all ten — eight branches and two GoTos', () => {
    expect(references).toHaveLength(10);
    expect(graph.edges.filter((e) => e.reason === 'branch')).toHaveLength(8);
    expect(graph.edges.filter((e) => e.reason === 'goto')).toHaveLength(2);
  });

  /**
   * The sharpest assertion available. The export names `2.1.3 - Battery
   * Temperature Check`, which is a `Sequence`; we emit an edge to its first
   * leaf, `2.1.3.1`. A parser that pointed the edge at the Sequence itself, or
   * that read a stale target attribute, fails here.
   */
  it('each resolves through its container down to the first leaf', () => {
    for (const ref of references) {
      const src = byNumber.get(ref.from);
      const target = byNumber.get(ref.to);
      expect(src, `no step numbered ${ref.from}`).toBeDefined();
      expect(target, `no step numbered ${ref.to}`).toBeDefined();

      const expected = firstLeaf(graph, target!.uid);
      const found = graph.edges.filter((e) => e.src === src!.uid && e.dst === expected);
      expect(found.length, `${ref.from} -> ${ref.to} is not an edge`).toBeGreaterThan(0);
    }
  });

  it('the export quotes no target the file does not contain', () => {
    for (const ref of references) expect(byNumber.has(ref.to)).toBe(true);
  });
});

describe('durations, against the numbers the tool prints', () => {
  function seconds(clock: string): number {
    const [h = '0', m = '0', s = '0'] = clock.split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const report = durations(graph, rules);

  it('the waits the export prints total what we count', () => {
    const waits = numbered.flatMap((r) => [...r.description.matchAll(/Wait (\d+:\d+:\d+\.\d+)/g)]);
    expect(waits).toHaveLength(16);
    const total = waits.reduce((sum, m) => sum + seconds(m[1]!), 0);
    expect(total).toBe(120);
    expect(report.waitSeconds).toBe(total);
    expect(report.waitSteps).toBe(waits.length);
  });

  it('the timeouts the export prints total what we count', () => {
    const polls = numbered.flatMap((r) => [
      ...r.description.matchAll(/times out after (\d+:\d+:\d+)/g),
    ]);
    expect(polls).toHaveLength(8);
    const total = polls.reduce((sum, m) => sum + seconds(m[1]!), 0);
    expect(total).toBe(4800);
    expect(report.pollingSeconds).toBe(total);
    expect(report.pollingSteps).toBe(polls.length);
  });

  it('and the two are never added together — 2 minutes against 82', () => {
    expect(Math.round(report.nominal.max / 60)).toBe(2);
    expect(Math.round(report.worst.max / 60)).toBe(82);
  });
});
