/**
 * SVG export, against the real laid-out 133-node graph.
 *
 * The emitter is pure and the layout runs in Node, so the whole of task 4 is
 * testable here — which is the reason the task chose to draw from the graph
 * rather than serialise the canvas.
 */

import { describe, expect, test } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { DOMParser as XmlParser } from '@xmldom/xmldom';

import { parse } from '../src/core/parse';
import { toFlow } from '../src/emit/flow';
import { asGraph, visibleGraph } from '../src/emit/collapse';
import { esc, toSvg, wrapText, DARK, LIGHT } from '../src/emit/svg';
import {
  applyLayout,
  edgeRoutes,
  fromElk,
  graphBounds,
  nodesForMode,
  toElk,
  type ElkLike,
} from '../src/layout/elkGraph';
import { domParser, fixtureXml, rules } from './helpers';

const elk = new ELK() as ElkLike;
const graph = parse(fixtureXml, { rules, domParser });

async function lay(
  flowNodes: ReturnType<typeof toFlow>,
  mode: 'grouped' | 'compact' = 'grouped',
) {
  const subject = nodesForMode(flowNodes.nodes, mode);
  const result = await elk.layout(toElk(subject, flowNodes.edges, mode));
  return {
    nodes: applyLayout(subject, fromElk(result)),
    edges: flowNodes.edges,
    routes: edgeRoutes(result),
  };
}

const flow = toFlow(graph, rules);
const grouped = await lay(flow, 'grouped');
const compact = await lay(flow, 'compact');

/** @xmldom/xmldom parses the output, which is the "opens in a browser" proxy. */
function parseSvg(text: string): Document {
  return new XmlParser().parseFromString(text, 'image/svg+xml') as unknown as Document;
}

function countTags(text: string, tag: string): number {
  return text.match(new RegExp(`<${tag}[ />]`, 'g'))?.length ?? 0;
}

describe('dimensions', () => {
  test('grouped matches the on-screen layout', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes, padding: 0 });
    // PHASE3-TASKS names 975 x 8886 for this fixture.
    expect(svg.width).toBe(975);
    expect(svg.height).toBe(8886);

    // That is the extent from ELK's origin, which is 22 px left and 52 px
    // above the topmost node — the outer group's padding. `graphBounds`
    // measures from the node instead, because the canvas fits what it can
    // see; an export that cropped to it would lose the padding on two sides
    // and keep it on the other two.
    const bounds = graphBounds(grouped.nodes)!;
    expect(bounds.x).toBe(22);
    expect(bounds.y).toBe(52);
    expect(Math.round(bounds.x + bounds.width)).toBe(svg.width);
    expect(Math.round(bounds.y + bounds.height)).toBe(svg.height);
  });

  test('compact is the wide layout, roughly 3600 x 2000', () => {
    const svg = toSvg(compact.nodes, compact.edges, { routes: compact.routes, padding: 0 });
    expect(svg.width).toBeGreaterThan(2800);
    expect(svg.width).toBeLessThan(4400);
    expect(svg.height).toBeGreaterThan(1400);
    expect(svg.height).toBeLessThan(2600);
  });

  test('padding widens the canvas on both sides and shifts the drawing', () => {
    const bare = toSvg(grouped.nodes, grouped.edges, { padding: 0 });
    const padded = toSvg(grouped.nodes, grouped.edges, { padding: 24 });
    expect(padded.width).toBe(bare.width + 48);
    expect(padded.height).toBe(bare.height + 48);
    expect(padded.text).toContain('<g transform="translate(24, 24)">');
  });

  test('the viewBox matches the declared size', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    expect(svg.text).toContain(`viewBox="0 0 ${svg.width} ${svg.height}"`);
    expect(svg.text).toContain(`width="${svg.width}" height="${svg.height}"`);
  });
});

