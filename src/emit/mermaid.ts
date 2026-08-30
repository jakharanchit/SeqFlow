/**
 * Graph -> Mermaid `flowchart` text. Spec section 8.
 *
 * Determinism is the requirement, not a nicety (NFR-1). Two calls on the same
 * graph return byte-identical strings, and so do two parses of the same bytes.
 * Nothing here reads a clock, a random source, or `Map` iteration order beyond
 * document order, which the parser fixes.
 *
 * Pure: no React, no DOM, no I/O. Lives in emit/ alongside collapse.ts because
 * it is a presentation of the parse result, never a change to it.
 *
 * Three things are worth knowing before editing:
 *
 * - **Ids are the uid, sanitised.** Mermaid will not take a GUID verbatim: it
 *   carries hyphens, and 88 of the fixture's 133 uids start with a digit. So
 *   `n` + the GUID with hyphens stripped. Sequential `n0…n132` would read
 *   better and halve the file, but inserting one step renumbers everything
 *   after it and the Git diff — the entire point of emitting text — becomes
 *   noise.
 *
 * - **Every label is quoted.** Four names in the fixture carry Mermaid-hostile
 *   characters, all of the form `6C Pulse (10s)`. A rule that only fires on
 *   known-bad input is a rule nobody maintains, so quote unconditionally.
 *
 * - **The modes are collapse.** `depth N` is `visibleGraph` with every
 *   container deeper than N folded, which already lifts and deduplicates the
 *   edges. There is deliberately no second folding implementation here.
 */

import { displayName } from '../core/ancestry';
import type { Graph, NodeShape, Rules, SeqEdge, SeqNode } from '../core/types';
import { visibleGraph } from './collapse';

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export type MermaidMode =
  /** Every node, every edge. */
  | { kind: 'full' }
  /** Top-level sequences only — `depth 1` by another name. */
  | { kind: 'overview' }
  /** Expand to `depth`, fold everything below it. */
  | { kind: 'depth'; depth: number }
  /**
   * One top-level sequence expanded; its siblings folded to a single node
   * each, so cross-sequence jumps still have somewhere to land. `split`
   * emits one of these per top-level sequence plus an overview.
   */
  | { kind: 'scope'; uid: string };

export type Direction = 'TD' | 'LR';

