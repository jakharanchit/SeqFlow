import { describe, expect, test } from 'vitest';

import { parse } from '../src/core/parse';
import {
  collapsedFor,
  escapeLabel,
  mermaidId,
  mermaidModel,
  slug,
  toMermaid,
  toMermaidSplit,
  topLevelSequences,
} from '../src/emit/mermaid';
import { displayName } from '../src/core/ancestry';
import type { Graph, SeqNode } from '../src/core/types';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

/** Two leaves and one edge. Small enough to assert on a single line of output. */
function twoStep(label: string, style: 'solid' | 'dotted'): Graph {
  const leaf = (uid: string, name: string): SeqNode => ({
    uid,
    element: 'WaitStep',
    name,
    kind: 'action',
    shape: 'rect',
    parent: null,
    depth: 1,
    attrs: {},
  });
  return {
    root: 'a',
    entry: 'a',
    nodes: new Map([
      ['a', leaf('a', 'A')],
      ['b', leaf('b', 'B')],
    ]),
    edges: [{ src: 'a', dst: 'b', label, style, reason: 'criteria' }],
    containers: new Map(),
    warnings: [],
  };
}

/** Every id the text declares or references, in order. */
function idsIn(text: string): string[] {
  return [...text.matchAll(/\bn[A-Za-z0-9_]{30,}/g)].map((m) => m[0]);
}

