/**
 * Wires `protocol.ts`'s command/event envelope onto `window`, for LabVIEW's
 * Execute JavaScript method to call.
 *
 * `installBridge` is the only thing in this file that touches `window`, and
 * `App.tsx` calls it once, from a mount effect, with a `BridgeHandlers` object
 * whose functions read from refs rather than closing over render-time state —
 * see the comment on `installBridge`'s call site in `App.tsx` for why.
 *
 * **Every method here returns a string, synchronously, and never throws.**
 * That is not defensiveness for its own sake: Execute JavaScript will not
 * return a value from function-wrapped code — `(function(){return 'hi'})()`
 * comes back empty — so LabVIEW can do no processing on the JS side and can
 * send nothing but a plain method call. Everything a caller could otherwise
 * have computed in a wrapper has to be in the return value already, and a
 * thrown exception is indistinguishable at that boundary from a method that
 * returned nothing at all.
 *
 * Two entry points on `window.SeqFlowBridge`, matching how Execute JavaScript
 * actually marshals data (one string in, one optional string out):
 *
 * - `handleCommand(text)` — fire-and-forget. Returns `{"ok":true,"id":...}`
 *   once the command is *accepted*; anything that fails is reported both in
 *   that envelope and through the event queue as a `commandError`, since an
 *   async failure has no envelope left to land in and there is nothing on the
 *   LabVIEW side to catch a thrown JS exception from an async call.
 * - `handleCommandSync(text)` — LabVIEW sets *Wait for Return Value* = TRUE and
 *   gets `{"ok":true,"result":...,"id":...}` or
 *   `{"ok":false,"error":"...","id":...}` back as a JSON string. Reserved for handlers that return a value synchronously
 *   (loads, selection, the text/SVG exports, `getState`) — `exportPng` cannot
 *   go through this path at all: rasterising to a canvas is asynchronous, and
 *   a synchronous Execute JavaScript call has no way to wait on it even if the
 *   engine has full Promise support. It always dispatches through
 *   `handleCommand` and reports its result later as an `exportPngResult` (or
 *   `exportPngError`) event.
 *
 * Plus three raw pass-through methods — `loadXml`, `loadRuleFile`,
 * `loadLayout` — one per member of the load family, which all share the same
 * `(text, fileName)` shape. Building a `{type, payload}` envelope for these
 * on the LabVIEW side means Bundle by Name and Flatten to JSON before a
 * single string ever reaches this page, which is ceremony the general
 * envelope earns everywhere else (10 command shapes through one dispatch
 * surface) but not here, where the whole payload
 * *is* the string LabVIEW already has in hand. `Arg` is the file's text,
 * verbatim — not JSON, so pasting raw XML straight into Execute JavaScript's
 * Argument field, the thing that reads most natural to do by hand, works.
 * `fileName` is a second, optional argument on the JS side (there is no
 * second channel through Execute JavaScript's own Argument to carry it
 * dynamically without going back to a JSON envelope) — it only ever affects
 * the toolbar title, export file names and error-message prefixes, never
 * parsing, so a call with no name at all still loads the file correctly.
 *
 * Plus `pollEvents` / `pollEventsFlat` (the outbound queue, nested or with
 * each payload pre-stringified — see `serialiseEventsFlat`) and three
 * diagnostics that take no argument: `isReady`, `ping`, `version`.
 *
 * Outbound, `setEventSink` replaces that polling with push where the host can
 * take it — a LabVIEW Web Browser control that exposes `LabVIEW.FireUserEvent`
 * hands over a closure and stops running a 200 ms timer. It is the one method
 * here that does not return a string, because its argument is a JS function
 * and its caller is therefore JS. Polling stays: it is the fallback when no
 * sink is attached, what a sink that threw falls back *to*, and the only way
 * to exercise the bridge from a browser console.
 *
 * `attachLabVIEW(refnum)` is that push with the closure written here instead
 * of in a VI: it fires each event straight into a LabVIEW User Event (see
 * `labview.ts`) and takes precedence over any sink while attached.
 *
 * Every JSON string returned or fired is pure ASCII — see `toAsciiJson`.
 *
 * `docs/LABVIEW-EVENTS.md` is the exact reference for all of it, generated
 * from this file and `App.tsx` — every method's return shape and every event
 * payload key.
 */

