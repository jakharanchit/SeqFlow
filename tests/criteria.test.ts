import { describe, expect, it } from 'vitest';

import {
  criteriaAhead,
  criteriaSteps,
  criteriaTable,
  failEdges,
  nodesForCriterion,
} from '../src/core/criteria';
import { parse } from '../src/core/parse';
import { pathLabel } from '../src/core/ancestry';
import { adjacency, downstream } from '../src/core/paths';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const table = criteriaTable(graph, rules);
const steps = criteriaSteps(graph);

describe('criteria table', () => {
  it('reduces sixteen evaluations to four rows', () => {
    expect(table).toHaveLength(4);
    expect(table.reduce((n, row) => n + row.uses.length, 0)).toBe(16);
    for (const row of table) {
      expect(row.uses).toHaveLength(4);
      expect(row.uids).toHaveLength(4);
    }
  });

  it('names each row from the steps that carry it', () => {
    expect(table.map((row) => row.name).sort()).toEqual([
      'Acceptance Criteria - ESR Max - 6C',
      'Acceptance Criteria - Individual Cell OCV',
      'Acceptance Criteria - Pack OCV',
      'Acceptance Criteria - Temperature Max',
    ]);
  });

  it('keys on the definition id, so four uses of one definition are one row', () => {
    for (const row of table) {
      expect(row.attr).toBe('criteriaMap');
      expect(row.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      expect(row.key).toBe(`criteriaMap|${row.id}`);
    }
    expect(new Set(table.map((row) => row.id)).size).toBe(4);
  });

  it('carries what each definition covers, from the reference itself', () => {
    const pack = table.find((row) => row.name.endsWith('Pack OCV'))!;
    expect(pack.members).toEqual(['calc_pack_ocv']);
    const cells = table.find((row) => row.name.endsWith('Individual Cell OCV'))!;
    expect(cells.members).toHaveLength(14);
    expect(cells.members[0]).toBe('calc_cell_ocv_1');
    const temps = table.find((row) => row.name.endsWith('Temperature Max'))!;
    expect(temps.members).toEqual(['PackTemps1', 'PackTemps2', 'PackTemps3', 'PackTemps4']);
  });

  it('says the limits are absent rather than showing an empty cell', () => {
    // Open question Q3: the names are in this file and the limits are not.
    for (const row of table) expect(row.limits).toBeNull();
  });

  it('spotlights exactly four nodes per row', () => {
    for (const row of table) {
      const lit = nodesForCriterion(table, row.key);
      expect(lit.size).toBe(4);
      for (const uid of lit) expect(graph.nodes.get(uid)?.kind).toBe('criteria');
    }
    expect(nodesForCriterion(table, 'nope').size).toBe(0);
  });

  it('is deterministic and most-used first', () => {
    expect(criteriaTable(graph, rules)).toEqual(table);
    const counts = table.map((row) => row.uses.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('is driven by the rule file, not by an element name', () => {
    const none = criteriaTable(graph, { ...rules, externalRefs: [] });
    expect(none).toEqual([]);
  });
});

describe('fail routes', () => {
  const routes = failEdges(graph);

  it('is sixteen edges from sixteen steps onto one', () => {
    expect(routes.edges).toHaveLength(16);
    expect(routes.sources.size).toBe(16);
    expect(routes.targets.size).toBe(1);
    expect(routes.nodes.size).toBe(17);
    expect(graph.nodes.get([...routes.targets][0]!)?.name).toBe('Turn off Load');
  });

  it('leaves only criteria steps', () => {
    for (const uid of routes.sources) {
      expect(graph.nodes.get(uid)?.element).toBe('TestCriteriaEvaluation');
    }
    expect([...routes.sources].sort()).toEqual([...steps].sort());
  });

  it('does not pick up the pass exits, which are not jumps in this file', () => {
    // Every passAction is Continue, so a pass leaves by fall-through. A rule
    // that counted every criteria-reason edge would still say 16 here and be
    // wrong the day a passAction becomes a jump.
    const solidCriteria = graph.edges.filter(
      (e) => e.reason === 'criteria' && e.style !== 'dotted',
    );
    expect(solidCriteria).toHaveLength(0);
  });
});

describe('criteria ahead', () => {
  it('counts sixteen at the entry and none after the last one', () => {
    const adj = adjacency(graph);
    const atEntry = criteriaAhead(graph, graph.entry, table, adj);
    expect(atEntry.uids).toHaveLength(16);
    expect(atEntry.keys).toHaveLength(4);
    expect(atEntry.isCriterion).toBe(false);

    const last = steps[steps.length - 1]!;
    const after = criteriaAhead(graph, last, table, adj);
    expect(after.uids).toHaveLength(0);
    expect(after.keys).toHaveLength(0);
    expect(after.isCriterion).toBe(true);
  });

  it('falls monotonically through the sixteen', () => {
    // This is the discriminating answer the 102-node path filter could not
    // give: it varies across the file instead of covering almost all of it.
    const adj = adjacency(graph);
    const counts = steps.map((uid) => criteriaAhead(graph, uid, table, adj).uids.length);
    expect(counts[0]).toBe(15);
    expect(counts[counts.length - 1]).toBe(0);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    }
  });

  it('never counts a step as lying ahead of itself', () => {
    for (const uid of steps) {
      expect(criteriaAhead(graph, uid, table).uids).not.toContain(uid);
    }
  });

  it('agrees with the downstream walk it is built on', () => {
    const adj = adjacency(graph);
    const reachable = downstream(graph, graph.entry, adj).nodes;
    for (const uid of criteriaAhead(graph, graph.entry, table, adj).uids) {
      expect(reachable.has(uid)).toBe(true);
    }
  });
});

describe('why the path filter was not built', () => {
  it('measures how little a failure-path filter would hide', () => {
    // Spec 7.5 asks for a filter to the paths that reach a terminal abort.
    // The argument for replacing it belongs in a test, not only in prose.
    //
    // PHASE4-TASKS puts it at "102 of 107". Measured: 99 of the 107 leaves can
    // reach the abort. The remaining 8 are the abort step itself, the 3 steps
    // that follow it inside Abort Sequence, and exactly the 4 the task list
    // names — "All Pulses Passed", two inside Complete Sequence, and Stop
    // Recording. Whichever of the two numbers you prefer, a filter that dims
    // four steps out of 107 is a toggle nobody presses twice.
    const adj = adjacency(graph);
    const abort = [...failEdges(graph).targets][0]!;
    const leaves = [...graph.nodes.values()].filter((n) => n.kind !== 'container');
    expect(leaves).toHaveLength(107);

    const cannot = leaves.filter(
      (n) => n.uid !== abort && !downstream(graph, n.uid, adj).nodes.has(abort),
    );
    expect(leaves.length - cannot.length - 1).toBe(99);

    const abortSequence = cannot.filter((n) =>
      pathLabel(graph, n.uid).endsWith('Abort Sequence'),
    );
    expect(abortSequence).toHaveLength(3);
    expect(cannot.length - abortSequence.length).toBe(4);
    expect(
      cannot.filter((n) => !abortSequence.includes(n)).map((n) => n.name),
    ).toEqual(['All Pulses Passed', 'Set Status', 'Play Status Tone', 'Stop Recording']);
  });
});
