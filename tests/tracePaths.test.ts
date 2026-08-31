/**
 * Path tracing, and the two ways it used to say nothing.
 *
 * The feature dims everything that is not on a route through the selected step.
 * Two things made that useless in practice, and both are pinned here:
 *
 *   1. **A container carries no flow.** Selecting one returned a path set of
 *      just itself, so every leaf in the file dimmed and the canvas went grey.
 *   2. **A loop back edge closes a cycle.** Following it makes every step in a
 *      loop both upstream and downstream of every other, so a loop lights whole
 *      and the two directions stop meaning anything.
 *
 * The third fix is not a bug fix: `pathSet` keeps upstream and downstream apart
 * so the canvas can paint them differently. On a linear sequence their union is
 * very nearly the whole file, which is exactly when one colour says nothing.
 */

import { describe, expect, test } from 'vitest';

import { parse } from '../src/core/parse';
import { firstLeafOf, isFlow, pathSet } from '../src/core/paths';
import { loadRules } from '../src/core/rules';
import type { Graph } from '../src/core/types';
import { domParser, gasXml, rules } from './helpers';

/** Nonsense element names, so nothing here can be read as schema knowledge. */
const dialect = loadRules(`
version: 1
containers: [Box]
steps: [Do]
shapes: {default: rect}
kinds:  {default: action}
edges:
  - when: {onNo: "jump"}
    target: noStep
    reason: branch
loops:
  Repeat: {count: times}
`);

const chain: Graph = parse(
  `<Doc><Box uid="A">
     <Do uid="1"/><Do uid="2"/>
     <Box uid="MID"><Do uid="3"/><Do uid="4"/></Box>
     <Do uid="5"/>
   </Box></Doc>`,
  { rules: dialect, domParser },
);

describe('a container traces where its flow enters', () => {
  test('firstLeafOf descends to the first executable leaf', () => {
    expect(firstLeafOf(chain, 'MID')).toBe('3');
    expect(firstLeafOf(chain, 'A')).toBe('1');
  });

  test('a leaf is its own first leaf', () => {
    expect(firstLeafOf(chain, '4')).toBe('4');
  });

  test('an empty container has none', () => {
    const empty = parse('<Doc><Box uid="A"><Do uid="1"/><Box uid="E"/></Box></Doc>', {
      rules: dialect,
      domParser,
    });
    expect(firstLeafOf(empty, 'E')).toBe(null);
  });

  test('tracing a container is not tracing nothing', () => {
    // The bug: `pathSet` on a container returned just itself, so every leaf in
    // the file dimmed and the canvas went uniformly grey.
    const bare = pathSet(chain, 'MID');
    expect(bare.nodes.size).toBe(1);

    const real = pathSet(chain, firstLeafOf(chain, 'MID')!);
    expect([...real.up.nodes].sort()).toEqual(['1', '2']);
    expect([...real.down.nodes].sort()).toEqual(['4', '5']);
  });
});

describe('the two directions stay apart', () => {
  const set = pathSet(chain, '3');

  test('upstream and downstream are disjoint on an acyclic graph', () => {
    for (const uid of set.up.nodes) expect(set.down.nodes.has(uid)).toBe(false);
  });

  test('and the union is still available for callers that want it', () => {
    expect([...set.nodes].sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  test('which on a straight chain is the whole file — hence the split', () => {
    // Every leaf is on the one route, so a single highlight colour would light
    // the entire diagram and tell the reader nothing at all.
    const leaves = [...chain.nodes.values()].filter((n) => n.kind !== 'container');
    expect(set.nodes.size).toBe(leaves.length);
  });
});

describe('loop back edges are not routes', () => {
  const looped: Graph = parse(
    `<Doc><Box uid="A">
       <Do uid="1"/>
       <Repeat uid="L" times="3"><Do uid="2"/><Do uid="3"/><Do uid="4"/></Repeat>
       <Do uid="5"/>
     </Box></Doc>`,
    { rules: dialect, domParser },
  );

  test('the back edge exists and is drawn', () => {
    const back = looped.edges.filter((e) => e.reason === 'loop');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ src: '4', dst: '2' });
    expect(isFlow(back[0]!)).toBe(false);
  });

  test('but the walk does not follow it', () => {
    // Followed, every step in the loop is reachable from every other, so `3`
    // would report the whole loop in *both* directions and nothing would dim.
    const set = pathSet(looped, '3');
    expect([...set.up.nodes].sort()).toEqual(['1', '2']);
    expect([...set.down.nodes].sort()).toEqual(['4', '5']);
    expect(set.up.nodes.has('4')).toBe(false);
    expect(set.down.nodes.has('2')).toBe(false);
  });

  test('the step before a loop still reaches into it', () => {
    // Excluding the back edge must not disconnect the loop from the flow.
    expect([...pathSet(looped, '1').down.nodes].sort()).toEqual(['2', '3', '4', '5']);
  });
});

describe('on the gas-analyzer fixture', () => {
  const graph = parse(gasXml, { rules, domParser });

  test('selecting the Loop traces its first step, not the box', () => {
    const loop = [...graph.nodes.values()].find((n) => n.name === 'Loop')!;
    const from = firstLeafOf(graph, loop.uid)!;
    expect(graph.nodes.get(from)?.stepNumber).toBe('3.1');

    const set = pathSet(graph, from);
    // Two steps run before it, and the rest of the loop plus the tail after.
    expect(set.up.nodes.size).toBe(2);
    expect(set.down.nodes.size).toBeGreaterThan(0);
    expect(set.nodes.size).toBeGreaterThan(2);
  });
});
