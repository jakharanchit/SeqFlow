/**
 * Signal cross-reference index — spec 7.4.
 *
 * Every tag named in `signal_attrs` mapped to the steps that touch it.
 * `power_supply_enable_output` is switched in eight places across four pulses;
 * finding them by reading XML is slow, which is the whole point of the index.
 *
 * The catch is `ConditionStep`. It holds no `sensorTag` of its own — the
 * condition lives on its `Comparison` child, lifted into `childAttrs` by the
 * parser. An index that reads only `attrs` finds zero uses of `PackVoltage`
 * in a file that compares against it four times.
 *
 * Which attributes count is rule-file knowledge, never source knowledge: this
 * module names no element and no attribute of the sequence schema.
 */

import type { Graph, Rules } from './types';

export interface SignalUse {
  uid: string;
  /** The attribute the reference was found under, e.g. `switchTag`. */
  attr: string;
  /** Child element it was lifted from, when it was not on the step itself. */
  via?: string;
}

/** Signal name -> every use, in document order. */
export type SignalIndex = Map<string, SignalUse[]>;

/**
 * Build the index. Empty values are skipped — the sample carries 33 empty
 * `sensorTag`s and 45 empty `variableTag`s, and an "" signal is not a signal.
 */
export function signalIndex(graph: Graph, rules: Rules): SignalIndex {
  const index: SignalIndex = new Map();

  const record = (signal: string, use: SignalUse): void => {
    if (signal === '') return;
    const bucket = index.get(signal);
    if (bucket === undefined) index.set(signal, [use]);
    else bucket.push(use);
  };

  for (const node of graph.nodes.values()) {
    for (const attr of rules.signalAttrs) {
      const value = node.attrs[attr];
      if (value !== undefined) record(value, { uid: node.uid, attr });
    }

    for (const [element, rows] of Object.entries(node.childAttrs ?? {})) {
      for (const row of rows) {
        for (const attr of rules.signalAttrs) {
          const value = row[attr];
          if (value !== undefined) record(value, { uid: node.uid, attr, via: element });
        }
      }
    }
  }

  return index;
}

/** The distinct nodes touching a signal. A step may reference one twice. */
export function nodesFor(index: SignalIndex, signal: string): Set<string> {
  return new Set((index.get(signal) ?? []).map((u) => u.uid));
}

export interface SignalRow {
  signal: string;
  /** Distinct nodes touching it — what the drawer shows as the count. */
  count: number;
  uids: string[];
  /** The attributes it appears under, sorted. */
  attrs: string[];
}

/** The index as drawer rows, sorted by descending use then by name. */
export function signalRows(index: SignalIndex): SignalRow[] {
  const rows: SignalRow[] = [];
  for (const [signal, uses] of index) {
    const uids = [...new Set(uses.map((u) => u.uid))];
    rows.push({
      signal,
      count: uids.length,
      uids,
      attrs: [...new Set(uses.map((u) => u.attr))].sort(),
    });
  }
  return rows.sort((a, b) => b.count - a.count || (a.signal < b.signal ? -1 : 1));
}
