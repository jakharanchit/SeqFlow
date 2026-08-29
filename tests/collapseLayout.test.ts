/**
 * PHASE2-TASKS task 5: collapsing the four Pulse sequences must make the
 * grouped layout legible, and every toggle must stay inside the 2 s budget
 * (NFR-5). Both are measurable without a browser, so they are measured here.
 */

import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';

import { parse } from '../src/core/parse';
import { asGraph, visibleGraph } from '../src/emit/collapse';
import { toFlow } from '../src/emit/flow';
import { applyLayout, fromElk, toElk, type ElkLike } from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const elk = new ELK() as ElkLike;

const pulses = [...graph.nodes.values()]
  .filter((n) => n.kind === 'container' && n.name.startsWith('Pulse '))
  .map((n) => n.uid);

interface Run {
  width: number;
  height: number;
  elapsed: number;
  nodes: number;
}

async function layoutCollapsed(collapsed: Set<string>): Promise<Run> {
  const view = visibleGraph(graph, collapsed);
  const flow = toFlow(asGraph(graph, view), rules, { collapsedCounts: view.collapsedCounts });
  const started = Date.now();
  const result = await elk.layout(toElk(flow.nodes, flow.edges, 'grouped'));
  const elapsed = Date.now() - started;
  const placed = applyLayout(flow.nodes, fromElk(result));

  // Top-level extent: children are positioned relative to their parent.
  let width = 0;
  let height = 0;
  for (const n of placed) {
    if (n.parentId !== undefined) continue;
    width = Math.max(width, n.position.x + n.width);
    height = Math.max(height, n.position.y + n.height);
  }
  return { width, height, elapsed, nodes: placed.length };
}

const expanded = await layoutCollapsed(new Set());
const folded = await layoutCollapsed(new Set(pulses));

describe('collapse on the canvas', () => {
  it('starts tall enough to be unreadable', () => {
    // The baseline this task exists to fix: roughly 8900 px on the fixture.
    expect(expanded.height).toBeGreaterThan(6000);
    expect(expanded.nodes).toBe(133);
  });

  it('drops under 2000 px with the four Pulses collapsed', () => {
    expect(folded.nodes).toBe(21);
    expect(folded.height).toBeLessThan(2000);
  });

  it('stays inside the 2 s layout budget on a toggle', () => {
    expect(folded.elapsed).toBeLessThan(2000);
    expect(expanded.elapsed).toBeLessThan(2000);
  });

  it('renders a collapsed sequence as one node carrying its step count', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const flow = toFlow(asGraph(graph, view), rules, { collapsedCounts: view.collapsedCounts });
    for (const uid of pulses) {
      const node = flow.nodes.find((n) => n.id === uid);
      expect(node?.type).toBe('seqNode');
      expect(node?.data.collapsed).toBe(28);
      expect(node?.data.params).toBe('28 steps');
    }
  });

  it('keeps expanded sequences as groups', () => {
    const view = visibleGraph(graph, new Set(pulses));
    const flow = toFlow(asGraph(graph, view), rules, { collapsedCounts: view.collapsedCounts });
    const groups = flow.nodes.filter((n) => n.type === 'seqGroup');
    expect(groups.length).toBe(view.containers.size);
    for (const g of groups) expect(pulses).not.toContain(g.id);
  });

  it('restores the full arrangement when expanded again', async () => {
    const again = await layoutCollapsed(new Set());
    expect(again.nodes).toBe(expanded.nodes);
    expect(again.height).toBe(expanded.height);
    expect(again.width).toBe(expanded.width);
  });
});
