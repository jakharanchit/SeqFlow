/**
 * What is in this file that the rule file does not know about — spec section 3
 * read from the other end.
 *
 * The parser's job is to render a document it understands. This module's job is
 * the document it does not: it walks the raw XML, reports every element name it
 * finds against the rule file's own vocabulary, and works out from the data
 * alone which attributes look like jump targets and what gates them. The output
 * feeds three surfaces — the Schema tab, `--profile`, and `--audit` across a
 * whole corpus — and the last section turns it into a `rules.yaml` fragment to
 * paste.
 *
 * Nothing here names an element or an attribute of any sequence schema
 * (invariant 2). Every judgement is derived:
 *
 *   - a *container* is an element holding uid-bearing children;
 *   - a *jump target* is an attribute whose value is a uid that exists
 *     elsewhere in the same document;
 *   - a *gate* is an attribute whose value separates the instances where a
 *     target is live from the instances where it is not — which is exactly the
 *     `when:` clause spec 4.2 needs, discovered rather than guessed.
 *
 * Pure. No fs, no React, and no DOM beyond the element traversal the core
 * already restricts itself to.
 */

import { childElements, isIgnored, stepChildren, tagOf, uidOf } from './resolve';
import type { Rules } from './types';

/** How the rule file currently classifies an element name. */
export type ElementStatus = 'container' | 'step' | 'ignored' | 'unknown';

/** An attribute that holds a reference to another element in the document. */
export interface TargetAttr {
  attr: string;
  /** Occurrences whose value resolves to a uid in this document. */
  live: number;
  /** Occurrences that are present but empty, or name something unknown. */
  dead: number;
  /**
   * The attribute and value that separate live from dead, when one exists.
   * This is a `when:` clause: `{ [gate.attr]: gate.value }`.
   *
   * Only reported when the two sets of values are disjoint *and* the live side
   * holds exactly one value. Anything weaker is a coincidence on a small
   * sample, and a wrong `when:` reads a stale target as a real edge — the one
   * mistake spec 4.2 exists to prevent.
   */
  gate?: { attr: string; value: string };
}

export interface ElementProfile {
  element: string;
  /** Occurrences across every document profiled. */
  count: number;
  /** How many carry a uid, and so could become a node. */
  withUid: number;
  /** How many hold uid-bearing children, and so are containers in fact. */
  withStepChildren: number;
  status: ElementStatus;
  /** Attribute name -> occurrences. */
  attrs: Record<string, number>;
  targets: TargetAttr[];
  /**
   * True where this element is the document element of a file profiled. It is
   * never a step and never a candidate for `ignore:` — ignoring the root would
   * leave the parser with nothing to walk.
   */
  documentElement: boolean;
  /**
   * True where every occurrence sits inside a subtree the rule file ignores.
   *
   * Still counted and still listed — an ignored subtree is where a rule file
   * that has fallen behind hides things, and seeing it is the point. But it is
   * not a *gap*: the rule file already made a decision about the parent, and
   * proposing an entry for something that can never be reached would be noise
   * on every file that has a notes block.
   */
  underIgnored: boolean;
  /** A few `name` values, so a reader can recognise the thing. */
  samples: string[];
}

export type SchemaProfile = Map<string, ElementProfile>;

const MAX_SAMPLES = 3;

/* ------------------------------------------------------------------ */
/* Profiling one document                                              */
/* ------------------------------------------------------------------ */

/** One element occurrence, flattened, so the correlation pass can index it. */
interface Instance {
  attrs: Record<string, string>;
}

function statusOf(element: string, rules: Rules): ElementStatus {
  if (rules.ignore.includes(element)) return 'ignored';
  if (rules.containers.includes(element)) return 'container';
  // No `steps:` list means the rule file declines to police leaf names, so
  // nothing is unknown. Reporting everything as unknown in that case would be
  // noise, not a finding.
  if (rules.steps === undefined || rules.steps.includes(element)) return 'step';
  return 'unknown';
}

