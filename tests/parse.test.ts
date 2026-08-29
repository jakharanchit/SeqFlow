import { describe, expect, it } from 'vitest';

import { ParseError, indexElements, parse } from '../src/core/parse';
import { firstLeaf, nextSiblingLeaf, resolveTarget } from '../src/core/resolve';
import type { Graph } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph: Graph = parse(fixtureXml, { rules, domParser });
const doc = domParser.parseFromString(fixtureXml, 'application/xml');
const index = indexElements(doc, rules);

/* Task 3 — tree walk ------------------------------------------------ */

describe('tree walk', () => {
  it('emits 133 nodes: 107 leaves and 26 containers', () => {
    const all = [...graph.nodes.values()];
    expect(graph.nodes.size).toBe(133);
    expect(all.filter((n) => n.kind !== 'container')).toHaveLength(107);
    expect(all.filter((n) => n.kind === 'container')).toHaveLength(26);
  });

  it('nests six node levels deep', () => {
    // PHASE1-TASKS says 7; that counts the TestSequence wrapper, which carries
    // no uid and so produces no node. The golden fixture is the target.
    const depths = [...graph.nodes.values()].map((n) => n.depth);
    expect(Math.min(...depths)).toBe(1);
    expect(Math.max(...depths)).toBe(6);
  });

  it('produces no warnings on the fixture', () => {
    expect(graph.warnings).toEqual([]);
  });

  it('keys every node on its uid, verbatim', () => {
    for (const [uid, node] of graph.nodes) {
      expect(node.uid).toBe(uid);
      expect(node.attrs['uid']).toBe(uid);
    }
  });

  it('records ordered children for all 26 containers', () => {
    expect(graph.containers.size).toBe(26);
    const listed = [...graph.containers.values()].flat();
    expect(new Set(listed).size).toBe(listed.length); // no node listed twice
    expect(listed).toHaveLength(132); // every node but the root
  });

  it('lifts a ConditionStep Comparison into childAttrs', () => {
    const cond = [...graph.nodes.values()].find(
      (n) => n.element === 'ConditionStep' && n.name === 'Check Start Voltage',
    );
    const comparison = cond?.childAttrs?.['Comparison']?.[0];
    expect(comparison?.['sensorTag']).toBe('PackVoltage');
    expect(comparison?.['comparison']).toBe('GTOET');
    expect(comparison?.['value']).toBe('53.2');
  });

  it('does not make a node of a Comparison, DynamicName or Text', () => {
    const elements = new Set([...graph.nodes.values()].map((n) => n.element));
    expect(elements.has('Comparison')).toBe(false);
    expect(elements.has('DynamicName')).toBe(false);
    expect(elements.has('TestSequence')).toBe(false);
  });

  it('keeps attrs verbatim, including ones the parser never reads', () => {
    const wait = [...graph.nodes.values()].find((n) => n.element === 'WaitStep');
    expect(wait?.attrs).toHaveProperty('waitType', 'Wait For');
    expect(wait?.attrs).toHaveProperty('timeValueSource', 'Constant');
  });
});

/* Task 4 — resolution ----------------------------------------------- */

