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
 * is wrong rather than throwing a generic parse error — LabVIEW is on the
 * other end of this, not a person who can fix a typo and retry.
 */

import { flatEvent, toAsciiJson } from './labview';

/**
 * Which of the two views the workspace is showing.
 *
 * The tree and the flowchart are one app sharing selection and collapse
 * state, but they are two independently addressable *views* of it —
 * an embedded LabVIEW panel with room for only one should be able to say
 * which, without the operator reaching for a menu. Named on the wire rather
 * than numbered: a boolean would say which pane is hidden and would have to
 * grow a second one the day a third view appears.
 */
export type ViewMode = 'tree' | 'canvas' | 'both';

const VIEW_MODES: ReadonlySet<string> = new Set<ViewMode>(['tree', 'canvas', 'both']);

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.has(value);
}

/**
 * What a fresh layout — a load, a re-parse, a collapse or expand — does to the
 * viewport. `fit` zooms out to the whole diagram (the old, only behaviour);
 * `top` and `centre` keep the current zoom and move to the diagram's first
 * step or its middle; `keep` leaves zoom and pan exactly where they were.
 */
export type ZoomMode = 'fit' | 'top' | 'centre' | 'keep';

const ZOOM_MODES: ReadonlySet<string> = new Set<ZoomMode>(['fit', 'top', 'centre', 'keep']);

export function isZoomMode(value: unknown): value is ZoomMode {
  return typeof value === 'string' && ZOOM_MODES.has(value);
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
  | 'exportMermaid'
  | 'exportSvg'
  | 'exportPng'
  | 'exportPdf'
  | 'setView'
  | 'setZoomMode'
  | 'getState';

const COMMAND_TYPES: ReadonlySet<string> = new Set<CommandType>([
  'loadXml',
  'loadRuleFile',
  'loadLayout',
  'clearRuleFile',
  'selectStep',
  'exportMermaid',
  'exportSvg',
  'exportPng',
  'exportPdf',
  'setView',
  'setZoomMode',
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

/**
 * The `id` out of a command that never became a `Command` — best effort, for
 * the error envelope. A caller that supplied an id and got a parse failure
 * back still has to correlate it with the request it sent; reporting
 * `id: null` there makes the one reply LabVIEW most needs to match the one
 * it cannot. Only reached on the failure path, so re-parsing the text costs
 * nothing on a normal call.
 */
export function peekCommandId(text: string): string | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === 'object' && raw !== null) {
      const id = (raw as Record<string, unknown>)['id'];
      if (typeof id === 'string') return id;
    }
  } catch {
    // Not JSON at all — there is no id to find.
  }
  return null;
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

export interface ViewPayload {
  view: ViewMode;
}

export function asViewPayload(payload: unknown): ViewPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "view"');
  }
  const v = (payload as Record<string, unknown>)['view'];
  if (!isViewMode(v)) {
    throw new BridgeError('payload.view must be one of "tree", "canvas", "both"');
  }
  return { view: v };
}

export interface ZoomModePayload {
  mode: ZoomMode;
}

export function asZoomModePayload(payload: unknown): ZoomModePayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new BridgeError('payload must be an object with "mode"');
  }
  const v = (payload as Record<string, unknown>)['mode'];
  if (!isZoomMode(v)) {
    throw new BridgeError('payload.mode must be one of "fit", "top", "centre", "keep"');
  }
  return { mode: v };
}

/**
 * `exportPng`'s and `exportPdf`'s optional payload. Both views are of the
 * canvas as it is now — its folds, its highlight:
 * - `full` (the default): the whole diagram;
 * - `viewport`: only what is visible in the pane, at its current zoom.
 *
 * `depth` was removed on 2026-10-04 and is refused by name, so a LabVIEW VI
 * built against the old payload fails loudly instead of exporting the wrong view.
 */
export type ExportView = 'full' | 'viewport';

export interface ExportOptions {
  view: ExportView;
}

export function asExportPayload(payload: unknown): ExportOptions {
  if (payload === undefined || payload === null) return { view: 'full' };
  if (typeof payload !== 'object') throw new BridgeError('payload must be an object');
  const v = payload as Record<string, unknown>;
  if ('depth' in v) {
    throw new BridgeError('payload.depth is no longer supported; use "view": "full" or "viewport"');
  }
  const view = v['view'];
  if (view === undefined || view === null) return { view: 'full' };
  if (view !== 'full' && view !== 'viewport') {
    throw new BridgeError('payload.view must be one of "full", "viewport"');
  }
  return { view };
}