/** Walks the raw document against `rules`, reporting every element it finds — known, ignored, or not. */
export function profile(doc: Document, rules: Rules): SchemaProfile {
  const root = doc.documentElement;
  const out: SchemaProfile = new Map();
  if (!root) return out;

  // Every uid in the document, so an attribute value can be tested against
  // them. Built first: a jump commonly points backwards as well as forwards.
  const uids = new Set<string>();
  const collectUids = (el: Element): void => {
    const uid = uidOf(el);
    if (uid !== '') uids.add(uid);
    for (const child of childElements(el)) collectUids(child);
  };
  collectUids(root);

  const instances = new Map<string, Instance[]>();

  const walk = (el: Element, ignored: boolean): void => {
    const element = tagOf(el);
    const attrs: Record<string, string> = {};
    const list = el.attributes;
    for (let i = 0; i < list.length; i++) {
      const a = list.item(i);
      if (a) attrs[a.name] = a.value;
    }

    let entry = out.get(element);
    if (entry === undefined) {
      entry = {
        element,
        count: 0,
        withUid: 0,
        withStepChildren: 0,
        status: statusOf(element, rules),
        attrs: {},
        targets: [],
        documentElement: false,
        underIgnored: true,
        samples: [],
      };
      out.set(element, entry);
    }

    entry.count += 1;
    if (!ignored) entry.underIgnored = false;
    if (uidOf(el) !== '') entry.withUid += 1;
    if (stepChildren(el, rules).some((c) => uidOf(c) !== '')) entry.withStepChildren += 1;
    for (const name of Object.keys(attrs)) {
      entry.attrs[name] = (entry.attrs[name] ?? 0) + 1;
    }
    const named = attrs['name'];
    if (named !== undefined && named !== '' && !entry.samples.includes(named)) {
      if (entry.samples.length < MAX_SAMPLES) entry.samples.push(named);
    }

    const bucket = instances.get(element) ?? [];
    bucket.push({ attrs });
    instances.set(element, bucket);

    // Descend through ignored elements too: they are exactly where a rule file
    // that has fallen behind hides things, and this report exists to find them.
    // What is under one is reported but never proposed — see `underIgnored`.
    const beneathIgnored = ignored || isIgnored(el, rules);
    for (const child of childElements(el)) walk(child, beneathIgnored);
  };

  walk(root, false);

  const rootEntry = out.get(tagOf(root));
  if (rootEntry !== undefined) rootEntry.documentElement = true;

  for (const [element, entry] of out) {
    entry.targets = targetAttrs(instances.get(element) ?? [], uids);
  }
  return out;
}

/**
 * Attributes whose values name other elements, and what gates them.
 *
 * `uid` itself is excluded — it names this element, not another one.
 */
function targetAttrs(rows: readonly Instance[], uids: ReadonlySet<string>): TargetAttr[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row.attrs)) names.add(key);
  names.delete('uid');

  const out: TargetAttr[] = [];
  for (const attr of [...names].sort()) {
    const live: Instance[] = [];
    const dead: Instance[] = [];
    for (const row of rows) {
      const value = row.attrs[attr];
      if (value === undefined) continue;
      if (value !== '' && uids.has(value)) live.push(row);
      else dead.push(row);
    }
    if (live.length === 0) continue;

    const gate = findGate(attr, live, dead, names);
    out.push({ attr, live: live.length, dead: dead.length, ...(gate === null ? {} : { gate }) });
  }
  return out;
}

/**
 * The attribute whose value tells a live target from a stale one.
 *
 * Requires the live side to agree on a single value and the dead side to never
 * use it. With no dead instances there is nothing to separate and no gate is
 * claimed — an unconditional edge is the caller's decision to make, not a
 * conclusion this can reach from one example.
 */