describe('resolution', () => {
  it('descends a jump target to its first leaf, not the Sequence', () => {
    // The assertion that catches a parser ignoring rule 4.3.
    const failTargets = new Set(
      [...graph.nodes.values()]
        .filter((n) => n.attrs['failAction'] === 'Go To Step')
        .map((n) => n.attrs['failStep'] ?? ''),
    );
    expect(failTargets.size).toBeGreaterThan(0);

    for (const uid of failTargets) {
      expect(index.get(uid)?.tagName).toBe('Sequence'); // target IS a container
      const leaf = resolveTarget(uid, { rules, index });
      expect(leaf).not.toBeNull();
      const node = graph.nodes.get(leaf!.getAttribute('uid')!);
      expect(node?.name).toBe('Turn off Load');
      expect(graph.nodes.get(node!.parent!)?.name).toBe('Abort Sequence');
    }
  });

  it('returns the element itself when it is already a leaf', () => {
    const leaf = index.get(graph.entry)!;
    expect(firstLeaf(leaf, rules)).toBe(leaf);
  });

  it('returns null for an unknown uid', () => {
    expect(resolveTarget('NOT-A-REAL-GUID', { rules, index })).toBeNull();
  });

  it('walks up the tree for the last step in a sequence', () => {
    // "Start Periodic Log" ends the Initialize sequence; its successor is the
    // first leaf of the next top-level sequence, not a sibling.
    const last = [...graph.nodes.values()].find((n) => n.name === 'Start Periodic Log')!;
    const next = nextSiblingLeaf(index.get(last.uid)!, rules);
    const nextNode = graph.nodes.get(next!.getAttribute('uid')!)!;
    expect(graph.nodes.get(last.parent!)?.name).toBe('Initialize');
    expect(nextNode.kind).not.toBe('container');
    expect(nextNode.depth).toBeGreaterThan(last.depth);
  });

  it('has no successor for the final step', () => {
    const terminal = [...graph.nodes.values()].find((n) => n.name === 'Stop Recording')!;
    expect(nextSiblingLeaf(index.get(terminal.uid)!, rules)).toBeNull();
  });
});

/* Task 5 — edges ---------------------------------------------------- */

