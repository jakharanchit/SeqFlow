import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { asGraph, visibleGraph } from '../src/emit/collapse';
import type { SeqNode } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

/** The four Pulse sequences. Names collide elsewhere in this file; these do not. */
const pulses = [...graph.nodes.values()]
  .filter((n) => n.kind === 'container' && n.name.startsWith('Pulse '))
  .map((n) => n.uid);

/** "Turn off Load" is not unique — take the one inside "Abort Sequence". */
function abortTurnOffLoad(): SeqNode {
  const found = [...graph.nodes.values()].find(
    (n) =>
      n.name === 'Turn off Load' && graph.nodes.get(n.parent ?? '')?.name === 'Abort Sequence',
  );
  if (found === undefined) throw new Error('fixture changed: no abort "Turn off Load"');
  return found;
}

describe('collapse model', () => {
  it('finds the four Pulse sequences', () => {
    expect(pulses).toHaveLength(4);
  });

  it('returns the whole graph when nothing is collapsed', () => {
    const view = visibleGraph(graph, new Set());
    expect(view.nodes.size).toBe(133);
    expect(view.edges).toHaveLength(126);
    expect(view.containers.size).toBe(graph.containers.size);
    expect(view.collapsedCounts.size).toBe(0);
  });

  it('hides 112 of 133 nodes behind the four Pulse toggles', () => {
    const view = visibleGraph(graph, new Set(pulses));
    expect(view.nodes.size).toBe(21);
    for (const uid of pulses) expect(view.nodes.has(uid)).toBe(true);
    expect([...view.collapsedCounts.values()].reduce((a, b) => a + b, 0)).toBe(112);
  });

  it('lifts and deduplicates edges down to 18', () => {
    const view = visibleGraph(graph, new Set(pulses));
    expect(view.edges).toHaveLength(18);

    // 96 of the 126 lift to self-loops inside a collapsed Pulse and are dropped;
    // the remaining 30 dedupe to 18.
    const lifted = graph.edges.filter(
      (e) => view.lifted.get(e.src) === view.lifted.get(e.dst),
    );
    expect(lifted).toHaveLength(96);
  });

  it('collapses the 16 abort edges to one per Pulse', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const criteria = view.edges.filter((e) => e.reason === 'criteria');
    expect(criteria).toHaveLength(4);

    const abort = abortTurnOffLoad();
    expect(new Set(criteria.map((e) => e.dst))).toEqual(new Set([abort.uid]));
    expect(new Set(criteria.map((e) => e.src))).toEqual(new Set(pulses));
    for (const e of criteria) {
      expect(e.label).toBe('fail');
      expect(e.style).toBe('dotted');
    }
  });

  it('never references a hidden uid', () => {
    const view = visibleGraph(graph, new Set(pulses));
    for (const e of view.edges) {
      expect(view.nodes.has(e.src)).toBe(true);
      expect(view.nodes.has(e.dst)).toBe(true);
    }
  });

  it('drops a collapsed container from the container map', () => {
    const view = visibleGraph(graph, new Set(pulses));
    for (const uid of pulses) expect(view.containers.has(uid)).toBe(false);
    // Its parent still lists it as a child — it is a visible node, just opaque.
    const parent = graph.nodes.get(pulses[0]!)!.parent!;
    expect(view.containers.get(parent)).toContain(pulses[0]);
  });

  it('lifts to the outermost collapsed ancestor, not the nearest', () => {
    const inner = graph.containers.get(pulses[0]!) ?? [];
    const nested = inner.find((uid) => graph.nodes.get(uid)?.kind === 'container');
    const both = new Set([pulses[0]!, ...(nested === undefined ? [] : [nested])]);
    const view = visibleGraph(graph, both);
    if (nested !== undefined) expect(view.nodes.has(nested)).toBe(false);
    expect(view.nodes.has(pulses[0]!)).toBe(true);
  });

  it('does not mutate the source graph', () => {
    const before = JSON.stringify(graph.edges);
    visibleGraph(graph, new Set(pulses));
    expect(JSON.stringify(graph.edges)).toBe(before);
    expect(graph.nodes.size).toBe(133);
  });

  it('keeps root and entry pointing at something visible', () => {
    const view = visibleGraph(graph, new Set([graph.nodes.get(graph.entry)!.parent!]));
    expect(view.nodes.has(view.entry)).toBe(true);
    expect(view.nodes.has(view.root)).toBe(true);
  });

  it('presents as a Graph the layout can consume', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const g = asGraph(graph, view);
    expect(g.nodes.size).toBe(21);
    expect(g.edges).toHaveLength(18);
    expect(g.warnings).toBe(graph.warnings);
  });
});
