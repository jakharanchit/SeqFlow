/**
 * Resolution helpers — spec 4.3 and 4.4.
 *
 * Two facts drive this module:
 *
 *   - A jump target is almost never a leaf. 44 of the 45 targets in the sample
 *     resolve to a `Sequence`, so a target uid must be descended to the first
 *     executable leaf, recursively (4.3).
 *   - The successor of the last step in a sequence is the parent's next
 *     sibling, walking up until one exists (4.4).
 *
 * Everything here is a pure function over an element and a context. Element
 * traversal sticks to `nodeType` / `parentNode` / `childNodes` so the same code
 * runs against the browser DOMParser and @xmldom/xmldom, which does not
 * implement the ElementTraversal convenience properties.
 */

import type { Rules } from './types';

const ELEMENT_NODE = 1;

export interface ResolveContext {
  rules: Rules;
  /** uid -> element, built during the tree walk. */
  index: Map<string, Element>;
}

/** Element name, without namespace assumptions. */
export function tagOf(el: Element): string {
  return el.tagName;
}

export function uidOf(el: Element): string {
  return el.getAttribute('uid') ?? '';
}

/** Element children in document order. */
export function childElements(el: Element): Element[] {
  const out: Element[] = [];
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids.item(i);
    if (n && n.nodeType === ELEMENT_NODE) out.push(n as Element);
  }
  return out;
}

/** Holds other steps, per the rule file. */
export function isContainer(el: Element, rules: Rules): boolean {
  return rules.containers.includes(tagOf(el));
}

/** Produces no node — structural or inspector-only, per the rule file. */
export function isIgnored(el: Element, rules: Rules): boolean {
  return rules.ignore.includes(tagOf(el));
}

/**
 * An element that takes part in the flow: not ignored, and not the document
 * element. The document element wraps the sequence; it is a container for
 * walking purposes but is not itself a step.
 */
export function isStep(el: Element, rules: Rules): boolean {
  if (isIgnored(el, rules)) return false;
  return el.parentNode !== null && el.parentNode.nodeType === ELEMENT_NODE;
}

/** Step children of a container, in document order. */
export function stepChildren(el: Element, rules: Rules): Element[] {
  return childElements(el).filter((c) => !isIgnored(c, rules));
}

/**
 * Descend a container to its first executable leaf, recursively (spec 4.3).
 * Returns `el` itself when it is already a leaf, or null for an empty
 * container. Cycle-guarded, though a well-formed XML tree cannot cycle.
 */
export function firstLeaf(el: Element, rules: Rules): Element | null {
  const seen = new Set<Element>();
  let current: Element | null = el;

  while (current !== null) {
    if (seen.has(current)) return null;
    seen.add(current);

    if (!isContainer(current, rules)) return current;

    const kids: Element[] = stepChildren(current, rules);
    const next: Element | undefined = kids[0];
    if (next === undefined) return null; // empty container
    current = next;
  }
  return null;
}

/**
 * The fall-through successor (spec 4.4): the next sibling step, descended to
 * its first leaf. When the element is last in its parent, walk up and take the
 * parent's next sibling. Null at the end of the sequence — a terminal.
 */
export function nextSiblingLeaf(el: Element, rules: Rules): Element | null {
  let current: Element = el;

  for (;;) {
    const parent = current.parentNode;
    if (parent === null || parent.nodeType !== ELEMENT_NODE) return null;
    const parentEl = parent as Element;

    const siblings = stepChildren(parentEl, rules);
    const i = siblings.indexOf(current);
    if (i >= 0) {
      // Skip siblings that are empty containers rather than stopping at them.
      for (let j = i + 1; j < siblings.length; j++) {
        const candidate = siblings[j];
        if (candidate === undefined) continue;
        const leaf = firstLeaf(candidate, rules);
        if (leaf !== null) return leaf;
      }
    }

    // Last in this parent — continue upward. Stop at the document element,
    // which is not itself a step.
    if (!isStep(parentEl, rules)) return null;
    current = parentEl;
  }
}

/**
 * Look a jump target up by uid, then descend it to its first executable leaf.
 * Null when the uid is unknown or names an empty container.
 */
export function resolveTarget(uid: string, ctx: ResolveContext): Element | null {
  const el = ctx.index.get(uid);
  if (el === undefined) return null;
  return firstLeaf(el, ctx.rules);
}
