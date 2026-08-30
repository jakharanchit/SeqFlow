import { describe, expect, it } from 'vitest';

import { BY_UID, diffGraphs, mergedGraph, summarise } from '../src/core/diff';
import { parse } from '../src/core/parse';
import type { Graph } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

/**
 * There is still only one sequence XML, so every revision below is a mutation
 * of the fixture. That pins the engine and does not test the feature — see the
 * note at the top of `src/core/diff.ts`. The mutations are deliberately the
 * four shapes a real revision takes: an edited attribute, a deleted step, an
 * inserted step, and a reordering.
 */
const base = parse(fixtureXml, { rules, domParser });

/** The whole `<Element .../>` tag carrying a uid, as it appears in the file. */
function tagFor(uid: string): string {
  const found = new RegExp(`<[A-Za-z]+[^>]*\\buid="${uid}"[^>]*/>`).exec(fixtureXml);
  if (found === null) throw new Error(`no self-closing element with uid ${uid}`);
  return found[0];
}

function revise(edit: (xml: string) => string): Graph {
  return parse(edit(fixtureXml), { rules, domParser });
}

/* The 10 s wait in Pulse 1 — the step Phase 2 task 10 found. */
const PULSE1_WAIT = '18458AB8-D15F-43BD-8E65-BB808A21FC79';
/* "Set Status" in Initialize: the first leaf in the file, and a plain one. */
const FIRST_STATUS = '61DE1D62-F24C-4E8C-AC92-6FA822D91191';

describe('a file against itself', () => {
  const same = parse(fixtureXml, { rules, domParser });
  const diff = diffGraphs(base, same);

  it('reports nothing', () => {
    expect(diff.identical).toBe(true);
    expect(diff.nodes).toEqual([]);
    expect(diff.edges).toEqual([]);
    expect(diff.counts.same).toBe(133);
    expect(summarise(diff)).toBe('No differences.');
  });

  it('marks every node the same and none of them anything else', () => {
    expect(diff.status.size).toBe(133);
    expect(new Set(diff.status.values())).toEqual(new Set(['same']));
  });

  it('merges back to a graph identical to the new revision', () => {
    const merged = mergedGraph(base, same, diff);
    expect(merged.nodes.size).toBe(same.nodes.size);
    expect(merged.edges).toEqual(same.edges);
    expect([...merged.containers.keys()]).toEqual([...same.containers.keys()]);
  });

  it('says how it paired the two sides', () => {
    expect(diff.matcher).toBe('uid');
    expect(BY_UID.name).toBe('uid');
  });
});

describe('an edited attribute', () => {
  // The Phase 2 finding, corrected: Pulse 1's 10 s wait now logs its start.
  const next = revise((xml) =>
    xml.replace(tagFor(PULSE1_WAIT), tagFor(PULSE1_WAIT).replace('logStart="FALSE"', 'logStart="TRUE"')),
  );
  const diff = diffGraphs(base, next);

  it('finds exactly the step that changed, and exactly the attribute', () => {
    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 1, moved: 0 });
    const change = diff.nodes[0]!;
    expect(change.uid).toBe(PULSE1_WAIT);
    expect(change.kind).toBe('changed');
    expect(change.attrs).toEqual([{ attr: 'logStart', before: 'FALSE', after: 'TRUE' }]);
    expect(summarise(diff)).toBe('1 changed');
  });

  it('leaves the other 132 nodes and every edge alone', () => {
    expect(diff.counts.same).toBe(132);
    expect(diff.edges).toEqual([]);
  });

  it('reads a change through a lifted child attribute too', () => {
    const comparison = revise((xml) => xml.replace('value="53.2"', 'value="61.9"'));
    const d = diffGraphs(base, comparison);
    expect(d.counts.changed).toBe(1);
    expect(d.nodes[0]!.attrs).toEqual([
      { attr: 'Comparison.value', before: '53.2', after: '61.9' },
    ]);
    expect(base.nodes.get(d.nodes[0]!.uid)?.element).toBe('ConditionStep');
  });
});

describe('a deleted step', () => {
  const next = revise((xml) => xml.replace(tagFor(FIRST_STATUS), ''));
  const diff = diffGraphs(base, next);

  it('finds one removal', () => {
    expect(diff.counts.removed).toBe(1);
    expect(diff.counts.added).toBe(0);
    expect(diff.nodes.filter((n) => n.kind === 'removed').map((n) => n.uid)).toEqual([
      FIRST_STATUS,
    ]);
    expect(diff.status.get(FIRST_STATUS)).toBe('removed');
  });

  it('reports the edges that went with it', () => {
    expect(diff.counts.edgesRemoved).toBeGreaterThan(0);
    for (const { edge } of diff.edges.filter((e) => e.kind === 'removed')) {
      expect([edge.src, edge.dst]).toContain(FIRST_STATUS);
    }
    // The entry moved on to whatever followed it.
    expect(next.entry).not.toBe(base.entry);
  });

  it('draws the ghost where it used to be, not at the end', () => {
    // A removed step has to be visible. An absence is exactly what a reader
    // cannot see.
    const merged = mergedGraph(base, next, diff);
    expect(merged.nodes.size).toBe(133);
    expect(merged.nodes.has(FIRST_STATUS)).toBe(true);

    const parent = base.nodes.get(FIRST_STATUS)!.parent!;
    expect(merged.containers.get(parent)).toEqual(base.containers.get(parent));
    expect(merged.containers.get(parent)![0]).toBe(FIRST_STATUS);
  });

  it('keeps the ghost connected, so it is not a floating box', () => {
    const merged = mergedGraph(base, next, diff);
    expect(merged.edges.some((e) => e.src === FIRST_STATUS || e.dst === FIRST_STATUS)).toBe(
      true,
    );
    // And every edge in the merged graph still has both ends drawable.
    for (const e of merged.edges) {
      expect(merged.nodes.has(e.src)).toBe(true);
      expect(merged.nodes.has(e.dst)).toBe(true);
    }
  });
});

