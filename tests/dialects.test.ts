/**
 * The rules that let an unfamiliar document render at all.
 *
 * Every case here is synthetic on purpose. These are properties of the parser,
 * not of any file: a corpus of real XML would test them by coincidence, and the
 * day a fixture stopped exercising one the test would keep passing. Element
 * names below are deliberately nonsense so nothing can be mistaken for schema
 * knowledge leaking into the tests.
 *
 * The four faults these pin all had the same symptom on the first unfamiliar
 * file — an empty diagram and an exit code of zero.
 */

import { describe, expect, test } from 'vitest';

import { ParseError, parse } from '../src/core/parse';
import { loadRules } from '../src/core/rules';
import type { Graph, Rules } from '../src/core/types';
import { domParser } from './helpers';

/** A minimal rule file: one container, one leaf, one gated jump. */
const dialect: Rules = loadRules(`
version: 1
containers: [Box]
ignore: [Notes, Note]
steps: [Do, Ask]
inspector_children:
  Ask: [Prompt]
shapes:  {default: rect}
kinds:   {default: action}
edges:
  - when:   {onNo: "jump"}
    target: noStep
    label:  "no"
    style:  solid
    reason: branch
durations:
  waits: [secs]
loops:
  Repeat: {count: times}
`);

function build(xml: string): Graph {
  return parse(xml, { rules: dialect, domParser });
}

describe('a uid-less container is transparent', () => {
  const graph = build(`<Doc>
      <Box>
        <Box uid="A" name="Outer">
          <Do uid="A1" name="one"/>
          <Do uid="A2" name="two"/>
        </Box>
      </Box>
    </Doc>`);

  test('contributes no node of its own', () => {
    // It has no uid, so it can have no identity, and IDs are never derived
    // (invariant 3). Dropping its subtree along with it is the bug.
    expect(graph.nodes.size).toBe(3);
    expect(graph.nodes.has('A')).toBe(true);
  });

  test('its children walk into the enclosing parent', () => {
    expect(graph.nodes.get('A')?.parent).toBe(null);
    expect(graph.nodes.get('A')?.depth).toBe(1);
    expect(graph.root).toBe('A');
  });

  test('and raises no warning — a wrapper is not an unknown element', () => {
    expect(graph.warnings).toEqual([]);
  });
});

describe('an element that holds steps is a container, whatever the rules say', () => {
  const graph = build(`<Doc>
      <Box uid="A" name="Outer">
        <Do uid="A1" name="before"/>
        <Repeat uid="L" name="loop" times="4">
          <Do uid="L1" name="inner one"/>
          <Do uid="L2" name="inner two"/>
        </Repeat>
        <Do uid="A2" name="after"/>
      </Box>
    </Doc>`);

  test('its children are not lost', () => {
    // The invariant-7 failure this exists to close: before the fix `Repeat` was
    // a leaf, its two children were never visited, and the flow ran straight
    // past them with nothing said.
    expect([...graph.nodes.keys()].sort()).toEqual(['A', 'A1', 'A2', 'L', 'L1', 'L2']);
    expect(graph.containers.get('L')).toEqual(['L1', 'L2']);
  });

  test('the flow runs through them, not around them', () => {
    const forward = graph.edges.filter((e) => e.reason === 'fallthrough');
    expect(forward.map((e) => `${e.src}->${e.dst}`).sort()).toEqual([
      'A1->L1',
      'L1->L2',
      'L2->A2',
    ]);
  });

  test('and it says so, rather than inferring quietly', () => {
    expect(graph.warnings.map((w) => w.code)).toEqual(['UNKNOWN_CONTAINER']);
    expect(graph.warnings[0]?.message).toContain('containers');
    expect(graph.warnings[0]?.uid).toBe('L');
  });

  test('a jump into it lands on its first leaf, not on the box', () => {
    // Rule 4.3's container descent, applied to a container the rule file does
    // not name. A target that resolved to the group box would point the edge at
    // something that carries no flow.
    const jumped = build(`<Doc>
        <Box uid="A" name="Outer">
          <Ask uid="Q" name="ask" onNo="jump" noStep="L"/>
          <Repeat uid="L" name="loop" times="2">
            <Do uid="L1" name="first"/>
            <Do uid="L2" name="second"/>
          </Repeat>
        </Box>
      </Doc>`);
    const branch = jumped.edges.find((e) => e.reason === 'branch');
    expect(branch?.dst).toBe('L1');
  });
});

