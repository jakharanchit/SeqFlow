/**
 * The layout sidecar — spec 7.8, Phase 3 task 6.
 *
 * **This is the only file the tool may ever write** (invariant 4). It never
 * writes sequence XML, and nothing here changes that: the sidecar holds
 * positions, a layout mode and a collapsed set, all keyed by uid, and the
 * parser never reads it.
 *
 * All 133 positions serialise to about 8 KB, so there is no reason to store a
 * subset, round harder than the layout does, or compress. Storing the mode and
 * the collapsed set alongside is not decoration: reloading a file and getting
 * the arrangement back with every sequence re-expanded is not "restored".
 *
 * Pure. Serialising and parsing only — the download lives in the UI.
 */

import type { FlowNode } from './flow';

/** Bumped only on a breaking change. A reader rejects what it does not know. */
export const SIDECAR_VERSION = 1;

export interface Sidecar {
  seqviz: number;
  /** The sequence file this arrangement was made for. Advisory, not a key. */
  file: string;
  /** `grouped` or `compact`. Positions mean different things in each. */
  mode: string;
  /** Collapsed container uids, sorted. */
  collapsed: string[];
  /**
   * uid -> [x, y], as the canvas holds them: parent-relative inside a group,
   * absolute at the top level. Re-applied to the same structure, so the frame
   * they are in never has to be recorded.
   */
  positions: Record<string, [number, number]>;
}

export class SidecarError extends Error {}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

export function toSidecar(
  fileName: string,
  mode: string,
  collapsed: ReadonlySet<string>,
  nodes: readonly FlowNode[],
): Sidecar {
  const positions: Record<string, [number, number]> = {};
  // Sorted, so two saves of the same arrangement are the same bytes and a Git
  // diff of the sidecar shows what actually moved.
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    positions[node.id] = [round(node.position.x), round(node.position.y)];
  }
  return {
    seqviz: SIDECAR_VERSION,
    file: fileName,
    mode,
    collapsed: [...collapsed].sort(),
    positions,
  };
}

/** Two decimals. ELK places on sub-pixel boundaries; nobody needs more. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function serialiseSidecar(sidecar: Sidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export function parseSidecar(text: string): Sidecar {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SidecarError('not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SidecarError('not an object');
  const value = raw as Record<string, unknown>;

  if (value['seqviz'] !== SIDECAR_VERSION) {
    throw new SidecarError(
      `expected "seqviz": ${SIDECAR_VERSION}, found ${JSON.stringify(value['seqviz'])} — not a seqviz layout file`,
    );
  }

  const positions: Record<string, [number, number]> = {};
  const rawPositions = value['positions'];
  if (typeof rawPositions !== 'object' || rawPositions === null) {
    throw new SidecarError('no "positions" object');
  }
  for (const [uid, point] of Object.entries(rawPositions as Record<string, unknown>)) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      // One bad entry is not worth failing a whole arrangement over.
      continue;
    }
    positions[uid] = [point[0], point[1]];
  }

  const collapsed = Array.isArray(value['collapsed'])
    ? value['collapsed'].filter((c): c is string => typeof c === 'string')
    : [];

  return {
    seqviz: SIDECAR_VERSION,
    file: typeof value['file'] === 'string' ? value['file'] : '',
    mode: value['mode'] === 'compact' ? 'compact' : 'grouped',
    collapsed,
    positions,
  };
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

export interface Applied {
  nodes: FlowNode[];
  /** Nodes that took a saved position. */
  placed: number;
  /**
   * uids in the sidecar that this file does not have. It means the sequence
   * changed under the layout — worth saying, never worth failing over.
   */
  unknown: string[];
  /** Visible nodes with no saved position. These keep the ELK arrangement. */
  unplaced: string[];
}

export function applySidecar(nodes: readonly FlowNode[], sidecar: Sidecar): Applied {
  const present = new Set(nodes.map((n) => n.id));
  const unknown = Object.keys(sidecar.positions)
    .filter((uid) => !present.has(uid))
    .sort();
  const unplaced: string[] = [];
  let placed = 0;

  const out = nodes.map((node) => {
    const point = sidecar.positions[node.id];
    if (point === undefined) {
      unplaced.push(node.id);
      return node;
    }
    placed++;
    return { ...node, position: { x: point[0], y: point[1] } };
  });

  return { nodes: out, placed, unknown, unplaced };
}

/** `Sequence_XML.xml` -> `Sequence_XML.layout.json`. */
export function sidecarName(stem: string): string {
  return `${stem}.layout.json`;
}