describe('a deleted sequence', () => {
  // The whole of Initialize: a container and its three steps.
  const initialize = [...base.nodes.values()].find((n) => n.name === 'Initialize')!;
  const next = revise((xml) => {
    const open = xml.indexOf(`<Sequence description="" logCompletion="TRUE" logStart="FALSE" name="Initialize"`);
    const close = xml.indexOf('</Sequence>', open) + '</Sequence>'.length;
    return xml.slice(0, open) + xml.slice(close);
  });
  const diff = diffGraphs(base, next);

  it('removes the container and everything under it', () => {
    expect(diff.counts.removed).toBe(4);
    expect(diff.counts.added).toBe(0);
    expect(diff.status.get(initialize.uid)).toBe('removed');
  });

  it('puts the whole subtree back as ghosts, container included', () => {
    const merged = mergedGraph(base, next, diff);
    expect(merged.nodes.size).toBe(133);
    expect(merged.containers.get(initialize.uid)).toHaveLength(3);
    expect(merged.containers.get(base.root)![0]).toBe(initialize.uid);
  });
});

describe('an inserted step', () => {
  const next = revise((xml) =>
    xml.replace(
      tagFor(FIRST_STATUS),
      `${tagFor(FIRST_STATUS)}<SetStatus logCompletion="TRUE" logStart="FALSE" name="New Step" status="Extra" tag="test_status" timeoutSeconds="0" uid="AAAAAAAA-0000-0000-0000-00000000000A"/>`,
    ),
  );
  const diff = diffGraphs(base, next);

  it('finds one addition and nothing removed', () => {
    expect(diff.counts).toMatchObject({ added: 1, removed: 0, changed: 0 });
    expect(diff.nodes[0]!.uid).toBe('AAAAAAAA-0000-0000-0000-00000000000A');
    expect(diff.nodes[0]!.name).toBe('New Step');
    expect(summarise(diff)).toBe('1 added');
  });

  it('reports the edges it brought with it', () => {
    expect(diff.counts.edgesAdded).toBe(2);
    expect(diff.counts.edgesRemoved).toBe(1);
  });

  it('needs no ghost, and the merged graph is the new revision', () => {
    const merged = mergedGraph(base, next, diff);
    expect(merged.nodes.size).toBe(134);
    expect(merged.edges).toEqual(next.edges);
  });
});

describe('a moved step', () => {
  // The first two steps of Initialize, swapped.
  const first = tagFor(FIRST_STATUS);
  const second = tagFor('AC53B319-C4CE-4703-80C4-242B77D4F030');
  const next = revise((xml) =>
    xml.replace(first, '@@FIRST@@').replace(second, first).replace('@@FIRST@@', second),
  );
  const diff = diffGraphs(base, next);

  it('is a change, not a delete and an add', () => {
    expect(diff.counts.added).toBe(0);
    expect(diff.counts.removed).toBe(0);
    expect(diff.counts.moved).toBe(2);
    for (const node of diff.nodes) {
      expect(node.kind).toBe('changed');
      expect(node.moved).toBe(true);
      expect(node.attrs).toEqual([]); // nothing about the steps themselves changed
    }
  });

  it('keeps the parent when only the order changed', () => {
    for (const node of diff.nodes) expect(node.before).toBe(node.after);
  });

  it('shows in the edges, which is where a reorder actually bites', () => {
    expect(diff.counts.edgesAdded).toBeGreaterThan(0);
    expect(diff.counts.edgesRemoved).toBeGreaterThan(0);
  });
});

describe('several mutations at once', () => {
  const next = revise((xml) =>
    xml
      .replace(tagFor(PULSE1_WAIT), tagFor(PULSE1_WAIT).replace('logStart="FALSE"', 'logStart="TRUE"'))
      .replace(tagFor(FIRST_STATUS), '')
      .replace('setpoint="26.4"', 'setpoint="27.0"'),
  );
  const diff = diffGraphs(base, next);

  it('finds exactly the three it was given and nothing else', () => {
    expect(diff.counts).toMatchObject({ added: 0, removed: 1, changed: 2 });
    expect(diff.nodes.map((n) => n.kind).sort()).toEqual(['changed', 'changed', 'removed']);
    expect(summarise(diff)).toBe('1 removed, 2 changed');
  });

  it('lists them in the order the file reads, ghost in place', () => {
    // The removed step is the first leaf; it has to head the list, not trail it.
    expect(diff.nodes[0]!.uid).toBe(FIRST_STATUS);
  });

  it('is not confused by 27 duplicated names', () => {
    // Matching is by uid. A matcher keyed on names would pair "Set Status" in
    // Initialize with one of the other four and report nonsense.
    const changed = diff.nodes.filter((n) => n.kind === 'changed');
    expect(new Set(changed.map((n) => n.uid)).size).toBe(2);
    for (const node of changed) expect(node.attrs).toHaveLength(1);
  });
});

describe('the matcher is a parameter', () => {
  it('can be replaced without touching anything else', () => {
    // Q5 is unanswered: if uids are re-issued on edit, the fallback goes here
    // and nothing else in the module changes. Proven by swapping in a matcher
    // that pairs nothing.
    const none = { name: 'none', match: (): string | null => null };
    const diff = diffGraphs(base, base, none);
    expect(diff.matcher).toBe('none');
    expect(diff.counts.removed).toBe(133);
    expect(diff.counts.added).toBe(133);
    expect(diff.counts.same).toBe(0);
  });
});
