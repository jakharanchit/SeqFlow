/**
 * XML -> Graph.
 *
 * Generic tree walking only. Every decision about what an element *means* is
 * read from the rule file — see CLAUDE.md invariant 2. No element name of the
 * source schema appears in this file.
 *
 * The three rules that make this a flowchart rather than a picture of the XML
 * tree all live here:
 *
 *   4.2  A jump target attribute is read only when its paired action selects
 *        it. Otherwise it holds a stale value. The `when` gate does this.
 *   4.3  A jump target resolves to a container; descend to its first leaf.
 *   4.4  Fall-through from the last step in a sequence walks up the tree.
 */

import { stepNumbers } from './numbering';
import {
  childElements,
  firstLeaf,
  isContainer,
  isIgnored,
  lastLeaf,
  nextSiblingLeaf,
  resolveTarget,
  stepChildren,
  tagOf,
  uidOf,
  type ResolveContext,
} from './resolve';
import type {
  Graph,
  NodeKind,
  NodeShape,
  ParseOptions,
  Rules,
  SeqEdge,
  SeqNode,
  Warning,
} from './types';

/** Raised when the document cannot be parsed or holds no sequence at all. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function attrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const list = el.attributes;
  for (let i = 0; i < list.length; i++) {
    const a = list.item(i);
    if (a) out[a.name] = a.value;
  }
  return out;
}

/**
 * uid -> element, for jump resolution and for the inspector's raw XML view.
 * Exported so the UI can serialise the selected element without the core
 * reaching for XMLSerializer (invariant 1).
 */
export function indexElements(doc: Document, rules: Rules): Map<string, Element> {
  const index = new Map<string, Element>();
  const root = doc.documentElement;
  if (!root) return index;

  const walk = (el: Element): void => {
    for (const child of childElements(el)) {
      if (isIgnored(child, rules)) continue;
      const uid = uidOf(child);
      if (uid !== '') index.set(uid, child);
      walk(child);
    }
  };

  const rootUid = uidOf(root);
  if (rootUid !== '') index.set(rootUid, root);
  walk(root);
  return index;
}

/**
 * The elements the flow starts from. The document element wraps the sequence
 * and is not itself a step unless it carries a uid of its own.
 */
function topLevel(doc: Document, rules: Rules): Element[] {
  const root = doc.documentElement;
  if (!root) throw new ParseError('document has no root element');
  if (uidOf(root) !== '') return [root];

  // A child of the document element starts the flow only if it can produce a
  // node or descend to one: it carries a uid, or it holds children that do.
  // A uid-less, childless sibling is document furniture — a temperature
  // profile, a revision block — and treating it as a root makes the file look
  // like it has two.
  const all = stepChildren(root, rules);
  const kids = all.filter((el) => uidOf(el) !== '' || isContainer(el, rules));
  if (kids.length === 0) {
    const seen = [...new Set(all.map(tagOf))];
    throw new ParseError(
      `document element <${tagOf(root)}> contains no steps — is this a test sequence? ` +
        (seen.length === 0
          ? 'it has no element children'
          : `it holds ${seen.join(', ')}, none of which carry a uid or hold steps`),
    );
  }
  return kids;
}

function shapeOf(el: Element, rules: Rules): NodeShape {
  if (isContainer(el, rules)) return 'container';
  return rules.shapes[tagOf(el)] ?? rules.shapes.default;
}

function kindOf(el: Element, rules: Rules): NodeKind {
  if (isContainer(el, rules)) return 'container';
  return rules.kinds[tagOf(el)] ?? rules.kinds.default;
}

/**
 * Attributes lifted from non-step children, e.g. a ConditionStep's Comparison
 * element, which holds the actual condition. Keyed by child element name.
 */
function childAttrsOf(
  el: Element,
  rules: Rules,
): Record<string, Record<string, string>[]> | undefined {
  const wanted = rules.inspectorChildren[tagOf(el)];
  if (wanted === undefined || wanted.length === 0) return undefined;

  const out: Record<string, Record<string, string>[]> = {};

  // Depth-first, because the element carrying the detail is often wrapped:
  // <UserInputBoolean><Message><Text text="…"/></Message></UserInputBoolean>,
  // and the fixture's own <DynamicName><Text text="…"/></DynamicName>. The
  // walk stops at anything that produces its own node, so a nested step's
  // attributes are never attributed to an ancestor.
  const walk = (parent: Element): void => {
    for (const child of childElements(parent)) {
      const name = tagOf(child);
      if (wanted.includes(name)) {
        const bucket = out[name] ?? (out[name] = []);
        bucket.push(attrsOf(child));
      }
      if (uidOf(child) === '') walk(child);
    }
  };
  walk(el);

  return Object.keys(out).length === 0 ? undefined : out;
}

