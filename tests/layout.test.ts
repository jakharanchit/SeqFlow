/**
 * Layout quality and speed, against the real 133-node graph.
 *
 * PHASE1-TASKS task 7 asks for this before any UI is built around it: layout
 * on a graph with 16-way convergence is the thing most likely to disappoint,
 * and finding out here is cheap. Runs the same ELK build the app uses, on the
 * main thread.
 */

import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { toFlow } from '../src/emit/flow';
import {
  applyLayout,
  fitZoom,
  fromElk,
  graphBounds,
  nodesForMode,
  toElk,
  type ElkLike,
} from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const flow = toFlow(graph, rules);
const elk = new ELK() as ElkLike;

const started = Date.now();
const result = await elk.layout(toElk(flow.nodes, flow.edges));
const elapsed = Date.now() - started;

const layout = fromElk(result);
const placed = applyLayout(flow.nodes, layout);
const byId = new Map(placed.map((n) => [n.id, n]));

/** Absolute position, walking up the parent chain. */
function absolute(id: string): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur = byId.get(id);
  while (cur !== undefined) {
    x += cur.position.x;
    y += cur.position.y;
    cur = cur.parentId === undefined ? undefined : byId.get(cur.parentId);
  }
  return { x, y };
}

describe('ELK layout', () => {
  it('lays out all 133 nodes in under 2 s', () => {
    expect(layout.size).toBe(133);
    expect(elapsed).toBeLessThan(2000);
  });

  it('gives every node a real size and position', () => {
    for (const n of placed) {
      expect(Number.isFinite(n.position.x), `${n.data.label} x`).toBe(true);
      expect(Number.isFinite(n.position.y), `${n.data.label} y`).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it('sizes each group to hold its children', () => {
    for (const group of placed.filter((n) => n.type === 'seqGroup')) {
      const kids = placed.filter((n) => n.parentId === group.id);
      if (kids.length === 0) continue;
      for (const kid of kids) {
        expect(kid.position.x, `${kid.data.label} left of ${group.data.label}`).toBeGreaterThanOrEqual(0);
        expect(kid.position.x + kid.width).toBeLessThanOrEqual(group.width + 1);
        expect(kid.position.y + kid.height).toBeLessThanOrEqual(group.height + 1);
      }
    }
  });

  it('reads top-down: the entry step sits above the terminal', () => {
    const entry = absolute(graph.entry);
    const terminal = [...graph.nodes.values()].find((n) => n.name === 'Stop Recording')!;
    expect(entry.y).toBeLessThan(absolute(terminal.uid).y);
  });

  it('does not stack the four Pulse blocks into one column', () => {
    const pulses = [...graph.nodes.values()]
      .filter((n) => n.kind === 'container' && n.name.startsWith('Pulse '))
      .map((n) => ({ name: n.name, ...absolute(n.uid), box: byId.get(n.uid)! }));

    expect(pulses).toHaveLength(4);
    // Each Pulse is a real block, not a degenerate strip.
    for (const p of pulses) {
      expect(p.box.width).toBeGreaterThan(200);
      expect(p.box.height).toBeGreaterThan(200);
    }
    // And they are laid out as distinct blocks, not overlapping.
    for (let i = 0; i < pulses.length; i++) {
      for (let j = i + 1; j < pulses.length; j++) {
        const a = pulses[i]!;
        const b = pulses[j]!;
        const overlaps =
          a.x < b.x + b.box.width &&
          b.x < a.x + a.box.width &&
          a.y < b.y + b.box.height &&
          b.y < a.y + a.box.height;
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  it('keeps the abort terminal clear of the main chain', () => {
    // 16 edges converge here. If ELK has placed it inside the flow rather than
    // off to one side, the diagram is unreadable.
    const abortSeq = [...graph.nodes.values()].find(
      (n) => n.kind === 'container' && n.name === 'Abort Sequence',
    )!;
    const abort = absolute(abortSeq.uid);
    const mainSeq = [...graph.nodes.values()].find(
      (n) => n.kind === 'container' && n.name === 'Main',
    )!;
    const main = absolute(mainSeq.uid);
    const mainBox = byId.get(mainSeq.uid)!;

    const horizontallyClear = abort.x >= main.x + mainBox.width || abort.x + byId.get(abortSeq.uid)!.width <= main.x;
    const verticallyClear = abort.y >= main.y + mainBox.height;
    expect(horizontallyClear || verticallyClear).toBe(true);
  });
});

describe('compact layout mode', () => {
  it('wraps the chain into a readable aspect ratio', async () => {
    // Task 7 asks that the Pulse blocks not read as one long chain. They are
    // genuinely sequential, so `grouped` stacks them; `compact` wraps the same
    // chain into columns without changing a single edge.
    const flat = nodesForMode(flow.nodes, 'compact');
    const compact = await elk.layout(toElk(flat, flow.edges, 'compact'));

    const tall = (result.height ?? 0) / (result.width ?? 1);
    const wide = (compact.height ?? 0) / (compact.width ?? 1);
    expect(tall).toBeGreaterThan(4); // grouped: one long column
    expect(wide).toBeLessThan(1.5); // compact: columns side by side
  });

  it('keeps every leaf and drops the group boxes', () => {
    const flat = nodesForMode(flow.nodes, 'compact');
    expect(flat).toHaveLength(107);
    expect(flat.every((n) => n.parentId === undefined)).toBe(true);
    expect(flat.some((n) => n.type === 'seqGroup')).toBe(false);
  });

  it('lays the same edges out in both modes', () => {
    const flat = nodesForMode(flow.nodes, 'compact');
    const req = toElk(flat, flow.edges, 'compact');
    expect(req.edges).toHaveLength(126);
  });
});

describe('fit geometry', () => {
  it('measures the graph extent through parent-relative positions', () => {
    const box = graphBounds(placed)!;
    expect(box).not.toBeNull();
    // Matches the top-level extent the canvas has to frame.
    let width = 0;
    let height = 0;
    for (const n of placed) {
      if (n.parentId !== undefined) continue;
      width = Math.max(width, n.position.x + n.width);
      height = Math.max(height, n.position.y + n.height);
    }
    expect(box.x + box.width).toBeCloseTo(width, 0);
    expect(box.y + box.height).toBeCloseTo(height, 0);
    expect(box.height).toBeGreaterThan(6000);
  });

  it('returns null for an empty graph rather than an infinite box', () => {
    expect(graphBounds([])).toBeNull();
  });

  it('fits the extent into a viewport, clamped to the zoom limits', () => {
    const box = { x: 0, y: 0, width: 1000, height: 500 };
    // Height-bound: 500 * 1.12 = 560 into 280 is 0.5; width gives 0.8928.
    expect(fitZoom(box, 1000, 280, 0.06, 0.02, 2.5)).toBeCloseTo(0.5, 3);
    // A tiny graph is capped rather than blown up past the canvas maximum.
    expect(fitZoom({ x: 0, y: 0, width: 10, height: 10 }, 1000, 1000, 0.06, 0.02, 2.5)).toBe(2.5);
    // A huge one bottoms out at the minimum.
    expect(fitZoom({ x: 0, y: 0, width: 1e6, height: 1e6 }, 100, 100, 0.06, 0.02, 2.5)).toBe(0.02);
  });

  it('survives a broken parent chain instead of looping', () => {
    const orphan = placed.map((n) => (n.id === placed[1]!.id ? { ...n, parentId: n.id } : n));
    expect(graphBounds(orphan)).not.toBeNull();
  });
});
