/**
 * Edges go around the steps they skip, not through them.
 *
 * React Flow's built-in edges route themselves handle to handle and know
 * nothing about what lies between. On a flowchart that is mostly one long
 * column that came out as a straight vertical line down the middle of every
 * node a jump skipped — measured on the gas-analyzer corpus, the false branch
 * ran 1103 px at a constant x, straight through twelve steps. ELK had routed
 * the same edge out to the side and back the whole time, and the SVG export had
 * been drawing that route, so the picture on screen and the picture in the
 * export disagreed about the one thing a flowchart is for.
 *
 * These tests are about the geometry rather than about React, because the
 * geometry is the part that can be wrong silently: the canvas now draws
 * `edgeRoutes`, so asserting the routes are sane asserts what it draws.
 */

import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { toFlow, type FlowNode } from '../src/emit/flow';
import {
  applyLayout,
  edgeRoutes,
  fromElk,
  toElk,
  type ElkLike,
  type Point,
} from '../src/layout/elkGraph';
import { domParser, fixtureXml, gasXml, rules } from './helpers';

const elk = new ELK() as ElkLike;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  group: boolean;
}

/** Lay a file out and return its routes beside absolute node boxes. */
async function layoutOf(xml: string): Promise<{
  routes: Map<string, Point[]>;
  boxes: Box[];
  edges: { id: string; source: string; target: string }[];
}> {
  const graph = parse(xml, { rules, domParser });
  const flow = toFlow(graph, rules);
  const result = await elk.layout(toElk(flow.nodes, flow.edges, 'grouped'));
  const placed = applyLayout(flow.nodes, fromElk(result));

  const byId = new Map(placed.map((n) => [n.id, n]));
  const absolute = (node: FlowNode): Box => {
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
    return { id: node.id, x, y, w: node.width, h: node.height, group: node.type === 'seqGroup' };
  };

  return {
    routes: edgeRoutes(result),
    boxes: placed.map(absolute),
    edges: flow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** Points sampled along a polyline, evenly by segment. */
function sample(points: readonly Point[], per = 12): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let s = 1; s < per; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / per, y: a.y + ((b.y - a.y) * s) / per });
    }
  }
  return out;
}

/** Step boxes the route passes through that are not its own endpoints. */
function crossings(
  points: readonly Point[],
  edge: { source: string; target: string },
  boxes: readonly Box[],
): string[] {
  const hit = new Set<string>();
  // A 3px inset, so a route that runs along a node's border or docks on its
  // edge is not counted as passing through it.
  const inside = (p: Point, b: Box): boolean =>
    p.x > b.x + 3 && p.x < b.x + b.w - 3 && p.y > b.y + 3 && p.y < b.y + b.h - 3;

  for (const p of sample(points)) {
    for (const b of boxes) {
      // Group boxes are meant to be crossed - an edge into a sequence has to
      // enter it. Only leaf steps count.
      if (b.group || b.id === edge.source || b.id === edge.target) continue;
      if (inside(p, b)) hit.add(b.id);
    }
  }
  return [...hit];
}

for (const [name, xml] of [
  ['the battery fixture', fixtureXml],
  ['the gas-analyzer fixture', gasXml],
] as const) {
  describe(name, () => {
    it('routes every edge, so the canvas never has to invent one', async () => {
      const { routes, edges } = await layoutOf(xml);
      const missing = edges.filter((e) => !routes.has(e.id)).map((e) => e.id);
      expect(missing).toEqual([]);
    });

    it('draws no edge through a step it is not attached to', async () => {
      const { routes, boxes, edges } = await layoutOf(xml);
      const through = edges
        .map((e) => ({ id: e.id, hit: crossings(routes.get(e.id) ?? [], e, boxes) }))
        .filter((r) => r.hit.length > 0);
      expect(through).toEqual([]);
    });
  });
}

describe('the jump that showed the problem', () => {
  it('leaves the column rather than running down it', async () => {
    // In the gas-analyzer corpus a decision skips a whole calibration sequence.
    // A straight line between its two ends passes through everything between;
    // ELK's route steps out sideways instead, and that is the difference this
    // whole edge type exists for.
    const { routes, boxes, edges } = await layoutOf(gasXml);
    const longest = edges
      .map((e) => ({ ...e, pts: routes.get(e.id) ?? [] }))
      .filter((e) => e.pts.length > 1)
      .sort(
        (a, b) =>
          Math.abs(b.pts[b.pts.length - 1]!.y - b.pts[0]!.y) -
          Math.abs(a.pts[a.pts.length - 1]!.y - a.pts[0]!.y),
      )[0]!;

    // It changes lane: more than one distinct x means it stepped aside.
    const lanes = new Set(longest.pts.map((p) => Math.round(p.x)));
    expect(lanes.size).toBeGreaterThan(1);

    // And the straight line it replaced would have gone through real steps —
    // which is what makes the assertion above worth making.
    const a = longest.pts[0]!;
    const b = longest.pts[longest.pts.length - 1]!;
    const straight = crossings([a, b], longest, boxes);
    expect(straight.length).toBeGreaterThan(0);
    expect(crossings(longest.pts, longest, boxes)).toEqual([]);
  });
});
