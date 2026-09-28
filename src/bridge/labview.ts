/**
 * The LabVIEW host adapter: the ASCII-safe JSON the bridge hands across, and
 * the one call that pushes an event into a LabVIEW User Event.
 *
 * Inert in a plain browser — `pushToLabVIEW` finds no `window.LabVIEW` and
 * returns `false`, and the caller queues the event as it always did.
 */

import type { BridgeEvent } from './protocol';

declare global {
  interface Window {
    /** Injected by LabVIEW's Web Browser Control. Absent everywhere else. */
    LabVIEW?: { FireUserEvent?: (refnum: number, message: string) => unknown };
    /** The last `FireUserEvent` failure, for someone probing from LabVIEW. */
    __seqflowError?: string;
  }
}

/**
 * `JSON.stringify`, with every char from U+007F up written as `\uXXXX`.
 *
 * LabVIEW strings are bytes shown as Windows-1252, so UTF-8 `›` arrives as
 * `â€º`. Escaped, it is plain ASCII and still the same JSON. A surrogate pair
 * becomes two escapes, which JSON allows. This is the only place escaping
 * happens: if LabVIEW's Unflatten turns out to decode `\u203a` wrongly, the
 * strategy changes here and nowhere else.
 */
export function toAsciiJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * One event as LabVIEW's `Bridge Event` cluster reads it: `payload` is itself
 * a JSON *string*, unflattened a second time in the case that knows its shape.
 * `origin` rides along only on `stepSelected`.
 */
export function flatEvent(e: BridgeEvent): Record<string, unknown> {
  return {
    type: e.type,
    at: e.at,
    payload: toAsciiJson(e.payload ?? null),
    ...(e.origin === undefined ? {} : { origin: e.origin }),
  };
}

/** Fire `evt` into the User Event behind `refnum`. `false` means the caller
 * keeps it: not attached, not inside LabVIEW, or the fire threw. */
export function pushToLabVIEW(refnum: number | null, evt: BridgeEvent): boolean {
  const fire = window.LabVIEW?.FireUserEvent;
  if (refnum === null || typeof fire !== 'function') return false;
  try {
    fire.call(window.LabVIEW, refnum, toAsciiJson(flatEvent(evt)));
    return true;
  } catch (err) {
    window.__seqflowError = err instanceof Error ? err.message : String(err);
    return false;
  }
}