describe('well-formedness', () => {
  const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });

  test('parses as XML — the "opens in a browser and in Inkscape" bar', () => {
    const doc = parseSvg(svg.text);
    expect(doc.documentElement?.nodeName).toBe('svg');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  });

  test('declares the SVG namespace and nothing else external', () => {
    expect(svg.text).toContain('xmlns="http://www.w3.org/2000/svg"');
    // No CDN, no <image href>, no <use xlink:href> — NFR-2.
    expect(svg.text).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg.text).not.toMatch(/<image\b/);
  });

  test('text is real text, not paths', () => {
    expect(countTags(svg.text, 'path')).toBe(4); // the four arrowhead markers
    const doc = parseSvg(svg.text);
    const texts = doc.getElementsByTagName('text');
    // 107 steps (some wrapping to two lines) + 26 group titles + the caption.
    expect(texts.length).toBeGreaterThan(133);
    const found = new Set<string>();
    for (let i = 0; i < texts.length; i++) {
      found.add(texts.item(i)?.textContent ?? '');
    }
    expect(found.has('Stop Recording')).toBe(true);
    expect(found.has('INITIALIZE')).toBe(true);
  });

  test('every node in the graph is drawn', () => {
    // 107 steps: rect+accent for plain and collapsed, polygon for the rest.
    const polygons = countTags(svg.text, 'polygon');
    const decisions = grouped.nodes.filter(
      (n) => n.type === 'seqNode' && (n.data.shape === 'diamond' || n.data.shape === 'hexagon'),
    ).length;
    expect(polygons).toBe(decisions);
  });

  test('group boxes are drawn behind, outermost first', () => {
    const doc = parseSvg(svg.text);
    const rects = doc.getElementsByTagName('rect');
    // The first rect is the page background; the 26 group boxes follow, in
    // depth order, before any step is drawn.
    expect(rects.item(1)?.getAttribute('rx')).toBe('8');
    const firstGroupY = Number(rects.item(1)?.getAttribute('y'));
    expect(Number.isFinite(firstGroupY)).toBe(true);
  });

  test('the caption is the file name, never a timestamp', () => {
    const titled = toSvg(grouped.nodes, grouped.edges, { title: 'Sequence_XML.xml' });
    expect(titled.text).toContain('>Sequence_XML.xml<');
    expect(titled.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('edges', () => {
  test("ELK's orthogonal routes are used, not invented ones", () => {
    expect(grouped.routes.size).toBe(126);
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes, padding: 0 });
    // Every route's first point appears verbatim in some polyline.
    const first = [...grouped.routes.values()][0]!;
    const head = `${Math.round(first[0]!.x * 100) / 100},${Math.round(first[0]!.y * 100) / 100}`;
    expect(svg.text).toContain(head);
    expect(countTags(svg.text, 'polyline')).toBe(126);
  });

  test('every route lands on its target, not in mid-air', () => {
    // ELK routes an edge in the coordinate system of its endpoints' lowest
    // common ancestor but reports it on the root, so reading the points as
    // absolute puts a jump between two Pulses 314 px above where it belongs.
    // Nothing catches that but this: it renders as an arrowhead in open space.
    const byId = new Map(grouped.nodes.map((n) => [n.id, n]));
    const absolute = (id: string): { x: number; y: number } => {
      let x = 0;
      let y = 0;
      let cursor = byId.get(id);
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        x += cursor.position.x;
        y += cursor.position.y;
        cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
      }
      return { x, y };
    };

    let checked = 0;
    for (const edge of grouped.edges) {
      const points = grouped.routes.get(edge.id);
      if (points === undefined) continue;
      const target = byId.get(edge.target)!;
      const at = absolute(edge.target);
      const last = points[points.length - 1]!;
      // The arrowhead touches the target's top edge, somewhere along its width.
      // Not its centre: 26 of the 126 fan in off-centre where edges converge.
      expect(Math.abs(last.y - at.y)).toBeLessThan(2);
      expect(last.x).toBeGreaterThanOrEqual(at.x - 2);
      expect(last.x).toBeLessThanOrEqual(at.x + target.width + 2);
      checked++;
    }
    expect(checked).toBe(126);
  });

  test('without routes every edge still gets an elbow', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { padding: 0 });
    expect(countTags(svg.text, 'polyline')).toBe(126);
  });

  test('dotted edges keep their dash, and each reason keeps its colour', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    const dotted = grouped.edges.filter((e) => e.style.strokeDasharray !== undefined).length;
    expect(dotted).toBeGreaterThan(0);
    expect(svg.text.match(/stroke-dasharray="5 4"/g)?.length).toBeGreaterThanOrEqual(dotted);
    expect(svg.text).toContain('stroke="#d4544a"'); // criteria
    expect(svg.text).toContain('stroke="#8a94a6"'); // fallthrough
  });

  test('edge labels are drawn', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    expect(svg.text).toContain('>fail<');
    expect(svg.text).toContain('>true<');
    expect(svg.text).toContain('>false<');
  });
});

