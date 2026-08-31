/**
 * The second dialect.
 *
 * `fixtures/Sequence_XML.xml` is a battery ESR test whose document element is
 * itself the container the parser walks. This one is a gas-analyzer integration
 * test, and it differs in three ways that between them produced an empty
 * diagram and an exit code of zero:
 *
 *   1. the document element is a <TestSpecification> wrapping a uid-less
 *      <TestSequence>, so the container the parser wants is one level down;
 *   2. it uses a repeating container the rule file had never heard of;
 *   3. a decision jumps *into* that container, so rule 4.3's descent has to
 *      work on it.
 *
 * Everything asserted here was read off the file by hand. Where a number here
 * and a number in the docs ever disagree, this file is describing the XML.
 */

import { describe, expect, test } from 'vitest';

import { durations } from '../src/core/duration';
import { parse } from '../src/core/parse';
import { profile, suggestRules, unknowns } from '../src/core/profile';
import { unreachable } from '../src/core/paths';
import { loadRules } from '../src/core/rules';
import type { Graph } from '../src/core/types';
import { EDGE_COLOR, toFlow } from '../src/emit/flow';
import { toMermaid } from '../src/emit/mermaid';
import { domParser, gasXml, read, rules } from './helpers';

const graph: Graph = parse(gasXml, { rules, domParser });

/** Node by name plus parent — names are not unique (invariant 3). */
function byName(name: string): string[] {
  return [...graph.nodes.values()].filter((n) => n.name === name).map((n) => n.uid);
}

function only(name: string): string {
  const hits = byName(name);
  expect(hits, `"${name}" is not unique`).toHaveLength(1);
  return hits[0]!;
}

describe('the wrapped document element', () => {
  test('parses at all', () => {
    // The whole bug in one line. Before the fix this was 0 nodes, no error and
    // an exit code of 0 — a total failure indistinguishable from an empty file.
    expect(graph.nodes.size).toBeGreaterThan(0);
  });

  test('the uid-less wrapper contributes no node and loses nothing', () => {
    // <TestSequence> carries no uid, so it can have no identity (invariant 3)
    // and gets no node. Its child does, and every step under it survives.
    expect([...graph.nodes.values()].some((n) => n.element === 'TestSequence')).toBe(false);
    expect(graph.nodes.size).toBe(12);
    expect([...graph.nodes.values()].filter((n) => n.kind === 'container')).toHaveLength(2);
  });

  test('the root is the outermost node, not the wrapper', () => {
    expect(graph.nodes.get(graph.root)?.name).toBe('Instrument Check Short Version');
    // A single parentless node is the document title, not step 1.
    expect(graph.nodes.get(graph.root)?.stepNumber).toBe('');
  });

  test('data that rides along in the same file is not a second root', () => {
    // <TemperatureProfile> is a sibling of <TestSequence> under the document
    // element. Treating it as a root would number the real one "1" and prefix
    // every step in the file.
    const roots = [...graph.nodes.values()].filter((n) => n.parent === null);
    expect(roots).toHaveLength(1);
    expect(graph.nodes.get(graph.containers.get(graph.root)![0]!)?.stepNumber).toBe('1');
  });

  test('the entry is the first executable leaf', () => {
    expect(graph.nodes.get(graph.entry)?.name).toBe('Activate Ref Set Selection');
  });

  test('0 warnings — the rule file covers this dialect', () => {
    expect(graph.warnings).toEqual([]);
  });

  test('nothing is unreachable', () => {
    expect(unreachable(graph).size).toBe(0);
  });
});

