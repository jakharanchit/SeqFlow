import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import { nodesFor, signalIndex, signalRows } from '../src/core/signals';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const index = signalIndex(graph, rules);

describe('signal index', () => {
  it('finds 10 distinct signals in the fixture', () => {
    expect(index.size).toBe(10);
  });

  it('skips empty attribute values', () => {
    expect(index.has('')).toBe(false);
    // 33 empty sensorTags and 45 empty variableTags are not a signal named "".
    for (const uses of index.values()) expect(uses.length).toBeGreaterThan(0);
  });

  it('lists 15 nodes for test_status', () => {
    expect(nodesFor(index, 'test_status').size).toBe(15);
  });

  it('lists 8 nodes for drive_source_enable_output', () => {
    expect(nodesFor(index, 'drive_source_enable_output').size).toBe(8);
  });

  it('reads a ConditionStep signal through its Comparison child', () => {
    const uids = [...nodesFor(index, 'UnitReading')];
    expect(uids).toHaveLength(4);
    for (const uid of uids) expect(graph.nodes.get(uid)?.element).toBe('ConditionStep');

    // Not on the step itself — only reachable through childAttrs.
    for (const uid of uids) {
      expect(graph.nodes.get(uid)?.attrs['sensorTag']).not.toBe('UnitReading');
    }
    for (const use of index.get('UnitReading') ?? []) {
      expect(use.via).toBe('Comparison');
      expect(use.attr).toBe('sensorTag');
    }
  });

  it('names every signal actually present in the file', () => {
    expect([...index.keys()].sort()).toEqual(
      [
        'UnitReading',
        'calc_mod_unit_temp_max',
        'controlled_load_current_setpoint',
        'controlled_load_enable_input',
        'controlled_load_operation_mode',
        'drive_source_current',
        'drive_source_current_limit',
        'drive_source_enable_output',
        'drive_source_reading_setpoint',
        'test_status',
      ].sort(),
    );
  });

  it('produces drawer rows sorted by use', () => {
    const rows = signalRows(index);
    expect(rows).toHaveLength(10);
    expect(rows[0]?.signal).toBe('test_status');
    expect(rows[0]?.count).toBe(15);
    expect(rows[0]?.attrs).toEqual(['tag']);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.count).toBeGreaterThanOrEqual(rows[i]!.count);
    }
  });

  it('points every uid at a node that exists', () => {
    for (const uses of index.values()) {
      for (const use of uses) expect(graph.nodes.has(use.uid)).toBe(true);
    }
  });
});
