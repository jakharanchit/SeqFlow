import { describe, expect, it } from 'vitest';

import { diffGraphs, mergedGraph } from '../src/core/diff';
import { parse } from '../src/core/parse';
import ELK from 'elkjs/lib/elk.bundled.js';

import { toFlow, type FlowEdge, type FlowNode } from '../src/emit/flow';
import { DIFF_CLASS_DEFS, toMermaid } from '../src/emit/mermaid';
import { diffClass, toSvg } from '../src/emit/svg';
import {
  applyLayout,
  edgeRoutes,
  fromElk,
  nodesForMode,
  toElk,
  type ElkLike,
} from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const elk = new ELK() as ElkLike;

async function lay(nodes: FlowNode[], edges: FlowEdge[]) {
  const subject = nodesForMode(nodes, 'grouped');
  const result = await elk.layout(toElk(subject, edges, 'grouped'));
  return { nodes: applyLayout(subject, fromElk(result)), routes: edgeRoutes(result) };
}

/**
 * The diff leaving the app, the way everything else in Phase 3 does: added,
 * removed and changed as three classes on nodes the emitters already draw.
 */
const base = parse(fixtureXml, { rules, domParser });

const FIRST_STATUS = '60000410-0000-0000-0000-000000004000';
const PULSE1_WAIT = '10000110-0000-0000-0000-000000004000';

const removedTag = new RegExp(`<[A-Za-z]+[^>]*\\buid="${FIRST_STATUS}"[^>]*/>`).exec(
  fixtureXml,
)![0];
const changedTag = new RegExp(`<[A-Za-z]+[^>]*\\buid="${PULSE1_WAIT}"[^>]*/>`).exec(
  fixtureXml,
)![0];

const next = parse(
  fixtureXml
    .replace(removedTag, '')
    .replace(changedTag, changedTag.replace('logStart="FALSE"', 'logStart="TRUE"')),
  { rules, domParser },
);

const diff = diffGraphs(base, next);
const merged = mergedGraph(base, next, diff);

/** The canvas's own class application, reproduced. */
function classed() {
  const flow = toFlow(merged, rules);
  const nodes = flow.nodes.map((n) => {
    const kind = diff.status.get(n.id);
    return kind === undefined || kind === 'same' ? n : { ...n, className: `diff-${kind}` };
  });
  const edges = flow.edges.map((e) => {
    const ghost =
      diff.status.get(e.source) === 'removed' || diff.status.get(e.target) === 'removed';
    return ghost ? { ...e, className: 'diff-removed' } : e;
  });
  return { nodes, edges };
}

describe('the merged graph is an ordinary graph', () => {
  it('lays out, with the ghost included', async () => {
    expect(merged.nodes.size).toBe(133);
    const flow = toFlow(merged, rules);
    const placed = await lay(flow.nodes, flow.edges);
    expect(placed.nodes).toHaveLength(nodesForMode(flow.nodes, 'grouped').length);
    expect(placed.nodes.some((n) => n.id === FIRST_STATUS)).toBe(true);
  });

  it('needs no diff awareness from the flow adapter', () => {
    // The whole point of ghosting into the graph rather than teaching four
    // downstream modules about revisions.
    const flow = toFlow(merged, rules);
    expect(flow.nodes.every((n) => n.className === undefined)).toBe(true);
  });
});

describe('mermaid', () => {
  const classes = new Map(
    [...diff.status].filter(([, kind]) => kind !== 'same').map(([uid, kind]) => [uid, kind]),
  );

  it('emits a classDef and a grouped class line per class', () => {
    const text = toMermaid(merged, rules, { classes, classDefs: DIFF_CLASS_DEFS });
    expect(text).toContain('classDef changed ');
    expect(text).toContain('classDef removed ');
    expect(text).not.toContain('classDef added ');
    // One line per class, not one per node.
    expect(text.split('\n').filter((l) => l.startsWith('  class ')).length).toBe(2);
  });

  it('is byte-identical to an unmarked emit when nothing is marked', () => {
    const plain = toMermaid(merged, rules);
    expect(toMermaid(merged, rules, { classes: new Map() })).toBe(plain);
  });

  it('stays deterministic', () => {
    const once = toMermaid(merged, rules, { classes, classDefs: DIFF_CLASS_DEFS });
    const twice = toMermaid(merged, rules, { classes, classDefs: DIFF_CLASS_DEFS });
    expect(twice).toBe(once);
    // And with the caller's Map built in a different order.
    const reversed = new Map([...classes].reverse());
    expect(toMermaid(merged, rules, { classes: reversed, classDefs: DIFF_CLASS_DEFS })).toBe(
      once,
    );
  });

  it('carries no marking without a classDef, rather than dropping the class', () => {
    const text = toMermaid(merged, rules, { classes });
    expect(text).not.toContain('classDef');
    expect(text).toContain('  class ');
  });
});

const { nodes: classedNodes, edges: classedEdges } = classed();
const placed = await lay(classedNodes, classedEdges);
const byId = new Map(classedNodes.map((n) => [n.id, n]));
const laid = placed.nodes.map((n) => {
  const className = byId.get(n.id)?.className;
  return className === undefined ? n : { ...n, className };
});

describe('svg', () => {
  const edges = classedEdges;

  it('draws the ghost dashed and in the removed colour', () => {
    const svg = toSvg(laid, edges, { routes: placed.routes });
    expect(svg.text).toContain('#d4544a');
    expect(svg.text).toContain('stroke-dasharray="3 5"');
  });

  it('honours the diff even with the highlight export turned off', () => {
    // `highlight: false` means "do not carry the transient dimming". A ghost is
    // not transient: it is what the canvas is, and an export that dropped it
    // would be a picture of a revision that does not exist.
    const off = toSvg(laid, edges, { routes: placed.routes, highlight: false });
    expect(off.text).toContain('#d4544a');
  });

  it('reads the three classes and nothing else', () => {
    expect(diffClass('diff-added')).toBe('added');
    expect(diffClass('dimmed diff-removed')).toBe('removed');
    expect(diffClass('diff-changed on-path')).toBe('changed');
    expect(diffClass('dimmed on-path')).toBeNull();
    expect(diffClass(undefined)).toBeNull();
  });
});
