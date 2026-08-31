import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { pathLabel } from '../src/core/ancestry';
import {
  elementCounts,
  isActive,
  isStepNumberQuery,
  matchSet,
  nameCounts,
  search,
} from '../src/core/search';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

describe('search by step number', () => {
  it('recognises a number query by shape, so it never shadows a name', () => {
    expect(isStepNumberQuery('2.3.6')).toBe(true);
    expect(isStepNumberQuery('2')).toBe(true);
    expect(isStepNumberQuery('2.3.')).toBe(true); // mid-type, walking down
    expect(isStepNumberQuery('2.3 - Cycle')).toBe(false);
    expect(isStepNumberQuery('Turn off Load')).toBe(false);
    expect(isStepNumberQuery('')).toBe(false);
  });

  it('an exact number finds exactly one step', () => {
    const hits = search(graph, { text: '2.3.6.8' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe('Acceptance Criteria - Top Val - 4R');
    // The whole point: that name is on four steps and the number is on one.
    expect(search(graph, { text: 'Acceptance Criteria - Top Val - 4R' })).toHaveLength(4);
  });

  it('a prefix selects the block beneath it', () => {
    const hits = search(graph, { text: '2.3.6' });
    // The Draw down at 32R sequence plus its eleven steps.
    expect(hits).toHaveLength(12);
    expect(hits[0]?.name).toBe('Draw down at 32R');
    expect(hits.every((h) => h.stepNumber.startsWith('2.3.6'))).toBe(true);
  });

  it('a trailing dot means the same thing', () => {
    expect(search(graph, { text: '2.3.6.' }).length).toBe(search(graph, { text: '2.3.6' }).length);
  });

  it('respects segment boundaries — 2.1 is not a prefix of 2.10', () => {
    const g = search(graph, { text: '2.1' });
    expect(g.every((h) => h.stepNumber === '2.1' || h.stepNumber.startsWith('2.1.'))).toBe(true);
    // The fixture has no 2.10, so assert the rule directly rather than hoping.
    expect(g.some((h) => h.stepNumber.startsWith('2.1') && !h.stepNumber.startsWith('2.1.') && h.stepNumber !== '2.1')).toBe(false);
  });

  it('highlights nothing in the name — the match was on the address', () => {
    for (const hit of search(graph, { text: '2.3.6' })) expect(hit.at).toBe(-1);
  });

  it('a number that is not in the file matches nothing', () => {
    expect(search(graph, { text: '9.9.9' })).toHaveLength(0);
  });

  it('still honours the element filter', () => {
    const hits = search(graph, {
      text: '2.3',
      elements: new Set(['TestCriteriaEvaluation']),
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.element === 'TestCriteriaEvaluation')).toBe(true);
    expect(hits.every((h) => h.stepNumber.startsWith('2.3'))).toBe(true);
  });
});

describe('search', () => {
  it('confirms the ambiguity this feature exists for', () => {
    const names = nameCounts(graph);
    const covered = [...names.values()].filter((v) => v.length > 1);
    expect(covered.length).toBe(27);
    expect(covered.reduce((a, v) => a + v.length, 0)).toBe(106);
    expect(names.get('Turn off Load')).toHaveLength(5);
    expect(names.get('Excite to Desired Reading')).toHaveLength(4);
  });

  it('returns 4 results with 4 distinct parent paths', () => {
    const hits = search(graph, { text: 'Excite to Desired Reading' });
    expect(hits).toHaveLength(4);
    expect(new Set(hits.map((h) => h.path)).size).toBe(4);
    for (const hit of hits) {
      expect(hit.path).toMatch(/Cycle \d/);
      expect(hit.path).toBe(pathLabel(graph, hit.uid));
    }
  });

  it('is case-insensitive and matches on a substring', () => {
    expect(search(graph, { text: 'EXCITE TO DESIRED' })).toHaveLength(4);
    expect(search(graph, { text: 'desired read' })).toHaveLength(4);
  });

  it('filters to exactly 16 TestCriteriaEvaluation nodes', () => {
    const hits = search(graph, { text: '', elements: new Set(['TestCriteriaEvaluation']) });
    expect(hits).toHaveLength(16);
    for (const hit of hits) expect(hit.element).toBe('TestCriteriaEvaluation');
  });

  it('combines a name query with a type filter', () => {
    const hits = search(graph, {
      text: 'Turn off Load',
      elements: new Set(['SetSwitchState']),
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.element).toBe('SetSwitchState');
      expect(hit.name).toBe('Turn off Load');
    }
  });

  it('returns everything when the query is empty', () => {
    expect(search(graph, { text: '' })).toHaveLength(133);
    expect(search(graph, { text: '   ', elements: new Set() })).toHaveLength(133);
  });

  it('knows when a query is doing anything', () => {
    expect(isActive({ text: '' })).toBe(false);
    expect(isActive({ text: '  ', elements: new Set() })).toBe(false);
    expect(isActive({ text: 'a' })).toBe(true);
    expect(isActive({ text: '', elements: new Set(['GoTo']) })).toBe(true);
  });

  it('carries the ancestor uids needed to reveal a hit', () => {
    const hit = search(graph, { text: 'Excite Until Cutoff' })[0]!;
    expect(hit.ancestors.length).toBeGreaterThan(0);
    for (const uid of hit.ancestors) {
      expect(graph.nodes.get(uid)?.kind).toBe('container');
    }
    // Outermost first, so expanding them in order reveals the hit.
    expect(hit.ancestors[0]).toBe(graph.root);
  });

  it('reports where the match landed, for highlighting', () => {
    const hit = search(graph, { text: 'Desired' })[0]!;
    expect(hit.name.slice(hit.at, hit.at + 7)).toBe('Desired');
  });

  it('lists element types by frequency for the filter menu', () => {
    const counts = elementCounts(graph);
    expect(counts[0]).toEqual({ element: 'Sequence', count: 26 });
    expect(counts.find((c) => c.element === 'TestCriteriaEvaluation')?.count).toBe(16);
    expect(counts.reduce((a, c) => a + c.count, 0)).toBe(133);
  });

  it('reduces to a set for dimming', () => {
    const hits = search(graph, { text: 'Turn off Load' });
    expect(matchSet(hits).size).toBe(hits.length);
  });
});