export interface MermaidOptions {
  mode?: MermaidMode;
  direction?: Direction;
  /**
   * Draw expanded containers as `subgraph` blocks. Off produces a flat list of
   * steps, which some renderers lay out better on very deep files.
   */
  groups?: boolean;
  /**
   * uid -> href for `click` directives. Used by `split` to link the overview
   * to the per-sequence files. Iterated in emission order, never Map order.
   */
  links?: ReadonlyMap<string, string>;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export interface MermaidNode {
  uid: string;
  /** The sanitised id as it appears in the text. */
  id: string;
  /** Already escaped; still needs its quotes. */
  label: string;
  shape: NodeShape;
  /** An expanded container: emitted as a `subgraph`, not a node statement. */
  group: boolean;
  /** Steps hidden inside a folded sequence, when this is one. */
  collapsed?: number;
  depth: number;
}

/**
 * What the text says, before it is text. Exported so tests can assert node and
 * edge counts without parsing Mermaid, and so the UI can show them.
 */
export interface MermaidModel {
  /** Document order: a container immediately followed by its children. */
  nodes: MermaidNode[];
  /** Sorted by (src, reason, dst) — inherited, never re-sorted here. */
  edges: SeqEdge[];
  /** Expanded container uid -> visible child uids. */
  containers: Map<string, string[]>;
  roots: string[];
}

/* ------------------------------------------------------------------ */
/* Ids and labels                                                      */
/* ------------------------------------------------------------------ */

/**
 * `n` + the GUID with hyphens stripped. The `n` matters: Mermaid rejects an id
 * that starts with a digit, and 88 of the fixture's uids do.
 *
 * Anything outside `[A-Za-z0-9]` is replaced rather than dropped, so two uids
 * differing only in punctuation cannot collide.
 */
export function mermaidId(uid: string): string {
  return `n${uid.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/**
 * Text safe inside a Mermaid quoted string. Mermaid's own entity escapes are
 * used rather than backslashes, which it does not honour.
 */
export function escapeLabel(text: string): string {
  return text
    .replace(/&/g, '#amp;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\r?\n/g, ' ');
}

/** Shape delimiters. A folded sequence gets the subroutine box. */
function wrap(shape: NodeShape, label: string, folded: boolean): string {
  if (folded) return `[["${label}"]]`;
  switch (shape) {
    case 'diamond':
      return `{"${label}"}`;
    case 'hexagon':
      return `{{"${label}"}}`;
    case 'rounded':
      return `("${label}")`;
    case 'container':
      return `[["${label}"]]`;
    case 'rect':
    default:
      return `["${label}"]`;
  }
}

/* ------------------------------------------------------------------ */
/* Mode -> collapsed set                                               */
/* ------------------------------------------------------------------ */

/**
 * The containers a mode folds shut.
 *
 * `depth N` folds every container deeper than N, so the deepest *visible*
 * nodes sit at N + 1: the children of the last expanded container. On the
 * fixture that reproduces spec section 8's table exactly — depth 1 gives 4
 * nodes, depth 5 and beyond give all 133.
 */
export function collapsedFor(graph: Graph, mode: MermaidMode): Set<string> {
  const out = new Set<string>();
  switch (mode.kind) {
    case 'full':
      return out;
    case 'overview':
      return collapsedFor(graph, { kind: 'depth', depth: 1 });
    case 'depth':
      for (const uid of graph.containers.keys()) {
        const node = graph.nodes.get(uid);
        if (node !== undefined && node.depth > mode.depth) out.add(uid);
      }
      return out;
    case 'scope': {
      // Everything outside the scope folds to its top-level sequence, so a
      // jump out of this subtree still lands on a node the reader can name.
      const keep = new Set<string>([mode.uid, ...ancestorChain(graph, mode.uid)]);
      for (const uid of graph.containers.keys()) {
        if (keep.has(uid)) continue;
        if (isDescendant(graph, uid, mode.uid)) continue;
        const node = graph.nodes.get(uid);
        // Fold at the top level only; folding deeper would hide the sibling
        // inside an already-folded parent and gain nothing.
        if (node !== undefined && node.depth === 2) out.add(uid);
      }
      return out;
    }
  }
}

function ancestorChain(graph: Graph, uid: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([uid]);
  let cursor = graph.nodes.get(uid)?.parent ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = graph.nodes.get(cursor)?.parent ?? null;
  }
  return out;
}

function isDescendant(graph: Graph, uid: string, ancestor: string): boolean {
  return ancestorChain(graph, uid).includes(ancestor);
}

/** Top-level sequences: the root's container children. `split` emits one each. */
export function topLevelSequences(graph: Graph): SeqNode[] {
  const out: SeqNode[] = [];
  for (const uid of graph.containers.get(graph.root) ?? []) {
    if (!graph.containers.has(uid)) continue;
    const node = graph.nodes.get(uid);
    if (node !== undefined) out.push(node);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Model construction                                                  */
/* ------------------------------------------------------------------ */

export function mermaidModel(graph: Graph, mode: MermaidMode = { kind: 'full' }): MermaidModel {
  const view = visibleGraph(graph, collapsedFor(graph, mode));

  const nodes: MermaidNode[] = [];
  const seen = new Set<string>();

  const push = (uid: string): void => {
    if (seen.has(uid)) return;
    const node = view.nodes.get(uid);
    if (node === undefined) return;
    seen.add(uid);

    const group = view.containers.has(uid);
    const hidden = view.collapsedCounts.get(uid);
    const folded = !group && graph.containers.has(uid);
    const name = escapeLabel(displayName(node));
    const label =
      folded && hidden !== undefined && hidden > 0
        ? `${name}<br/>${hidden} step${hidden === 1 ? '' : 's'}`
        : name;

    nodes.push({
      uid,
      id: mermaidId(uid),
      label,
      shape: node.shape,
      group,
      ...(folded && hidden !== undefined ? { collapsed: hidden } : {}),
      depth: node.depth,
    });

    for (const child of view.containers.get(uid) ?? []) push(child);
  };

  const roots: string[] = [];
  for (const node of view.nodes.values()) {
    if (node.parent === null || !view.nodes.has(node.parent)) roots.push(node.uid);
  }
  for (const uid of roots) push(uid);
  // A file malformed enough to orphan a node still emits it rather than
  // silently dropping it — invariant 7, in spirit.
  for (const uid of view.nodes.keys()) push(uid);

  return { nodes, edges: view.edges, containers: view.containers, roots };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function edgeLine(edge: SeqEdge, indent: string): string {
  const src = mermaidId(edge.src);
  const dst = mermaidId(edge.dst);
  const label = edge.label === undefined ? null : escapeLabel(edge.label);
  if (edge.style === 'dotted') {
    return label === null
      ? `${indent}${src} -.-> ${dst}`
      : `${indent}${src} -. "${label}" .-> ${dst}`;
  }
  return label === null
    ? `${indent}${src} --> ${dst}`
    : `${indent}${src} -->|"${label}"| ${dst}`;
}

/**
 * The whole graph as one `flowchart`.
 *
 * `rules` is taken but unused today: shapes already reached the node through
 * the parser, which read them from the rule file. Keeping it in the signature
 * means a future label-verbosity option (rules.labels) does not change every
 * call site — and it keeps the "schema knowledge lives in rules.yaml"
 * invariant visibly in force.
 */
export function toMermaid(
  graph: Graph,
  _rules: Rules,
  options: MermaidOptions = {},
): string {
  const mode = options.mode ?? { kind: 'full' };
  const direction = options.direction ?? 'TD';
  const groups = options.groups ?? true;
  const model = mermaidModel(graph, mode);
  const byUid = new Map(model.nodes.map((n) => [n.uid, n]));

  const lines: string[] = [`flowchart ${direction}`];

  const emit = (node: MermaidNode, indent: string): void => {
    const children = model.containers.get(node.uid);
    if (groups && node.group && children !== undefined) {
      lines.push(`${indent}subgraph ${node.id}["${node.label}"]`);
      lines.push(`${indent}  direction ${direction === 'LR' ? 'LR' : 'TB'}`);
      for (const child of children) {
        const kid = byUid.get(child);
        if (kid !== undefined) emit(kid, `${indent}  `);
      }
      lines.push(`${indent}end`);
      return;
    }
    if (node.group && children !== undefined) {
      // groups off: the container itself is not drawn, only its steps.
      for (const child of children) {
        const kid = byUid.get(child);
        if (kid !== undefined) emit(kid, indent);
      }
      return;
    }
    lines.push(`${indent}${node.id}${wrap(node.shape, node.label, node.collapsed !== undefined)}`);
  };

  const rendered = new Set<string>();
  for (const uid of model.roots) {
    const node = byUid.get(uid);
    if (node === undefined) continue;
    emit(node, '  ');
    rendered.add(uid);
  }

  // Edges last and always at the top level: a Mermaid edge inside a subgraph
  // is legal but binds its endpoints to that subgraph, which silently moves a
  // node when a jump crosses a boundary.
  for (const edge of model.edges) lines.push(edgeLine(edge, '  '));

  if (options.links !== undefined) {
    for (const node of model.nodes) {
      const href = options.links.get(node.uid);
      if (href === undefined) continue;
      lines.push(`  click ${node.id} href "${escapeLabel(href)}"`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ */
/* Split                                                               */
/* ------------------------------------------------------------------ */

export interface MermaidFile {
  /** Suggested file name, including the `.mmd` extension. */
  name: string;
  /** Human title — the sequence name, or "Overview". */
  title: string;
  text: string;
}

/** `Pulse 1 - 6C` -> `pulse-1-6c`. Collision-free within one split by suffix. */
export function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'sequence' : base;
}

/**
 * Spec section 8's `split`: one file per *top-level* sequence plus a linked
 * overview. Taken literally, "one file per sequence" is 27 files for the
 * fixture — nobody checks that into a repo. Top-level is 3 plus the overview.
 *
 * `base` is the loaded file's stem, so `Sequence_XML` yields
 * `Sequence_XML.mmd` and `Sequence_XML.main.mmd`.
 */
export function toMermaidSplit(
  graph: Graph,
  rules: Rules,
  base: string,
  options: MermaidOptions = {},
): MermaidFile[] {
  const tops = topLevelSequences(graph);

  const used = new Set<string>();
  const fileFor = (node: SeqNode): string => {
    let name = slug(displayName(node));
    let n = 2;
    while (used.has(name)) name = `${slug(displayName(node))}-${n++}`;
    used.add(name);
    return `${base}.${name}.mmd`;
  };
  const names = new Map(tops.map((node) => [node.uid, fileFor(node)]));

  const files: MermaidFile[] = [
    {
      name: `${base}.mmd`,
      title: 'Overview',
      text: toMermaid(graph, rules, {
        ...options,
        mode: { kind: 'overview' },
        links: names,
      }),
    },
  ];

  for (const node of tops) {
    const others = new Map(
      [...names].filter(([uid]) => uid !== node.uid),
    );
    files.push({
      name: names.get(node.uid) ?? `${base}.${slug(displayName(node))}.mmd`,
      title: displayName(node),
      text: toMermaid(graph, rules, {
        ...options,
        mode: { kind: 'scope', uid: node.uid },
        links: others,
      }),
    });
  }

  return files;
}
