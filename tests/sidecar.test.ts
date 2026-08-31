/**
 * The layout sidecar — spec 7.8, Phase 3 task 6.
 *
 * The interesting cases are all about disagreement between a saved arrangement
 * and the file it is applied to: a uid the sequence no longer has, and a step
 * the sidecar never saw. Neither may fail the load.
 */

import { describe, expect, test } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { toFlow } from '../src/emit/flow';
import {
  SIDECAR_VERSION,
  SidecarError,
  applySidecar,
  parseSidecar,
  serialiseSidecar,
  sidecarName,
  toSidecar,
} from '../src/emit/sidecar';
import { applyLayout, fromElk, toElk, type ElkLike } from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const flow = toFlow(graph, rules);
const elk = new ELK() as ElkLike;
const placed = applyLayout(flow.nodes, fromElk(await elk.layout(toElk(flow.nodes, flow.edges))));

const collapsed = new Set(
  [...graph.containers.keys()].filter((uid) => (graph.nodes.get(uid)?.depth ?? 0) > 3),
);

describe('writing', () => {
  const sidecar = toSidecar('Sequence_XML.xml', 'grouped', collapsed, placed);
  const text = serialiseSidecar(sidecar);

  test('every visible node gets a position', () => {
    expect(Object.keys(sidecar.positions).length).toBe(133);
    expect(sidecar.collapsed.length).toBe(collapsed.size);
    expect(sidecar.mode).toBe('grouped');
    expect(sidecar.seqflow).toBe(SIDECAR_VERSION);
  });

  test('133 positions are about 8 KB, so nothing is worth omitting', () => {
    expect(text.length).toBeGreaterThan(5_000);
    expect(text.length).toBeLessThan(14_000);
  });

  test('keys are sorted, so two saves of one arrangement are the same bytes', () => {
    const again = serialiseSidecar(toSidecar('Sequence_XML.xml', 'grouped', collapsed, placed));
    expect(again).toBe(text);
    const uids = Object.keys(sidecar.positions);
    expect(uids).toEqual([...uids].sort());
    expect(sidecar.collapsed).toEqual([...sidecar.collapsed].sort());
  });

  test('it is named beside the sequence', () => {
    expect(sidecarName('Sequence_XML')).toBe('Sequence_XML.layout.json');
  });

  test('it records positions and nothing from the sequence itself', () => {
    // Invariant 4: this is the only file the tool writes, and it is not XML.
    expect(text).not.toContain('<');
    expect(text).not.toContain('WaitStep');
  });
});

describe('round trip', () => {
  test('save, parse, apply — every position comes back', () => {
    const text = serialiseSidecar(toSidecar('Sequence_XML.xml', 'compact', collapsed, placed));
    const back = parseSidecar(text);
    expect(back.mode).toBe('compact');
    expect(new Set(back.collapsed)).toEqual(collapsed);

    const applied = applySidecar(
      placed.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
      back,
    );
    expect(applied.placed).toBe(133);
    expect(applied.unknown).toEqual([]);
    expect(applied.unplaced).toEqual([]);
    for (const node of applied.nodes) {
      const original = placed.find((n) => n.id === node.id)!;
      expect(node.position.x).toBeCloseTo(original.position.x, 1);
      expect(node.position.y).toBeCloseTo(original.position.y, 1);
    }
  });
});

describe('disagreement', () => {
  test('a uid the sequence no longer has is dropped and reported', () => {
    const sidecar = toSidecar('Sequence_XML.xml', 'grouped', collapsed, placed);
    sidecar.positions['NOT-IN-THIS-FILE'] = [10, 20];
    sidecar.positions['ALSO-GONE'] = [30, 40];

    const applied = applySidecar(placed, sidecar);
    expect(applied.unknown).toEqual(['ALSO-GONE', 'NOT-IN-THIS-FILE']);
    expect(applied.placed).toBe(133);
    expect(applied.nodes.length).toBe(133);
  });

  test('a step with no saved position keeps the automatic one', () => {
    const sidecar = toSidecar('Sequence_XML.xml', 'grouped', collapsed, placed);
    const orphan = placed[5]!;
    delete sidecar.positions[orphan.id];

    const applied = applySidecar(placed, sidecar);
    expect(applied.unplaced).toEqual([orphan.id]);
    expect(applied.placed).toBe(132);
    const kept = applied.nodes.find((n) => n.id === orphan.id)!;
    expect(kept.position).toEqual(orphan.position);
  });

  test('a sidecar from a different sequence loads what it can', () => {
    // The extreme case of the above: nothing matches at all.
    const foreign = {
      seqflow: SIDECAR_VERSION,
      file: 'Other.xml',
      mode: 'grouped',
      collapsed: [],
      positions: { 'A-B-C': [1, 2] as [number, number] },
    };
    const applied = applySidecar(placed, foreign);
    expect(applied.placed).toBe(0);
    expect(applied.unknown).toEqual(['A-B-C']);
    expect(applied.unplaced.length).toBe(133);
    expect(applied.nodes).toEqual(placed);
  });
});

describe('reading a hostile file', () => {
  test('not JSON', () => {
    expect(() => parseSidecar('<TestSequence/>')).toThrow(SidecarError);
  });

  test('JSON, but not a seqflow layout — the message says which', () => {
    expect(() => parseSidecar('{"hello":1}')).toThrow(/not a seqflow layout file/);
    expect(() => parseSidecar('[]')).toThrow(SidecarError);
    expect(() => parseSidecar('null')).toThrow(/not an object/);
  });

  test('a future version is refused rather than half-read', () => {
    expect(() => parseSidecar('{"seqflow":99,"positions":{}}')).toThrow(SidecarError);
  });

  test('no positions object', () => {
    expect(() => parseSidecar(`{"seqflow":${SIDECAR_VERSION}}`)).toThrow(/no "positions" object/);
  });

  test('one malformed entry does not lose the rest', () => {
    const back = parseSidecar(
      `{"seqflow":${SIDECAR_VERSION},"positions":{"a":[1,2],"b":"nope","c":[3],"d":[null,1],"e":[4,5]}}`,
    );
    expect(Object.keys(back.positions)).toEqual(['a', 'e']);
  });

  test('an unknown mode falls back to grouped rather than to nothing', () => {
    const back = parseSidecar(`{"seqflow":${SIDECAR_VERSION},"mode":"spiral","positions":{}}`);
    expect(back.mode).toBe('grouped');
  });

  test('a non-string in collapsed is skipped', () => {
    const back = parseSidecar(
      `{"seqflow":${SIDECAR_VERSION},"collapsed":["a",7,null,"b"],"positions":{}}`,
    );
    expect(back.collapsed).toEqual(['a', 'b']);
  });
});
