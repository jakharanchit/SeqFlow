/**
 * Every edge touching a diamond touches one of its two apexes.
 *
 * A diamond is inscribed in its box, so the only points it has on the top and
 * bottom edges of that box are the apexes. ELK, left alone, spreads a node's
 * attach points along the whole edge: measured on the battery fixture, the two
 * branch exits of a `ConditionStep` left the bottom edge 28.5 px either side of
 * centre — in the notch beside the shape, where the line reads as detached from
 * the diamond it belongs to.
 *
 * `apexPorts` in layout/elkGraph.ts pins them. This is the geometry test for
 * it, and it is the kind that can only fail silently otherwise: the layout
 * type-checks, renders and exports either way, and is wrong in one of them.
 */

import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { toFlow, type FlowNode } from '../src/emit/flow';
import { applyLayout, edgeRoutes, fromElk, toElk, type ElkLike } from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const elk = new ELK() as ElkLike;

async function attachments(xml: string) {
  const graph = parse(xml, { rules, domParser });
  const flow = toFlow(graph, rules);
  const result = await elk.layout(toElk(flow.nodes, flow.edges));
  const placed = applyLayout(flow.nodes, fromElk(result));
  const routes = edgeRoutes(result);

  const byId = new Map(placed.map((n) => [n.id, n]));
  const absolute = (node: FlowNode): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    let cursor: FlowNode | undefined = node;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      x += cursor.position.x;
      y += cursor.position.y;
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
    return { x, y };
  };

  /** Distance from a point to the nearest of a diamond's four apexes. */
  const toApex = (
    point: { x: number; y: number },
    at: { x: number; y: number },
    w: number,
    h: number,
  ): number =>
    Math.min(
      ...[
        { x: at.x + w / 2, y: at.y },
        { x: at.x + w / 2, y: at.y + h },
        { x: at.x + w, y: at.y + h / 2 },
        { x: at.x, y: at.y + h / 2 },
      ].map((a) => Math.hypot(point.x - a.x, point.y - a.y)),
    );

  const out: { off: number; side: string }[] = [];
  for (const edge of flow.edges) {
    const route = routes.get(edge.id);
    if (route === undefined) continue;
    for (const [point, id] of [
      [route[0]!, edge.source],
      [route[route.length - 1]!, edge.target],
    ] as const) {
      const node = byId.get(id);
      if (node === undefined || node.data.shape !== 'diamond') continue;
      const at = absolute(node);
      const w = node.width;
      const h = node.height;
      const side =
        point.y === at.y
          ? 'n'
          : point.y === at.y + h
            ? 's'
            : point.x === at.x + w
              ? 'e'
              : point.x === at.x
                ? 'w'
                : '?';
      out.push({ off: toApex(point, at, w, h), side });
    }
  }
  return out;
}

describe('diamond apex ports', () => {
  it('attaches every battery-fixture edge to an apex', async () => {
    const found = await attachments(fixtureXml);
    // 12 diamonds: one inbound and two branch exits each, less the four whose
    // exits are the only jumps out of their pulse. The count is here so a
    // change that stops finding diamonds at all cannot pass this vacuously.
    expect(found.length).toBe(28);
    for (const { off } of found) expect(off).toBeCloseTo(0, 6);

    // And they are spread, not stacked: every inbound edge on the north apex,
    // each diamond's first exit south and its second east. Asserting the sides
    // is what pins the convention — the distances above hold either way.
    const sides = found.reduce<Record<string, number>>((acc, f) => {
      acc[f.side] = (acc[f.side] ?? 0) + 1;
      return acc;
    }, {});
    expect(sides).toEqual({ n: 12, s: 12, e: 4 });
  }, 60_000);

});
