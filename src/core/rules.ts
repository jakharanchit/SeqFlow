/**
 * Rule file loader.
 *
 * This is the one module allowed to know the shape of `rules.yaml` — see
 * CLAUDE.md invariant 2. It knows the shape of the rule file, never the shape
 * of a test sequence: no element name of the source schema appears here.
 *
 * Validation is loud on purpose. A malformed rule file must name the offending
 * key rather than quietly yielding an empty graph.
 */

import { parse as parseYaml } from 'yaml';
import type {
  Durations,
  EdgeRule,
  EdgeStyle,
  LoopRule,
  NodeKind,
  NodeShape,
  Rules,
} from './types';

/** Thrown for any structural problem in the rule file. */
export class RuleFileError extends Error {
  readonly key: string;

  constructor(key: string, detail: string) {
    super(`rules.yaml: ${key}: ${detail}`);
    this.name = 'RuleFileError';
    this.key = key;
  }
}

const SHAPES: readonly NodeShape[] = ['rect', 'diamond', 'hexagon', 'rounded', 'container'];
const KINDS: readonly NodeKind[] = ['action', 'decision', 'criteria', 'jump', 'container'];
const STYLES: readonly EdgeStyle[] = ['solid', 'dotted'];
// 'fallthrough' and 'loop' are listed so a rule file naming one gets the
// message that says where it actually comes from, rather than "expected one
// of ...". Both are rejected below.
const REASONS: readonly EdgeRule['reason'][] = [
  'fallthrough',
  'goto',
  'branch',
  'criteria',
  'loop',
];

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function req(root: Raw, key: string): unknown {
  const v = root[key];
  if (v === undefined || v === null) {
    throw new RuleFileError(key, 'required key is missing');
  }
  return v;
}

function strArray(root: Raw, key: string): string[] {
  const v = req(root, key);
  if (!Array.isArray(v)) {
    throw new RuleFileError(key, `expected a list, got ${typeof v}`);
  }
  v.forEach((item, i) => {
    if (typeof item !== 'string') {
      throw new RuleFileError(`${key}[${i}]`, `expected a string, got ${typeof item}`);
    }
  });
  return v as string[];
}

/** An optional `{ Element: [name, ...] }` mapping. Absent means empty. */
function strListMap(root: Raw, key: string): Record<string, string[]> {
  const v = root[key];
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) {
    throw new RuleFileError(key, `expected a mapping, got ${typeof v}`);
  }
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!Array.isArray(val) || val.some((s) => typeof s !== 'string')) {
      throw new RuleFileError(`${key}.${k}`, 'expected a list of strings');
    }
    out[k] = val as string[];
  }
  return out;
}

/**
 * A `{ Element: value }` mapping constrained to `allowed` and required to
 * carry a `default`. Both `shapes` and `kinds` take this form.
 */
function enumMap<T extends string>(
  root: Raw,
  key: string,
  allowed: readonly T[],
): Record<string, T> & { default: T } {
  const v = req(root, key);
  if (!isRecord(v)) {
    throw new RuleFileError(key, `expected a mapping, got ${typeof v}`);
  }
  const out: Record<string, T> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string' || !allowed.includes(val as T)) {
      throw new RuleFileError(
        `${key}.${k}`,
        `expected one of ${allowed.join(' | ')}, got ${JSON.stringify(val)}`,
      );
    }
    out[k] = val as T;
  }
  if (out['default'] === undefined) {
    throw new RuleFileError(key, 'must define a "default" entry');
  }
  return out as Record<string, T> & { default: T };
}

/**
 * `durations: { waits: [...], timeouts: [...] }`. Both lists optional; absent
 * means the duration estimate has nothing to measure and says so, rather than
 * reporting zero. Spec 7.6.
 */
function durations(root: Raw): Durations {
  const v = root['durations'];
  if (v === undefined || v === null) return { waits: [], timeouts: [] };
  if (!isRecord(v)) {
    throw new RuleFileError('durations', `expected a mapping, got ${typeof v}`);
  }
  const list = (key: 'waits' | 'timeouts'): string[] => {
    if (v[key] === undefined || v[key] === null) return [];
    return strArray(v, key).map((attr) => {
      if (attr === '') throw new RuleFileError(`durations.${key}`, 'attribute name is empty');
      return attr;
    });
  };
  const out = { waits: list('waits'), timeouts: list('timeouts') };
  for (const attr of out.waits) {
    if (out.timeouts.includes(attr)) {
      throw new RuleFileError(
        'durations',
        `"${attr}" is listed as both a wait and a timeout; they are reported ` +
          'separately and one attribute cannot be both',
      );
    }
  }
  return out;
}

/**
 * `loops: { Element: { count: attr, period: attr } }`.
 *
 * Optional; absent means no element repeats and no back edge is ever drawn.
 * Both inner keys are optional too — a loop with no count attribute still
 * gets its back edge, just without a `×N` label.
 */
