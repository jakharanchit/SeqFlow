import { describe, expect, it } from 'vitest';

import { RuleFileError, loadRules } from '../src/core/rules';
import { read, rules } from './helpers';

describe('rule file loader', () => {
  it('loads the shipped rules.yaml', () => {
    expect(rules.version).toBe(1);
    // The rule file covers two dialects now, so this asserts what must be
    // there rather than the whole list — a third dialect should not break a
    // test about the loader.
    expect(rules.containers).toEqual(expect.arrayContaining(['TestSequence', 'Sequence']));
    expect(rules.edges).toHaveLength(5);
    expect(rules.convergenceThreshold).toBe(3);
  });

  it('keeps the `when` gate on every target-bearing rule', () => {
    // Spec 4.2: a target attribute read without its gate is a stale value.
    const gated = rules.edges.filter((e) => Object.keys(e.when).length > 0);
    expect(gated).toHaveLength(4);
    for (const rule of gated) {
      expect(Object.values(rule.when)).toContain('Go To Step');
    }
  });

  it('lifts snake_case keys onto the camelCase Rules type', () => {
    expect(rules.inspectorChildren['ConditionStep']).toEqual(['Comparison']);
    expect(rules.externalRefs).toContain('criteriaMap');
    expect(rules.signalAttrs).toContain('sensorTag');
    expect(rules.steps).toContain('WaitStep');
  });

  const bad = (yaml: string): (() => unknown) => (): unknown => loadRules(yaml);

  it('names the offending key when `edges` is missing', () => {
    const without = read('rules.yaml').replace(/^edges:$/m, 'edgez:');
    expect(bad(without)).toThrow(RuleFileError);
    expect(bad(without)).toThrow(/edges: required key is missing/);
  });

  it('rejects an edge rule with no `when` clause', () => {
    expect(
      bad(`version: 1
containers: [Sequence]
shapes: {default: rect}
kinds: {default: action}
edges:
  - target: failStep
    reason: criteria`),
    ).toThrow(/edges\[0\]\.when: required/);
  });

  it('rejects an unknown shape, naming the element', () => {
    expect(
      bad(`version: 1
containers: [Sequence]
shapes: {default: rect, WaitStep: octagon}
kinds: {default: action}
edges: [{when: {}, target: stepUID, reason: goto}]`),
    ).toThrow(/shapes\.WaitStep: expected one of/);
  });

  it('requires a default shape and kind', () => {
    expect(
      bad(`version: 1
containers: [Sequence]
shapes: {WaitStep: rect}
kinds: {default: action}
edges: [{when: {}, target: stepUID, reason: goto}]`),
    ).toThrow(/shapes: must define a "default" entry/);
  });

  it('rejects a fallthrough edge rule — the parser synthesises those', () => {
    expect(
      bad(`version: 1
containers: [Sequence]
shapes: {default: rect}
kinds: {default: action}
edges: [{when: {}, target: stepUID, reason: fallthrough}]`),
    ).toThrow(/edges\[0\]\.reason: fallthrough is synthesised/);
  });

  it('rejects an unsupported version', () => {
    expect(bad('version: 99\ncontainers: [Sequence]')).toThrow(
      /version: unsupported rule file version 99/,
    );
  });
});
