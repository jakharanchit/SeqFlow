import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { asGraph, autoCollapse, visibleGraph } from '../src/emit/collapse';
import type { SeqNode } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

/** The four Cycle sequences. Names collide elsewhere in this file; these do not. */
const cycles = [...graph.nodes.values()]
  .filter((n) => n.kind === 'container' && n.name.startsWith('Cycle '))
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
  it('finds the four Cycle sequences', () => {
    expect(cycles).toHaveLength(4);
  });

  it('returns the whole graph when nothing is collapsed', () => {
    const view = visibleGraph(graph, new Set());
    expect(view.nodes.size).toBe(133);
    expect(view.edges).toHaveLength(126);
    expect(view.containers.size).toBe(graph.containers.size);
    expect(view.collapsedCounts.size).toBe(0);
  });

  it('hides 112 of 133 nodes behind the four Cycle toggles', () => {
    const view = visibleGraph(graph, new Set(cycles));
    expect(view.nodes.size).toBe(21);
    for (const uid of cycles) expect(view.nodes.has(uid)).toBe(true);
    expect([...view.collapsedCounts.values()].reduce((a, b) => a + b, 0)).toBe(112);
  });

  it('lifts and deduplicates edges down to 18', () => {
    const view = visibleGraph(graph, new Set(cycles));
    expect(view.edges).toHaveLength(18);

    // 96 of the 126 lift to self-loops inside a collapsed Cycle and are dropped;
    // the remaining 30 dedupe to 18.
    const lifted = graph.edges.filter(
      (e) => view.lifted.get(e.src) === view.lifted.get(e.dst),
    );
    expect(lifted).toHaveLength(96);
  });

  it('collapses the 16 abort edges to one per Cycle', () => {
    const view = visibleGraph(graph, new Set(cycles));
    const criteria = view.edges.filter((e) => e.reason === 'criteria');
    expect(criteria).toHaveLength(4);

    const abort = abortTurnOffLoad();
    expect(new Set(criteria.map((e) => e.dst))).toEqual(new Set([abort.uid]));
    expect(new Set(criteria.map((e) => e.src))).toEqual(new Set(cycles));
    for (const e of criteria) {
      expect(e.label).toBe('fail');
      expect(e.style).toBe('dotted');
    }
  });

  it('never references a hidden uid', () => {
    const view = visibleGraph(graph, new Set(cycles));
    for (const e of view.edges) {
      expect(view.nodes.has(e.src)).toBe(true);
      expect(view.nodes.has(e.dst)).toBe(true);
    }
  });

  it('drops a collapsed container from the container map', () => {
    const view = visibleGraph(graph, new Set(cycles));
    for (const uid of cycles) expect(view.containers.has(uid)).toBe(false);
    // Its parent still lists it as a child — it is a visible node, just opaque.
    const parent = graph.nodes.get(cycles[0]!)!.parent!;
    expect(view.containers.get(parent)).toContain(cycles[0]);
  });

  it('lifts to the outermost collapsed ancestor, not the nearest', () => {
    const inner = graph.containers.get(cycles[0]!) ?? [];
    const nested = inner.find((uid) => graph.nodes.get(uid)?.kind === 'container');
    const both = new Set([cycles[0]!, ...(nested === undefined ? [] : [nested])]);
    const view = visibleGraph(graph, both);
    if (nested !== undefined) expect(view.nodes.has(nested)).toBe(false);
    expect(view.nodes.has(cycles[0]!)).toBe(true);
  });

  it('does not mutate the source graph', () => {
    const before = JSON.stringify(graph.edges);
    visibleGraph(graph, new Set(cycles));
    expect(JSON.stringify(graph.edges)).toBe(before);
    expect(graph.nodes.size).toBe(133);
  });

  it('keeps root and entry pointing at something visible', () => {
    const view = visibleGraph(graph, new Set([graph.nodes.get(graph.entry)!.parent!]));
    expect(view.nodes.has(view.entry)).toBe(true);
    expect(view.nodes.has(view.root)).toBe(true);
  });

  it('presents as a Graph the layout can consume', () => {
    const view = visibleGraph(graph, new Set(cycles));
    const g = asGraph(graph, view);
    expect(g.nodes.size).toBe(21);
    expect(g.edges).toHaveLength(18);
    expect(g.warnings).toBe(graph.warnings);
  });
});

/**
 * Auto-folding a file that is too big to lay out whole.
 *
 * ELK is the entire cost of opening a file — 10.7 s on a 5 733-node graph
 * against under 200 ms for every other stage put together — so the only lever
 * that helps a large file is giving it fewer nodes. `tests/scale.test.ts` has
 * the measurements; this pins the behaviour they argued for.
 */
describe('autoCollapse', () => {
  it('leaves a file under budget completely alone', () => {
    // The common case, and the fixture: 133 nodes against a budget of 600.
    expect(autoCollapse(graph, 600).size).toBe(0);
    expect(autoCollapse(graph, graph.nodes.size).size).toBe(0);
  });

  it('folds until it is under budget and then stops', () => {
    const folded = autoCollapse(graph, 40);
    expect(folded.size).toBeGreaterThan(0);
    expect(visibleGraph(graph, folded).nodes.size).toBeLessThanOrEqual(40);
  });

  it('folds the deepest sequences first', () => {
    // Deepest-first hides the least: an inner group becomes one box inside a
    // structure the reader can still see and open. Folding from the top would
    // present a 5 000-step file as three rectangles.
    const folded = autoCollapse(graph, 60);
    const depths = [...folded].map((uid) => graph.nodes.get(uid)!.depth);
    const untouched = [...graph.containers.keys()]
      .filter((uid) => !folded.has(uid))
      .map((uid) => graph.nodes.get(uid)!.depth);
    if (untouched.length > 0) {
      expect(Math.min(...depths)).toBeGreaterThan(Math.min(...untouched) - 1);
      expect(Math.max(...untouched)).toBeLessThanOrEqual(Math.max(...depths));
    }
  });

  it('never folds the document root', () => {
    // A single box is not a view of anything, and there would be nothing left
    // to expand from.
    const folded = autoCollapse(graph, 1);
    expect(folded.has(graph.root)).toBe(false);
    expect(visibleGraph(graph, folded).nodes.size).toBeGreaterThan(1);
  });

  it('is a view, like every other collapse — the graph is untouched', () => {
    const before = graph.nodes.size;
    autoCollapse(graph, 40);
    expect(graph.nodes.size).toBe(before);
  });
});