describe('a loop back edge', () => {
  const graph = build(`<Doc>
      <Box uid="A" name="Outer">
        <Repeat uid="L" name="loop" times="4">
          <Do uid="L1" name="one" secs="5"/>
          <Do uid="L2" name="two" secs="5"/>
        </Repeat>
        <Do uid="A2" name="after"/>
      </Box>
    </Doc>`);

  test('runs from the last leaf to the first, labelled with the count', () => {
    const back = graph.edges.filter((e) => e.reason === 'loop');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ src: 'L2', dst: 'L1', label: '×4', style: 'dotted' });
  });

  test('is not drawn for a single-step loop', () => {
    // It would be a self-edge, which reads as a mistake rather than a repeat.
    const one = build(`<Doc><Box uid="A"><Repeat uid="L" times="9">
        <Do uid="L1" name="only"/></Repeat></Box></Doc>`);
    expect(one.edges.filter((e) => e.reason === 'loop')).toHaveLength(0);
  });

  test('is not drawn when the rule file names no loop', () => {
    const plain = loadRules(`
version: 1
containers: [Box, Repeat]
shapes: {default: rect}
kinds:  {default: action}
edges:
  - when: {onNo: "jump"}
    target: noStep
    reason: branch
`);
    const none = parse(
      `<Doc><Box uid="A"><Repeat uid="L" times="4">
        <Do uid="L1"/><Do uid="L2"/></Repeat></Box></Doc>`,
      { rules: plain, domParser },
    );
    expect(none.edges.filter((e) => e.reason === 'loop')).toHaveLength(0);
  });
});

describe('inspector children are found at any depth', () => {
  test('through a wrapper that is not itself a node', () => {
    // <Ask><Notes><Prompt/></Notes></Ask>: the element carrying the detail is
    // one level below the one the rule file names.
    const graph = build(`<Doc><Box uid="A">
        <Ask uid="Q" name="ask"><Notes><Prompt text="carry on?"/></Notes></Ask>
      </Box></Doc>`);
    expect(graph.nodes.get('Q')?.childAttrs?.['Prompt']).toEqual([{ text: 'carry on?' }]);
  });

  test('but never across into a step of its own', () => {
    // A nested step's detail belongs to that step, not to its ancestor.
    const graph = build(`<Doc><Box uid="A">
        <Ask uid="Q" name="outer">
          <Box uid="B"><Ask uid="R"><Prompt text="inner"/></Ask></Box>
        </Ask>
      </Box></Doc>`);
    expect(graph.nodes.get('Q')?.childAttrs).toBeUndefined();
  });
});

describe('a document that yields nothing is an error, not an empty graph', () => {
  test('when no child can start a flow', () => {
    // The original symptom: `flowchart TD` and an exit code of 0, which nothing
    // downstream can tell from a file that genuinely has no steps.
    expect(() => build('<Doc><Sidecar lower="0"/><Sidecar lower="1"/></Doc>')).toThrow(
      ParseError,
    );
    expect(() => build('<Doc><Sidecar lower="0"/></Doc>')).toThrow(/Sidecar/);
  });

  test('and it names the document element', () => {
    expect(() => build('<Doc/>')).toThrow(/<Doc>/);
  });

  test('but a file with one step is fine', () => {
    expect(build('<Doc><Box uid="A"><Do uid="A1"/></Box></Doc>').nodes.size).toBe(2);
  });
});

describe('data alongside the sequence is not a second root', () => {
  const graph = build(`<Doc>
      <Box uid="A" name="Sequence"><Do uid="A1" name="one"/></Box>
      <Readings lower="0"><Sample t="0" v="20"/></Readings>
    </Doc>`);

  test('the step tree is numbered as if it were alone', () => {
    // Counting the sidecar as a root would number the real one "1" and prefix
    // every step in the document.
    expect(graph.nodes.get('A')?.stepNumber).toBe('');
    expect(graph.nodes.get('A1')?.stepNumber).toBe('1');
  });
});