/** Node *statements* — a declaration with a shape, not an edge reference. */
function declaredIds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/^\s*(n[A-Za-z0-9_]+)(?:\[\[|\[|\(|\{\{|\{)/gm)) {
    out.add(m[1] as string);
  }
  for (const m of text.matchAll(/^\s*subgraph (n[A-Za-z0-9_]+)\[/gm)) out.add(m[1] as string);
  return out;
}

describe('ids and labels', () => {
  test('a uid that starts with a digit becomes a legal id', () => {
    // 88 of the fixture's 133 uids do, which is why ids are prefixed at all.
    const digits = [...graph.nodes.keys()].filter((uid) => /^[0-9]/.test(uid));
    expect(digits.length).toBe(88);
    for (const uid of digits) expect(mermaidId(uid)).toMatch(/^n[A-Za-z0-9_]+$/);
  });

  test('ids are unique across the whole graph', () => {
    const ids = new Set([...graph.nodes.keys()].map(mermaidId));
    expect(ids.size).toBe(graph.nodes.size);
  });

  test('the four bracketed names survive escaping', () => {
    const hostile = [...graph.nodes.values()].filter((n) => n.name.includes('('));
    expect(hostile.map((n) => n.name)).toEqual([
      '6C Pulse (10s)',
      '12C Pulse (10s)',
      '24C Pulse (10s)',
      '36C Pulse (10s)',
    ]);
    const text = toMermaid(graph, rules);
    for (const node of hostile) expect(text).toContain(`"${node.name}"`);
  });

  test('quotes and angle brackets become Mermaid entities, not backslashes', () => {
    expect(escapeLabel('a "b" <c> & d')).toBe('a #quot;b#quot; #lt;c#gt; #amp; d');
  });
});

describe('flat mode', () => {
  const text = toMermaid(graph, rules);

  test('emits every node and every edge', () => {
    const model = mermaidModel(graph);
    expect(model.nodes.length).toBe(133);
    expect(model.edges.length).toBe(126);
  });

  test('the header names a direction', () => {
    expect(text.startsWith('flowchart TD\n')).toBe(true);
  });

  test('shapes follow the rule file', () => {
    const shapeOf = (element: string): string => {
      const node = [...graph.nodes.values()].find((n) => n.element === element);
      if (node === undefined) throw new Error(`no ${element} in the fixture`);
      const line = text
        .split('\n')
        .find((l) => l.trimStart().startsWith(`${mermaidId(node.uid)}[`) ||
          l.trimStart().startsWith(`${mermaidId(node.uid)}{`) ||
          l.trimStart().startsWith(`${mermaidId(node.uid)}(`));
      return (line ?? '').trim().slice(mermaidId(node.uid).length);
    };
    expect(shapeOf('ConditionStep').startsWith('{"')).toBe(true);
    expect(shapeOf('TestCriteriaEvaluation').startsWith('{{"')).toBe(true);
    expect(shapeOf('GoTo').startsWith('("')).toBe(true);
    expect(shapeOf('WaitStep').startsWith('["')).toBe(true);
  });

  test('every labelled edge in the graph reaches the text with its label', () => {
    // The fixture carries fail / true / false but no `pass`: all 16 of its
    // passStep values are the stale ones rule 4.2 gates out, so no pass edge
    // is ever emitted. Assert what the graph has, then check `pass` renders
    // by handing the emitter one.
    const labels = new Set(graph.edges.map((e) => e.label).filter((l) => l !== undefined));
    expect([...labels].sort()).toEqual(['fail', 'false', 'true']);
    for (const label of labels) expect(text).toContain(`"${label}"`);

    expect(toMermaid(twoStep('pass', 'solid'), rules)).toContain('|"pass"|');
    expect(toMermaid(twoStep('pass', 'dotted'), rules)).toContain('-. "pass" .->');
  });

  test('dotted edges use the dotted arrow', () => {
    const dotted = graph.edges.filter((e) => e.style === 'dotted');
    expect(dotted.length).toBeGreaterThan(0);
    for (const e of dotted) {
      expect(text).toContain(`${mermaidId(e.src)} -. "${e.label ?? ''}" .-> ${mermaidId(e.dst)}`);
    }
  });

  test('containers are subgraphs, and every one is closed', () => {
    const opens = text.match(/^\s*subgraph /gm)?.length ?? 0;
    const ends = text.match(/^\s*end$/gm)?.length ?? 0;
    expect(opens).toBe(26);
    expect(ends).toBe(26);
  });

  test('groups off drops the boxes but keeps every step', () => {
    const flat = toMermaid(graph, rules, { groups: false });
    expect(flat).not.toMatch(/subgraph/);
    expect(declaredIds(flat).size).toBe(107);
  });
});

describe('determinism — NFR-1', () => {
  test('two calls are byte-identical', () => {
    expect(toMermaid(graph, rules)).toBe(toMermaid(graph, rules));
  });

  test('two parses of the same bytes emit the same text', () => {
    const again = parse(fixtureXml, { rules, domParser });
    expect(toMermaid(again, rules)).toBe(toMermaid(graph, rules));
  });

  test('every mode is byte-deterministic', () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      const mode = { kind: 'depth' as const, depth };
      expect(toMermaid(graph, rules, { mode })).toBe(toMermaid(graph, rules, { mode }));
    }
    expect(toMermaid(graph, rules, { mode: { kind: 'overview' } })).toBe(
      toMermaid(graph, rules, { mode: { kind: 'overview' } }),
    );
  });

  test('no timestamp or other varying token in the body', () => {
    const text = toMermaid(graph, rules);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/generated/i);
  });
});

describe('depth modes — spec section 8', () => {
  // Measured against the fixture. depth 3 is the sharp row: 49 nodes but 58
  // edges, because folding lifts cross-sequence jumps onto fewer nodes
  // without merging them.
  const table: [number, number, number][] = [
    [1, 4, 3],
    [2, 15, 14],
    [3, 49, 58],
    [4, 121, 118],
    [5, 133, 126],
    [6, 133, 126],
  ];

  for (const [depth, nodes, edges] of table) {
    test(`depth ${depth} is ${nodes} nodes and ${edges} edges`, () => {
      const model = mermaidModel(graph, { kind: 'depth', depth });
      expect(model.nodes.length).toBe(nodes);
      expect(model.edges.length).toBe(edges);
    });
  }

  test('overview is depth 1', () => {
    expect(toMermaid(graph, rules, { mode: { kind: 'overview' } })).toBe(
      toMermaid(graph, rules, { mode: { kind: 'depth', depth: 1 } }),
    );
  });

  test('a folded sequence is one node carrying its step count', () => {
    const text = toMermaid(graph, rules, { mode: { kind: 'depth', depth: 2 } });
    const main = [...graph.nodes.values()].find((n) => n.name === 'Pulse 1 - 6C');
    expect(main).toBeDefined();
    expect(text).toContain(`${mermaidId(main!.uid)}[["Pulse 1 - 6C<br/>28 steps"]]`);
    // ...not as an empty subgraph.
    expect(text).not.toContain(`subgraph ${mermaidId(main!.uid)}`);
  });

  test('no emitted edge references a node the mode did not emit', () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      const mode = { kind: 'depth' as const, depth };
      const model = mermaidModel(graph, mode);
      const emitted = new Set(model.nodes.map((n) => n.uid));
      for (const e of model.edges) {
        expect(emitted.has(e.src)).toBe(true);
        expect(emitted.has(e.dst)).toBe(true);
      }
      // And the text agrees with the model.
      const text = toMermaid(graph, rules, { mode });
      const declared = declaredIds(text);
      for (const id of idsIn(text)) expect(declared.has(id)).toBe(true);
    }
  });

  test('depth 0 folds everything below the root', () => {
    expect(mermaidModel(graph, { kind: 'depth', depth: 0 }).nodes.length).toBe(1);
  });

  test('collapsedFor picks containers strictly deeper than N', () => {
    const set = collapsedFor(graph, { kind: 'depth', depth: 2 });
    for (const uid of set) expect(graph.nodes.get(uid)!.depth).toBeGreaterThan(2);
    expect(set.size).toBe(22);
  });
});

