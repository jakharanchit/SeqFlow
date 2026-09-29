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
  type Sidecar,
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

/** A layout file as an earlier build saved it: every position, collapsed set sorted. */
function saved(): Sidecar {
  return {
    seqflow: SIDECAR_VERSION,
    file: 'Sequence_XML.xml',
    collapsed: [...collapsed].sort(),
    positions: Object.fromEntries(
      placed.map((n) => [n.id, [n.position.x, n.position.y] as [number, number]]),
    ),
  };
}

describe('round trip', () => {
  test('parse, apply — every position comes back', () => {
    const back = parseSidecar(JSON.stringify(saved(), null, 2));
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
    const sidecar = saved();
    sidecar.positions['NOT-IN-THIS-FILE'] = [10, 20];
    sidecar.positions['ALSO-GONE'] = [30, 40];

    const applied = applySidecar(placed, sidecar);
    expect(applied.unknown).toEqual(['ALSO-GONE', 'NOT-IN-THIS-FILE']);
    expect(applied.placed).toBe(133);
    expect(applied.nodes.length).toBe(133);
  });

  test('a step with no saved position keeps the automatic one', () => {
    const sidecar = saved();
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

  test('an old sidecar carrying a "mode" key is read without complaint', () => {
    // Compact mode is gone; an old sidecar's leftover "mode" field is simply
    // ignored rather than rejected, which is the same tolerance one bad
    // "collapsed" entry or one bad position gets elsewhere in this file.
    expect(() =>
      parseSidecar(`{"seqflow":${SIDECAR_VERSION},"mode":"compact","positions":{}}`),
    ).not.toThrow();
  });

  test('a non-string in collapsed is skipped', () => {
    const back = parseSidecar(
      `{"seqflow":${SIDECAR_VERSION},"collapsed":["a",7,null,"b"],"positions":{}}`,
    );
    expect(back.collapsed).toEqual(['a', 'b']);
  });
});
