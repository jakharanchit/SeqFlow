/**
 * Hierarchical step numbers — `2.1.6.7`.
 *
 * The authoring tool addresses every step this way, and its text export quotes
 * jump targets by number: `Go To "3.3 - Stop Recording"`. Names collide four
 * and five ways in the sample file, so the number is the only address a reader
 * can carry between a test report, a review comment and this diagram.
 *
 * Pure, and derived from nothing but document order: the 1-based ordinal among
 * a container's children, dotted. Two properties fall out of that and both are
 * relied on elsewhere:
 *
 * - `visibleGraph` reuses the same `SeqNode` objects, so a number survives
 *   collapse with no work.
 * - `mergedGraph` inserts the *baseline* revision's nodes as ghosts, so a
 *   removed step keeps the number it had rather than borrowing its successor's.
 *
 * Note this numbers *nodes*. The tool also numbers a `ConditionStep`'s
 * `Comparison` child (`2.1.1.1`), which we carry as `childAttrs` rather than as
 * a node. That costs nothing: a Comparison is always the only child of a leaf,
 * so it never displaces a sibling and every node number still agrees with the
 * tool's. `tests/textExport.test.ts` pins the reconciliation.
 */

import type { Graph } from './types';

/**
 * uid -> step number. `''` where a node has no number: the document root, and
 * anything a malformed file has orphaned.
 *
 * A single parentless node is the document title, not step 1 — the sample's
 * outer `Sequence` "XTR Module Test" is unnumbered and its children are 1, 2,
 * 3. Where a file has several roots there is no title to speak of, so they are
 * numbered 1..n instead.
 *
 * A root is a node whose `parent` is null, and *only* that. A node naming a
 * parent the graph does not hold is an orphan, not a root, and it and its
 * subtree stay unnumbered. The distinction matters: counting an orphan as a
 * root would make it the second of two, which would number the real root `1`
 * and prefix every one of the file's 132 numbers with `1.`. One broken parent
 * reference must not renumber the whole document out from under a reader.
 */
export function stepNumbers(graph: Graph): Map<string, string> {
  const numbers = new Map<string, string>();
  for (const uid of graph.nodes.keys()) numbers.set(uid, '');

  const roots: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.parent === null) roots.push(node.uid);
  }

  const seen = new Set<string>();
  const visit = (uid: string, prefix: string): void => {
    if (seen.has(uid)) return; // a cycle cannot number twice
    seen.add(uid);
    numbers.set(uid, prefix);

    const children = graph.containers.get(uid) ?? [];
    let ordinal = 0;
    for (const child of children) {
      if (!graph.nodes.has(child)) continue;
      ordinal++;
      visit(child, prefix === '' ? `${ordinal}` : `${prefix}.${ordinal}`);
    }
  };

  if (roots.length === 1) {
    visit(roots[0]!, '');
  } else {
    roots.forEach((uid, i) => visit(uid, `${i + 1}`));
  }

  return numbers;
}

/** uid by step number — the reverse index. Used by search and by the tests. */
export function byStepNumber(graph: Graph): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.stepNumber !== '') out.set(node.stepNumber, node.uid);
  }
  return out;
}
