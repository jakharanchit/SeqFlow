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
  const result = await elk().layout(toElk(subject, edges, mode));
  return {
    nodes: applyLayout(subject, fromElk(result)),
    routes: edgeRoutes(result),
    elapsedMs: Math.round(performance.now() - started),
  };
}
