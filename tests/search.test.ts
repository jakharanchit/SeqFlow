import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { pathLabel } from '../src/core/ancestry';
import { elementCounts, isActive, matchSet, nameCounts, search } from '../src/core/search';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

describe('search', () => {
  it('confirms the ambiguity this feature exists for', () => {
    const names = nameCounts(graph);
    const covered = [...names.values()].filter((v) => v.length > 1);
    expect(covered.length).toBe(27);
    expect(covered.reduce((a, v) => a + v.length, 0)).toBe(106);
    expect(names.get('Turn off Load')).toHaveLength(5);
    expect(names.get('Charge to Desired Voltage')).toHaveLength(4);
  });

  it('returns 4 results with 4 distinct parent paths', () => {
    const hits = search(graph, { text: 'Charge to Desired Voltage' });
    expect(hits).toHaveLength(4);
    expect(new Set(hits.map((h) => h.path)).size).toBe(4);
    for (const hit of hits) {
      expect(hit.path).toMatch(/Pulse \d/);
      expect(hit.path).toBe(pathLabel(graph, hit.uid));
    }
  });

  it('is case-insensitive and matches on a substring', () => {
    expect(search(graph, { text: 'CHARGE TO DESIRED' })).toHaveLength(4);
    expect(search(graph, { text: 'desired volt' })).toHaveLength(4);
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
    const hit = search(graph, { text: 'Charge Until Cutoff' })[0]!;
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