/* ------------------------------------------------------------------ */
/* Outbound: app -> LabVIEW                                            */
/* ------------------------------------------------------------------ */

/**
 * Which side caused an event the app is reporting back.
 *
 * Only `stepSelected` carries it today, and only because selection is the one
 * piece of state both ends write: LabVIEW sends `selectStep`, the app reports
 * `stepSelected`, and a LabVIEW side that reacts to the report by selecting
 * again has built a loop. `origin: "host"` is the app saying "this is your own
 * command coming back" — ignorable — where `"user"` is an operator clicking
 * the canvas, which is the event worth acting on.
 */
export type EventOrigin = 'user' | 'host';

export interface BridgeEvent {
  type: string;
  payload: unknown;
  /** `Date.now()` at the time it was queued — an ordering aid for LabVIEW,
   * never a key; nothing here reads it back. */
  at: number;
  /** Present on `stepSelected` and nothing else. A missing key unflattens
   * into an empty string against LabVIEW's cluster, which is exactly what
   * "this event has no origin" should look like there. */
  origin?: EventOrigin;
}

/**
 * The fallback outbound transport, and the one the browser console uses.
 *
 * Fallback / non-LabVIEW event path. When LabVIEW is attached via
 * `attachLabVIEW()`, events are pushed directly, and this queue only holds
 * pre-attach and failed-push events. LabVIEW should not poll this.
 *
 * A LabVIEW Web Browser control that exposes `LabVIEW.FireUserEvent` can hand
 * the bridge a push sink instead (`setEventSink` in `install.ts`), and while
 * one is attached nothing lands here at all. The queue is what a page with no
 * sink uses, what a sink that threw falls back to, and what `pollEvents()`
 * drains — the event shapes are the same either way, which is the point: only
 * the transport differs.
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
    this.pushEvent({ type, payload, at: Date.now() });
  }

  pushEvent(event: BridgeEvent): void {
    this.items.push(event);
    this.trim();
  }

  /**
   * Put events back at the front, in order — what a push sink that threw
   * mid-flush leaves behind. The cap still applies, and still drops the
   * oldest first, so a requeue into an already-full queue loses the events
   * furthest back rather than the ones that just failed to deliver.
   */
  unshift(events: readonly BridgeEvent[]): void {
    if (events.length === 0) return;
    this.items.unshift(...events);
    this.trim();
  }

  private trim(): void {
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
  return toAsciiJson(events);
}

/**
 * The same queue, flattened one level: `payload` arrives as a JSON *string*
 * rather than a nested object.
 *
 * LabVIEW's Unflatten From JSON needs a concrete type for every field, and
 * an event's payload is a different shape per event type — `stepSelected`'s
 * seven strings, `fileLoaded`'s two counts, `exportPngResult`'s base64. There
 * is no one cluster for that, and a Variant field only defers the problem.
 * Handing each payload over as text lets the Helper Loop unflatten it a
 * second time, in the case structure that already knows which type it is.
 *
 * `undefined` serialises as `"null"`, not as a missing key: an event with no
 * payload still has to unflatten into the same cluster as one that has one.
 *
 * Both this and `serialiseEvents` drain the same queue, so poll one or the
 * other, never both — whichever runs first takes the events.
 */
export function serialiseEventsFlat(events: readonly BridgeEvent[]): string {
  return toAsciiJson(events.map(flatEvent));
}

/**
 * Bumped whenever the set of methods on `window.SeqFlowBridge`, or what one
 * of them returns, changes — so a LabVIEW module built against an older
 * `dist/index.html` can say so at start-up instead of failing on the first
 * call to a method that is not there.
 *
 * 1: the original surface — `handleCommand` returned nothing.
 * 2: every method returns a string; `pollEventsFlat`, `isReady`, `ping`,
 *    `version` added; `id` echoed on the sync envelope.
 * 3: `setEventSink` added — a push channel that replaces polling while it is
 *    attached; `stepSelected` grew a top-level `origin`.
 * 4: `attachLabVIEW` added — pushes straight into a LabVIEW User Event, and
 *    every JSON string the bridge returns or fires is pure ASCII.
 */
export const BRIDGE_PROTOCOL_VERSION = '4';