function loopRules(root: Raw): Record<string, LoopRule> {
  const v = root['loops'];
  if (v === undefined || v === null) return {};
  if (!isRecord(v)) {
    throw new RuleFileError('loops', `expected a mapping, got ${typeof v}`);
  }

  const out: Record<string, LoopRule> = {};
  for (const [element, raw] of Object.entries(v)) {
    const at = `loops.${element}`;
    if (!isRecord(raw)) {
      throw new RuleFileError(at, 'expected a mapping of count/period to attribute names');
    }
    const attr = (key: 'count' | 'period'): string | undefined => {
      const value = raw[key];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string' || value === '') {
        throw new RuleFileError(`${at}.${key}`, 'expected a non-empty attribute name');
      }
      return value;
    };
    const count = attr('count');
    const period = attr('period');
    out[element] = {
      ...(count === undefined ? {} : { count }),
      ...(period === undefined ? {} : { period }),
    };
  }
  return out;
}

function edgeRules(root: Raw): EdgeRule[] {
  const v = req(root, 'edges');
  if (!Array.isArray(v)) {
    throw new RuleFileError('edges', `expected a list, got ${typeof v}`);
  }
  if (v.length === 0) {
    throw new RuleFileError('edges', 'must declare at least one edge rule');
  }

  return v.map((raw, i): EdgeRule => {
    const at = `edges[${i}]`;
    if (!isRecord(raw)) throw new RuleFileError(at, 'expected a mapping');

    const target = raw['target'];
    if (typeof target !== 'string' || target === '') {
      throw new RuleFileError(`${at}.target`, 'expected a non-empty attribute name');
    }

    // `when: {}` is legal and means unconditional. A missing key is not:
    // target attributes hold stale values when their paired action is not a
    // jump, so the gate must be a deliberate choice. See spec 4.2.
    const whenRaw = raw['when'];
    if (whenRaw === undefined) {
      throw new RuleFileError(
        `${at}.when`,
        'required — use {} for an unconditional edge. Target attributes hold stale ' +
          'values when their paired action is not a jump (spec 4.2)',
      );
    }
    if (!isRecord(whenRaw)) {
      throw new RuleFileError(`${at}.when`, 'expected a mapping of attribute to value');
    }
    const when: Record<string, string> = {};
    for (const [k, val] of Object.entries(whenRaw)) {
      if (typeof val !== 'string') {
        throw new RuleFileError(`${at}.when.${k}`, 'expected a string value');
      }
      when[k] = val;
    }

    const style = raw['style'] ?? 'solid';
    if (typeof style !== 'string' || !STYLES.includes(style as EdgeStyle)) {
      throw new RuleFileError(`${at}.style`, `expected one of ${STYLES.join(' | ')}`);
    }

    const reason = raw['reason'];
    if (typeof reason !== 'string' || !REASONS.includes(reason as EdgeRule['reason'])) {
      throw new RuleFileError(`${at}.reason`, `expected one of ${REASONS.join(' | ')}`);
    }
    if (reason === 'fallthrough' || reason === 'loop') {
      throw new RuleFileError(
        `${at}.reason`,
        `${reason} is synthesised by the parser, not declared as an edge rule` +
          (reason === 'loop' ? ' — see the `loops:` section' : ''),
      );
    }

    const label = raw['label'] ?? null;
    if (label !== null && typeof label !== 'string') {
      throw new RuleFileError(`${at}.label`, 'expected a string or null');
    }

    return {
      when,
      target,
      label,
      style: style as EdgeStyle,
      reason: reason as EdgeRule['reason'],
    };
  });
}

/** Parse and validate rule-file text. Throws {@link RuleFileError}. */
export function loadRules(yamlText: string): Rules {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    throw new RuleFileError('<document>', `not valid YAML — ${(err as Error).message}`);
  }
  if (!isRecord(doc)) {
    throw new RuleFileError('<document>', 'expected a top-level mapping');
  }

  const version = req(doc, 'version');
  if (typeof version !== 'number') {
    throw new RuleFileError('version', `expected a number, got ${typeof version}`);
  }
  if (version !== 1) {
    throw new RuleFileError('version', `unsupported rule file version ${version}`);
  }

  const threshold = doc['convergence_threshold'] ?? 3;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 1) {
    throw new RuleFileError('convergence_threshold', 'expected a positive number');
  }

  const containers = strArray(doc, 'containers');
  if (containers.length === 0) {
    throw new RuleFileError('containers', 'must declare at least one container element');
  }

  return {
    version,
    containers,
    ignore: doc['ignore'] === undefined ? [] : strArray(doc, 'ignore'),
    ...(doc['steps'] === undefined ? {} : { steps: strArray(doc, 'steps') }),
    inspectorChildren: strListMap(doc, 'inspector_children'),
    shapes: enumMap(doc, 'shapes', SHAPES),
    kinds: enumMap(doc, 'kinds', KINDS),
    edges: edgeRules(doc),
    labels: strListMap(doc, 'labels'),
    signalAttrs: doc['signal_attrs'] === undefined ? [] : strArray(doc, 'signal_attrs'),
    externalRefs: doc['external_refs'] === undefined ? [] : strArray(doc, 'external_refs'),
    durations: durations(doc),
    loops: loopRules(doc),
    convergenceThreshold: threshold,
  };
}