describe('collapse and highlight', () => {
  test('a collapsed sequence exports as the single node it appears as', async () => {
    const pulse = [...graph.nodes.values()].find((n) => n.name === 'Pulse 1 - 6C')!;
    const view = visibleGraph(graph, new Set([pulse.uid]));
    const folded = toFlow(asGraph(graph, view), rules, {
      collapsedCounts: view.collapsedCounts,
    });
    const laid = await lay(folded, 'grouped');
    const svg = toSvg(laid.nodes, laid.edges, { routes: laid.routes });

    expect(laid.nodes.length).toBe(133 - 28);
    // One dashed box, with its step count, and nothing from inside it.
    expect(svg.text).toContain('>Pulse 1 - 6C<');
    expect(svg.text).toContain('>28 steps<');
    expect(svg.text).not.toContain('>Discharge at 6C<');
  });

  test('dim and highlight classes are honoured, and can be switched off', () => {
    const marked = grouped.nodes.map((n, i) =>
      i % 2 === 0 ? { ...n, className: 'dimmed' } : { ...n, className: 'on-path' },
    );
    const on = toSvg(marked, grouped.edges, { routes: grouped.routes });
    expect(on.text).toContain('opacity="0.2"');
    expect(on.text).toContain(`stroke="${DARK.accent}"`);

    const off = toSvg(marked, grouped.edges, { routes: grouped.routes, highlight: false });
    expect(off.text).not.toContain('opacity="0.2"');
  });

  test('group boxes never dim', () => {
    const marked = grouped.nodes.map((n) => ({ ...n, className: 'dimmed' }));
    const svg = toSvg(marked, grouped.edges, { routes: grouped.routes });
    const doc = parseSvg(svg.text);
    const rects = doc.getElementsByTagName('rect');
    // Group boxes are emitted outside any opacity group; the first one is a
    // direct child of the shifted <g>, not of a faded wrapper.
    expect(rects.item(1)?.parentNode?.nodeName).toBe('g');
    expect((rects.item(1)?.parentNode as Element | null)?.getAttribute('opacity')).toBe(null);
  });
});

describe('themes', () => {
  test('light uses a white page and darkened line colours', () => {
    const light = toSvg(grouped.nodes, grouped.edges, { theme: 'light', routes: grouped.routes });
    expect(light.text).toContain(`fill="${LIGHT.bg}"`);
    expect(light.text).not.toContain(`fill="${DARK.bg}"`);
    expect(light.text).not.toContain('stroke="#8a94a6"');
  });

  test('a theme changes no geometry', () => {
    const a = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    const b = toSvg(grouped.nodes, grouped.edges, { theme: 'light', routes: grouped.routes });
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
  });
});

describe('determinism', () => {
  test('two calls are byte-identical', () => {
    const a = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    const b = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    expect(a.text).toBe(b.text);
  });
});

describe('text handling', () => {
  test('the four bracketed names survive as XML text', () => {
    const svg = toSvg(grouped.nodes, grouped.edges, { routes: grouped.routes });
    const doc = parseSvg(svg.text);
    const texts = doc.getElementsByTagName('text');
    const found: string[] = [];
    for (let i = 0; i < texts.length; i++) found.push(texts.item(i)?.textContent ?? '');
    expect(found.some((t) => t.includes('6C Pulse (10s)'))).toBe(true);
  });

  test('markup in a name is escaped, not injected', () => {
    expect(esc('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
    const hostile = grouped.nodes.map((n) => ({
      ...n,
      data: { ...n.data, label: '<script>alert(1)</script>' },
    }));
    const svg = toSvg(hostile, grouped.edges, {});
    expect(svg.text).not.toContain('<script>');
    expect(parseSvg(svg.text).getElementsByTagName('parsererror').length).toBe(0);
  });

  test('wrapText fills lines and ellipsises the overflow', () => {
    expect(wrapText('Short', 200)).toEqual(['Short']);
    const long = wrapText('Charge to Desired Voltage at a Constant Current Until Full', 150, 2);
    expect(long.length).toBe(2);
    expect(long.join('')).toMatch(/…$/);
    // A single unbreakable word is still cut.
    expect(wrapText('A'.repeat(80), 100, 1)[0]).toMatch(/…$/);
  });
});
