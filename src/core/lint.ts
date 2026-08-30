/**
 * The linter — PHASE4-TASKS task 1.
 *
 * A *warning* (spec 3, NFR-6) means the parser could not make sense of
 * something: an unknown element, an unresolved jump. The fixture correctly
 * produces zero of them. A *finding* means this parsed perfectly well and
 * still looks wrong. The two lists stay separate, and nothing here ever
 * appends to `graph.warnings`: merging them makes a clean file look dirty and
 * buries the four warnings that would actually matter.
 *
 * Every rule below fires on the fixture. A linter whose rules all pass on the
 * only file available is a linter nobody has tested.
 *
 * Pure. No DOM, no React, no I/O — `lint(graph, rules)` and nothing else.
 * Schema knowledge stays in the rule file: this module names no element and no
 * attribute of the sequence schema, only the rule-file keys that list them.
 */

import { displayName, outlineOrder } from './ancestry';
import { adjacency, terminals, unreachable } from './paths';
import { compare, similarGroups, type Difference, type SimilarGroup } from './similarity';
import type { Graph, Rules, SeqNode } from './types';

export type FindingCode =
  /** An attribute that differs across an otherwise identical set of siblings. */
  | 'ODD_SIBLING_ATTR'
  /** A jump target populated where the paired action does not select it. */
  | 'STALE_TARGET'
  /** One name, several steps. Not an error; the reason lists carry a path. */
  | 'DUPLICATE_NAME'
  /** A step the flow can never reach from the entry. */
  | 'UNREACHABLE'
  /** More than one place the flow can stop. */
  | 'MULTIPLE_TERMINALS'
  /** A definition referenced by this file but stored somewhere else. */
  | 'EXTERNAL_CRITERIA';

/**
 * `warn` is "look at this". `info` is "this is how the file is, and a reader
 * diffing raw XML will trip over it". Nothing here is an error: the linter
 * reads a file that already parsed, and it has no power to reject one.
 */
export type Severity = 'info' | 'warn';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** The node the finding is about. Empty only for a file-wide finding. */
  uid: string;
  /** Attribute name, where the finding is about one. */
  attr?: string;
  value?: string;
  message: string;
  /**
   * Every node the finding covers, `uid` included — the other four steps
   * sharing a name, the four steps carrying one criteria definition. Present
   * whenever the finding is about a set rather than a single step.
   */
  related?: string[];
}

/* ------------------------------------------------------------------ */
/* Value classification                                                */
/* ------------------------------------------------------------------ */

/**
 * What a set of values looks like. Used only to order the sibling-difference
 * table — booleans and enums above numeric setpoints, so a stray `FALSE` is
 * the first row a reader sees rather than the last.
 *
 * This is a sort key, never a filter. Nothing is dropped for its class.
 */
export type ValueClass = 'boolean' | 'enum' | 'text' | 'number' | 'reference';

const BOOLEAN = /^(true|false)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,23}$/;

export function classify(values: readonly string[]): ValueClass {
  const present = values.filter((v) => v !== '');
  if (present.length === 0) return 'text';
  if (present.every((v) => BOOLEAN.test(v))) return 'boolean';
  if (present.every((v) => GUID.test(v))) return 'reference';
  if (present.every((v) => NUMBER.test(v))) return 'number';
  if (present.every((v) => TOKEN.test(v))) return 'enum';
  return 'text';
}

const CLASS_RANK: Record<ValueClass, number> = {
  boolean: 0,
  enum: 1,
  text: 2,
  number: 3,
  reference: 4,
};

/* ------------------------------------------------------------------ */
/* Sibling differences                                                 */
/* ------------------------------------------------------------------ */

export interface AttrDifference extends Difference {
  klass: ValueClass;
  /**
   * True when the members do not each carry their own value.
   *
   * Four sequences that differ in a setpoint carry four distinct setpoints:
   * that is a parameter, and it is what the four Pulses are *for*. Four that
   * carry `FALSE, TRUE, TRUE, TRUE` are not parameterised in that attribute —
   * three agree and one does not, and there is no reading of the file in which
   * that is deliberate parameterisation.
   *
   * The test is arithmetic, not a judgement about meaning, which is the only
   * reason it is safe to raise a finding on it. It cannot see a wrong value
   * that happens to be distinct from its siblings' — a mistyped setpoint reads
   * as a parameter here. That is why `siblingDifferences` returns *every*
   * difference and the UI shows all of them beside the finding: the finding
   * points at the one the arithmetic can prove, and the table shows the rest
   * so the reader is never told there is only one thing to look at.
   */
  odd: boolean;
  /** Distinct values across the members. */
  distinct: number;
}

