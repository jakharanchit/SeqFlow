import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import {
  classify,
  lint,
  referenceId,
  referenceMembers,
  siblingDifferences,
} from '../src/core/lint';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const result = lint(graph, rules);

describe('findings are not warnings', () => {
  it('leaves the parser warning list at zero', () => {
    // The whole point of a separate list. A file that parses cleanly must
    // still report zero warnings after 52 findings.
    expect(graph.warnings).toHaveLength(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('never invents a finding without a uid, code, severity and message', () => {
    for (const f of result.findings) {
      expect(f.uid).not.toBe('');
      expect(graph.nodes.has(f.uid)).toBe(true);
      expect(f.code).toBeTruthy();
      expect(['info', 'warn']).toContain(f.severity);
      expect(f.message.length).toBeGreaterThan(20);
    }
  });

  it('is deterministic', () => {
    const again = lint(graph, rules);
    expect(again.findings).toEqual(result.findings);
    // And across two parses of the same bytes.
    const reparsed = lint(parse(fixtureXml, { rules, domParser }), rules);
    expect(reparsed.findings).toEqual(result.findings);
  });
});

describe('rule counts on the fixture', () => {
  it('reproduces every measured count', () => {
    expect(result.counts).toEqual({
      ODD_SIBLING_ATTR: 1,
      UNREACHABLE: 0,
      MULTIPLE_TERMINALS: 0,
      STALE_TARGET: 20,
      DUPLICATE_NAME: 27,
      EXTERNAL_CRITERIA: 4,
    });
    expect(result.findings).toHaveLength(52);
  });
});

describe('ODD_SIBLING_ATTR', () => {
  it('fires once, on the 10 s wait that does not log its start', () => {
    const odd = result.findings.filter((f) => f.code === 'ODD_SIBLING_ATTR');
    expect(odd).toHaveLength(1);
    const finding = odd[0]!;
    expect(finding.attr).toBe('logStart');
    expect(finding.value).toBe('FALSE');
    expect(finding.severity).toBe('warn');
    expect(graph.nodes.get(finding.uid)?.element).toBe('WaitStep');
    expect(graph.nodes.get(finding.uid)?.name).toBe('4R Cycle (10s)');
    expect(finding.related).toHaveLength(4);
  });

  it('reports all eight differences, not only the one it fired on', () => {
    // "Do not try to be clever about obviously" — every difference stays
    // visible. The finding narrows; the report does not.
    const reports = siblingDifferences(graph);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.differences).toHaveLength(8);
    expect(reports[0]!.names).toEqual([
      'Cycle 1 - 4R',
      'Cycle 2 - 18R',
      'Cycle 3 - 32R',
      'Cycle 4 - 57R',
    ]);
  });

  it('sorts the odd one first, then booleans and enums above numeric setpoints', () => {
    const differences = siblingDifferences(graph)[0]!.differences;
    expect(differences[0]!.attr).toBe('logStart');
    expect(differences[0]!.odd).toBe(true);
    expect(differences.filter((d) => d.odd)).toHaveLength(1);

    const rank = differences.map((d) => d.klass);
    expect(rank.indexOf('number')).toBeGreaterThan(rank.indexOf('boolean'));
    expect(rank.indexOf('reference')).toBeGreaterThan(rank.indexOf('number'));
    // The seven parameters each give every member its own value.
    for (const d of differences.filter((x) => !x.odd)) expect(d.distinct).toBe(4);
  });

  it('calls a per-member value a parameter, not an oddity', () => {
    const setpoint = siblingDifferences(graph)[0]!.differences.find(
      (d) => d.attr === 'setpoint',
    );
    expect(setpoint?.values).toEqual(['11.0', '22.0', '140.2', '210.3']);
    expect(setpoint?.odd).toBe(false);
    expect(setpoint?.klass).toBe('number');
  });
});

describe('STALE_TARGET', () => {
  const stale = result.findings.filter((f) => f.code === 'STALE_TARGET');

  it('counts 16 passStep and 4 trueStep — and not 32', () => {
    // PHASE4-TASKS predicts 32: 16 passStep, 8 trueStep, 8 falseStep. Measured
    // against the file, 8 of those trueStep and all 8 falseStep are the empty
    // string: the attribute is present, nothing is stored in it. An empty
    // target is not a stale value, and there is nothing in it for a reader
    // diffing raw XML to trip over, so it is not reported. The fixture wins
    // over the prose, as it did over PHASE1-TASKS' "max depth 7".
    const byAttr = stale.reduce<Record<string, number>>((acc, f) => {
      acc[f.attr ?? ''] = (acc[f.attr ?? ''] ?? 0) + 1;
      return acc;
    }, {});
    expect(byAttr).toEqual({ passStep: 16, trueStep: 4 });

    const populated = [...graph.nodes.values()].filter(
      (n) => (n.attrs['falseAction'] ?? '') === 'Continue' && (n.attrs['falseStep'] ?? '') !== '',
    );
    expect(populated).toHaveLength(0);
  });

  it('is info, never warn — the authoring tool wrote these on purpose', () => {
    for (const f of stale) expect(f.severity).toBe('info');
  });

  it('shows all 16 pass targets naming one sequence the flow never jumps to', () => {
    // PHASE4-TASKS says these 16 "point at the abort". They do not: the abort
    // is where the 16 *failStep* values go, and those are live edges, not
    // stale ones. All 16 passStep values name "Complete Sequence" — the step
    // after the last cycle, which the flow reaches by falling through anyway.
    // Believing them costs a reader a jump that is not in the sequence.
    const pass = stale.filter((f) => f.attr === 'passStep');
    expect(pass).toHaveLength(16);
    expect(new Set(pass.map((f) => f.value)).size).toBe(1);
    const target = graph.nodes.get(pass[0]!.value!)!;
    expect(target.name).toBe('Complete Sequence');
    expect(target.kind).toBe('container');
    // No edge in the graph follows any of them.
    for (const f of pass) {
      expect(graph.edges.some((e) => e.src === f.uid && e.dst === f.value)).toBe(false);
    }

    // The live counterpart, for contrast: 16 fail edges, all reaching the abort.
    const failing = graph.edges.filter((e) => e.reason === 'criteria' && e.label === 'fail');
    expect(failing).toHaveLength(16);
    expect(new Set(failing.map((e) => e.dst)).size).toBe(1);
    expect(graph.nodes.get(failing[0]!.dst)?.name).toBe('Turn off Load');
  });

  it('never reports an exit the flow really takes', () => {
    for (const f of stale) {
      expect(graph.edges.some((e) => e.src === f.uid && e.dst === f.value)).toBe(false);
    }
  });
});

describe('DUPLICATE_NAME', () => {
  const dups = result.findings.filter((f) => f.code === 'DUPLICATE_NAME');

  it('finds 27 names covering 106 of the 133 nodes', () => {
    expect(dups).toHaveLength(27);
    const covered = new Set(dups.flatMap((f) => f.related ?? []));
    expect(covered.size).toBe(106);
    expect(graph.nodes.size).toBe(133);
  });

  it('names the worst offenders', () => {
    const worst = dups
      .map((f) => ({ name: f.value, n: (f.related ?? []).length }))
      .sort((a, b) => b.n - a.n || (a.name! < b.name! ? -1 : 1));
    expect(worst[0]).toEqual({ name: 'Turn off Load', n: 5 });
    expect(worst.slice(1, 3).map((w) => w.n)).toEqual([4, 4]);
  });

  it('reports one finding per name, not one per node', () => {
    expect(new Set(dups.map((f) => f.value)).size).toBe(dups.length);
  });
});

describe('UNREACHABLE and MULTIPLE_TERMINALS', () => {
  it('both find nothing on the fixture', () => {
    expect(result.counts.UNREACHABLE).toBe(0);
    expect(result.counts.MULTIPLE_TERMINALS).toBe(0);
  });

  it('both have a voice when a file gives them one', () => {
    // Two dead ends and an island. A rule that has never fired is a rule
    // nobody has tested, and neither of these fires on the only real file.
    const xml = `<TestSequence>
      <Sequence uid="R" name="Main">
        <ConditionStep uid="A" name="Branch"
          trueAction="Go To Step" trueStep="X"
          falseAction="Go To Step" falseStep="Y"/>
        <GoTo uid="X" name="Stop here" stepUID="NOPE-1"/>
        <SetStatus uid="C" name="Never"/>
        <GoTo uid="Y" name="Stop there" stepUID="NOPE-2"/>
      </Sequence>
    </TestSequence>`;
    const g = parse(xml, { rules, domParser });
    const r = lint(g, rules);

    expect(r.counts.UNREACHABLE).toBe(1);
    expect(r.findings.find((f) => f.code === 'UNREACHABLE')?.uid).toBe('C');
    expect(r.counts.MULTIPLE_TERMINALS).toBe(2);
    expect(
      r.findings.filter((f) => f.code === 'MULTIPLE_TERMINALS').map((f) => f.uid),
    ).toEqual(['X', 'Y']);

    // And the point of the whole exercise: this file has two *warnings* as
    // well, and they are a different list saying a different thing.
    expect(g.warnings.map((w) => w.code)).toEqual(['UNRESOLVED_TARGET', 'UNRESOLVED_TARGET']);
    expect(r.findings.some((f) => f.code.includes('UNRESOLVED'))).toBe(false);
  });
});

describe('EXTERNAL_CRITERIA', () => {
  const external = result.findings.filter((f) => f.code === 'EXTERNAL_CRITERIA');

  it('finds four definitions behind sixteen evaluations', () => {
    expect(external).toHaveLength(4);
    expect(external.reduce((n, f) => n + (f.related ?? []).length, 0)).toBe(16);
    for (const f of external) {
      expect(f.severity).toBe('info');
      expect(f.attr).toBe('criteriaMap');
      expect(f.related).toHaveLength(4);
    }
  });

  it('keys on the definition id, not on the whole reference', () => {
    for (const f of external) expect(f.value).toMatch(/^[0-9A-F-]{36}$/);
  });

  it('does not double as an unresolved-target warning', () => {
    expect(graph.warnings).toHaveLength(0);
  });
});

describe('reference values', () => {
  it('splits an id from the members it covers', () => {
    expect(referenceId('718C2399-A=calc_unit_ref')).toBe('718C2399-A');
    expect(referenceMembers('718C2399-A=calc_unit_ref')).toEqual(['calc_unit_ref']);
    expect(referenceMembers('X=a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('treats a value with no members as the id entire', () => {
    expect(referenceId('plain')).toBe('plain');
    expect(referenceMembers('plain')).toEqual([]);
  });
});

describe('value classification', () => {
  it('sorts the classes the difference table cares about', () => {
    expect(classify(['TRUE', 'FALSE'])).toBe('boolean');
    expect(classify(['11.0', '210.3'])).toBe('number');
    expect(classify(['A0000050-0000-0000-0000-000000004000'])).toBe('reference');
    expect(classify(['Exciting', 'Withdrawing'])).toBe('enum');
    expect(classify(['4R Cycle (10s)'])).toBe('text');
  });

  it('does not let one stray value change the class of a whole column', () => {
    // A boolean column with a name in it is a text column: the class is what
    // every value is, never what most of them are.
    expect(classify(['TRUE', '4R Cycle (10s)'])).toBe('text');
    expect(classify(['11.0', 'auto'])).toBe('text');
  });

  it('ignores absent values rather than calling the column text', () => {
    expect(classify(['TRUE', '', 'FALSE'])).toBe('boolean');
  });
});
