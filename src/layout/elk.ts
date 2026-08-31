/**
 * ELK, in a web worker.
 *
 * elkjs is a GWT-compiled Java port at roughly 1.5 MB and takes a few hundred
 * ms on the sample file. Off the main thread, so the canvas never freezes.
 *
 * `?worker&inline` matters for NFR-2/NFR-3: the worker is emitted as an inline
 * blob rather than a separate asset, so the built page stays a single file and
 * works from file:// with no network.
 */

import ELK from 'elkjs/lib/elk-api';
// eslint-disable-next-line import/no-unresolved -- Vite worker import
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker&inline';

import type { FlowEdge, FlowNode } from '../emit/flow';
import {
  applyLayout,
  edgeRoutes,
  fromElk,
  nodesForMode,
  toElk,
  type ElkLike,
  type LayoutMode,
  type Point,
} from './elkGraph';

/**
 * How long a single layout may take before it is abandoned.
 *
 * ELK's cost is not a function of node count alone. Measured: a 2 295-node
 * sequence folded to 295 visible nodes lays out grouped in 4 s and **compact in
 * 60 s** — the wrapping strategy meets a node with hundreds of inbound edges
 * and the shape of the problem changes entirely.
 *
 * Node count can therefore be budgeted for (see `autoCollapse`) but not relied
 * on, and the corpus is a database nobody here has read. A wall-clock ceiling
 * is the only guard that holds for a file we have not seen: past it the tool
 * says so and keeps the diagram it already had, instead of appearing to hang.
 */
export const LAYOUT_TIMEOUT_MS = 60000;

/** Thrown when a layout runs past {@link LAYOUT_TIMEOUT_MS}. */
export class LayoutTimeout extends Error {
  constructor(seconds: number) {
    super(
      `layout gave up after ${seconds} s. This graph is too tangled to arrange ` +
        'at this size — fold some sequences in the outline, or stay in Grouped mode',
    );
    this.name = 'LayoutTimeout';
  }
}

let instance: ElkLike | null = null;

function elk(): ElkLike {
  if (instance === null) {
    instance = new ELK({
      workerFactory: () => new ElkWorker(),
    }) as unknown as ElkLike;
  }
  return instance;
}

export interface LayoutResult {
  nodes: FlowNode[];
  /**
   * Edge id -> ELK's orthogonal polyline, in absolute coordinates. The canvas
   * ignores these — React Flow draws its own smoothstep curves — but the SVG
   * export draws them rather than inventing a routing of its own.
   */
  routes: Map<string, Point[]>;
  /** Wall-clock ms, for the status bar. NFR-5 budgets 2 s. */
  elapsedMs: number;
}

/**
 * Lay the graph out and return repositioned nodes. Edges are unchanged — React
 * Flow routes them from the node positions.
 */
export async function layout(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  mode: LayoutMode = 'grouped',
): Promise<LayoutResult> {
  const subject = nodesForMode(nodes, mode);
  const started = performance.now();

  // The worker cannot be interrupted, so this does not stop ELK — it stops the
  // *waiting*. The run is abandoned and the app keeps the arrangement it had,
  // which is a great deal better than a canvas that never comes back.
  let timer = 0;
  const result = await Promise.race([
    elk().layout(toElk(subject, edges, mode)),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new LayoutTimeout(Math.round(LAYOUT_TIMEOUT_MS / 1000))),
        LAYOUT_TIMEOUT_MS,
      ) as unknown as number;
    }),
  ]).finally(() => clearTimeout(timer));

  return {
    nodes: applyLayout(subject, fromElk(result)),
    routes: edgeRoutes(result),
    elapsedMs: Math.round(performance.now() - started),
  };
}
