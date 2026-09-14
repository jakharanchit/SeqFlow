/**
 * Wires `protocol.ts`'s command/event envelope onto `window`, for LabVIEW's
 * Execute JavaScript method to call.
 *
 * `installBridge` is the only thing in this file that touches `window`, and
 * `App.tsx` calls it once, from a mount effect, with a `BridgeHandlers` object
 * whose functions read from refs rather than closing over render-time state —
 * see the comment on `installBridge`'s call site in `App.tsx` for why.
 *
 * Two entry points on `window.SeqFlowBridge`, matching how Execute JavaScript
 * actually marshals data (one string in, one optional string out):
 *
 * - `handleCommand(text)` — fire-and-forget. Anything that fails is reported
 *   through `pollEvents()` as a `commandError` event rather than thrown, since
 *   there is nothing on the LabVIEW side to catch a thrown JS exception from
 *   an async call.
 * - `handleCommandSync(text)` — LabVIEW sets *Wait for Return Value* = TRUE and
 *   gets `{"ok":true,"result":...}` or `{"ok":false,"error":"..."}` back as a
 *   JSON string. Reserved for handlers that return a value synchronously
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
 * envelope earns everywhere else (12 command shapes through one dispatch
 * surface) but not here, where the whole payload
 * *is* the string LabVIEW already has in hand. `Arg` is the file's text,
 * verbatim — not JSON, so pasting raw XML straight into Execute JavaScript's
 * Argument field, the thing that reads most natural to do by hand, works.
 * `fileName` is a second, optional argument on the JS side (there is no
 * second channel through Execute JavaScript's own Argument to carry it
 * dynamically without going back to a JSON envelope) — it only ever affects
 * the toolbar title, export file names and error-message prefixes, never
 * parsing, so a call with no name at all still loads the file correctly.
 */

import {
  BridgeError,
  EventQueue,
  asFilePayload,
  asSelectStepPayload,
  asStepStatusPayload,
  asStepStatusesPayload,
  asViewPayload,
  parseCommand,
  serialiseEvents,
  type Command,
  type ExecStatus,
  type StepStatusPayload,
  type ViewMode,
} from './protocol';

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
  setStepStatus(uid: string, status: ExecStatus): void;
  setStepStatuses(entries: readonly StepStatusPayload[]): void;
  resetExecution(): void;
  setView(view: ViewMode): void;
  exportMermaid(): string;
  exportSvg(): string;
  exportPng(): Promise<PngResult>;
  getState(): Record<string, unknown>;
}

export interface SeqFlowBridgeApi {
  handleCommand(text: string): void;
  handleCommandSync(text: string): string;
  /** Drains and returns the outbound queue as a JSON array. A LabVIEW Helper
   * Loop calls this on a timer — see `protocol.ts`'s `EventQueue`. */
  pollEvents(): string;
  /** Raw pass-throughs for the load family — see the module doc. Each returns
   * the same `{"ok":true,"result":null}` / `{"ok":false,"error":"..."}` shape
   * as `handleCommandSync`, so LabVIEW-side result handling does not have to
   * branch on which entry point was used. */
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
  /** Queue an outbound event that did not originate from a command reply —
   * e.g. `stepSelected` when the reader clicks the canvas directly, or
   * `fileLoaded`/`loadError` from a drag-and-drop rather than a bridge call. */
  enqueue(type: string, payload?: unknown): void;
  /** Removes `window.SeqFlowBridge`. */
  dispose(): void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dispatch(command: Command, handlers: BridgeHandlers, queue: EventQueue): unknown {
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
      handlers.selectStep(p.uid);
      return null;
    }
    case 'setView': {
      const p = asViewPayload(command.payload);
      handlers.setView(p.view);
      return null;
    }
    case 'setStepStatus': {
      const p = asStepStatusPayload(command.payload);
      handlers.setStepStatus(p.uid, p.status);
      return null;
    }
    case 'setStepStatuses': {
      const p = asStepStatusesPayload(command.payload);
      handlers.setStepStatuses(p.statuses);
      return null;
    }
    case 'resetExecution':
      handlers.resetExecution();
      return null;
    case 'exportMermaid':
      return handlers.exportMermaid();
    case 'exportSvg':
      return handlers.exportSvg();
    case 'exportPng':
      // Fire-and-forget even under handleCommandSync: see the module doc.
      // The id is echoed on the result event so LabVIEW can match it to the
      // command that started it, the way a request-and-wait-for-reply would.
      void handlers
        .exportPng()
        .then((result) => queue.push('exportPngResult', { id: command.id, ...result }))
        .catch((err: unknown) =>
          queue.push('exportPngError', { id: command.id, message: message(err) }),
        );
      return null;
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

  /** Every raw pass-through shares this shape: run the handler, report the
   * same `{ok, ...}` envelope `handleCommandSync` uses. A `try`/`catch` here
   * costs nothing and protects against a future handler that does throw —
   * none of the current ones do; `App.tsx`'s load functions already catch
   * their own parse errors and report them as a `loadError` event instead. */
  function raw(fn: () => void): string {
    try {
      fn();
      return JSON.stringify({ ok: true, result: null });
    } catch (err) {
      return JSON.stringify({ ok: false, error: message(err) });
    }
  }

  const api: SeqFlowBridgeApi = {
    loadXml: (text, fileName) => raw(() => handlers.loadXml(text, fileName ?? 'sequence.xml')),
    loadRuleFile: (text, fileName) =>
      raw(() => handlers.loadRuleFile(text, fileName ?? 'rules.yaml')),
    loadLayout: (text, fileName) => raw(() => handlers.loadLayout(text, fileName ?? 'layout.json')),
    handleCommand(text: string): void {
      let command: Command;
      try {
        command = parseCommand(text);
      } catch (err) {
        queue.push('commandError', { message: message(err), raw: text });
        return;
      }
      try {
        dispatch(command, handlers, queue);
      } catch (err) {
        queue.push('commandError', { id: command.id, type: command.type, message: message(err) });
      }
    },
    handleCommandSync(text: string): string {
      try {
        const command = parseCommand(text);
        const result = dispatch(command, handlers, queue);
        return JSON.stringify({ ok: true, result: result ?? null });
      } catch (err) {
        return JSON.stringify({ ok: false, error: message(err) });
      }
    },
    pollEvents(): string {
      return serialiseEvents(queue.drain());
    },
  };

  window.SeqFlowBridge = api;

  return {
    enqueue: (type, payload) => queue.push(type, payload),
    dispose: () => {
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