describe('split — one file per top-level sequence plus a linked overview', () => {
  const tops = topLevelSequences(graph);
  const files = toMermaidSplit(graph, rules, 'Sequence_XML');

  test('the fixture has three top-level sequences, so four files', () => {
    expect(tops.map(displayName)).toEqual(['Initialize', 'Main', 'Shutdown']);
    expect(files.map((f) => f.name)).toEqual([
      'Sequence_XML.mmd',
      'Sequence_XML.initialize.mmd',
      'Sequence_XML.main.mmd',
      'Sequence_XML.shutdown.mmd',
    ]);
  });

  test('the overview links to each of the others', () => {
    const overview = files[0]!;
    expect(overview.title).toBe('Overview');
    for (const name of ['initialize', 'main', 'shutdown']) {
      expect(overview.text).toContain(`href "Sequence_XML.${name}.mmd"`);
    }
  });

  test('a scoped file expands its own sequence and folds its siblings', () => {
    const main = tops.find((n) => n.name === 'Main')!;
    const model = mermaidModel(graph, { kind: 'scope', uid: main.uid });
    const emitted = new Set(model.nodes.map((n) => n.uid));
    // Every descendant of Main is present...
    for (const node of graph.nodes.values()) {
      let cursor = node.parent;
      let inside = false;
      while (cursor !== null) {
        if (cursor === main.uid) {
          inside = true;
          break;
        }
        cursor = graph.nodes.get(cursor)?.parent ?? null;
      }
      if (inside) expect(emitted.has(node.uid)).toBe(true);
    }
    // ...and the siblings are one node each.
    const initialize = tops.find((n) => n.name === 'Initialize')!;
    expect(emitted.has(initialize.uid)).toBe(true);
    for (const child of graph.containers.get(initialize.uid) ?? []) {
      expect(emitted.has(child)).toBe(false);
    }
  });

  test('every file is byte-deterministic and self-consistent', () => {
    const again = toMermaidSplit(graph, rules, 'Sequence_XML');
    expect(again.map((f) => f.text)).toEqual(files.map((f) => f.text));
    for (const file of files) {
      const declared = declaredIds(file.text);
      for (const id of idsIn(file.text)) expect(declared.has(id)).toBe(true);
    }
  });

  test('slug is filename-safe', () => {
    expect(slug('Pulse 1 - 6C')).toBe('pulse-1-6c');
    expect(slug('6C Pulse (10s)')).toBe('6c-pulse-10s');
    expect(slug('!!!')).toBe('sequence');
  });
});