function findGate(
  target: string,
  live: readonly Instance[],
  dead: readonly Instance[],
  names: ReadonlySet<string>,
): { attr: string; value: string } | null {
  if (dead.length === 0) return null;

  for (const attr of [...names].sort()) {
    if (attr === target) continue;
    const liveValues = new Set(live.map((r) => r.attrs[attr] ?? ''));
    if (liveValues.size !== 1) continue;
    const value = [...liveValues][0];
    if (value === undefined || value === '') continue;
    if (dead.some((r) => (r.attrs[attr] ?? '') === value)) continue;
    return { attr, value };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Folding a corpus                                                    */
/* ------------------------------------------------------------------ */

/**
 * One profile across many documents.
 *
 * Counts add. A gate is kept only where every document that saw the attribute
 * agrees on it: one file's coincidence is another file's counterexample, and a
 * corpus is the only place that distinction can be drawn.
 */
export function mergeProfiles(parts: readonly SchemaProfile[]): SchemaProfile {
  const out: SchemaProfile = new Map();

  for (const part of parts) {
    for (const [element, p] of part) {
      const entry = out.get(element);
      if (entry === undefined) {
        out.set(element, {
          ...p,
          attrs: { ...p.attrs },
          targets: p.targets.map((t) => ({ ...t })),
          samples: [...p.samples],
        });
        continue;
      }

      entry.count += p.count;
      entry.withUid += p.withUid;
      entry.withStepChildren += p.withStepChildren;
      entry.documentElement = entry.documentElement || p.documentElement;
      entry.underIgnored = entry.underIgnored && p.underIgnored;
      for (const [attr, n] of Object.entries(p.attrs)) {
        entry.attrs[attr] = (entry.attrs[attr] ?? 0) + n;
      }
      for (const named of p.samples) {
        if (entry.samples.length < MAX_SAMPLES && !entry.samples.includes(named)) {
          entry.samples.push(named);
        }
      }

      for (const t of p.targets) {
        const existing = entry.targets.find((e) => e.attr === t.attr);
        if (existing === undefined) {
          entry.targets.push({ ...t });
          continue;
        }
        existing.live += t.live;
        existing.dead += t.dead;
        const agree =
          existing.gate !== undefined &&
          t.gate !== undefined &&
          existing.gate.attr === t.gate.attr &&
          existing.gate.value === t.gate.value;
        if (!agree) delete existing.gate;
      }
      entry.targets.sort((a, b) => (a.attr < b.attr ? -1 : a.attr > b.attr ? 1 : 0));
    }
  }

  return out;
}

/** Everything the rule file has no answer for, commonest first. */
export function unknowns(p: SchemaProfile): ElementProfile[] {
  return [...p.values()]
    .filter((e) => !e.documentElement && !e.underIgnored)
    .filter((e) => e.status === 'unknown' || (e.status === 'step' && e.withStepChildren > 0))
    .sort((a, b) => b.count - a.count || (a.element < b.element ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* The fragment to paste                                               */
/* ------------------------------------------------------------------ */

/**
 * A `rules.yaml` fragment covering everything the rule file does not know.
 *
 * Deliberately a fragment and not a file: it is merged into an existing rule
 * file by a person who can see what is already there. Edge rules are emitted
 * commented out unless a gate was actually found, because an ungated `when: {}`
 * reads every stale target as a live edge — the failure spec 4.2 is about.
 *
 * Edge candidates are drawn from *every* element, not only the unrecognised
 * ones. A known step that has grown a new jump attribute is the harder case to
 * spot by reading, and it is silent: the parser has no rule for the attribute,
 * so the edge simply never appears. Attributes the rule file already maps are
 * left out.
 */
export function suggestRules(p: SchemaProfile, rules?: Rules): string {
  const rows = unknowns(p);
  const mapped = new Set(rules?.edges.map((e) => e.target) ?? []);
  const withTargets = [...p.values()]
    .filter((e) => !e.underIgnored)
    .map((e) => ({ element: e.element, targets: e.targets.filter((t) => !mapped.has(t.attr)) }))
    .filter((e) => e.targets.length > 0)
    .sort((a, b) => (a.element < b.element ? -1 : 1));

  if (rows.length === 0 && withTargets.length === 0) return '';

  const containers = rows.filter((e) => e.withStepChildren > 0);
  const leaves = rows.filter((e) => e.withStepChildren === 0 && e.withUid > 0);
  // No uid and no step children: it never becomes a node, so the rule file
  // should say so explicitly rather than leave it to raise a warning per file.
  const ignorable = rows.filter(
    (e) => e.withStepChildren === 0 && e.withUid === 0 && !e.documentElement,
  );

  const out: string[] = [];
  const list = (key: string, items: readonly ElementProfile[]): void => {
    if (items.length === 0) return;
    out.push(`${key}:`);
    for (const e of items) out.push(`  - ${e.element}   # ${describe(e)}`);
    out.push('');
  };

  list('containers', containers);
  list('steps', leaves);
  list('ignore', ignorable);

  if (withTargets.length > 0) {
    out.push('edges:');
    out.push('  # Candidate jump targets, found by matching attribute values');
    out.push('  # against the uids in the document. Check each `when:` before');
    out.push('  # using it: an ungated target holds a stale value whenever its');
    out.push('  # paired action is not a jump (spec 4.2).');
    for (const e of withTargets) {
      for (const t of e.targets) {
        const gate = t.gate;
        const prefix = gate === undefined ? '  # ' : '  ';
        const when = gate === undefined ? '{}  # NO GATE FOUND' : `{${gate.attr}: "${gate.value}"}`;
        out.push(`  # ${e.element}.${t.attr} — ${t.live} live, ${t.dead} stale`);
        out.push(`${prefix}- when:   ${when}`);
        out.push(`${prefix}  target: ${t.attr}`);
        out.push(`${prefix}  label:  "${t.attr}"`);
        out.push(`${prefix}  style:  solid`);
        out.push(`${prefix}  reason: branch`);
      }
    }
    out.push('');
  }

  return out.join('\n');
}

function describe(e: ElementProfile): string {
  const parts = [`${e.count}x`];
  if (e.withStepChildren > 0) parts.push(`holds steps in ${e.withStepChildren}`);
  else if (e.withUid === 0) parts.push('never carries a uid');
  if (e.targets.length > 0) parts.push(`targets: ${e.targets.map((t) => t.attr).join(', ')}`);
  if (e.samples.length > 0) parts.push(`e.g. "${e.samples[0]}"`);
  return parts.join(', ');
}
