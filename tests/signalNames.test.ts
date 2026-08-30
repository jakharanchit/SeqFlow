/**
 * The optional signal dictionary.
 *
 * The behaviour that matters most here is the one with no file loaded: every
 * tag comes back exactly as the XML spells it. The text export proves the
 * names cannot be derived — `calc_bms_pack_temp_max` prints as "Pack Temp max"
 * and `power_supply_voltage_setpoint` as "Power Supply Voltage Request" — so
 * anything this module invents would be wrong in a way nobody could see.
 */

import { describe, expect, it } from 'vitest';

import { parse } from '../src/core/parse';
import {
  enumLabel,
  noSignalNames,
  parseSignalNames,
  signalLabel,
  unnamedTags,
} from '../src/core/signalNames';
import { signalIndex } from '../src/core/signals';
import { domParser, fixtureXml, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });

describe('with no dictionary', () => {
  it('shows the tag verbatim and never a guess', () => {
    expect(signalLabel('power_supply_voltage_setpoint')).toBe('power_supply_voltage_setpoint');
    expect(signalLabel('calc_bms_pack_temp_max', undefined)).toBe('calc_bms_pack_temp_max');
    expect(signalLabel('PackVoltage')).toBe('PackVoltage');
    expect(enumLabel('electronic_load_operation_mode', '2')).toBe('2');
  });

  it('is an empty dictionary, not a null one, so callers need no branch', () => {
    const none = noSignalNames();
    expect(none.size).toBe(0);
    expect(signalLabel('anything', none.names)).toBe('anything');
  });
});

describe('parsing', () => {
  const file = `# the plant's names for these tags
tag,display
calc_bms_pack_temp_max,Pack Temp max
power_supply_voltage_setpoint,Power Supply Voltage Request
electronic_load_current_setpoint,Load Current Request
electronic_load_operation_mode,Operation Mode
electronic_load_operation_mode:2,"2: Constant Current"
`;

  it('reads CSV, skipping the header and the comment', () => {
    const { names, size, skipped } = parseSignalNames(file);
    expect(size).toBe(5);
    expect(skipped).toBe(0);
    expect(signalLabel('calc_bms_pack_temp_max', names)).toBe('Pack Temp max');
    expect(signalLabel('power_supply_voltage_setpoint', names)).toBe(
      'Power Supply Voltage Request',
    );
  });

  it('keys an enum member by tag and value', () => {
    const { names } = parseSignalNames(file);
    expect(enumLabel('electronic_load_operation_mode', '2', names)).toBe('2: Constant Current');
    // A value the dictionary does not carry falls back to the value itself.
    expect(enumLabel('electronic_load_operation_mode', '3', names)).toBe('3');
  });

  it('reads TSV, and a tab beats a comma inside a name', () => {
    const { names } = parseSignalNames('calc_bms_pack_temp_max\tPack Temp, max\n');
    expect(signalLabel('calc_bms_pack_temp_max', names)).toBe('Pack Temp, max');
  });

  it('counts a row with no name, and a repeated key, rather than taking it', () => {
    const { names, size, skipped } = parseSignalNames(
      'a,First\nb\nc,\na,Second\n',
    );
    expect(size).toBe(1);
    expect(skipped).toBe(3);
    // First spelling wins: a file naming one tag twice is telling us it is
    // wrong, and quietly taking the last row would hide that.
    expect(signalLabel('a', names)).toBe('First');
  });

  it('an empty file is an empty dictionary, not an error', () => {
    expect(parseSignalNames('').size).toBe(0);
    expect(parseSignalNames('\n\n# only comments\n').size).toBe(0);
  });

  it('does not mistake a first data row for a header', () => {
    const { names, size } = parseSignalNames('PackVoltage,Pack Voltage\n');
    expect(size).toBe(1);
    expect(signalLabel('PackVoltage', names)).toBe('Pack Voltage');
  });
});

describe('against the fixture', () => {
  const tags = [...signalIndex(graph, rules).keys()];

  it('the file uses ten tags, none of them named without a dictionary', () => {
    expect(tags).toHaveLength(10);
    expect(unnamedTags(tags)).toHaveLength(10);
  });

  it('a partial dictionary reads as partial', () => {
    const { names } = parseSignalNames('PackVoltage,Pack Voltage\n');
    const left = unnamedTags(tags, names);
    expect(left).toHaveLength(9);
    expect(left).not.toContain('PackVoltage');
    expect(left).toContain('calc_bms_pack_temp_max');
  });
});
