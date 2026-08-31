/**
 * seqviz core types.
 *
 * These types are the contract between the parser and everything downstream.
 * Nothing in this file may import from React or touch the DOM.
 */

export type NodeKind =
  | 'action'
  | 'decision'
  | 'criteria'
  | 'jump'
  | 'container';

export type NodeShape = 'rect' | 'diamond' | 'hexagon' | 'rounded' | 'container';

export type EdgeStyle = 'solid' | 'dotted';

/**
 * Why an edge exists. Also the sort key component that makes Mermaid output
 * deterministic — see CLAUDE.md invariant 6.
 */
export type EdgeReason = 'fallthrough' | 'goto' | 'branch' | 'criteria' | 'loop';

export interface SeqNode {
  /** GUID from the XML `uid` attribute, verbatim. Never derived. */
  uid: string;
  /** XML element name, e.g. "WaitStep", "ConditionStep". */
  element: string;
  /** The `name` attribute. NOT unique — do not use as a key. */
  name: string;
  kind: NodeKind;
  shape: NodeShape;
  /** uid of the containing Sequence, or null at the root. */
  parent: string | null;
  /** Nesting depth from the document root. */
  depth: number;
  /**
   * Hierarchical step number — `2.1.6.7`. The address the authoring tool's own
   * text export uses, and the only one that survives the file's colliding
   * names. `''` on the document root and on anything orphaned. Derived from
   * document order alone; see `numbering.ts`.
   */
  stepNumber: string;
  /**
   * Full attribute set, verbatim. The parser does not decide what matters;
   * the inspector panel renders all of it.
   */
  attrs: Record<string, string>;
  /**
   * Attributes lifted from non-step children, e.g. a ConditionStep's
   * Comparison element. Keyed by child element name.
   */
  childAttrs?: Record<string, Record<string, string>[]>;
}

export interface SeqEdge {
  src: string;
  dst: string;
  /** "pass" | "fail" | "true" | "false" | undefined */
  label?: string;
  style: EdgeStyle;
  reason: EdgeReason;
}

export type WarningCode =
  | 'UNKNOWN_ELEMENT'
  /**
   * An element the rule file calls a leaf that nonetheless holds uid-bearing
   * children. It is walked as a container anyway — dropping the subtree would
   * make steps vanish in silence, which invariant 7 forbids — but the rule
   * file and the file disagree and a reader should know which one won.
   */
  | 'UNKNOWN_CONTAINER'
  | 'UNRESOLVED_TARGET'
  | 'EMPTY_CONTAINER'
  | 'NO_SUCCESSOR';

export interface Warning {
  code: WarningCode;
  /** uid of the node the warning concerns. */
  uid: string;
  /** Attribute name, where relevant. */
  attr?: string;
  value?: string;
  message: string;
}

export interface Graph {
  /** uid of the outermost Sequence. */
  root: string;
  /** uid of the first executable leaf — where the flow actually starts. */
  entry: string;
  nodes: Map<string, SeqNode>;
  /** Sorted by (src, reason, dst). Do not rely on insertion order. */
  edges: SeqEdge[];
  /** Sequence uid -> ordered child uids, document order. */
  containers: Map<string, string[]>;
  warnings: Warning[];
}

/* ------------------------------------------------------------------ */
/* Rule file                                                           */
/* ------------------------------------------------------------------ */

export interface EdgeRule {
  /**
   * Attribute/value pairs that must all match for this edge to be emitted.
   * An empty object means unconditional.
   *
   * This gate is not optional. Target attributes are populated even when the
   * paired action is "Continue", holding stale values. See spec section 4.2.
   */
  when: Record<string, string>;
  /** Attribute holding the target uid. */
  target: string;
  label: string | null;
  style: EdgeStyle;
  reason: EdgeReason;
}

export interface Rules {
  version: number;
  containers: string[];
  ignore: string[];
  /**
   * Recognised leaf step elements. Optional: when present, an element in step
   * position that is absent from this list still renders, with the default
   * shape, and raises an UNKNOWN_ELEMENT warning (spec section 3, NFR-6).
   * When absent, no such warning is raised.
   */
  steps?: string[];
  inspectorChildren: Record<string, string[]>;
  shapes: Record<string, NodeShape> & { default: NodeShape };
  kinds: Record<string, NodeKind> & { default: NodeKind };
  edges: EdgeRule[];
  labels: Record<string, string[]>;
  signalAttrs: string[];
  externalRefs: string[];
  /**
   * Attributes holding a duration in seconds. Kept as two lists, never one:
   * a wait is time the sequence spends on purpose and a timeout is an upper
   * bound it only reaches when something is slow, and adding them together
   * produces a figure 41x out on the sample. See spec 7.6.
   */
  durations: Durations;
  /**
   * Container elements that repeat. Keyed by element name; see `LoopRule`.
   * Absent means no element loops and no back edge is ever drawn.
   */
  loops: Record<string, LoopRule>;
  convergenceThreshold: number;
}

export interface Durations {
  waits: string[];
  timeouts: string[];
}

/**
 * A repeating container. The back edge runs from the container's last leaf to
 * its first, carrying `reason: 'loop'` so that path arithmetic can exclude it
 * (see `duration.ts`) while the diagram still draws it.
 */
export interface LoopRule {
  /** Attribute holding the iteration count. Optional — an unlabelled loop. */
  count?: string;
  /** Attribute holding the period in seconds, for the timing report. */
  period?: string;
}

/* ------------------------------------------------------------------ */
/* Parser entry point                                                  */
/* ------------------------------------------------------------------ */

export interface ParseOptions {
  rules: Rules;
  /**
   * Injected so the core stays testable under Node. Pass window.DOMParser in
   * the browser, @xmldom/xmldom in tests.
   */
  domParser: DOMParser;
}

export type Parse = (xml: string, opts: ParseOptions) => Graph;
