import { describe, expect, it } from 'vitest';

import {
  durations,
  humanRange,
  humanSeconds,
  offsets,
  stepSeconds,
  terminalCount,
} from '../src/core/duration';
import { parse } from '../src/core/parse';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const report = durations(graph, rules);

describe('the fixture, measured', () => {
  it('reports 2.0 minutes nominal and 82.0 minutes worst case', () => {
    expect(report.nominal.max).toBe(120);
    expect(report.worst.max).toBe(4920);
    expect(report.nominal.max / 60).toBe(2);
    expect(report.worst.max / 60).toBe(82);
    expect(report.ratio).toBe(41);
  });

  it('breaks the polling out rather than folding it in', () => {
    expect(report.waitSteps).toBe(16);
    expect(report.waitSeconds).toBe(120);
    expect(report.pollingSteps).toBe(8);
    expect(report.pollingSeconds).toBe(4800);
    // 80 of the 82 minutes. This is why one figure will not do.
    expect(report.pollingSeconds / report.worst.max).toBeGreaterThan(0.97);
  });

  it('counts the waits as eight fives and eight tens', () => {
    const waits = [...graph.nodes.values()]
      .map((n) => stepSeconds(n, rules).wait)
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
    expect(waits).toHaveLength(16);
    expect(waits.filter((s) => s === 5)).toHaveLength(8);
    expect(waits.filter((s) => s === 10)).toHaveLength(8);
  });

  it('finds 136 distinct entry-to-terminal paths, ending at one terminal', () => {
    expect(report.paths).toBe(136);
    expect(report.cyclic).toBe(false);
    expect(terminalCount(graph)).toBe(1);
  });

  it('gives a range, not a figure — the abort path is much the shorter', () => {
    expect(report.nominal.min).toBe(0);
    expect(report.worst.min).toBe(600);
    expect(report.nominal.min).toBeLessThan(report.nominal.max);
    expect(report.worst.min).toBeLessThan(report.worst.max);
  });

  it('says which rule-file attributes produced the numbers', () => {
    // `durationSec` is listed too, for a dialect this fixture does not use.
    // The numbers below are unchanged because no element here carries it.
    expect(report.waitAttrs).toContain('time');
    expect(report.timeoutAttrs).toEqual(['timeoutSeconds']);
  });
});

describe('the zero gate', () => {
  it('selects 8 polling steps, not all 107', () => {
    // "Steps with a timeout" selects everything: 125 of the 133 elements carry
    // timeoutSeconds="0". The gate is a non-zero value.
    const present = [...graph.nodes.values()].filter(
      (n) => n.attrs['timeoutSeconds'] !== undefined,
    );
    expect(present).toHaveLength(133);
    expect(report.pollingSteps).toBe(8);
  });

  it('ignores an empty, negative or unparseable value', () => {
    const xml = `<TestSequence>
      <Sequence uid="R" name="Main">
        <WaitStep uid="A" name="Empty" time="" timeoutSeconds="0"/>
        <WaitStep uid="B" name="Negative" time="-5" timeoutSeconds="0"/>
        <WaitStep uid="C" name="Words" time="soon" timeoutSeconds="0"/>
        <WaitStep uid="D" name="Real" time="7.5" timeoutSeconds="0"/>
      </Sequence>
    </TestSequence>`;
    const g = parse(xml, { rules, domParser });
    const r = durations(g, rules);
    expect(r.waitSteps).toBe(1);
    expect(r.waitSeconds).toBe(7.5);
    expect(r.nominal).toEqual({ min: 7.5, max: 7.5 });
  });
});