describe('the repeating container', () => {
  const loop = only('Loop');

  test('is a container with its seven steps inside it', () => {
    expect(graph.nodes.get(loop)?.kind).toBe('container');
    expect(graph.containers.get(loop)).toHaveLength(7);
    expect(graph.nodes.get(loop)?.stepNumber).toBe('3');
  });

  test('emits one back edge, last leaf to first, labelled with the count', () => {
    const back = graph.edges.filter((e) => e.reason === 'loop');
    expect(back).toHaveLength(1);
    expect(graph.nodes.get(back[0]!.src)?.stepNumber).toBe('3.7');
    expect(graph.nodes.get(back[0]!.dst)?.stepNumber).toBe('3.1');
    expect(back[0]!.label).toBe('×3');
    // Styled so it reads as a return, not as one more forward branch.
    expect(back[0]!.style).toBe('dotted');
  });

  test('the last step still falls out of the loop as well', () => {
    // A counted loop exits. Both edges are real, and dropping the fall-through
    // would leave the steps after the loop unreachable.
    const last = graph.edges.filter(
      (e) => e.src === graph.edges.find((x) => x.reason === 'loop')!.src,
    );
    expect(last.map((e) => e.reason).sort()).toEqual(['fallthrough', 'loop']);
  });

  test('the back edge does not make the timing report cyclic', () => {
    // The sharpest consequence. Left in the path arithmetic the whole loop body
    // sits on a cycle, reverseTopo leaves it unvisited, and the estimate is
    // silently truncated at the loop's entrance.
    const report = durations(graph, rules);
    expect(report.cyclic).toBe(false);
    expect(report.paths).toBeGreaterThan(0);
    // 20 + 15 + 30 + 10 of waits inside the loop, one iteration counted.
    expect(report.nominal.max).toBe(75);
  });

  test('repetition is reported rather than folded into the figure', () => {
    const report = durations(graph, rules);
    expect(report.loops).toHaveLength(1);
    expect(report.loops[0]).toMatchObject({ name: 'Loop', count: 3, period: 180 });
    // Not multiplied: 75 s, not 225 s. The count is shown beside it instead.
    expect(report.nominal.max).toBe(75);
  });
});

describe('step numbering follows the rendered tree', () => {
  test('the wrapper consumes no ordinal', () => {
    const numbers = [...graph.nodes.values()]
      .filter((n) => n.stepNumber !== '')
      .map((n) => n.stepNumber);
    expect(numbers).toEqual([
      '1',
      '2',
      '3',
      '3.1',
      '3.2',
      '3.3',
      '3.4',
      '3.5',
      '3.6',
      '3.7',
      '4',
    ]);
  });
});

describe('the profiler', () => {
  const doc = domParser.parseFromString(gasXml, 'application/xml');

  test('accounts for every element with the shipped rules', () => {
    expect(unknowns(profile(doc, rules))).toEqual([]);
    expect(suggestRules(profile(doc, rules))).toBe('');
  });

  test('names what is missing when the rule file has never seen the dialect', () => {
    // The rule file as it stood before this dialect existed: the same file with
    // the two elements that matter most removed from it.
    const stale = loadRules(
      read('rules.yaml')
        .replace(/^  - Loop$/m, '')
        .replace(/^  - SelectOption$/m, ''),
    );
    const gaps = profile(doc, stale);
    const names = unknowns(gaps).map((e) => e.element);
    expect(names).toContain('Loop');
    expect(names).toContain('SelectOption');

    // And the fragment says where each one goes — a container is not a step,
    // and getting that wrong is what loses a subtree.
    const fragment = suggestRules(gaps);
    expect(fragment).toMatch(/containers:\n  - Loop/);
    expect(fragment).toMatch(/steps:\n(  - \w+.*\n)*  - SelectOption/);
  });
});

describe('the emitter', () => {
  test('is deterministic across two parses', () => {
    const again = parse(gasXml, { rules, domParser });
    expect(toMermaid(again, rules)).toBe(toMermaid(graph, rules));
  });

  test('draws the loop back edge', () => {
    expect(toMermaid(graph, rules)).toContain('-. "×3" .->');
  });

  test('the canvas gives the back edge its own colour and the label', () => {
    // Checked in a real browser too, where it is one stroke at rgb(201,130,31)
    // among nineteen grey ones. Pinned here because the DOM check is a
    // screenshot away from silently passing on a graph that lost the edge.
    const flow = toFlow(graph, rules);
    const back = flow.edges.filter((e) => e.data.reason === 'loop');
    expect(back).toHaveLength(1);
    expect(back[0]?.style.stroke).toBe(EDGE_COLOR['loop']);
    expect(back[0]?.label).toBe('×3');
    expect(back[0]?.style.strokeDasharray).toBeDefined();
  });
});