describe('edges', () => {
  const byReason = graph.edges.reduce<Record<string, number>>((acc, e) => {
    acc[e.reason] = (acc[e.reason] ?? 0) + 1;
    return acc;
  }, {});

  it('builds 126 edges in the expected proportions', () => {
    expect(graph.edges).toHaveLength(126);
    expect(byReason).toEqual({ fallthrough: 100, criteria: 16, branch: 8, goto: 2 });
  });

  it('ignores a stale jump target whose action is Continue', () => {
    // All 16 passStep values point at "Complete Sequence" while every
    // passAction is Continue. None may become an edge. Spec 4.2.
    const stale = [...graph.nodes.values()].filter(
      (n) => n.attrs['passAction'] === 'Continue' && (n.attrs['passStep'] ?? '') !== '',
    );
    expect(stale).toHaveLength(16);

    const staleTargets = new Set(stale.map((n) => n.attrs['passStep']!));
    for (const src of stale) {
      const outgoing = graph.edges.filter((e) => e.src === src.uid);
      for (const edge of outgoing) {
        if (edge.reason === 'fallthrough') continue;
        expect(staleTargets.has(edge.dst)).toBe(false);
      }
    }
    expect(graph.edges.some((e) => e.label === 'pass')).toBe(false);
  });

  it('suppresses fall-through only when every exit is a jump', () => {
    for (const node of graph.nodes.values()) {
      if (node.kind === 'container') continue;
      const out = graph.edges.filter((e) => e.src === node.uid);
      const falls = out.filter((e) => e.reason === 'fallthrough');

      const bothJumps =
        node.attrs['trueAction'] === 'Go To Step' && node.attrs['falseAction'] === 'Go To Step';
      const isGoto = (node.attrs['stepUID'] ?? '') !== '';
      const isTerminal = node.name === 'Stop Recording';

      expect(falls).toHaveLength(bothJumps || isGoto || isTerminal ? 0 : 1);
    }
  });

  it('never connects a container', () => {
    const containers = new Set(
      [...graph.nodes.values()].filter((n) => n.kind === 'container').map((n) => n.uid),
    );
    for (const e of graph.edges) {
      expect(containers.has(e.src)).toBe(false);
      expect(containers.has(e.dst)).toBe(false);
    }
  });

  it('converges 16 edges on "Turn off Load"', () => {
    const inbound = graph.edges.reduce<Record<string, number>>((acc, e) => {
      acc[e.dst] = (acc[e.dst] ?? 0) + 1;
      return acc;
    }, {});
    const [uid, count] = Object.entries(inbound).sort((a, b) => b[1] - a[1])[0]!;
    expect(count).toBe(16);
    const node = graph.nodes.get(uid)!;
    expect(node.name).toBe('Turn off Load');
    expect(graph.nodes.get(node.parent!)?.name).toBe('Abort Sequence');
  });

  it('has exactly one terminal and no unreachable step', () => {
    const sources = new Set(graph.edges.map((e) => e.src));
    const targets = new Set(graph.edges.map((e) => e.dst));
    const leaves = [...graph.nodes.values()].filter((n) => n.kind !== 'container');

    const terminals = leaves.filter((n) => !sources.has(n.uid));
    expect(terminals.map((n) => n.name)).toEqual(['Stop Recording']);

    const unreachable = leaves.filter((n) => !targets.has(n.uid) && n.uid !== graph.entry);
    expect(unreachable).toEqual([]);
  });

  it('sorts by (src, reason, dst)', () => {
    const keys = graph.edges.map((e) => `${e.src}|${e.reason}|${e.dst}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('is deterministic across runs', () => {
    const again = parse(fixtureXml, { rules, domParser });
    expect(JSON.stringify(again.edges)).toBe(JSON.stringify(graph.edges));
  });

  it('starts at the first leaf of the root sequence', () => {
    expect(graph.nodes.get(graph.root)?.name).toBe('HLB Battery ESR');
    expect(graph.nodes.get(graph.entry)?.name).toBe('Set Status');
    expect(graph.nodes.get(graph.entry)?.kind).not.toBe('container');
  });
});

/* Robustness -------------------------------------------------------- */

describe('malformed input', () => {
  it('throws a readable ParseError on broken XML', () => {
    expect(() => parse('<TestSequence><Sequence></TestSequence>', { rules, domParser })).toThrow(
      ParseError,
    );
  });

  it('throws when the document holds no steps', () => {
    expect(() => parse('<TestSequence><Variables/></TestSequence>', { rules, domParser })).toThrow(
      /contains no steps/,
    );
  });

  it('renders and warns for an element the rule file does not know', () => {
    const xml = `<TestSequence><Sequence name="S" uid="S-1">
      <WaitStep name="w" time="1" uid="W-1"/>
      <FrobnicateStep name="frob" uid="F-1"/>
    </Sequence></TestSequence>`;
    const g = parse(xml, { rules, domParser });

    expect(g.nodes.get('F-1')?.shape).toBe('rect'); // renders
    expect(g.warnings.map((w) => w.code)).toEqual(['UNKNOWN_ELEMENT']); // and warns
    expect(g.warnings[0]?.uid).toBe('F-1');
    expect(g.edges).toHaveLength(1); // still wired into the flow
  });

  it('warns for a jump target that is not in the file', () => {
    const xml = `<TestSequence><Sequence name="S" uid="S-1">
      <GoTo name="g" stepUID="MISSING" uid="G-1"/>
    </Sequence></TestSequence>`;
    const g = parse(xml, { rules, domParser });
    expect(g.warnings.map((w) => w.code)).toContain('UNRESOLVED_TARGET');
    expect(g.warnings.find((w) => w.code === 'UNRESOLVED_TARGET')?.value).toBe('MISSING');
  });

  it('warns for an empty sequence', () => {
    const xml = `<TestSequence><Sequence name="Outer" uid="S-1">
      <WaitStep name="w" time="1" uid="W-1"/>
      <Sequence name="Empty" uid="S-2"/>
    </Sequence></TestSequence>`;
    const g = parse(xml, { rules, domParser });
    expect(g.warnings.map((w) => w.code)).toContain('EMPTY_CONTAINER');
    // The empty sequence is skipped rather than becoming a dead end.
    expect(g.edges).toHaveLength(0);
  });
});