import {
  BridgeError,
  EventQueue,
  asFilePayload,
  asSelectStepPayload,
  asViewPayload,
  asZoomModePayload,
  asExportPayload,
  parseCommand,
  peekCommandId,
  serialiseEvents,
  serialiseEventsFlat,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeEvent,
  type Command,
  type EventOrigin,
  type ExportOptions,
  type ViewMode,
  type ZoomMode,
} from './protocol';
import { pushToLabVIEW, toAsciiJson } from './labview';

export interface PngResult {
  /** Base64, no `data:` prefix — Execute JavaScript's return channel is a
   * plain string and LabVIEW's own file-write VIs expect raw base64. */
  base64: string;
  width: number;
  height: number;
}

export interface BridgeHandlers {
  loadXml(text: string, fileName: string): void;
  loadRuleFile(text: string, fileName: string): void;
  loadLayout(text: string, fileName: string): void;
  clearRuleFile(): void;
  selectStep(uid: string): void;
  setView(view: ViewMode): void;
  setZoomMode(mode: ZoomMode): void;
  exportMermaid(): string;
  exportSvg(): string;
  exportPng(options: ExportOptions): Promise<PngResult>;
  /** Same shape as PNG; width/height are the page size in pt. */
  exportPdf(options: ExportOptions): Promise<PngResult>;
  getState(): Record<string, unknown>;
}

/**
 * A push channel out of the page, in place of polling.
 *
 * The newer LabVIEW Web Browser control exposes `LabVIEW.FireUserEvent` to
 * code run through Execute JavaScript, so LabVIEW can hand the bridge a
 * closure that fires a User Event and stop draining a queue on a timer:
 *
 * ```js
 * var refnum = JSON.parse(Arg).refnum;
 * window.SeqFlowBridge.setEventSink(function (evt) {
 *   LabVIEW.FireUserEvent(refnum, JSON.stringify(evt));
 * });
 * return 0;
 * ```
 *
 * The sink takes the event *object*; serialising it is the caller's job, so
 * nothing here has to guess which of the two wire shapes a host wants. That
 * is also what keeps this file host-agnostic — there is no `LabVIEW` global
 * anywhere in it, and the snippet above is the only LabVIEW-specific code in
 * the whole arrangement.
 */
export type EventSink = (evt: BridgeEvent) => void;

export interface SeqFlowBridgeApi {
  /** Fire-and-forget. Returns `{"ok":true,"id":...}` once the command is
   * accepted — not once it has finished; an async one like `exportPng` is
   * still only starting. Parse and validation failures come back as
   * `{"ok":false,"error":"...","id":...}` *and* as a `commandError` event,
   * so a Helper Loop that logs those keeps working unchanged. */
  handleCommand(text: string): string;
  handleCommandSync(text: string): string;
  /** Drains and returns the outbound queue as an ASCII JSON array of
   * `{type, payload, at}`, payload nested.
   *
   * Fallback / non-LabVIEW event path. When LabVIEW is attached via
   * `attachLabVIEW()`, events are pushed directly, and this queue only holds
   * pre-attach and failed-push events. LabVIEW should not poll this. */
  pollEvents(): string;
  /** The same drain with each payload pre-stringified — what a LabVIEW
   * Helper Loop should poll, since Unflatten From JSON cannot decode a
   * nested payload whose shape varies by event type. Drains the same queue
   * as `pollEvents`: poll one, never both. */
  pollEventsFlat(): string;
  /** `"true"` once `installBridge` has finished. A LabVIEW Initialize case
   * gates its first command on this rather than on a navigation event —
   * `typeof window.SeqFlowBridge !== 'undefined'` still works as a fallback
   * for a page built before this method existed. */
  isReady(): string;
  /** `"pong"`. The smallest possible round trip through ExecuteJavaScript. */
  ping(): string;
  /** `BRIDGE_PROTOCOL_VERSION` — see `protocol.ts`. */
  version(): string;
  /**
   * Attach a push sink, or pass `null` to detach and go back to polling.
   *
   * Returns the number of already-queued events flushed to it, so the caller
   * knows whether it missed anything between page load and attaching — the
   * one number a `pollEvents()` call it is about to stop making would have
   * told it. The only method here that does not return a string: its argument
   * is a JS function, so its caller is JS either way and has no marshalling
   * problem to solve.
   */
  setEventSink(sink: EventSink | null): number;
  /**
   * Push every event into the LabVIEW User Event behind `refnum`. Sends
   * `bridgeReady` first, then flushes the queue in order; returns how many
   * events it pushed, `bridgeReady` included, as a bare string. Calling it
   * again with the same refnum does nothing and returns `"0"`. A push that fails is queued and the refnum stays
   * attached.
   */
  attachLabVIEW(refnum: number): string;
  /** Raw pass-throughs for the load family — see the module doc. Each returns
   * the same `{"ok":true,"result":null,"id":null}` / `{"ok":false,"error":"..."}`
   * shape as `handleCommandSync`, so LabVIEW-side result handling does not
   * have to branch on which entry point was used. */
  loadXml(text: string, fileName?: string): string;
  loadRuleFile(text: string, fileName?: string): string;
  loadLayout(text: string, fileName?: string): string;
}