export interface SiblingReport {
  group: SimilarGroup;
  /** Member display names, in `group.members` order. */
  names: string[];
  /** Odd first, then booleans and enums above numeric setpoints. */
  differences: AttrDifference[];
}

/**
 * Every attribute that differs across each group of structurally identical
 * siblings, classified and sorted.
 *
 * On the fixture this is one group — the four Pulses, 116 nodes — with eight
 * differences: four names, the load setpoint, the two intra-pulse jump
 * targets, and one `logStart`.
 */
export function siblingDifferences(graph: Graph): SiblingReport[] {
  const out: SiblingReport[] = [];

  for (const group of similarGroups(graph)) {
    const result = compare(graph, group.members);
    if (!result.identical) continue;

    const differences: AttrDifference[] = result.differences.map((d) => {
      const distinct = new Set(d.values).size;
      return {
        ...d,
        klass: classify(d.values),
        distinct,
        odd: distinct < group.members.length,
      };
    });

    differences.sort((a, b) => {
      if (a.odd !== b.odd) return a.odd ? -1 : 1;
      const rank = CLASS_RANK[a.klass] - CLASS_RANK[b.klass];
      if (rank !== 0) return rank;
      if (a.position !== b.position) return a.position - b.position;
      return a.attr < b.attr ? -1 : a.attr > b.attr ? 1 : 0;
    });

    out.push({ group, names: result.names, differences });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Individual rules                                                    */
/* ------------------------------------------------------------------ */

/** The member indices holding the minority value. */
function oddMembers(values: readonly string[]): number[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let rarest = Infinity;
  for (const n of counts.values()) rarest = Math.min(rarest, n);
  const out: number[] = [];
  values.forEach((v, i) => {
    if (counts.get(v) === rarest) out.push(i);
  });
  return out;
}

function oddSiblingAttrs(graph: Graph, reports: SiblingReport[]): Finding[] {
  const out: Finding[] = [];

  for (const report of reports) {
    const parameters = report.differences.filter((d) => !d.odd).length;

    for (const d of report.differences) {
      if (!d.odd) continue;
      const odd = oddMembers(d.values);
      const shown = odd
        .map((i) => `${report.names[i] ?? '?'} = ${quote(d.values[i] ?? '')}`)
        .join(', ');
      const others = d.values
        .map((v, i) => (odd.includes(i) ? null : `${report.names[i] ?? '?'} = ${quote(v)}`))
        .filter((s): s is string => s !== null)
        .join(', ');
      const rest = d.values.length - odd.length;

      // Report the odd member, not the group: that is the step to click.
      const subject = odd[0] ?? 0;
      out.push({
        code: 'ODD_SIBLING_ATTR',
        severity: 'warn',
        uid: d.uids[subject] ?? '',
        attr: d.attr,
        value: d.values[subject] ?? '',
        message:
          `"${d.label}" carries ${d.attr} ${shown}, where the other ${rest} of ` +
          `${d.values.length} structurally identical siblings say ${others}. The ` +
          `${parameters} other ${plural(parameters, 'attribute')} that differ in this ` +
          'group give every member its own value, which is parameterisation; this one ' +
          'does not.',
        related: d.uids.filter((u) => u !== '' && graph.nodes.has(u)),
      });
    }
  }

  return out;
}

/**
 * A jump target populated where its paired action does not select it.
 *
 * This is spec 4.2 read as a finding rather than as a parser rule. The parser
 * already ignores these attributes; the linter says out loud that they are
 * there, because 16 of the fixture's 32 point at the abort sequence and a
 * reader diffing raw XML will believe them.
 *
 * Severity `info`: this is how the authoring tool stores a value the user
 * typed and then stopped using. It is not corruption.
 */
function staleTargets(graph: Graph, rules: Rules): Finding[] {
  const out: Finding[] = [];

  for (const node of graph.nodes.values()) {
    if (node.kind === 'container') continue;
    for (const rule of rules.edges) {
      const gates = Object.entries(rule.when);
      if (gates.length === 0) continue; // unconditional: never stale
      // "Applies" and "matches" are the parser's own distinction — see
      // parse.ts. Applies but does not match is exactly a stale target.
      if (!gates.every(([k]) => node.attrs[k] !== undefined)) continue;
      if (gates.every(([k, v]) => node.attrs[k] === v)) continue;

      const value = node.attrs[rule.target] ?? '';
      if (value === '') continue; // nothing stored, nothing stale

      const held = gates
        .filter(([k, v]) => node.attrs[k] !== v)
        .map(([k]) => `${k}="${node.attrs[k] ?? ''}"`)
        .join(', ');
      const target = graph.nodes.get(value);

      out.push({
        code: 'STALE_TARGET',
        severity: 'info',
        uid: node.uid,
        attr: rule.target,
        value,
        message:
          `${rule.target} still names ` +
          `${target === undefined ? value : `"${displayName(target)}"`}, but ${held}, so ` +
          'the flow never takes it. Ignored by the parser (spec 4.2); shown here because ' +
          'a raw XML diff will not ignore it.',
        ...(target === undefined ? {} : { related: [node.uid, value] }),
      });
    }
  }

  return out;
}

/**
 * One name, several steps.
 *
 * One finding per name rather than per node: 27 findings covering 106 of the
 * fixture's 133 nodes. Reported because it is the reason every list in this
 * tool carries a parent path, and the reason a test that selected "Turn off
 * Load" by name alone was once written wrong.
 */
function duplicateNames(graph: Graph): Finding[] {
  const byName = new Map<string, SeqNode[]>();
  for (const node of outlineOrder(graph)) {
    if (node.name === '') continue;
    const bucket = byName.get(node.name);
    if (bucket === undefined) byName.set(node.name, [node]);
    else bucket.push(node);
  }

  const out: Finding[] = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const elements = [...new Set(group.map((n) => n.element))].sort();
    out.push({
      code: 'DUPLICATE_NAME',
      severity: 'info',
      uid: group[0]!.uid,
      value: name,
      message:
        `"${name}" is the name of ${group.length} ${plural(group.length, 'node')} ` +
        `(${elements.join(', ')}). Identify ${group.length === 2 ? 'either' : 'any'} of ` +
        'them by uid, or by name plus parent — never by name alone.',
      related: group.map((n) => n.uid),
    });
  }
  return out;
}

/** Steps the flow can never reach. Already computed; reported as findings. */
function unreachableSteps(graph: Graph): Finding[] {
  const adj = adjacency(graph);
  const out: Finding[] = [];
  for (const uid of unreachable(graph, adj)) {
    const node = graph.nodes.get(uid);
    out.push({
      code: 'UNREACHABLE',
      severity: 'warn',
      uid,
      message:
        `"${node === undefined ? uid : displayName(node)}" has no route from the entry ` +
        'step. Nothing in this file can execute it.',
    });
  }
  return out;
}

/**
 * Where the flow can stop.
 *
 * One terminal is a sequence with one end. Several is worth knowing about, and
 * each gets its own finding rather than one finding listing them: the reader
 * wants to click each in turn.
 */
function multipleTerminals(graph: Graph): Finding[] {
  const ends = [...terminals(graph)];
  if (ends.length < 2) return [];

  const order = documentOrder(graph);
  ends.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  return ends.map((uid) => {
    const node = graph.nodes.get(uid);
    return {
      code: 'MULTIPLE_TERMINALS' as const,
      severity: 'warn' as const,
      uid,
      message:
        `"${node === undefined ? uid : displayName(node)}" is one of ${ends.length} steps ` +
        'the flow can stop at. A sequence with several ends has several ways to finish, ' +
        'and each needs its own answer to "what state is the unit left in".',
      related: ends,
    };
  });
}

/**
 * Definitions this file names but does not contain.
 *
 * `external_refs` in the rule file already stops these being reported as
 * unresolved targets, which is right — they are not broken. But four GUIDs
 * decide whether a unit passes, and a tool that says nothing about them is
 * quietly answering "what can reject this unit" with silence.
 *
 * One finding per distinct definition, never an error.
 */
function externalCriteria(graph: Graph, rules: Rules): Finding[] {
  const uses = new Map<string, { attr: string; uids: string[]; names: Set<string> }>();

  for (const node of outlineOrder(graph)) {
    for (const attr of rules.externalRefs) {
      const raw = node.attrs[attr];
      if (raw === undefined || raw === '') continue;
      const key = `${attr}|${referenceId(raw)}`;
      const bucket = uses.get(key);
      if (bucket === undefined) {
        uses.set(key, { attr, uids: [node.uid], names: new Set([displayName(node)]) });
      } else {
        bucket.uids.push(node.uid);
        bucket.names.add(displayName(node));
      }
    }
  }

  const out: Finding[] = [];
  for (const [key, use] of uses) {
    const id = key.slice(key.indexOf('|') + 1);
    const names = [...use.names];
    out.push({
      code: 'EXTERNAL_CRITERIA',
      severity: 'info',
      uid: use.uids[0]!,
      attr: use.attr,
      value: id,
      message:
        `${names.length === 1 ? `"${names[0]}"` : `${names.length} differently named steps`} ` +
        `reference ${use.attr} ${id}, used ${use.uids.length} ` +
        `${plural(use.uids.length, 'time')}. The definition is not in this file, so its ` +
        'limits cannot be shown here.',
      related: use.uids,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The definition id inside an external reference.
 *
 * The rule file names the attribute; this names the one convention its value
 * follows — an id, optionally followed by `=` and a comma-separated list of
 * what the definition covers. A value with no `=` is the id entire.
 */
export function referenceId(raw: string): string {
  const cut = raw.indexOf('=');
  return cut === -1 ? raw : raw.slice(0, cut);
}

/** What an external reference's `=` list names, when it carries one. */
export function referenceMembers(raw: string): string[] {
  const cut = raw.indexOf('=');
  if (cut === -1) return [];
  return raw
    .slice(cut + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function documentOrder(graph: Graph): Map<string, number> {
  const out = new Map<string, number>();
  outlineOrder(graph).forEach((node, i) => out.set(node.uid, i));
  return out;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function quote(value: string): string {
  return value === '' ? 'nothing' : `"${value}"`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Rule order, and the order findings come back in. Severity is not the key:
 * the reader wants the odd sibling first, and it is the only rule that has
 * ever found a defect.
 */
const CODE_ORDER: readonly FindingCode[] = [
  'ODD_SIBLING_ATTR',
  'UNREACHABLE',
  'MULTIPLE_TERMINALS',
  'STALE_TARGET',
  'DUPLICATE_NAME',
  'EXTERNAL_CRITERIA',
];

export interface LintResult {
  findings: Finding[];
  /** Findings per code, including the codes that found nothing. */
  counts: Record<FindingCode, number>;
  /** The sibling analysis, so the UI can show every difference, not just the odd one. */
  siblings: SiblingReport[];
}

/**
 * Run every rule. Deterministic: findings sort by rule, then by document
 * order, then by attribute.
 *
 * The graph is not touched. `lint` returns findings and nothing else — it
 * never appends to `graph.warnings`, which stays the parser's own list.
 */
export function lint(graph: Graph, rules: Rules): LintResult {
  const siblings = siblingDifferences(graph);

  const findings = [
    ...oddSiblingAttrs(graph, siblings),
    ...staleTargets(graph, rules),
    ...duplicateNames(graph),
    ...unreachableSteps(graph),
    ...multipleTerminals(graph),
    ...externalCriteria(graph, rules),
  ];

  const order = documentOrder(graph);
  findings.sort((a, b) => {
    const rank = CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code);
    if (rank !== 0) return rank;
    const doc = (order.get(a.uid) ?? 0) - (order.get(b.uid) ?? 0);
    if (doc !== 0) return doc;
    const aa = a.attr ?? '';
    const bb = b.attr ?? '';
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });

  const counts = Object.fromEntries(CODE_ORDER.map((code) => [code, 0])) as Record<
    FindingCode,
    number
  >;
  for (const f of findings) counts[f.code] += 1;

  return { findings, counts, siblings };
}
