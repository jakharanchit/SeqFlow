import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import {
  adjacency,
  downstream,
  pathSet,
  predecessors,
  terminals,
  unreachable,
  upstream,
} from '../src/core/paths';
import type { Graph, SeqNode } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const adj = adjacency(graph);

function byNameUnder(g: Graph, name: string, parentName: string): SeqNode {
  const found = [...g.nodes.values()].find(
    (n) => n.name === name && g.nodes.get(n.parent ?? '')?.name === parentName,
  );
  if (found === undefined) throw new Error(`fixture changed: no "${name}" under "${parentName}"`);
  return found;
}

const abort = byNameUnder(graph, 'Turn off Load', 'Abort Sequence');

describe('path sets', () => {
  it('gives the abort step 16 direct predecessors, all criteria steps', () => {
    const preds = predecessors(graph, abort.uid, adj);
    expect(preds).toHaveLength(16);
    for (const uid of preds) {
      expect(graph.nodes.get(uid)?.element).toBe('TestCriteriaEvaluation');
    }
  });

  it('ends every downstream path from the abort step at "Stop Recording"', () => {
    const down = downstream(graph, abort.uid, adj);
    const ends = [...terminals(graph, adj)].filter((uid) => down.nodes.has(uid));
    expect(ends).toHaveLength(1);
    expect(graph.nodes.get(ends[0]!)?.name).toBe('Stop Recording');
  });

  it('has exactly one terminal in the whole file', () => {
    const ends = terminals(graph, adj);
    expect(ends.size).toBe(1);
    expect(graph.nodes.get([...ends][0]!)?.name).toBe('Stop Recording');
  });

  it('puts entry upstream of every reachable node', () => {
    for (const node of graph.nodes.values()) {
      if (node.kind === 'container' || node.uid === graph.entry) continue;
      expect(upstream(graph, node.uid, adj).nodes.has(graph.entry)).toBe(true);
    }
  });

  it('leaves nothing unreachable', () => {
    expect([...unreachable(graph, adj)]).toEqual([]);
  });

  it('reaches every leaf downstream of entry', () => {
    const leaves = [...graph.nodes.values()].filter((n) => n.kind !== 'container');
    const reached = downstream(graph, graph.entry, adj).nodes;
    expect(leaves.filter((n) => n.uid !== graph.entry).every((n) => reached.has(n.uid))).toBe(
      true,
    );
  });

  it('gives entry no upstream at all', () => {
    expect(upstream(graph, graph.entry, adj).nodes.size).toBe(0);
  });

  it('returns only edges whose endpoints are in the set', () => {
    const up = upstream(graph, abort.uid, adj);
    for (const e of up.edges) {
      expect(up.nodes.has(e.src)).toBe(true);
      expect(e.dst === abort.uid || up.nodes.has(e.dst)).toBe(true);
    }
  });

  it('unions both directions plus the subject for highlighting', () => {
    const both = pathSet(graph, abort.uid, adj);
    const up = upstream(graph, abort.uid, adj);
    const down = downstream(graph, abort.uid, adj);
    expect(both.nodes.has(abort.uid)).toBe(true);
    expect(both.nodes.size).toBe(new Set([abort.uid, ...up.nodes, ...down.nodes]).size);
    // Edges come back in the graph's own sorted order, for determinism.
    const order = graph.edges.filter((e) => both.edges.includes(e));
    expect(both.edges).toEqual(order);
  });

  it('terminates on a cycle rather than recursing forever', () => {
    const cyclic: Graph = {
      ...graph,
      nodes: new Map([
        ['A', { uid: 'A', element: 'X', name: 'A', kind: 'action', shape: 'rect', parent: null, depth: 1, attrs: {} }],
        ['B', { uid: 'B', element: 'X', name: 'B', kind: 'action', shape: 'rect', parent: null, depth: 1, attrs: {} }],
      ]),
      edges: [
        { src: 'A', dst: 'B', style: 'solid', reason: 'goto' },
        { src: 'B', dst: 'A', style: 'solid', reason: 'goto' },
      ],
      entry: 'A',
      root: 'A',
    };
    expect(downstream(cyclic, 'A').nodes).toEqual(new Set(['A', 'B']));
    expect(upstream(cyclic, 'A').nodes).toEqual(new Set(['A', 'B']));
  });
});
