import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { compare, similarGroups, structureKey, subtree } from '../src/core/similarity';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

const pulses = [...graph.nodes.values()]
  .filter((n) => n.kind === 'container' && n.name.startsWith('Pulse '))
  .map((n) => n.uid);

describe('sibling similarity', () => {
  it('reports the four Pulse sequences as structurally identical', () => {
    expect(new Set(pulses.map((uid) => structureKey(graph, uid))).size).toBe(1);
    // 29 including the Pulse itself; 28 descendants, which is what collapse hides.
    for (const uid of pulses) expect(subtree(graph, uid)).toHaveLength(29);
  });

  it('finds them as the only repeat in the file', () => {
    const groups = similarGroups(graph);
    expect(groups).toHaveLength(1);
    const top = groups[0]!;
    expect(new Set(top.members)).toEqual(new Set(pulses));
    expect(top.size).toBe(29);
    expect(graph.nodes.get(top.parent!)?.name).toBe('Main');
  });

  it('accounts for 112 of the 133 nodes as four parameterised repeats', () => {
    const group = similarGroups(graph)[0]!;
    // Descendants only: the four Pulse containers themselves stay.
    expect((group.size - 1) * group.members.length).toBe(112);
    expect(graph.nodes.size - (group.size - 1) * group.members.length).toBe(21);
  });

  it('reduces 116 nodes of difference to 8 attributes', () => {
    const result = compare(graph, pulses);
    expect(result.identical).toBe(true);
    expect(result.size).toBe(29);
    expect(result.names).toEqual([
      'Pulse 1 - 6C',
      'Pulse 2 - 12C',
      'Pulse 3 - 24C',
      'Pulse 4 - 36C',
    ]);
    expect(result.differences).toHaveLength(8);

    for (const d of result.differences) {
      expect(d.values).toHaveLength(4);
      expect(new Set(d.values).size).toBeGreaterThan(1);
      expect(d.uids.every((u) => graph.nodes.has(u))).toBe(true);
    }
  });

  it('names the load setpoint as the parameter the pulses are about', () => {
    const result = compare(graph, pulses);
    const setpoint = result.differences.find((d) => d.attr === 'setpoint');
    expect(setpoint?.values).toEqual(['26.4', '52.8', '105.6', '158.4']);
    expect(setpoint?.element).toBe('SetSetpoint');
  });

  it('surfaces an inconsistency no one would spot by eye', () => {
    // Pulse 1's 10 s pulse does not log its start; the other three do. This is
    // the payoff: one odd attribute in 116 otherwise identical nodes.
    const result = compare(graph, pulses);
    const logStart = result.differences.find((d) => d.attr === 'logStart');
    expect(logStart?.element).toBe('WaitStep');
    expect(logStart?.label).toBe('6C Pulse (10s)');
    expect(logStart?.values).toEqual(['FALSE', 'TRUE', 'TRUE', 'TRUE']);
  });

  it('leaves the jump targets as the only structural difference', () => {
    const result = compare(graph, pulses);
    // Each pulse jumps within itself, so its targets necessarily differ.
    const targets = result.differences.filter((d) => d.attr.endsWith('Step'));
    expect(targets.map((d) => d.attr).sort()).toEqual(['falseStep', 'trueStep']);
    for (const d of targets) expect(new Set(d.values).size).toBe(4);
  });

  it('never reports uid, which always differs and means nothing', () => {
    expect(compare(graph, pulses).differences.some((d) => d.attr === 'uid')).toBe(false);
  });

  it('reports structurally different containers as not identical', () => {
    const initialize = [...graph.nodes.values()].find((n) => n.name === 'Initialize')!;
    const result = compare(graph, [pulses[0]!, initialize.uid]);
    expect(result.identical).toBe(false);
    expect(result.differences).toEqual([]);
  });

  it('does not loop on a self-referencing container', () => {
    const broken = {
      ...graph,
      containers: new Map(graph.containers).set(pulses[0]!, [pulses[0]!]),
    };
    expect(() => structureKey(broken, pulses[0]!)).not.toThrow();
    expect(() => subtree(broken, pulses[0]!)).not.toThrow();
  });
});

describe('lifted child attributes', () => {
  // The fixture's four Comparisons all threshold at 53.2, so the fixture
  // cannot show that a lifted difference is caught. This can.
  const xml = `<TestSequence>
    <Sequence uid="R" name="Main">
      <Sequence uid="A" name="A">
        <ConditionStep uid="A1" name="Check" trueAction="Continue" falseAction="Continue">
          <Comparison uid="AC" sensorTag="PackVoltage" comparison="GTOET" value="53.2"/>
        </ConditionStep>
      </Sequence>
      <Sequence uid="B" name="B">
        <ConditionStep uid="B1" name="Check" trueAction="Continue" falseAction="Continue">
          <Comparison uid="BC" sensorTag="PackVoltage" comparison="GTOET" value="61.9"/>
        </ConditionStep>
      </Sequence>
    </Sequence>
  </TestSequence>`;
  const g = parse(xml, { rules, domParser });

  it('compares a ConditionStep threshold through its Comparison child', () => {
    const result = compare(g, ['A', 'B']);
    expect(result.identical).toBe(true);
    const value = result.differences.find((d) => d.attr === 'Comparison.value');
    expect(value).toBeDefined();
    expect(value!.values).toEqual(['53.2', '61.9']);
    expect(value!.element).toBe('ConditionStep');
  });

  it('does not report a child attribute the siblings agree on', () => {
    const result = compare(g, ['A', 'B']);
    expect(result.differences.some((d) => d.attr === 'Comparison.sensorTag')).toBe(false);
    expect(result.differences.some((d) => d.attr === 'Comparison.comparison')).toBe(false);
  });
});
