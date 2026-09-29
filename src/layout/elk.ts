/**
 * ELK, in a web worker.
 *
 * elkjs is a GWT-compiled Java port at roughly 1.5 MB and takes a few hundred
 * ms on the sample file. Off the main thread, so the canvas never freezes.
 *
 * The worker script is pulled in with `?raw` — plain text, inlined into the
 * bundle like `rules.yaml?raw` — and turned into a `Worker` by hand via
 * `createElkWorker` below, rather than via Vite's `?worker&inline`. That
 * matters for NFR-2/NFR-3 in a way `?worker&inline` itself does not deliver:
 * this plugin version emits `?worker&inline` as `new Worker("data:...")`, and
 * Chromium refuses to run a `data:` URL as a *top-level worker script* under
 * a `file://` origin — "Refused to cross-origin redirects of the top-level
 * worker script." A blob: URL, built from the same inlined source, is not
 * subject to that restriction and is exactly what every download in
 * `ui/download.ts`/`ui/raster.ts` already relies on working from file://.
 */

import ELK from 'elkjs/lib/elk-api';
import elkWorkerSource from 'elkjs/lib/elk-worker.min.js?raw';

import type { FlowEdge, FlowNode } from '../emit/flow';
import { applyLayout, edgeRoutes, fromElk, toElk, type ElkLike, type Point } from './elkGraph';

/**
 * How long a single layout may take before it is abandoned.
 *
 * ELK's cost is not a function of node count alone — a hierarchical, grouped
 * layout was measured at 4 s for a 2 295-node sequence folded to 295 visible
 * nodes, but a node with hundreds of inbound edges can change the shape of
 * the problem entirely.
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
        'at this size — fold some sequences in the outline',
    );
    this.name = 'LayoutTimeout';
  }
}

/**
 * A `blob:` URL only has to live long enough for `new Worker` to read it.
 * Revoking it on the next tick rather than immediately, because revoking at
 * once races the read in some browsers.
 */
function createElkWorker(): Worker {
  const blob = new Blob([elkWorkerSource], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return worker;
}

let instance: ElkLike | null = null;

function elk(): ElkLike {
  if (instance === null) {
    instance = new ELK({
      workerFactory: () => createElkWorker(),
    }) as unknown as ElkLike;
  }
  return instance;
}

export interface LayoutResult {
  nodes: FlowNode[];
  /**
   * Edge id -> ELK's orthogonal polyline, in absolute coordinates. Both the
   * canvas and the SVG export draw these rather than inventing a routing of
   * their own, which is what keeps the two pictures the same.
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
): Promise<LayoutResult> {
  const started = performance.now();

  // The worker cannot be interrupted, so this does not stop ELK — it stops the
  // *waiting*. The run is abandoned and the app keeps the arrangement it had,
  // which is a great deal better than a canvas that never comes back.
  let timer = 0;
  const result = await Promise.race([
    elk().layout(toElk(nodes, edges)),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new LayoutTimeout(Math.round(LAYOUT_TIMEOUT_MS / 1000))),
        LAYOUT_TIMEOUT_MS,
      ) as unknown as number;
    }),
  ]).finally(() => clearTimeout(timer));

  return {
    nodes: applyLayout(nodes, fromElk(result)),
    routes: edgeRoutes(result),
    elapsedMs: Math.round(performance.now() - started),
  };
}
