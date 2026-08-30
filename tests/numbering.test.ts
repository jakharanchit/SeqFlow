/**
 * Step numbering, and the edge cases the fixture cannot show.
 *
 * `textExport.test.ts` checks the numbers against the authoring tool's own
 * rendering of this file, which is the real proof. What is left here is the
 * shape of the function on files this repo does not have: several roots, an
 * orphan, a cycle, and a container whose child map disagrees with its nodes.
 */

import { describe, expect, it } from 'vitest';

import { numberedName } from '../src/core/ancestry';
import { byStepNumber, stepNumbers } from '../src/core/numbering';
import { parse } from '../src/core/parse';
import { visibleGraph } from '../src/emit/collapse';
import type { Graph, SeqNode } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

/** A bare node, for the synthetic graphs below. */
function node(uid: string, parent: string | null, depth = 1): SeqNode {
  return {
    uid,
    element: 'WaitStep',
    name: uid,
    kind: 'action',
    shape: 'rect',
    parent,
    depth,
    stepNumber: '',
    attrs: {},
  };
}

function make(nodes: SeqNode[], containers: [string, string[]][]): Graph {
  return {
    root: nodes[0]?.uid ?? '',
    entry: nodes[0]?.uid ?? '',
    nodes: new Map(nodes.map((n) => [n.uid, n])),
    edges: [],
    containers: new Map(containers),
    warnings: [],
  };
}

describe('the fixture', () => {
  it('numbers 132 of 133 nodes, leaving the document title unnumbered', () => {
    const numbers = stepNumbers(graph);
    expect(numbers.size).toBe(133);
    expect([...numbers.values()].filter((n) => n !== '')).toHaveLength(132);
    expect(numbers.get(graph.root)).toBe('');
  });

  it('reads back by number', () => {
    const index = byStepNumber(graph);
    expect(index.size).toBe(132);
    expect(graph.nodes.get(index.get('2.1.6.7')!)?.name).toBe('6C Pulse (10s)');
    expect(graph.nodes.get(index.get('3.3')!)?.element).toBe('StopLogging');
  });

  it('survives collapse, because collapse reuses the node objects', () => {
    const pulses = [...graph.nodes.values()].filter((n) => n.name.startsWith('Pulse '));
    const view = visibleGraph(graph, new Set(pulses.map((n) => n.uid)));
    for (const p of pulses) {
      expect(view.nodes.get(p.uid)?.stepNumber).toBe(p.stepNumber);
    }
    expect(view.nodes.get(pulses[0]!.uid)?.stepNumber).toBe('2.1');
  });

  it('is stable across two parses of the same bytes', () => {
    const again = parse(fixtureXml, { rules, domParser });
    for (const [uid, n] of graph.nodes) {
      expect(again.nodes.get(uid)?.stepNumber).toBe(n.stepNumber);
    }
  });
});

describe('numberedName', () => {
  it('uses the tool text export separator', () => {
    const pulse = [...graph.nodes.values()].find((n) => n.stepNumber === '2.1.6.7')!;
    expect(numberedName(pulse)).toBe('2.1.6.7 - 6C Pulse (10s)');
  });

  it('falls back to the bare name rather than printing a stray dash', () => {
    expect(numberedName(graph.nodes.get(graph.root)!)).toBe('HLB Battery ESR');
    expect(numberedName(node('X', null))).toBe('X');
  });
});

describe('shapes the fixture cannot show', () => {
  it('numbers several roots 1..n — there is no title to speak of', () => {
    const g = make(
      [node('A', null), node('B', null), node('A1', 'A', 2)],
      [['A', ['A1']]],
    );
    const numbers = stepNumbers(g);
    expect(numbers.get('A')).toBe('1');
    expect(numbers.get('B')).toBe('2');
    expect(numbers.get('A1')).toBe('1.1');
  });

  it('leaves an orphan unnumbered, and does not renumber the file around it', () => {
    // `X` names a parent that is not in the graph, which is what a malformed
    // file produces. It still appears — invariant 7, in spirit — but with no
    // number, because it has no position among any siblings.
    //
    // The second assertion is the one that matters. Counting X as a root would
    // make it the second of two, so R would become `1` and every real number
    // in the file would gain a `1.` prefix. One broken parent reference must
    // not renumber 132 steps.
    const g = make([node('R', null), node('R1', 'R', 2), node('X', 'gone', 2)], [['R', ['R1']]]);
    const numbers = stepNumbers(g);
    expect(numbers.get('X')).toBe('');
    expect(numbers.get('R')).toBe('');
    expect(numbers.get('R1')).toBe('1');
  });

  it('skips a child listed in a container but absent from the nodes', () => {
    const g = make([node('R', null), node('R1', 'R', 2)], [['R', ['ghost', 'R1']]]);
    // The missing child must not consume ordinal 1 — a number nobody can click
    // is worse than no gap.
    expect(stepNumbers(g).get('R1')).toBe('1');
  });

  it('terminates on a cycle instead of recursing forever', () => {
    const g = make(
      [node('A', null), node('B', 'A', 2)],
      [
        ['A', ['B']],
        ['B', ['A']],
      ],
    );
    const numbers = stepNumbers(g);
    expect(numbers.get('A')).toBe('');
    expect(numbers.get('B')).toBe('1');
  });

  it('numbers nothing in an empty graph', () => {
    expect(stepNumbers(make([], [])).size).toBe(0);
  });
});
