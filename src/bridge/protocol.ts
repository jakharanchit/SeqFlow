/**
 * The LabVIEW bridge's wire format — pure, no DOM, no `window`.
 *
 * LabVIEW's Execute JavaScript method marshals exactly one string in and one
 * optional string out (see `.claude/CLAUDE.md`'s LabVIEW integration notes).
 * Every command and event on the bridge is therefore JSON text, never a typed
 * object handed across the boundary directly. This module owns that
 * envelope — parsing an inbound command, validating its payload, and queuing
 * outbound events — so `bridge/install.ts` (which does touch `window`) stays
 * thin and this half stays Node-testable like the rest of `core/` and `emit/`.
 *
 * Defensive the way `emit/sidecar.ts` is defensive: a bad envelope names what
 * is wrong rather than throwing a generic parse error, and a batch with one
 * bad entry keeps the rest rather than failing the whole command — LabVIEW is
 * on the other end of this, not a person who can fix a typo and retry.
 */

export type ExecStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';

const EXEC_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'pass',
  'fail',
  'skipped',
]);

export function isExecStatus(value: unknown): value is ExecStatus {
  return typeof value === 'string' && EXEC_STATUSES.has(value);
}

/* ------------------------------------------------------------------ */
/* Inbound: LabVIEW -> app                                             */
/* ------------------------------------------------------------------ */

export type CommandType =
  | 'loadXml'
  | 'loadRuleFile'
  | 'loadLayout'
  | 'clearRuleFile'
  | 'selectStep'
  | 'setStepStatus'
  | 'setStepStatuses'
  | 'resetExecution'
  | 'exportMermaid'
  | 'exportSvg'
  | 'exportPng'
  | 'getState';

const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandType>([
  'loadXml',
  'loadRuleFile',
  'loadLayout',
  'clearRuleFile',
  'selectStep',
  'setStepStatus',
  'setStepStatuses',
  'resetExecution',
  'exportMermaid',
  'exportSvg',
  'exportPng',
  'getState',
]);

export interface Command {
  /** Echoed back on the sync reply and on any event a command triggers later
   * (e.g. `exportPngResult`), so LabVIEW can correlate without a lookup table.
   * `null` when the caller did not supply one. */
  id: string | null;
  type: CommandType;
  payload: unknown;
}

export class BridgeError extends Error {}

/** `{ id?, type, payload? }`, JSON text. Throws `BridgeError` naming what failed. */
export function parseCommand(text: string): Command {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BridgeError('not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new BridgeError('not an object');
  const value = raw as Record<string, unknown>;

  const type = value['type'];
  if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) {
    throw new BridgeError(`unknown command type ${JSON.stringify(type)}`);
  }
  const id = typeof value['id'] === 'string' ? value['id'] : null;
  return { id, type: type as CommandType, payload: value['payload'] };
}

/* ------------------------------------------------------------------ */
/* Command payloads                                                    */
/* ------------------------------------------------------------------ */

/**
 * `loadXml`, `loadRuleFile` and `loadLayout` all wrap the same two strings
 * `App.tsx`'s drop handler already reads off a dropped file — text content,
 * then a name for messages and titles.
 */
export interface FilePayload {
  text: string;
  fileName: string;
}

export function asFilePayload(payload: unknown): FilePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "text" and "fileName"');
  }
  const v = payload as Record<string, unknown>;
  if (typeof v['text'] !== 'string') throw new BridgeError('payload.text must be a string');
  if (typeof v['fileName'] !== 'string') {
    throw new BridgeError('payload.fileName must be a string');
  }
  return { text: v['text'], fileName: v['fileName'] };
}

export interface SelectStepPayload {
  uid: string;
}

export function asSelectStepPayload(payload: unknown): SelectStepPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "uid"');
  }
  const v = payload as Record<string, unknown>;
  if (typeof v['uid'] !== 'string') throw new BridgeError('payload.uid must be a string');
  return { uid: v['uid'] };
}

export interface StepStatusPayload {
  uid: string;
  status: ExecStatus;
}

export function asStepStatusPayload(payload: unknown): StepStatusPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "uid" and "status"');
  }
  const v = payload as Record<string, unknown>;
  if (typeof v['uid'] !== 'string') throw new BridgeError('payload.uid must be a string');
  if (!isExecStatus(v['status'])) {
    throw new BridgeError(
      `payload.status must be one of pending/running/pass/fail/skipped, got ${JSON.stringify(v['status'])}`,
    );
  }
  return { uid: v['uid'], status: v['status'] };
}

export interface StepStatusesPayload {
  statuses: StepStatusPayload[];
}

/**
 * A batch update for live execution highlighting. One malformed entry does
 * not lose the rest — the same choice `applySidecar` makes for a layout file,
 * for the same reason: a status feed running for the length of a test is not
 * worth interrupting over one bad row.
 */
export function asStepStatusesPayload(payload: unknown): StepStatusesPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "statuses"');
  }
  const v = payload as Record<string, unknown>;
  if (!Array.isArray(v['statuses'])) throw new BridgeError('payload.statuses must be an array');

  const statuses: StepStatusPayload[] = [];
  for (const entry of v['statuses']) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['uid'] === 'string' && isExecStatus(e['status'])) {
      statuses.push({ uid: e['uid'], status: e['status'] });
    }
  }
  return { statuses };
}

/* ------------------------------------------------------------------ */
/* Outbound: app -> LabVIEW                                            */
/* ------------------------------------------------------------------ */

export interface BridgeEvent {
  type: string;
  payload: unknown;
  /** `Date.now()` at the time it was queued — an ordering aid for LabVIEW,
   * never a key; nothing here reads it back. */
  at: number;
}

/**
 * The default outbound transport is polling, not push — see the LabVIEW
 * integration notes: whether Execute JavaScript's control can call back into
 * LabVIEW asynchronously is not confirmed for the 2026 release. A Helper Loop
 * drains this on a timer via `pollEvents()` (see `install.ts`) regardless of
 * whether a real push channel turns out to exist; only the transport
 * underneath changes if it does, not this queue or the event shapes it holds.
 *
 * Capped rather than unbounded: a LabVIEW side that stops polling (crashed,
 * closed, never wired up) must not turn a running app into a slow memory leak.
 * Oldest events are dropped first, the same choice `layoutCache` in App.tsx
 * makes for its own bounded cache.
 */
const QUEUE_LIMIT = 500;

export class EventQueue {
  private items: BridgeEvent[] = [];

  push(type: string, payload?: unknown): void {
    this.items.push({ type, payload, at: Date.now() });
    if (this.items.length > QUEUE_LIMIT) {
      this.items.splice(0, this.items.length - QUEUE_LIMIT);
    }
  }

  /** Returns every queued event and empties the queue. */
  drain(): BridgeEvent[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}

export function serialiseEvents(events: readonly BridgeEvent[]): string {
  return JSON.stringify(events);
}
