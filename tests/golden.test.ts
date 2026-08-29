/**
 * Golden-file test — the regression guard for everything downstream.
 *
 * `fixtures/expected-graph.json` was computed from the fixture by applying the
 * semantic rules in spec section 4. Comparison is structural, not by string
 * equality: attribute order within `attrs` is not significant, and each node is
 * compared on the keys the golden file actually defines. (The golden was
 * serialised without `childAttrs`; the parser emits it because the inspector
 * needs it — see PHASE1-TASKS task 10.)
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import type { SeqEdge, SeqNode } from '../src/core/types';
import { domParser, fixtureXml, read, rules } from './helpers';

interface GoldenGraph {
  root: string;
  entry: string;
  nodes: Record<string, Record<string, unknown>>;
  edges: SeqEdge[];
  containers: Record<string, string[]>;
  warnings: unknown[];
}

const golden = JSON.parse(read('fixtures', 'expected-graph.json')) as GoldenGraph;
const graph = parse(fixtureXml, { rules, domParser });

/** Sort object keys so `attrs` compares by content, not by XML order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, canonical(src[k])]),
    );
  }
  return value;
}

/** The golden edge shape spells an absent label as null. */
function edgeKey(e: SeqEdge): string {
  return JSON.stringify([e.src, e.reason, e.dst, e.label ?? null, e.style]);
}

describe('golden fixture', () => {
  it('matches root and entry', () => {
    expect(graph.root).toBe(golden.root);
    expect(graph.entry).toBe(golden.entry);
  });

  it('produces the same node set', () => {
    expect([...graph.nodes.keys()].sort()).toEqual(Object.keys(golden.nodes).sort());
  });

  it('matches every node on every field the golden file defines', () => {
    for (const [uid, want] of Object.entries(golden.nodes)) {
      const got = graph.nodes.get(uid) as unknown as Record<string, unknown>;
      expect(got, `no node for ${uid}`).toBeDefined();

      const narrowed = Object.fromEntries(Object.keys(want).map((k) => [k, got[k]]));
      expect(canonical(narrowed), `node ${uid} (${String(want['name'])})`).toEqual(
        canonical(want),
      );
    }
  });

  it('produces the same container map, in document order', () => {
    expect(Object.fromEntries(graph.containers)).toEqual(golden.containers);
  });

  it('produces the same edge set', () => {
    expect(graph.edges.map(edgeKey)).toEqual(golden.edges.map(edgeKey));
  });

  it('produces the same warnings', () => {
    expect(graph.warnings).toEqual(golden.warnings);
  });

  it('holds the counts CLAUDE.md pins down', () => {
    const nodes = [...graph.nodes.values()] as SeqNode[];
    const byReason = graph.edges.reduce<Record<string, number>>((acc, e) => {
      acc[e.reason] = (acc[e.reason] ?? 0) + 1;
      return acc;
    }, {});

    expect(nodes).toHaveLength(133);
    expect(nodes.filter((n) => n.kind !== 'container')).toHaveLength(107);
    expect(nodes.filter((n) => n.kind === 'container')).toHaveLength(26);
    expect(graph.edges).toHaveLength(126);
    expect(byReason).toEqual({ fallthrough: 100, criteria: 16, branch: 8, goto: 2 });
    expect(graph.warnings).toHaveLength(0);
  });
});
