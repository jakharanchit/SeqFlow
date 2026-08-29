/**
 * PHASE2-TASKS task 7: the path highlight must survive a collapse toggle by
 * lifting onto the visible ancestor. The UI composes `pathSet` with the
 * collapse view's `lifted` map; that composition is the part worth pinning.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { pathSet, upstream } from '../src/core/paths';
import { visibleGraph } from '../src/emit/collapse';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

const pulses = [...graph.nodes.values()]
  .filter((n) => n.kind === 'container' && n.name.startsWith('Pulse '))
  .map((n) => n.uid);

const abort = [...graph.nodes.values()].find(
  (n) =>
    n.name === 'Turn off Load' && graph.nodes.get(n.parent ?? '')?.name === 'Abort Sequence',
)!;

describe('path highlighting', () => {
  it('lights all 16 criteria steps that reach the abort', () => {
    const up = upstream(graph, abort.uid);
    const direct = graph.edges.filter((e) => e.dst === abort.uid).map((e) => e.src);
    expect(direct).toHaveLength(16);
    for (const uid of direct) {
      expect(up.nodes.has(uid)).toBe(true);
      expect(graph.nodes.get(uid)?.element).toBe('TestCriteriaEvaluation');
    }
  });

  it('lifts the highlight onto the collapsed Pulses', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const set = pathSet(graph, abort.uid);
    const lit = new Set([...set.nodes].map((uid) => view.lifted.get(uid) ?? uid));

    // The 16 individual criteria steps are hidden; their four Pulses light up.
    for (const uid of pulses) expect(lit.has(uid)).toBe(true);
    for (const uid of graph.edges.filter((e) => e.dst === abort.uid).map((e) => e.src)) {
      expect(view.nodes.has(uid)).toBe(false);
    }
    // Nothing lit is hidden.
    for (const uid of lit) expect(view.nodes.has(uid)).toBe(true);
  });

  it('keeps the subject lit even when it is folded away itself', () => {
    const parent = graph.nodes.get(abort.uid)!.parent!;
    const view = visibleGraph(graph, new Set([parent]));
    const subject = view.lifted.get(abort.uid) ?? abort.uid;
    expect(subject).toBe(parent);
    expect(view.nodes.has(subject)).toBe(true);
  });

  it('drops edges that lift to a self-loop rather than lighting nothing', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const lift = (uid: string): string => view.lifted.get(uid) ?? uid;
    const keys = new Set(
      pathSet(graph, abort.uid)
        .edges.map((e) => `${lift(e.src)}|${e.reason}|${lift(e.dst)}`)
        .filter((key) => {
          const [src, , dst] = key.split('|');
          return src !== dst;
        }),
    );
    // Every lit edge key names an edge that actually exists in the view.
    const present = new Set(view.edges.map((e) => `${e.src}|${e.reason}|${e.dst}`));
    for (const key of keys) expect(present.has(key)).toBe(true);
    // The four abort edges are among them.
    for (const uid of pulses) expect(keys.has(`${uid}|criteria|${abort.uid}`)).toBe(true);
  });
});