/* ------------------------------------------------------------------ */
/* Tree walk — nodes                                                   */
/* ------------------------------------------------------------------ */

interface WalkResult {
  nodes: Map<string, SeqNode>;
  containers: Map<string, string[]>;
  warnings: Warning[];
}

function walkNodes(roots: Element[], rules: Rules): WalkResult {
  const nodes = new Map<string, SeqNode>();
  const containers = new Map<string, string[]>();
  const warnings: Warning[] = [];
  const knownSteps = rules.steps;

  /**
   * Returns the uids this element contributes to its parent's child list.
   * Normally one; none for an element that cannot be given an identity, and
   * several for a uid-less container, which is transparent (see below).
   */
  const visit = (el: Element, parent: string | null, depth: number): string[] => {
    const uid = uidOf(el);
    const name = el.getAttribute('name') ?? '';
    const container = isContainer(el, rules);

    // A uid-less container is transparent: it gets no node of its own — IDs
    // are the uid and are never derived (invariant 3) — but its children are
    // the flow and are walked into the enclosing parent at the same depth.
    //
    // This is what a wrapper element looks like. The shipped fixture's
    // <TestSequence> is the document element, where `topLevel` steps over it;
    // in another dialect the same element sits one level down inside a
    // <TestSpecification>, and dropping it there discards the whole document.
    if (uid === '' && container) {
      const lifted: string[] = [];
      for (const child of stepChildren(el, rules)) {
        lifted.push(...visit(child, parent, depth));
      }
      return lifted;
    }

    if (uid === '') {
      // No uid, no children to lift: no identity and nothing to descend to.
      // Warn rather than drop it silently (NFR-6).
      warnings.push({
        code: 'UNKNOWN_ELEMENT',
        uid: '',
        message:
          `<${tagOf(el)}>${name ? ` "${name}"` : ''} has no uid attribute and ` +
          'cannot be given a node identity — skipped',
      });
      return [];
    }

    const declared = rules.containers.includes(tagOf(el));

    if (!declared && container) {
      // The rule file calls this a leaf and the file holds steps inside it.
      // Walked as a container regardless, because the alternative loses the
      // subtree in silence — but the disagreement is reported, not absorbed.
      warnings.push({
        code: 'UNKNOWN_CONTAINER',
        uid,
        message:
          `<${tagOf(el)}>${name ? ` "${name}"` : ''} holds ` +
          `${stepChildren(el, rules).filter((c) => uidOf(c) !== '').length} child ` +
          'step(s) but is not listed as a container — walked as one. Add it to ' +
          '`containers` in rules.yaml',
      });
    } else if (knownSteps !== undefined && !container && !knownSteps.includes(tagOf(el))) {
      // An element the rule file does not recognise still renders, with the
      // default shape, and is collected as a warning. Spec section 3, NFR-6.
      warnings.push({
        code: 'UNKNOWN_ELEMENT',
        uid,
        message:
          `<${tagOf(el)}> is not listed in the rule file — rendered with the ` +
          'default shape. Add it to `steps` in rules.yaml',
      });
    }

    const childAttrs = childAttrsOf(el, rules);
    const node: SeqNode = {
      uid,
      element: tagOf(el),
      name,
      kind: kindOf(el, rules),
      shape: shapeOf(el, rules),
      parent,
      depth,
      // Filled in once the whole tree is known — a number is a fact about a
      // node's position among its siblings, which this walk has not finished
      // establishing yet. See `applyStepNumbers` below.
      stepNumber: '',
      attrs: attrsOf(el),
      ...(childAttrs === undefined ? {} : { childAttrs }),
    };
    nodes.set(uid, node);

    if (container) {
      const kids = stepChildren(el, rules);
      if (kids.length === 0) {
        warnings.push({
          code: 'EMPTY_CONTAINER',
          uid,
          message: `sequence "${name}" contains no steps`,
        });
      }
      const childUids: string[] = [];
      for (const child of kids) childUids.push(...visit(child, uid, depth + 1));
      containers.set(uid, childUids);
    }

    return [uid];
  };

  for (const root of roots) visit(root, null, 1);
  return { nodes, containers, warnings };
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether an edge rule applies to this element at all: every attribute its
 * `when` clause gates on must be present. An unconditional rule applies when
 * its target attribute carries a value.
 *
 * "Applies" and "matches" are deliberately different questions. A
 * TestCriteriaEvaluation has a pass exit and a fail exit — both rules apply —
 * but only the fail one matches, so the step still falls through. A
 * ConditionStep whose two actions are both jumps has no fall-through at all.
 */
function ruleApplies(el: Element, when: Record<string, string>, target: string): boolean {
  const keys = Object.keys(when);
  if (keys.length === 0) return (el.getAttribute(target) ?? '') !== '';
  return keys.every((k) => el.hasAttribute(k));
}

function ruleMatches(el: Element, when: Record<string, string>): boolean {
  return Object.entries(when).every(([k, v]) => el.getAttribute(k) === v);
}

function buildEdges(
  nodes: Map<string, SeqNode>,
  index: Map<string, Element>,
  rules: Rules,
  warnings: Warning[],
): SeqEdge[] {
  const edges: SeqEdge[] = [];
  const ctx: ResolveContext = { rules, index };

  for (const node of nodes.values()) {
    // Containers group; they never carry flow. Edges run leaf to leaf.
    if (node.kind === 'container') continue;
    const el = index.get(node.uid);
    if (el === undefined) continue;

    let applicable = 0;
    let jumps = 0;

    for (const rule of rules.edges) {
      if (!ruleApplies(el, rule.when, rule.target)) continue;
      applicable++;
      if (!ruleMatches(el, rule.when)) continue; // stale target — spec 4.2
      jumps++;

      // Some attributes name definitions outside this file. Expected, and not
      // an unresolved target.
      if (rules.externalRefs.includes(rule.target)) continue;

      const targetUid = el.getAttribute(rule.target) ?? '';
      if (targetUid === '') {
        warnings.push({
          code: 'UNRESOLVED_TARGET',
          uid: node.uid,
          attr: rule.target,
          message: `"${node.name}" selects ${rule.target} but the attribute is empty`,
        });
        continue;
      }

      const dst = resolveTarget(targetUid, ctx); // descends containers — 4.3
      if (dst === null) {
        warnings.push({
          code: 'UNRESOLVED_TARGET',
          uid: node.uid,
          attr: rule.target,
          value: targetUid,
          message:
            `"${node.name}" jumps to ${targetUid}, which is not a step in this ` +
            'file or is an empty sequence',
        });
        continue;
      }

      edges.push({
        src: node.uid,
        dst: uidOf(dst),
        ...(rule.label === null ? {} : { label: rule.label }),
        style: rule.style,
        reason: rule.reason,
      });
    }

    // A step falls through unless every one of its exits is an explicit jump.
    if (applicable > 0 && applicable === jumps) continue;

    const next = nextSiblingLeaf(el, rules); // walks up the tree — 4.4
    if (next === null) continue; // end of the sequence: a terminal, not a fault
    edges.push({
      src: node.uid,
      dst: uidOf(next),
      style: 'solid',
      reason: 'fallthrough',
    });
  }

  edges.push(...loopEdges(nodes, index, rules));

  // Deterministic order. Invariant 6, and the basis of stable Mermaid output.
  edges.sort((a, b) => {
    const ka = `${a.src}|${a.reason}|${a.dst}`;
    const kb = `${b.src}|${b.reason}|${b.dst}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return edges;
}

/**
 * Back edges for repeating containers — `loops:` in the rule file.
 *
 * One edge per loop, from where a repetition ends to where the next one
 * starts, labelled with the iteration count when the rule file names an
 * attribute holding it. The loop's last leaf still falls through as well:
 * a loop with a count exits, and both edges are real.
 *
 * `reason: 'loop'` is what makes this affordable. It marks the one edge in
 * the graph that closes a cycle, so `duration.ts` can leave it out of the
 * path arithmetic while the canvas, the SVG and the Mermaid output all draw
 * it like any other edge.
 */
function loopEdges(
  nodes: Map<string, SeqNode>,
  index: Map<string, Element>,
  rules: Rules,
): SeqEdge[] {
  const out: SeqEdge[] = [];

  for (const node of nodes.values()) {
    const rule = rules.loops[node.element];
    if (rule === undefined) continue;
    const el = index.get(node.uid);
    if (el === undefined) continue;

    const first = firstLeaf(el, rules);
    const last = lastLeaf(el, rules);
    if (first === null || last === null) continue;
    // A one-step loop would be a self-edge, which reads as a mistake rather
    // than as repetition; the count on the container's own label says it.
    if (first === last) continue;

    const count = rule.count === undefined ? '' : (el.getAttribute(rule.count) ?? '');
    out.push({
      src: uidOf(last),
      dst: uidOf(first),
      ...(count === '' ? {} : { label: `×${count}` }),
      style: 'dotted',
      reason: 'loop',
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function parse(xml: string, opts: ParseOptions): Graph {
  const { rules, domParser } = opts;

  // Browser DOMParser reports a malformed document by returning one holding a
  // <parsererror>; @xmldom/xmldom throws. Normalise both to ParseError so the
  // drop banner has something readable to show.
  let doc: Document;
  try {
    doc = domParser.parseFromString(xml, 'application/xml');
  } catch (err) {
    throw new ParseError(`XML is not well formed — ${(err as Error).message}`);
  }
  const failure = doc.getElementsByTagName('parsererror').item(0);
  if (failure) {
    // Browsers wrap the real message in a rendered error page; keep the line
    // that names the fault and drop the boilerplate around it.
    const detail = (failure.textContent ?? 'parse error')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /error on line|error:/i.test(line));
    throw new ParseError(`XML is not well formed — ${detail ?? 'parse error'}`);
  }
  if (!doc.documentElement) throw new ParseError('document has no root element');

  const roots = topLevel(doc, rules);
  const { nodes, containers, warnings } = walkNodes(roots, rules);

  // A graph with no nodes is a failure, not a result. Returning one produced
  // an empty `flowchart TD` and an exit code of zero, which is the worst way
  // to be wrong: nothing downstream can tell it from a file that genuinely
  // has no steps, and CI passes.
  if (nodes.size === 0) {
    const seen = [...new Set(roots.flatMap((el) => stepChildren(el, rules).map(tagOf)))];
    throw new ParseError(
      `<${tagOf(doc.documentElement)}> produced no steps — every element under it ` +
        'either lacks a uid or is listed in `ignore`' +
        (seen.length === 0 ? '' : `. It holds ${seen.join(', ')}`),
    );
  }

  const first = roots[0];
  if (first === undefined) throw new ParseError('document contains no steps');

  // The outermost *node*, which is not always `roots[0]`: a uid-less wrapper
  // is transparent and contributes no node, so the root is the first thing the
  // walk actually kept. `nodes` is filled in document order, so this is it.
  let rootUid = '';
  for (const node of nodes.values()) {
    if (node.parent === null) {
      rootUid = node.uid;
      break;
    }
  }

  const entryEl = firstLeaf(first, rules);
  if (entryEl === null) {
    throw new ParseError(
      `sequence "${first.getAttribute('name') ?? rootUid}" contains no executable step`,
    );
  }

  const index = indexElements(doc, rules);
  const edges = buildEdges(nodes, index, rules, warnings);

  const graph: Graph = {
    root: rootUid,
    entry: uidOf(entryEl),
    nodes,
    edges,
    containers,
    warnings,
  };
  applyStepNumbers(graph);
  return graph;
}

/**
 * Write each node's step number, now that the whole tree exists.
 *
 * This mutates the nodes the walk above just built and nothing else — the only
 * graph it can reach is the one being returned. Kept out of `walkNodes` so the
 * numbering stays a pure function of a finished `Graph` and can be tested,
 * and re-derived, without a parser.
 */
function applyStepNumbers(graph: Graph): void {
  for (const [uid, number] of stepNumbers(graph)) {
    const node = graph.nodes.get(uid);
    if (node !== undefined) node.stepNumber = number;
  }
}
