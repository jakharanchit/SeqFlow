import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { convergentNodes, paramText, toFlow } from '../src/emit/flow';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const flow = toFlow(graph, rules);

describe('flow adapter', () => {
  it('emits one flow node per graph node', () => {
    expect(flow.nodes).toHaveLength(133);
    expect(flow.edges).toHaveLength(126);
  });

  it('maps containers to groups and steps to nodes', () => {
    expect(flow.nodes.filter((n) => n.type === 'seqGroup')).toHaveLength(26);
    expect(flow.nodes.filter((n) => n.type === 'seqNode')).toHaveLength(107);
  });

  it('lists every parent before its children', () => {
    const seen = new Set<string>();
    for (const n of flow.nodes) {
      if (n.parentId !== undefined) expect(seen.has(n.parentId)).toBe(true);
      seen.add(n.id);
    }
  });

  it('gives every node a unique id, despite colliding names', () => {
    expect(new Set(flow.nodes.map((n) => n.id)).size).toBe(flow.nodes.length);
    expect(new Set(flow.edges.map((e) => e.id)).size).toBe(flow.edges.length);
  });

  it('dots the inbound edges where convergence exceeds the threshold', () => {
    // "Turn off Load" is not a unique name — select the one inside "Abort
    // Sequence" by its parent, never by name alone.
    const abort = [...graph.nodes.values()].find(
      (n) =>
        n.name === 'Turn off Load' &&
        graph.nodes.get(n.parent ?? '')?.name === 'Abort Sequence',
    )!;
    expect(convergentNodes(graph, rules).has(abort.uid)).toBe(true);

    const inbound = flow.edges.filter((e) => e.target === abort.uid);
    expect(inbound).toHaveLength(16);
    for (const e of inbound) expect(e.style.strokeDasharray).toBeDefined();
  });

  it('leaves ordinary fall-through edges solid', () => {
    const plain = flow.edges.filter(
      (e) => e.data['reason'] === 'fallthrough' && e.data['convergent'] === false,
    );
    expect(plain.length).toBeGreaterThan(80);
    for (const e of plain) expect(e.style.strokeDasharray).toBeUndefined();
  });

  it('renders rule-file label attributes, skipping empty ones', () => {
    const setSwitch = [...graph.nodes.values()].find(
      (n) => n.name === 'Turn Drive Supply On',
    )!;
    const text = paramText(setSwitch, rules);
    expect(text).toContain('switchTag = drive_source_enable_output');
    expect(text).toContain('state = TRUE');
    expect(text).not.toContain('sensorTag'); // present in XML but empty
  });

  it('falls back to the element name when a step has no name', () => {
    const g = parse('<TestSequence><Sequence uid="S-1"><WaitStep uid="W-1"/></Sequence></TestSequence>', {
      rules,
      domParser,
    });
    const f = toFlow(g, rules);
    expect(f.nodes.find((n) => n.id === 'W-1')?.data.label).toBe('WaitStep');
  });

  it('is a pure function — repeated calls agree', () => {
    const again = toFlow(graph, rules);
    expect(JSON.stringify(again.nodes)).toBe(JSON.stringify(flow.nodes));
    expect(JSON.stringify(again.edges)).toBe(JSON.stringify(flow.edges));
  });
});