describe('a file with nothing timed', () => {
  it('says so rather than reporting 0.0', () => {
    const xml = `<TestSequence>
      <Sequence uid="R" name="Main">
        <SetStatus uid="A" name="A"/>
        <SetStatus uid="B" name="B"/>
      </Sequence>
    </TestSequence>`;
    const g = parse(xml, { rules, domParser });
    const r = durations(g, rules);
    expect(r.timed).toBe(false);
    expect(r.waitSteps).toBe(0);
    expect(r.pollingSteps).toBe(0);
    // A ratio of nothing to nothing is not 1, and it is not 0 either.
    expect(r.ratio).toBe(Infinity);
  });

  it('is also false when the rule file names no duration attribute', () => {
    const r = durations(graph, { ...rules, durations: { waits: [], timeouts: [] } });
    expect(r.timed).toBe(false);
    expect(r.paths).toBe(136);
  });
});

describe('where a step sits', () => {
  const offset = offsets(graph, rules);

  it('places the entry at zero', () => {
    expect(offset.get(graph.entry)).toMatchObject({
      nominal: { min: 0, max: 0 },
      worst: { min: 0, max: 0 },
      unreachable: false,
    });
  });

  it('places the last step at the far end of the range', () => {
    const stop = [...graph.nodes.values()].find((n) => n.name === 'Stop Recording')!;
    const at = offset.get(stop.uid)!;
    expect(at.nominal).toEqual({ min: 0, max: 120 });
    expect(at.worst).toEqual({ min: 600, max: 4920 });
    expect(at.remaining).toEqual({ min: 0, max: 0 });
  });

  it('grows through the four cycles', () => {
    const cycles = [...graph.nodes.values()]
      .filter((n) => n.kind === 'container' && n.name.startsWith('Cycle '))
      .map((n) => graph.containers.get(n.uid)![0]!);
    const maxima = cycles.map((uid) => offset.get(uid)!.nominal.max);
    expect(maxima).toEqual([0, 30, 60, 90]);
  });

  it('covers every leaf and no container', () => {
    const leaves = [...graph.nodes.values()].filter((n) => n.kind !== 'container');
    expect(offset.size).toBe(leaves.length);
    for (const n of leaves) expect(offset.has(n.uid)).toBe(true);
  });

  it('marks a step the flow cannot reach rather than guessing an offset', () => {
    const xml = `<TestSequence>
      <Sequence uid="R" name="Main">
        <GoTo uid="A" name="Skip" stepUID="D"/>
        <WaitStep uid="C" name="Never" time="99"/>
        <WaitStep uid="D" name="End" time="1"/>
      </Sequence>
    </TestSequence>`;
    const g = parse(xml, { rules, domParser });
    const at = offsets(g, rules);
    expect(at.get('C')?.unreachable).toBe(true);
    expect(at.get('D')?.unreachable).toBe(false);
    // And the unreachable 99 s is not in the estimate.
    expect(durations(g, rules).nominal.max).toBe(1);
  });
});

describe('formatting', () => {
  it('keeps short things in seconds and long things in minutes', () => {
    expect(humanSeconds(0)).toBe('0 s');
    expect(humanSeconds(5)).toBe('5 s');
    expect(humanSeconds(119)).toBe('119 s');
    expect(humanSeconds(120)).toBe('2 min');
    expect(humanSeconds(4920)).toBe('82 min');
    expect(humanSeconds(10800)).toBe('3 h');
    expect(humanSeconds(Infinity)).toBe('—');
  });

  it('collapses a range only when both ends agree', () => {
    expect(humanRange({ min: 120, max: 120 })).toBe('2 min');
    expect(humanRange(report.worst)).toBe('10 min to 82 min');
  });
});

describe('a cycle', () => {
  it('is reported rather than hung on', () => {
    const xml = `<TestSequence>
      <Sequence uid="R" name="Main">
        <WaitStep uid="A" name="A" time="1"/>
        <GoTo uid="B" name="Back" stepUID="A"/>
      </Sequence>
    </TestSequence>`;
    const g = parse(xml, { rules, domParser });
    const r = durations(g, rules);
    expect(r.cyclic).toBe(true);
    // The wait totals are still true; only the path arithmetic cannot close.
    expect(r.waitSteps).toBe(1);
    expect(r.waitSeconds).toBe(1);
  });
});