declare global {
  interface Window {
    SeqFlowBridge?: SeqFlowBridgeApi;
  }
}

export interface InstalledBridge {
  /** Send an outbound event that did not originate from a command reply —
   * e.g. `stepSelected` when the reader clicks the canvas directly, or
   * `fileLoaded`/`loadError` from a drag-and-drop rather than a bridge call.
   * Goes to the push sink if one is attached and to the queue otherwise.
   *
   * `stepSelected` is handled specially, and only here: it is tagged with an
   * `origin` and dropped when the selection did not actually change — see
   * `selectionEvent`. Every caller sends it the same way regardless. */
  enqueue(type: string, payload?: unknown): void;
  /** Removes `window.SeqFlowBridge`. */
  dispose(): void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Emit = (type: string, payload?: unknown) => void;

function dispatch(
  command: Command,
  handlers: BridgeHandlers,
  emit: Emit,
  onSelectStep: (uid: string) => void,
): unknown {
  switch (command.type) {
    case 'loadXml': {
      const p = asFilePayload(command.payload);
      handlers.loadXml(p.text, p.fileName);
      return null;
    }
    case 'loadRuleFile': {
      const p = asFilePayload(command.payload);
      handlers.loadRuleFile(p.text, p.fileName);
      return null;
    }
    case 'loadLayout': {
      const p = asFilePayload(command.payload);
      handlers.loadLayout(p.text, p.fileName);
      return null;
    }
    case 'clearRuleFile':
      handlers.clearRuleFile();
      return null;
    case 'selectStep': {
      const p = asSelectStepPayload(command.payload);
      onSelectStep(p.uid);
      handlers.selectStep(p.uid);
      return null;
    }
    case 'setView': {
      const p = asViewPayload(command.payload);
      handlers.setView(p.view);
      return null;
    }
    case 'setZoomMode': {
      const p = asZoomModePayload(command.payload);
      handlers.setZoomMode(p.mode);
      return null;
    }
    case 'exportMermaid':
      return handlers.exportMermaid();
    case 'exportSvg':
      return handlers.exportSvg();
    case 'exportPng': {
      // Validated before the promise starts, so a bad view fails in the
      // envelope like every other payload error rather than as a late event.
      const options = asExportPayload(command.payload);
      // Fire-and-forget even under handleCommandSync: see the module doc.
      // The id is echoed on the result event so LabVIEW can match it to the
      // command that started it, the way a request-and-wait-for-reply would.
      void handlers
        .exportPng(options)
        .then((result) => emit('exportPngResult', { id: command.id, ...result }))
        .catch((err: unknown) => emit('exportPngError', { id: command.id, message: message(err) }));
      return null;
    }
    case 'exportPdf': {
      // Same contract as exportPng: payload checked up front, result later.
      const options = asExportPayload(command.payload);
      void handlers
        .exportPdf(options)
        .then((result) => emit('exportPdfResult', { id: command.id, ...result }))
        .catch((err: unknown) => emit('exportPdfError', { id: command.id, message: message(err) }));
      return null;
    }
    case 'getState':
      return handlers.getState();
    default: {
      const exhaustive: never = command.type;
      throw new BridgeError(`unknown command type ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function installBridge(handlers: BridgeHandlers): InstalledBridge {
  const queue = new EventQueue();
  let ready = false;

  /** The push sink, when a host has attached one. Null means queue. */
  let sink: EventSink | null = null;

  /** The LabVIEW User Event refnum from `attachLabVIEW`. Wins over `sink`. */
  let labview: number | null = null;

  /**
   * The uid a `selectStep` command asked for and whose `stepSelected` echo has
   * not come back yet — the one thing that distinguishes a selection the host
   * caused from one an operator caused. Cleared by that echo, so it can never
   * mis-tag the *next* selection as `host`.
   */
  let hostSelect: string | null = null;

  /**
   * The uid of the last selection reported out, or `undefined` before any has
   * been. `undefined` rather than `null` because `null` is a real value here —
   * "nothing is selected" is a state worth reporting once, and it is what the
   * app reports on mount.
   */
  let reported: string | null | undefined = undefined;

  /**
   * The one place an event leaves this module — sink if one is attached, the
   * queue otherwise, never both. Double delivery would show up on the LabVIEW
   * side as every event arriving twice the moment someone left a Helper Loop
   * polling after attaching a sink, which is exactly the mistake a module
   * being migrated off polling is going to make.
   */
  function deliver(event: BridgeEvent): void {
    if (labview !== null) {
      if (!pushToLabVIEW(labview, event)) queue.pushEvent(event);
      return;
    }
    if (sink === null) {
      queue.pushEvent(event);
      return;
    }
    try {
      sink(event);
    } catch (err) {
      detach([event], err);
    }
  }

  /**
   * A sink that threw is a sink that is gone — the usual cause is a LabVIEW
   * refnum that went stale when the module stopped without detaching, and
   * every subsequent call would throw the same way. So: drop it, put what it
   * did not take back at the front of the queue in order, and say so once.
   * The page carries on queueing, which is where it started.
   */
  function detach(undelivered: readonly BridgeEvent[], err: unknown): void {
    sink = null;
    queue.unshift(undelivered);
    console.error(`SeqFlowBridge: event sink threw, detached — ${message(err)}`);
  }

  function emit(type: string, payload?: unknown, origin?: EventOrigin): void {
    deliver({ type, payload, at: Date.now(), ...(origin === undefined ? {} : { origin }) });
  }

  /** Arm the echo, from a `selectStep` command. A redundant one arms nothing:
   * no echo is coming, and the flag would be left set to mis-tag whatever the
   * operator clicks next. */
  function onSelectStep(uid: string): void {
    if (uid !== reported) hostSelect = uid;
  }

  /**
   * `stepSelected` is the one event both ends write, so it is the one that can
   * loop: LabVIEW sends `selectStep`, the app reports the selection, LabVIEW
   * reacts by selecting again. Two things break that here, and both belong on
   * this side of the boundary rather than in a LabVIEW case structure.
   *
   * `origin` says whose selection it was — `host` for the echo of a
   * `selectStep`, `user` for a canvas or tree click.
   *
   * And a selection that did not *change* is not reported at all. A
   * `selectStep` for the step already selected is the common way to hit that:
   * the app's own effect is keyed on the selection, so it never fires, and
   * nothing here should invent an event it did not get. Holding the last
   * reported uid makes that true regardless of which side asked.
   */
  function selectionEvent(payload: unknown): void {
    const uid =
      typeof payload === 'object' && payload !== null
        ? ((payload as Record<string, unknown>)['uid'] as string | undefined) ?? null
        : null;
    if (uid === reported) return;
    const origin: EventOrigin = uid !== null && uid === hostSelect ? 'host' : 'user';
    hostSelect = null;
    reported = uid;
    emit('stepSelected', payload, origin);
  }

  /**
   * Every public method's whole body runs inside this.
   *
   * ExecuteJavaScript hands LabVIEW back one optional string, and a thrown
   * JS exception is indistinguishable at that boundary from a method that
   * returned nothing at all — the same empty string, no error, no way to
   * tell which happened. So nothing here throws: a failure is a string that
   * says so, in the same envelope a success uses.
   */
  function safe(fn: () => string, id: string | null = null): string {
    try {
      return fn();
    } catch (err) {
      return toAsciiJson({ ok: false, error: message(err), id });
    }
  }

  /** Every raw pass-through shares this shape: run the handler, report the
   * same `{ok, ...}` envelope `handleCommandSync` uses. The `safe` wrapper
   * protects against a future handler that does throw — none of the current
   * ones do; `App.tsx`'s load functions already catch their own parse errors
   * and report them as a `loadError` event instead. `id` is `null` rather
   * than absent so one LabVIEW cluster unflattens every envelope this file
   * returns. */
  function raw(fn: () => void): string {
    return safe(() => {
      fn();
      return toAsciiJson({ ok: true, result: null, id: null });
    });
  }

  /** Both poll methods drain first and serialise second, so a payload that
   * will not stringify cannot be retried — it is already out of the queue.
   * The fallback is still an array, because the Helper Loop's unflatten
   * expects one: a `pollError` event in place of the batch says the events
   * were lost, where an `{"ok":false}` object would only fail to unflatten. */
  function poll(serialise: (events: readonly BridgeEvent[]) => string): string {
    const events = queue.drain();
    try {
      return serialise(events);
    } catch (err) {
      return serialise([{ type: 'pollError', payload: { message: message(err) }, at: Date.now() }]);
    }
  }

  const api: SeqFlowBridgeApi = {
    loadXml: (text, fileName) => raw(() => handlers.loadXml(text, fileName ?? 'sequence.xml')),
    loadRuleFile: (text, fileName) =>
      raw(() => handlers.loadRuleFile(text, fileName ?? 'rules.yaml')),
    loadLayout: (text, fileName) => raw(() => handlers.loadLayout(text, fileName ?? 'layout.json')),
    handleCommand(text: string): string {
      return safe(() => {
        let command: Command;
        try {
          command = parseCommand(text);
        } catch (err) {
          const id = peekCommandId(text);
          emit('commandError', { id, message: message(err), raw: text });
          return toAsciiJson({ ok: false, error: message(err), id });
        }
        try {
          dispatch(command, handlers, emit, onSelectStep);
        } catch (err) {
          emit('commandError', { id: command.id, type: command.type, message: message(err) });
          return toAsciiJson({ ok: false, error: message(err), id: command.id });
        }
        // Accepted, not finished: exportPng reports its own result later.
        return toAsciiJson({ ok: true, id: command.id });
      });
    },
    handleCommandSync(text: string): string {
      // Not `safe`: the id is only known once the command has parsed, and
      // `safe` takes its id up front. The envelope is the same either way.
      let id: string | null = null;
      try {
        const command = parseCommand(text);
        id = command.id;
        const result = dispatch(command, handlers, emit, onSelectStep);
        return toAsciiJson({ ok: true, result: result ?? null, id });
      } catch (err) {
        return toAsciiJson({ ok: false, error: message(err), id: id ?? peekCommandId(text) });
      }
    },
    pollEvents(): string {
      return poll(serialiseEvents);
    },
    pollEventsFlat(): string {
      return poll(serialiseEventsFlat);
    },
    setEventSink(next: EventSink | null): number {
      if (typeof next !== 'function') {
        sink = null;
        return 0;
      }
      // Drain before attaching: anything queued while nobody was listening is
      // the host's own backlog, and it wants it in order, ahead of whatever
      // the next click produces.
      const pending = queue.drain();
      sink = next;
      for (let i = 0; i < pending.length; i++) {
        try {
          next(pending[i]!);
        } catch (err) {
          detach(pending.slice(i), err);
          return i;
        }
      }
      return pending.length;
    },
    attachLabVIEW: (refnum) =>
      safe(() => {
        if (typeof refnum !== 'number' || !Number.isFinite(refnum)) {
          throw new BridgeError(`refnum must be a number, got ${JSON.stringify(refnum)}`);
        }
        if (refnum === labview) return '0';
        labview = refnum;
        const pending = [{ type: 'bridgeReady', payload: null, at: Date.now() }, ...queue.drain()];
        let sent = 0;
        for (const e of pending) {
          if (pushToLabVIEW(refnum, e)) sent++;
          else queue.pushEvent(e);
        }
        return String(sent);
      }),
    isReady: () => safe(() => String(ready)),
    ping: () => safe(() => 'pong'),
    version: () => safe(() => BRIDGE_PROTOCOL_VERSION),
  };

  window.SeqFlowBridge = api;
  ready = true;

  return {
    enqueue: (type, payload) => {
      if (type === 'stepSelected') selectionEvent(payload);
      else emit(type, payload);
    },
    dispose: () => {
      sink = null;
      labview = null;
      delete window.SeqFlowBridge;
    },
  };
}

/**
 * A rasterised PNG comes back from `raster.ts` as a `Blob`; the bridge's only
 * return channel is a string. `FileReader` is what the page-wide drop handler
 * already uses to get text *out* of a `File`, and `readAsDataURL` is its
 * mirror for getting base64 out of a `Blob` — no new dependency either way.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('could not encode the image'));
    reader.readAsDataURL(blob);
  });
}
