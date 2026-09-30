# Function inventory — `src/`

Generated 2026-09-29 on branch `dev-LabVIEW` at `4947c12`. Read-only survey: no source was changed.

> **Superseded the same day.** Tiers 1–4 of the recommendations drawn from this survey were applied,
> and the step execution-status feature (`setStepStatus`, `setStepStatuses`, `resetExecution`) was
> removed. This document describes the code *before* those changes; its IDs no longer match `src/`.

**Reply with IDs** ("remove 111, 145, 260") to act on any row.

## How this was produced

- **Every function was enumerated by the TypeScript compiler, not by eye.** A script walked the ASTs of all
  `src/**/*.ts(x)` files and recorded every function declaration, every `const` bound to an arrow/function
  expression or `useCallback(...)`, every class and class method/getter, and every method on the
  `window.SeqFlowBridge` object. Inline JSX callbacks (`onClick={() => …}`) are not listed.
- **Callers come from the language service's Find All References**, run over `src/`, `tests/` and `bin/`
  together (the CLI in `bin/cli.mjs` imports `src/` directly). A reference that only appears in a type
  position or an import line is not counted as a call.
- **Status is reachability, not just "has a caller".** A function called only by another function that is
  itself dead is dead too. Roots: `main.tsx` and module-level code in shipped files (**app**), `bin/` (**cli**),
  the `window.SeqFlowBridge` methods (**bridge**), and test files (**tests**). Two edges the reference search
  cannot see were added by hand: `dispatch` → App's handlers (through the `BridgeHandlers` interface), and the
  `api.load*` pass-throughs → `load` / `loadRuleFile` / `loadLayout`. App's `bridge*` handlers are passed to
  `installBridge` by reference in `App`; that reference was *not* counted as an app-side call.
- **Tooling cross-check:** `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` and `npx knip` (6.38),
  run twice — once with tests as entry points, once with only `main.tsx` + `bin/`. See the last section.

## Status legend

| Status | Meaning |
|---|---|
| **USED (app / cli / bridge)** | Reachable from a shipped entry point; the parenthesis says which. `cli` alone means only `bin/seqflow.mjs` uses it; nothing in the page does. |
| **BRIDGE-ONLY** | Reachable only through `window.SeqFlowBridge` — nothing on screen calls it. Removing it removes a LabVIEW feature. |
| **ONLY-USED-BY-TESTS** | Called by tests (directly or through other test-only code) and by nothing shipped. |
| **UNUSED** | No caller anywhere, tests included. |
| **· DUPLICATE** | Appended when the function does the same job as another one, named in its row. |

## Totals

**319 functions** across 37 of the 40 source files (`main.tsx`, `vite-env.d.ts` and `core/types.ts` define none).

| Status | Count |
|---|---:|
| USED | 175 — app 85 · app+bridge 17 · app+cli+bridge 47 · cli+bridge 11 · cli only 15 |
| BRIDGE-ONLY | 59 |
| ONLY-USED-BY-TESTS | 78 |
| UNUSED | 7 |
| of which also DUPLICATE | 3 (ids 111, 148, 157) |

### The big finding: eight whole modules ship nowhere

When the drawer's tabs were removed (2026-09-28), the analyses behind them lost their last caller. These
files are imported by tests and by each other, and by nothing in the app, the bridge or the CLI:

| File | Lines | Was behind | IDs |
|---|---:|---|---|
| `core/lint.ts` | 518 | Findings tab | 270–284 |
| `core/duration.ts` | 453 | Timing tab | 298–309 |
| `core/diff.ts` | 435 | Diff tab | 290–297 |
| `core/similarity.ts` | 216 | Repeats tab (and `lint`) | 263–269 |
| `core/criteria.ts` | 208 | Criteria tab | 285–289 |
| `core/paths.ts` | 206 | Trace paths (and `lint`/`criteria`/`duration`) | 251–262 |
| `core/signalNames.ts` | 146 | signal dictionary drop | 314–319 |
| `core/signals.ts` | 90 | Signals tab | 310–313 |
| **total** | **2 272** | | |

Plus `ui/download.ts` (72 lines), which not even a test imports. The project notes say "their core modules
remain" deliberately, so the eight are a decision for you rather than obvious deletions — they carry the
Phase 2/4 test suites with them.

## Functions, by file

Links go to the declaring line. "Called by" names the enclosing function of each call site; nested
functions list only their parent. Test callers are counted by file.

### `src/polyfills.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 1 | [`fastImmediate`](../src/polyfills.ts#L53) | Picks the fastest available microtask scheduler for the Promise polyfill. | (module scope) | no | **USED (app)** |

### `src/App.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 2 | [`App`](../src/App.tsx#L81) | Root component: owns all state, the drop target, the tree + canvas panes and the bridge. | main.tsx (module scope) | yes — imported by src | **USED (app)** |
| 3 | [App › `load`](../src/App.tsx#L399) | Parses sequence XML, auto-folds large files and resets selection/execution state. | loadRuleFile, clearRuleFile, drop, LabVIEW via `installBridge` handlers | no | **USED (app, bridge)** |
| 4 | [App › `loadRuleFile`](../src/App.tsx#L444) | Loads a dropped/sent rule file and re-parses the current sequence with it. | drop, LabVIEW via `installBridge` handlers | no | **USED (app, bridge)** |
| 5 | [App › `clearRuleFile`](../src/App.tsx#L467) | Reverts to the built-in rules and re-parses the current sequence. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 6 | [App › `loadLayout`](../src/App.tsx#L477) | Loads a layout sidecar: applies its collapsed set now and its positions after the next layout. | drop, LabVIEW via `installBridge` handlers | no | **USED (app, bridge)** |
| 7 | [App › `over`](../src/App.tsx#L501) | dragover handler: shows the drop highlight. | App | no | **USED (app)** |
| 8 | [App › `leave`](../src/App.tsx#L505) | dragleave handler: clears the drop highlight when the pointer leaves the window. | App | no | **USED (app)** |
| 9 | [App › `drop`](../src/App.tsx#L508) | drop handler: reads the file and routes it by extension (.json layout, .yaml rules, else XML). | App | no | **USED (app)** |
| 10 | [App › `reveal`](../src/App.tsx#L543) | Selects a step, expands any collapsed ancestors and asks the canvas to centre on it. | App | no | **USED (app)** |
| 11 | [App › `toggle`](../src/App.tsx#L561) | Collapses or expands one sequence. | App | no | **USED (app)** |
| 12 | [App › `collapseAll`](../src/App.tsx#L569) | Collapses every sequence except the root. | App | no | **USED (app)** |
| 13 | [App › `expandAll`](../src/App.tsx#L579) | Expands every sequence. | App | no | **USED (app)** |
| 14 | [App › `onNodesChange`](../src/App.tsx#L581) | Applies React Flow node changes (drags) and drops ELK routes for moved nodes. | App | no | **USED (app)** |
| 15 | [App › `selectedDetail`](../src/App.tsx#L620) | Builds the `{uid,name,stepNumber,numbered,element,kind,path}` object for stepSelected / getState. | bridgeGetState, App | no | **USED (app, bridge)** |
| 16 | [App › `bridgeSelectStep`](../src/App.tsx#L637) | Bridge handler for selectStep: calls reveal. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 17 | [App › `bridgeSetStepStatus`](../src/App.tsx#L641) | Bridge handler for setStepStatus: sets one step's execution status. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 18 | [App › `bridgeSetStepStatuses`](../src/App.tsx#L649) | Bridge handler for setStepStatuses: sets many execution statuses at once. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 19 | [App › `bridgeResetExecution`](../src/App.tsx#L661) | Bridge handler for resetExecution: clears all execution statuses. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 20 | [App › `bridgeSetView`](../src/App.tsx#L665) | Bridge handler for setView: switches tree / canvas / both. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 21 | [App › `bridgeExportMermaid`](../src/App.tsx#L669) | Bridge handler for exportMermaid: returns the full graph as Mermaid text. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 22 | [App › `bridgeExportSvg`](../src/App.tsx#L676) | Bridge handler for exportSvg: returns the canvas as it currently looks, as SVG text. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 23 | [App › `bridgeExportPng`](../src/App.tsx#L685) | Bridge handler for exportPng: rasterises the SVG and returns base64 PNG + size. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |
| 24 | [App › `bridgeGetState`](../src/App.tsx#L697) | Bridge handler for getState: file name, node count, warning count, selection, view. | LabVIEW, via `installBridge` handlers → `dispatch` | no | **BRIDGE-ONLY** |

### `src/bridge/protocol.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 25 | [`isExecStatus`](../src/bridge/protocol.ts#L30) | Type guard: is a value one of pending/running/pass/fail/skipped. | asStepStatusPayload, asStepStatusesPayload; tests (1 file) | yes — imported by tests | **BRIDGE-ONLY** |
| 26 | [`isViewMode`](../src/bridge/protocol.ts#L48) | Type guard: is a value one of tree/canvas/both. | asViewPayload, App.tsx App | yes — imported by src | **USED (app, bridge)** |
| 27 | [`BridgeError` (class)](../src/bridge/protocol.ts#L96) | Error class for a malformed bridge command or payload. | parseCommand, asFilePayload, asSelectStepPayload, asViewPayload, asStepStatusPayload, asStepStatusesPayload, bridge/install.ts dispatch, bridge/install.ts attachLabVIEW; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 28 | [`parseCommand`](../src/bridge/protocol.ts#L99) | Parses `{id?, type, payload?}` JSON text into a Command, throwing BridgeError on anything invalid. | bridge/install.ts handleCommand, bridge/install.ts handleCommandSync; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 29 | [`peekCommandId`](../src/bridge/protocol.ts#L125) | Best-effort extraction of `id` from command text that failed to parse, for the error envelope. | bridge/install.ts handleCommand, bridge/install.ts handleCommandSync | yes — imported by src | **BRIDGE-ONLY** |
| 30 | [`asFilePayload`](../src/bridge/protocol.ts#L152) | Validates a `{text, fileName}` payload (loadXml / loadRuleFile / loadLayout). | bridge/install.ts dispatch; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 31 | [`asSelectStepPayload`](../src/bridge/protocol.ts#L168) | Validates a `{uid}` payload for selectStep. | bridge/install.ts dispatch; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 32 | [`asViewPayload`](../src/bridge/protocol.ts#L181) | Validates a `{view}` payload for setView. | bridge/install.ts dispatch | yes — imported by src | **BRIDGE-ONLY** |
| 33 | [`asStepStatusPayload`](../src/bridge/protocol.ts#L197) | Validates a `{uid, status}` payload for setStepStatus. | bridge/install.ts dispatch; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 34 | [`asStepStatusesPayload`](../src/bridge/protocol.ts#L221) | Validates a `{statuses: [...]}` batch, silently dropping malformed entries. | bridge/install.ts dispatch; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 35 | [`EventQueue` (class)](../src/bridge/protocol.ts#L288) | Bounded (500) FIFO of outbound bridge events, used when nothing is pushing them to LabVIEW. | bridge/install.ts installBridge; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 36 | [`EventQueue.push`](../src/bridge/protocol.ts#L291) | Convenience: builds an event from type+payload and calls pushEvent. *Note: wrapper of `pushEvent`, used only by tests.* | tests (1 file) | no | **ONLY-USED-BY-TESTS** |
| 37 | [`EventQueue.pushEvent`](../src/bridge/protocol.ts#L295) | Appends an event and trims the queue to its cap. | EventQueue.push, bridge/install.ts deliver, bridge/install.ts attachLabVIEW | no | **USED (app, bridge)** |
| 38 | [`EventQueue.unshift`](../src/bridge/protocol.ts#L306) | Puts undelivered events back at the front of the queue, in order. | bridge/install.ts detach | no | **BRIDGE-ONLY** |
| 39 | [`EventQueue.trim`](../src/bridge/protocol.ts#L312) | Drops the oldest events beyond the 500 cap. | EventQueue.pushEvent, EventQueue.unshift | no | **USED (app, bridge)** |
| 40 | [`EventQueue.drain`](../src/bridge/protocol.ts#L319) | Returns all queued events and empties the queue. | bridge/install.ts poll, bridge/install.ts setEventSink, bridge/install.ts attachLabVIEW; tests (1 file) | no | **BRIDGE-ONLY** |
| 41 | [`EventQueue.size` (getter)](../src/bridge/protocol.ts#L325) | Getter: number of queued events. | tests (1 file) | no | **ONLY-USED-BY-TESTS** |
| 42 | [`serialiseEvents`](../src/bridge/protocol.ts#L330) | Serialises an event list to ASCII JSON with payloads nested (one-line wrapper of toAsciiJson). *Note: one-line wrapper of `toAsciiJson`.* | bridge/install.ts pollEvents; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 43 | [`serialiseEventsFlat`](../src/bridge/protocol.ts#L351) | Serialises an event list to ASCII JSON with each payload pre-stringified for LabVIEW. | bridge/install.ts pollEventsFlat; tests (1 file) | yes — imported by src, tests | **BRIDGE-ONLY** |

### `src/bridge/install.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 44 | [`message`](../src/bridge/install.ts#L222) | Turns any thrown value into a message string. | dispatch, detach, safe, poll, handleCommand, handleCommandSync | no | **BRIDGE-ONLY** |
| 45 | [`dispatch`](../src/bridge/install.ts#L228) | Routes a parsed Command to the matching BridgeHandlers method and returns its result. | handleCommand, handleCommandSync | no | **BRIDGE-ONLY** |
| 46 | [`installBridge`](../src/bridge/install.ts#L299) | Creates window.SeqFlowBridge and returns an `enqueue`/`dispose` handle for the app. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 47 | [installBridge › `deliver`](../src/bridge/install.ts#L332) | Sends one event to LabVIEW (if attached), else a JS sink (if set), else the queue. | emit | no | **USED (app, bridge)** |
| 48 | [installBridge › `detach`](../src/bridge/install.ts#L355) | Drops a push sink that threw and re-queues what it did not take. *Note: only fires when a `setEventSink` sink throws.* | deliver, setEventSink | no | **BRIDGE-ONLY** |
| 49 | [installBridge › `emit`](../src/bridge/install.ts#L361) | Builds a timestamped event (with optional origin) and delivers it. | selectionEvent, handleCommand, handleCommandSync, enqueue | no | **USED (app, bridge)** |
| 50 | [installBridge › `onSelectStep`](../src/bridge/install.ts#L368) | Remembers the uid a host selectStep asked for, so its echo is tagged origin "host". | handleCommand, handleCommandSync | no | **BRIDGE-ONLY** |
| 51 | [installBridge › `selectionEvent`](../src/bridge/install.ts#L387) | Emits stepSelected only when the selection changed, tagged user or host. | enqueue | no | **USED (app)** |
| 52 | [installBridge › `safe`](../src/bridge/install.ts#L408) | Runs a method body and converts any throw into an `{ok:false}` JSON string. | raw, handleCommand, attachLabVIEW, isReady, ping, version | no | **BRIDGE-ONLY** |
| 53 | [installBridge › `raw`](../src/bridge/install.ts#L423) | Wraps a load pass-through: runs it and returns the standard `{ok,result,id}` envelope. | loadXml, loadRuleFile, loadLayout | no | **BRIDGE-ONLY** |
| 54 | [installBridge › `poll`](../src/bridge/install.ts#L435) | Drains the queue and serialises it, substituting a pollError event if serialising fails. | pollEvents, pollEventsFlat | no | **BRIDGE-ONLY** |
| 55 | [`api.loadXml`](../src/bridge/install.ts#L445) | Bridge method: load sequence XML text directly (no JSON envelope). | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 56 | [`api.loadRuleFile`](../src/bridge/install.ts#L446) | Bridge method: load rule-file YAML text directly. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 57 | [`api.loadLayout`](../src/bridge/install.ts#L448) | Bridge method: load a layout sidecar JSON text directly. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 58 | [`api.handleCommand`](../src/bridge/install.ts#L449) | Bridge method: fire-and-forget command; returns an acceptance envelope, errors also queued as commandError. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 59 | [`api.handleCommandSync`](../src/bridge/install.ts#L469) | Bridge method: run a command and return `{ok,result\|error,id}` synchronously. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 60 | [`api.pollEvents`](../src/bridge/install.ts#L482) | Bridge method: drain the event queue as JSON, payloads nested. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 61 | [`api.pollEventsFlat`](../src/bridge/install.ts#L485) | Bridge method: drain the event queue as JSON, payloads pre-stringified. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 62 | [`api.setEventSink`](../src/bridge/install.ts#L488) | Bridge method: attach/detach a JS push callback and flush the backlog into it. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 63 | [`api.attachLabVIEW`](../src/bridge/install.ts#L508) | Bridge method: push all events into a LabVIEW User Event refnum, sending bridgeReady first. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 64 | [`api.isReady`](../src/bridge/install.ts#L523) | Bridge method: "true" once installed. | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 65 | [`api.ping`](../src/bridge/install.ts#L524) | Bridge method: returns "pong". | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 66 | [`api.version`](../src/bridge/install.ts#L525) | Bridge method: returns the protocol version ("4"). | LabVIEW (`window.SeqFlowBridge`) | on `window.SeqFlowBridge` | **BRIDGE-ONLY** |
| 67 | [`blobToBase64`](../src/bridge/install.ts#L550) | Reads a Blob into a base64 string (no data: prefix) with FileReader. | App.tsx bridgeExportPng | yes — imported by src | **BRIDGE-ONLY** |

### `src/bridge/labview.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 68 | [`toAsciiJson`](../src/bridge/labview.ts#L29) | JSON.stringify with every non-ASCII character escaped as \uXXXX. | flatEvent, pushToLabVIEW, bridge/protocol.ts serialiseEvents, bridge/protocol.ts serialiseEventsFlat, bridge/install.ts safe, bridge/install.ts raw, bridge/install.ts handleCommand, bridge/install.ts handleCommandSync; tests (1 file) | yes — imported by src, tests | **USED (app, bridge)** |
| 69 | [`flatEvent`](../src/bridge/labview.ts#L41) | Reshapes one event so its payload is a JSON string (LabVIEW cluster shape). | pushToLabVIEW, bridge/protocol.ts serialiseEventsFlat | yes — imported by src | **USED (app, bridge)** |
| 70 | [`pushToLabVIEW`](../src/bridge/labview.ts#L52) | Fires one event into a LabVIEW User Event via window.LabVIEW.FireUserEvent; false if it could not. *Note: runs on every event, but does nothing unless `attachLabVIEW` set a refnum.* | bridge/install.ts deliver, bridge/install.ts attachLabVIEW | yes — imported by src | **USED (app, bridge)** |

### `src/ui/Canvas.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 71 | [`Canvas`](../src/ui/Canvas.tsx#L103) | The React Flow canvas: nodes, routed edges, controls, minimap, keyboard zoom and fit. | App.tsx App | yes — imported by src | **USED (app)** |
| 72 | [Canvas › `setZoomVar`](../src/ui/Canvas.tsx#L131) | Writes the current zoom to the `--zoom` CSS variable for semantic zoom. | Canvas, fitAll, onKey | no | **USED (app)** |
| 73 | [Canvas › `measure`](../src/ui/Canvas.tsx#L159) | Records the pane's pixel size when it changes. | Canvas | no | **USED (app)** |
| 74 | [Canvas › `fitAll`](../src/ui/Canvas.tsx#L200) | Fits the whole diagram in the pane from ELK sizes; returns false if it could not yet. | Canvas | no | **USED (app)** |
| 75 | [Canvas › `attempt`](../src/ui/Canvas.tsx#L265) | Retry loop (timer-based) that calls fitAll until it succeeds or gives up. | Canvas | no | **USED (app)** |
| 76 | [Canvas › `onKey`](../src/ui/Canvas.tsx#L323) | Keyboard shortcuts: + / - zoom, 0 fit, 1 = 100%. | Canvas | no | **USED (app)** |
| 77 | [Canvas › `handleNodeClick`](../src/ui/Canvas.tsx#L355) | Node click: selects the node. | Canvas | no | **USED (app)** |
| 78 | [Canvas › `handleNodeDoubleClick`](../src/ui/Canvas.tsx#L361) | Node double-click: toggles collapse on a container. | Canvas | no | **USED (app)** |

### `src/ui/Outline.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 79 | [`rowHeightFor`](../src/ui/Outline.tsx#L76) | Row height in px for a font size (2 × font − 2). | Outline | no | **USED (app)** |
| 80 | [`rowsFor`](../src/ui/Outline.tsx#L89) | Tree rows in document order, skipping the insides of collapsed sequences. | Outline | no | **USED (app)** |
| 81 | [rowsFor › `visit`](../src/ui/Outline.tsx#L93) | Recursive step of rowsFor. | rowsFor | no | **USED (app)** |
| 82 | [`Marked`](../src/ui/Outline.tsx#L112) | Renders a name with the matched search substring wrapped in `<mark>`. | Outline | no | **USED (app)** |
| 83 | [`cellText`](../src/ui/Outline.tsx#L129) | Trimmed attribute text, or an em dash when empty. | DataCells | no | **USED (app)** |
| 84 | [`logGlyph`](../src/ui/Outline.tsx#L140) | Maps TRUE/FALSE to an icon name, otherwise returns the raw text. | LogCell | no | **USED (app)** |
| 85 | [`LogCell`](../src/ui/Outline.tsx#L152) | Renders a Log Start / Log Completion cell as a check, a cross, or raw text. | DataCells | no | **USED (app)** |
| 86 | [`DataCells`](../src/ui/Outline.tsx#L165) | Renders the Description / Log Start / Log Completion cells, honouring hidden columns. | Outline | no | **USED (app)** |
| 87 | [`groupByCategory`](../src/ui/Outline.tsx#L207) | Groups the element-type counts by the rule file's categories, with "Other" last. | Outline | no | **USED (app)** |
| 88 | [`Outline`](../src/ui/Outline.tsx#L250) | Left pane: search box, Step Types filter, windowed tree / result list, text-size and collapse buttons. | App.tsx App | yes — imported by src | **USED (app)** |
| 89 | [Outline › `attach`](../src/ui/Outline.tsx#L344) | Callback ref that tracks the scroll container's height for windowing. | Outline | no | **USED (app)** |
| 90 | [Outline › `toggleElement`](../src/ui/Outline.tsx#L396) | Adds/removes one element type from the type filter. | Outline | no | **USED (app)** |
| 91 | [Outline › `toggleCategory`](../src/ui/Outline.tsx#L402) | Opens/closes one category group in the Step Types panel. | Outline | no | **USED (app)** |

### `src/ui/nodes.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 92 | [`StepNode`](../src/ui/nodes.tsx#L15) | React Flow node renderer for a step (or a folded sequence). | seqNode | no | **USED (app)** |
| 93 | [`GroupNode`](../src/ui/nodes.tsx#L47) | React Flow node renderer for an expanded sequence's group box. | seqGroup | no | **USED (app)** |

### `src/ui/edges.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 94 | [`polyline`](../src/ui/edges.tsx#L38) | Turns route points into an SVG path `d` string (M…L…). | RoutedEdge | no | **USED (app)** |
| 95 | [`RoutedEdge`](../src/ui/edges.tsx#L44) | React Flow edge renderer that draws ELK's route, falling back to smoothstep. *Note: used via `edgeTypes` in the same file; the `export` itself is unused.* | (module scope) | yes — **never imported** | **USED (app)** |

### `src/ui/SplitBar.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 96 | [`SplitBar`](../src/ui/SplitBar.tsx#L16) | The drag handle between tree and canvas; rendered only in "both" mode. | App.tsx App | yes — imported by src | **USED (app)** |

### `src/ui/StepNum.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 97 | [`StepNum`](../src/ui/StepNum.tsx#L11) | Renders a step number in front of a name. | ui/Outline.tsx Outline | yes — imported by src | **USED (app)** |

### `src/ui/Icon.tsx`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 98 | [`Icon`](../src/ui/Icon.tsx#L57) | Renders a Material Symbols icon from inlined SVG paths. | ui/Canvas.tsx Canvas, ui/Outline.tsx LogCell, ui/Outline.tsx Outline, App.tsx App | yes — imported by src | **USED (app)** |

### `src/ui/useResizable.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 99 | [`clamp`](../src/ui/useResizable.ts#L15) | Clamps a number to [min, max]. | useResizable, move, reset | no | **USED (app)** |
| 100 | [`readStorage`](../src/ui/useResizable.ts#L19) | localStorage.getItem that never throws. | usePersistedState | no | **USED (app)** |
| 101 | [`writeStorage`](../src/ui/useResizable.ts#L27) | localStorage.setItem that never throws. | set | no | **USED (app)** |
| 102 | [`usePersistedState`](../src/ui/useResizable.ts#L38) | Hook: useState persisted to localStorage with custom parse/serialise. | useResizable, App.tsx App | yes — imported by src | **USED (app)** |
| 103 | [usePersistedState › `set`](../src/ui/useResizable.ts#L54) | Setter that updates state and writes it to storage. | usePersistedState | no | **USED (app)** |
| 104 | [`useResizable`](../src/ui/useResizable.ts#L92) | Hook: one draggable, persisted panel/column size with a reset. | ui/Outline.tsx Outline, App.tsx App | yes — imported by src | **USED (app)** |
| 105 | [useResizable › `onHandleDown`](../src/ui/useResizable.ts#L112) | Pointer-down on a resize handle: starts a drag. | useResizable | no | **USED (app)** |
| 106 | [useResizable › `move`](../src/ui/useResizable.ts#L123) | Pointer-move during a drag: updates the size. | useResizable | no | **USED (app)** |
| 107 | [useResizable › `up`](../src/ui/useResizable.ts#L129) | Pointer-up: ends the drag and restores the cursor. | useResizable | no | **USED (app)** |
| 108 | [useResizable › `reset`](../src/ui/useResizable.ts#L143) | Resets the size to its default. | useResizable | no | **USED (app)** |

### `src/ui/raster.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 109 | [`RasterError` (class)](../src/ui/raster.ts#L35) | Error class for a PNG render that cannot be done (empty or too large). | svgToPng | yes — **never imported** | **BRIDGE-ONLY** |
| 110 | [`svgToPng`](../src/ui/raster.ts#L37) | Rasterises SVG text to a PNG Blob through an `<img>` and a canvas. | App.tsx bridgeExportPng | yes — imported by src | **BRIDGE-ONLY** |
| 111 | [`downloadBlob`](../src/ui/raster.ts#L86) | Offers a Blob to the user as a file download via a throwaway `<a download>`. *Note: same throwaway-anchor download as `ui/download.ts` `downloadText`; both unused.* | none | yes — **never imported** | **UNUSED · DUPLICATE** |

### `src/ui/download.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 112 | [`downloadText`](../src/ui/download.ts#L14) | Offers text to the user as a file download. *Note: see `ui/raster.ts` `downloadBlob`.* | none | yes — **never imported** | **UNUSED** |
| 113 | [`copyText`](../src/ui/download.ts#L37) | Copies text to the clipboard, with a fallback for insecure contexts. | none | yes — **never imported** | **UNUSED** |
| 114 | [`legacyCopy`](../src/ui/download.ts#L47) | Clipboard fallback via an off-screen textarea and execCommand("copy"). | copyText | no | **UNUSED** |
| 115 | [`stem`](../src/ui/download.ts#L68) | File name without extension (`Sequence_XML.xml` → `Sequence_XML`). | none | yes — **never imported** | **UNUSED** |

### `src/layout/elk.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 116 | [`LayoutTimeout` (class)](../src/layout/elk.ts#L41) | Error class thrown when an ELK layout exceeds 60 s. | layout, App.tsx App | yes — imported by src | **USED (app)** |
| 117 | [`createElkWorker`](../src/layout/elk.ts#L58) | Creates the ELK web worker from its inlined source via a blob: URL. | workerFactory | no | **USED (app)** |
| 118 | [`elk`](../src/layout/elk.ts#L68) | Lazily creates the single ELK instance. | layout | no | **USED (app)** |
| 119 | [`layout`](../src/layout/elk.ts#L93) | Runs ELK on flow nodes/edges (with a timeout) and returns positions + edge routes. | App.tsx App | yes — imported by src | **USED (app)** |

### `src/layout/elkGraph.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 120 | [`apexPort`](../src/layout/elkGraph.ts#L139) | Builds the port id for one apex (n/e/s/w) of a diamond node. | at, toElk | no | **USED (app)** |
| 121 | [`apexPorts`](../src/layout/elkGraph.ts#L141) | Builds the four fixed apex ports for a diamond node. | toElk | no | **USED (app)** |
| 122 | [apexPorts › `at`](../src/layout/elkGraph.ts#L142) | Builds one apex port object. | apexPorts | no | **USED (app)** |
| 123 | [`toElk`](../src/layout/elkGraph.ts#L159) | Converts flow nodes/edges into an ELK graph request (grouped hierarchy). | layout/elk.ts layout; tests (8 files) | yes — imported by src, tests | **USED (app)** |
| 124 | [toElk › `exitSide`](../src/layout/elkGraph.ts#L203) | Picks which diamond apex an outgoing edge leaves from. | toElk | no | **USED (app)** |
| 125 | [`fromElk`](../src/layout/elkGraph.ts#L231) | Flattens an ELK result into per-node positions and sizes. | layout/elk.ts layout; tests (7 files) | yes — imported by src, tests | **USED (app)** |
| 126 | [fromElk › `walk`](../src/layout/elkGraph.ts#L234) | Recursive step of fromElk. | fromElk | no | **USED (app)** |
| 127 | [`collapseCollinear`](../src/layout/elkGraph.ts#L278) | Removes interior points that lie on a straight line from a route. | walkEdges; tests (1 file) | yes — imported by tests | **USED (app)** |
| 128 | [`edgeRoutes`](../src/layout/elkGraph.ts#L299) | Extracts every edge's route from an ELK result in absolute coordinates. | layout/elk.ts layout; tests (4 files) | yes — imported by src, tests | **USED (app)** |
| 129 | [edgeRoutes › `walkNodes`](../src/layout/elkGraph.ts#L312) | Records absolute position, parent and port ownership for every ELK node. | edgeRoutes | no | **USED (app)** |
| 130 | [edgeRoutes › `chain`](../src/layout/elkGraph.ts#L325) | Root-first ancestor chain of an ELK node. | origin | no | **USED (app)** |
| 131 | [edgeRoutes › `origin`](../src/layout/elkGraph.ts#L337) | Absolute origin of the lowest common ancestor of two nodes. | walkEdges | no | **USED (app)** |
| 132 | [edgeRoutes › `walkEdges`](../src/layout/elkGraph.ts#L349) | Converts each ELK edge's sections to absolute points. | edgeRoutes | no | **USED (app)** |
| 133 | [`applyLayout`](../src/layout/elkGraph.ts#L375) | Returns new flow nodes with ELK's positions and sizes applied. | layout/elk.ts layout; tests (7 files) | yes — imported by src, tests | **USED (app)** |
| 134 | [`graphBounds`](../src/layout/elkGraph.ts#L405) | Bounding box of a laid-out graph in absolute coordinates. | ui/Canvas.tsx Canvas, ui/Canvas.tsx fitAll; tests (2 files) | yes — imported by src, tests | **USED (app)** |
| 135 | [`fitZoom`](../src/layout/elkGraph.ts#L439) | Zoom level that fits a box into a viewport with a margin, clamped. | ui/Canvas.tsx fitAll; tests (1 file) | yes — imported by src, tests | **USED (app)** |

### `src/emit/flow.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 136 | [`measure`](../src/emit/flow.ts#L111) | Estimates a node's width from its label, params and step-number lengths. | toFlow | no | **USED (app)** |
| 137 | [`paramText`](../src/emit/flow.ts#L123) | Formats the rule-file-selected attributes shown under a node label. | toFlow; tests (1 file) | yes — imported by tests | **USED (app)** |
| 138 | [`inboundCounts`](../src/emit/flow.ts#L137) | Counts inbound edges per node. *Note: overlaps `paths.adjacency().inn` (test-only module).* | convergentNodes | yes — **never imported** | **USED (app)** |
| 139 | [`convergentNodes`](../src/emit/flow.ts#L148) | Nodes with more inbound edges than the convergence threshold (their inbound edges go dotted). | toFlow; tests (1 file) | yes — imported by tests | **USED (app)** |
| 140 | [`toFlow`](../src/emit/flow.ts#L171) | Converts a Graph into React Flow nodes and styled edges. | App.tsx App; tests (10 files) | yes — imported by src, tests | **USED (app)** |

### `src/emit/collapse.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 141 | [`liftMap`](../src/emit/collapse.ts#L45) | Maps every hidden uid to the outermost collapsed ancestor that stands in for it. | visibleGraph | no | **USED (app, cli, bridge)** |
| 142 | [`autoCollapse`](../src/emit/collapse.ts#L96) | Picks containers to fold (deepest first) until the visible graph fits a node budget. | App.tsx load; tests (1 file) | yes — imported by src, tests | **USED (app, bridge)** |
| 143 | [`visibleGraph`](../src/emit/collapse.ts#L120) | The graph as seen with some sequences collapsed: hidden nodes removed, edges lifted and deduped. | autoCollapse, emit/mermaid.ts mermaidModel, App.tsx App; tests (5 files) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 144 | [`asGraph`](../src/emit/collapse.ts#L199) | Wraps a collapsed view back into a Graph object. | App.tsx App; tests (3 files) | yes — imported by src, tests | **USED (app)** |
| 145 | [`collapsibleUids`](../src/emit/collapse.ts#L211) | Every container uid in the graph. *Note: `App.collapseAll` computes the same set (minus root) inline.* | none | yes — **never imported** | **UNUSED** |

### `src/emit/sidecar.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 146 | [`SidecarError` (class)](../src/emit/sidecar.ts#L36) | Error class for an unreadable layout sidecar. | parseSidecar, App.tsx loadLayout; tests (1 file) | yes — imported by src, tests | **USED (app, bridge)** |
| 147 | [`toSidecar`](../src/emit/sidecar.ts#L42) | Builds a layout sidecar (collapsed set + rounded positions) from the canvas. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 148 | [`round`](../src/emit/sidecar.ts#L62) | Rounds to two decimals. *Note: identical to `emit/svg.ts` `round`.* | toSidecar | no | **ONLY-USED-BY-TESTS · DUPLICATE** |
| 149 | [`serialiseSidecar`](../src/emit/sidecar.ts#L66) | Pretty-prints a sidecar as JSON text. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 150 | [`parseSidecar`](../src/emit/sidecar.ts#L74) | Parses and validates layout sidecar JSON. | App.tsx loadLayout; tests (1 file) | yes — imported by src, tests | **USED (app, bridge)** |
| 151 | [`applySidecar`](../src/emit/sidecar.ts#L139) | Overrides node positions from a sidecar and reports unknown uids. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 152 | [`sidecarName`](../src/emit/sidecar.ts#L161) | Sidecar file name for a sequence (`X.xml` → `X.layout.json`). | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/emit/mermaid.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 153 | [`mermaidId`](../src/emit/mermaid.ts#L138) | Mermaid node id for a uid (`n` + uid without hyphens). | push, edgeLine; tests (1 file) | yes — imported by tests | **USED (cli, bridge)** |
| 154 | [`escapeLabel`](../src/emit/mermaid.ts#L146) | Escapes text for a Mermaid quoted label. | push, edgeLine, toMermaid; tests (1 file) | yes — imported by tests | **USED (cli, bridge)** |
| 155 | [`wrap`](../src/emit/mermaid.ts#L156) | Wraps a label in the Mermaid shape delimiters for a node shape. | emit | no | **USED (cli, bridge)** |
| 156 | [`collapsedFor`](../src/emit/mermaid.ts#L185) | The set of containers a Mermaid mode (full / depth-N / overview / scoped) folds. | collapsedFor, mermaidModel; tests (1 file) | yes — imported by tests | **USED (cli, bridge)** |
| 157 | [`ancestorChain`](../src/emit/mermaid.ts#L215) | Parent uids of a node, nearest first. *Note: same walk as `core/ancestry.ts` `ancestors` (uids, nearest-first instead of nodes, outermost-first).* | collapsedFor, isDescendant | no | **USED (cli, bridge) · DUPLICATE** |
| 158 | [`isDescendant`](../src/emit/mermaid.ts#L227) | Whether one node sits inside another. | collapsedFor | no | **USED (cli, bridge)** |
| 159 | [`topLevelSequences`](../src/emit/mermaid.ts#L232) | The root's child sequences (one file each in split mode). | toMermaidSplit; tests (1 file) | yes — imported by tests | **USED (cli)** |
| 160 | [`mermaidModel`](../src/emit/mermaid.ts#L246) | Builds the node list and edges a Mermaid diagram will contain for a mode. | toMermaid; tests (1 file) | yes — imported by tests | **USED (cli, bridge)** |
| 161 | [mermaidModel › `push`](../src/emit/mermaid.ts#L252) | Adds one node (with label and shape) to the model. | mermaidModel | no | **USED (cli, bridge)** |
| 162 | [`edgeLine`](../src/emit/mermaid.ts#L300) | Formats one edge as a Mermaid line (solid or dotted, labelled or not). | toMermaid | no | **USED (cli, bridge)** |
| 163 | [`toMermaid`](../src/emit/mermaid.ts#L323) | Emits the whole graph as deterministic Mermaid `flowchart` text. | toMermaidSplit, App.tsx bridgeExportMermaid; CLI: bin/cli.mjs; tests (4 files) | yes — imported by src, CLI, tests | **USED (cli, bridge)** |
| 164 | [toMermaid › `emit`](../src/emit/mermaid.ts#L336) | Recursively writes nodes and subgraphs. | toMermaid | no | **USED (cli, bridge)** |
| 165 | [`slug`](../src/emit/mermaid.ts#L417) | Lower-case, hyphenated, collision-free file name from a sequence name. | fileFor, toMermaidSplit; tests (1 file) | yes — imported by tests | **USED (cli)** |
| 166 | [`toMermaidSplit`](../src/emit/mermaid.ts#L433) | Emits one Mermaid file per top-level sequence plus a linked overview. | CLI: bin/cli.mjs; tests (2 files) | yes — imported by CLI, tests | **USED (cli)** |
| 167 | [toMermaidSplit › `fileFor`](../src/emit/mermaid.ts#L442) | File name for one top-level sequence. | toMermaidSplit | no | **USED (cli)** |

### `src/emit/svg.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 168 | [`place`](../src/emit/svg.ts#L142) | Absolute positions for nodes (resolving parent-relative ones). | toSvg | no | **BRIDGE-ONLY** |
| 169 | [`esc`](../src/emit/svg.ts#L164) | Escapes text for XML content/attributes. | toSvg; tests (1 file) | yes — imported by tests | **BRIDGE-ONLY** |
| 170 | [`wrapText`](../src/emit/svg.ts#L179) | Greedy word wrap to N lines with an ellipsis. | toSvg; tests (1 file) | yes — imported by tests | **BRIDGE-ONLY** |
| 171 | [`diffClass`](../src/emit/svg.ts#L220) | Reads the diff-added/removed/changed class off a node or edge. | strokeFor, shapeOf, toSvg; tests (1 file) | yes — imported by tests | **BRIDGE-ONLY** |
| 172 | [`strokeFor`](../src/emit/svg.ts#L229) | Outline colour for a node from its shape/diff state. | shapeOf | no | **BRIDGE-ONLY** |
| 173 | [`shapeOf`](../src/emit/svg.ts#L245) | SVG markup for a node's shape (rect, rounded, diamond, hexagon). | toSvg | no | **BRIDGE-ONLY** |
| 174 | [`elbow`](../src/emit/svg.ts#L284) | Fallback three-segment route when ELK gave none. | toSvg | no | **BRIDGE-ONLY** |
| 175 | [`polyline`](../src/emit/svg.ts#L292) | Formats route points as an SVG `points` attribute. | toSvg | no | **BRIDGE-ONLY** |
| 176 | [`round`](../src/emit/svg.ts#L296) | Rounds to two decimals. *Note: identical to `emit/sidecar.ts` `round`.* | polyline, toSvg | no | **BRIDGE-ONLY** |
| 177 | [`toSvg`](../src/emit/svg.ts#L306) | Renders laid-out nodes and routed edges as a standalone SVG string. | App.tsx bridgeExportSvg, App.tsx bridgeExportPng; tests (2 files) | yes — imported by src, tests | **BRIDGE-ONLY** |
| 178 | [toSvg › `dim`](../src/emit/svg.ts#L341) | Whether a class list marks an element dimmed. | toSvg | no | **BRIDGE-ONLY** |
| 179 | [toSvg › `onPath`](../src/emit/svg.ts#L343) | Whether a class list marks an element on a traced path. | toSvg | no | **BRIDGE-ONLY** |
| 180 | [toSvg › `direction`](../src/emit/svg.ts#L351) | Whether a traced element is upstream or downstream. | toSvg | no | **BRIDGE-ONLY** |
| 181 | [`darken`](../src/emit/svg.ts#L484) | Darkens a canvas colour for a white background. | toSvg | no | **BRIDGE-ONLY** |

### `src/core/rules.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 182 | [`RuleFileError` (class)](../src/core/rules.ts#L24) | Error class naming the rule-file key that is wrong. | req, strArray, strListMap, enumMap, durations, list, loopRules, attr, edgeRules, loadRules, App.tsx loadRuleFile; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 183 | [`isRecord`](../src/core/rules.ts#L50) | Type guard: plain object (not array, not null). | strListMap, enumMap, durations, loopRules, edgeRules, loadRules | no | **USED (app, cli, bridge)** |
| 184 | [`req`](../src/core/rules.ts#L54) | Reads a required key or throws RuleFileError. | strArray, enumMap, edgeRules, loadRules | no | **USED (app, cli, bridge)** |
| 185 | [`strArray`](../src/core/rules.ts#L62) | Reads a required list of strings. | list, loadRules | no | **USED (app, cli, bridge)** |
| 186 | [`strListMap`](../src/core/rules.ts#L76) | Reads an optional `{Element: [names]}` mapping. | loadRules | no | **USED (app, cli, bridge)** |
| 187 | [`enumMap`](../src/core/rules.ts#L96) | Reads a `{Element: value}` mapping restricted to allowed values, with a default. | loadRules | no | **USED (app, cli, bridge)** |
| 188 | [`durations`](../src/core/rules.ts#L126) | Reads the optional `durations: {waits, timeouts}` block. | loadRules | no | **USED (app, cli, bridge)** |
| 189 | [durations › `list`](../src/core/rules.ts#L132) | Reads one of the two duration lists. | durations | no | **USED (app, cli, bridge)** |
| 190 | [`loopRules`](../src/core/rules.ts#L159) | Reads the optional `loops:` block. | loadRules | no | **USED (app, cli, bridge)** |
| 191 | [loopRules › `attr`](../src/core/rules.ts#L172) | Reads the optional count/period attribute name of one loop rule. | loopRules | no | **USED (app, cli, bridge)** |
| 192 | [`edgeRules`](../src/core/rules.ts#L190) | Reads and validates the `edges:` list. | loadRules | no | **USED (app, cli, bridge)** |
| 193 | [`loadRules`](../src/core/rules.ts#L263) | Parses and validates rules.yaml text into a Rules object. | App.tsx (module scope), App.tsx loadRuleFile; CLI: bin/cli.mjs; tests (6 files) | yes — imported by src, CLI, tests | **USED (app, cli, bridge)** |

### `src/core/resolve.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 194 | [`tagOf`](../src/core/resolve.ts#L29) | Element local name. | isContainer, isIgnored, core/parse.ts topLevel, core/parse.ts shapeOf, core/parse.ts kindOf, core/parse.ts childAttrsOf, core/parse.ts walk, core/parse.ts visit, core/parse.ts parse, core/profile.ts walk, core/profile.ts profile | yes — imported by src | **USED (app, cli, bridge)** |
| 195 | [`uidOf`](../src/core/resolve.ts#L33) | Element `uid` attribute or empty string. | holdsStepChildren, core/parse.ts walk, core/parse.ts indexElements, core/parse.ts topLevel, core/parse.ts visit, core/parse.ts buildEdges, core/parse.ts loopEdges, core/parse.ts parse, core/profile.ts collectUids, core/profile.ts walk | yes — imported by src | **USED (app, cli, bridge)** |
| 196 | [`childElements`](../src/core/resolve.ts#L38) | Element children in document order (no ElementTraversal needed). | stepChildren, core/parse.ts walk, core/profile.ts collectUids, core/profile.ts walk | yes — imported by src | **USED (app, cli, bridge)** |
| 197 | [`isContainer`](../src/core/resolve.ts#L63) | Whether an element holds steps (per rules, or because it has uid-bearing children). | firstLeaf, lastLeaf, core/parse.ts topLevel, core/parse.ts shapeOf, core/parse.ts kindOf, core/parse.ts visit | yes — imported by src | **USED (app, cli, bridge)** |
| 198 | [`isIgnored`](../src/core/resolve.ts#L68) | Whether the rule file says an element produces no node. | isStep, stepChildren, core/parse.ts walk, core/profile.ts walk | yes — imported by src | **USED (app, cli, bridge)** |
| 199 | [`isStep`](../src/core/resolve.ts#L77) | Whether an element takes part in the flow (not ignored, not the document element). | nextSiblingLeaf | yes — **never imported** | **USED (app, cli, bridge)** |
| 200 | [`stepChildren`](../src/core/resolve.ts#L83) | Step children of a container, in order. | holdsStepChildren, firstLeaf, lastLeaf, nextSiblingLeaf, core/parse.ts topLevel, core/parse.ts visit, core/parse.ts parse, core/profile.ts walk | yes — imported by src | **USED (app, cli, bridge)** |
| 201 | [`holdsStepChildren`](../src/core/resolve.ts#L96) | Whether an element has children that will become nodes. | isContainer | yes — **never imported** | **USED (app, cli, bridge)** |
| 202 | [`firstLeaf`](../src/core/resolve.ts#L105) | Descends a container to its first executable leaf (jump-target rule 4.3). | lastLeaf, nextSiblingLeaf, resolveTarget, core/parse.ts loopEdges, core/parse.ts parse; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 203 | [`lastLeaf`](../src/core/resolve.ts#L128) | Descends a container to its last leaf (for loop back edges). | lastLeaf, core/parse.ts loopEdges | yes — imported by src | **USED (app, cli, bridge)** |
| 204 | [`nextSiblingLeaf`](../src/core/resolve.ts#L162) | Fall-through successor: next sibling step, walking up when last (rule 4.4). | core/parse.ts buildEdges; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 205 | [`resolveTarget`](../src/core/resolve.ts#L193) | Looks up a jump target uid and descends to its first leaf. | core/parse.ts buildEdges; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |

### `src/core/parse.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 206 | [`ParseError` (class)](../src/core/parse.ts#L43) | Error class for an unparseable or empty sequence document. | topLevel, parse, App.tsx load; CLI: bin/cli.mjs; tests (2 files) | yes — imported by src, CLI, tests | **USED (app, cli, bridge)** |
| 207 | [`attrsOf`](../src/core/parse.ts#L50) | All attributes of an element as a plain record. | walk, visit | no | **USED (app, cli, bridge)** |
| 208 | [`indexElements`](../src/core/parse.ts#L65) | Builds a uid → DOM element index. | parse; tests (1 file) | yes — imported by tests | **USED (app, cli, bridge)** |
| 209 | [indexElements › `walk`](../src/core/parse.ts#L70) | Recursive step of indexElements. | indexElements | no | **USED (app, cli, bridge)** |
| 210 | [`topLevel`](../src/core/parse.ts#L89) | The elements the walk starts from (skipping uid-less wrappers and sidecar blocks). | parse | no | **USED (app, cli, bridge)** |
| 211 | [`shapeOf`](../src/core/parse.ts#L113) | Node shape from the rule file (container if it holds steps). | visit | no | **USED (app, cli, bridge)** |
| 212 | [`kindOf`](../src/core/parse.ts#L118) | Node kind from the rule file (container if it holds steps). | visit | no | **USED (app, cli, bridge)** |
| 213 | [`childAttrsOf`](../src/core/parse.ts#L127) | Collects attributes of inspector-only children (e.g. Comparison) into childAttrs. | visit | no | **USED (app, cli, bridge)** |
| 214 | [childAttrsOf › `walk`](../src/core/parse.ts#L141) | Recursive step of childAttrsOf. | childAttrsOf | no | **USED (app, cli, bridge)** |
| 215 | [`walkNodes`](../src/core/parse.ts#L166) | Walks the DOM and builds nodes, container child lists and element warnings. | parse | no | **USED (app, cli, bridge)** |
| 216 | [walkNodes › `visit`](../src/core/parse.ts#L177) | Visits one element and returns the uids it contributes to its parent. | walkNodes | no | **USED (app, cli, bridge)** |
| 217 | [`ruleApplies`](../src/core/parse.ts#L291) | Whether an edge rule's gating attributes are all present on an element. | buildEdges | no | **USED (app, cli, bridge)** |
| 218 | [`ruleMatches`](../src/core/parse.ts#L297) | Whether an element's attributes equal every value in a rule's `when` clause. | buildEdges | no | **USED (app, cli, bridge)** |
| 219 | [`buildEdges`](../src/core/parse.ts#L301) | Builds jump, branch, criteria and fall-through edges from the rule file. | parse | no | **USED (app, cli, bridge)** |
| 220 | [`loopEdges`](../src/core/parse.ts#L400) | Adds loop back edges (last leaf → first leaf) for repeating containers. | buildEdges | no | **USED (app, cli, bridge)** |
| 221 | [`parse`](../src/core/parse.ts#L437) | XML text → Graph (nodes, edges, containers, warnings, step numbers). Throws on empty. | App.tsx load; CLI: bin/cli.mjs; tests (30 files) | yes — imported by src, CLI, tests | **USED (app, cli, bridge)** |
| 222 | [`applyStepNumbers`](../src/core/parse.ts#L521) | Writes stepNumbers() results onto the nodes. | parse | no | **USED (app, cli, bridge)** |

### `src/core/numbering.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 223 | [`stepNumbers`](../src/core/numbering.ts#L43) | Computes dotted step numbers (2.1.6.7) from document order. | core/parse.ts applyStepNumbers; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 224 | [stepNumbers › `visit`](../src/core/numbering.ts#L53) | Recursive step of stepNumbers. | stepNumbers | no | **USED (app, cli, bridge)** |
| 225 | [`byStepNumber`](../src/core/numbering.ts#L77) | Reverse index: step number → uid. *Note: doc comment says "used by search" — it is not.* | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/ancestry.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 226 | [`ancestors`](../src/core/ancestry.ts#L17) | Container nodes above a node, outermost first. | ancestorUids, pathLabel, core/search.ts search | yes — imported by src | **USED (app, bridge)** |
| 227 | [`ancestorUids`](../src/core/ancestry.ts#L32) | Ancestor uids as a Set. | App.tsx reveal | yes — imported by src | **USED (app)** |
| 228 | [`pathLabel`](../src/core/ancestry.ts#L37) | Breadcrumb string of ancestor names (`Main › Pulse 3`). | App.tsx selectedDetail; tests (2 files) | yes — imported by src, tests | **USED (app, bridge)** |
| 229 | [`displayName`](../src/core/ancestry.ts#L44) | A node's name, or its element name when unnamed. | numberedName, core/search.ts search, core/search.ts nameCounts, emit/mermaid.ts fileFor, emit/mermaid.ts toMermaidSplit, ui/Outline.tsx Outline, App.tsx selectedDetail, core/similarity.ts compare, core/lint.ts staleTargets, core/lint.ts unreachableSteps, core/lint.ts multipleTerminals, core/lint.ts externalCriteria, core/criteria.ts criteriaTable, core/diff.ts diffGraphs; tests (1 file) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 230 | [`numberedName`](../src/core/ancestry.ts#L57) | Name prefixed with the step number (`2.1.6.7 - Name`). | emit/mermaid.ts push, ui/Outline.tsx Outline, App.tsx selectedDetail; tests (2 files) | yes — imported by src, tests | **USED (app, cli, bridge)** |
| 231 | [`outlineOrder`](../src/core/ancestry.ts#L68) | Every node in document (outline) order. | core/lint.ts duplicateNames, core/lint.ts externalCriteria, core/lint.ts documentOrder, core/criteria.ts criteriaTable, core/criteria.ts criteriaAhead, core/criteria.ts criteriaSteps, core/diff.ts diffGraphs, core/diff.ts mergedGraph | yes — imported by src | **ONLY-USED-BY-TESTS** |
| 232 | [outlineOrder › `visit`](../src/core/ancestry.ts#L72) | Recursive step of outlineOrder. | outlineOrder | no | **ONLY-USED-BY-TESTS** |

### `src/core/search.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 233 | [`isActive`](../src/core/search.ts#L44) | Whether a search query has text or an element filter. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 234 | [`isStepNumberQuery`](../src/core/search.ts#L53) | Whether query text looks like a step number (digits and dots). | search; tests (1 file) | yes — imported by tests | **USED (app)** |
| 235 | [`numberMatches`](../src/core/search.ts#L62) | Segment-aware prefix match on step numbers (2.1 matches 2.1.6, not 2.10). | search | no | **USED (app)** |
| 236 | [`search`](../src/core/search.ts#L74) | Finds nodes by name/number and element filter, with parent paths, in document order. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 237 | [`matchSet`](../src/core/search.ts#L109) | Result uids as a Set, for dimming. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 238 | [`elementCounts`](../src/core/search.ts#L119) | Element types present in the graph with counts, commonest first. | App.tsx App; tests (1 file) | yes — imported by src, tests | **USED (app)** |
| 239 | [`nameCounts`](../src/core/search.ts#L130) | Distinct names with how many nodes share each. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/profile.ts`

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 240 | [`statusOf`](../src/core/profile.ts#L97) | Classifies an element name as ignored / container / step / unknown for the rule file. | walk | no | **USED (cli)** |
| 241 | [`profile`](../src/core/profile.ts#L108) | Walks a raw document and reports every element and how the rule file treats it. | CLI: bin/cli.mjs; tests (3 files) | yes — imported by CLI, tests | **USED (cli)** |
| 242 | [profile › `collectUids`](../src/core/profile.ts#L116) | Collects every uid in the document. | profile | no | **USED (cli)** |
| 243 | [profile › `walk`](../src/core/profile.ts#L125) | Recursive per-element profiling step. | profile | no | **USED (cli)** |
| 244 | [`targetAttrs`](../src/core/profile.ts#L190) | Finds attributes whose values are uids (jump targets) and their gate attribute. | profile | no | **USED (cli)** |
| 245 | [`findGate`](../src/core/profile.ts#L221) | Finds the attribute that separates live from stale jump targets. | targetAttrs | no | **USED (cli)** |
| 246 | [`mergeProfiles`](../src/core/profile.ts#L252) | Merges per-file profiles across a corpus, dropping gates that disagree. | CLI: bin/cli.mjs; tests (1 file) | yes — imported by CLI, tests | **USED (cli)** |
| 247 | [`unknowns`](../src/core/profile.ts#L305) | Elements the rule file has no answer for, commonest first. | suggestRules; CLI: bin/cli.mjs; tests (2 files) | yes — imported by CLI, tests | **USED (cli)** |
| 248 | [`suggestRules`](../src/core/profile.ts#L330) | Emits a rules.yaml fragment covering what the rule file is missing. | CLI: bin/cli.mjs; tests (2 files) | yes — imported by CLI, tests | **USED (cli)** |
| 249 | [suggestRules › `list`](../src/core/profile.ts#L350) | Formats one YAML list section. | suggestRules | no | **USED (cli)** |
| 250 | [`describe`](../src/core/profile.ts#L386) | One-line description of an element profile for YAML comments. | list | no | **USED (cli)** |

### `src/core/paths.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 251 | [`isFlow`](../src/core/paths.ts#L31) | Whether an edge is a forward route (not a loop back edge). | walk, core/duration.ts reverseTopo, core/duration.ts pathTotals, core/duration.ts offsets; tests (1 file) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 252 | [`adjacency`](../src/core/paths.ts#L63) | Builds in/out edge lists per node. | upstream, downstream, pathSet, predecessors, successors, terminals, unreachable, core/lint.ts unreachableSteps, core/criteria.ts criteriaAhead, core/duration.ts pathTotals, core/duration.ts durations, core/duration.ts offsets, core/duration.ts terminalCount; tests (3 files) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 253 | [adjacency › `bucket`](../src/core/paths.ts#L66) | Get-or-create a list in a Map. | adjacency | no | **ONLY-USED-BY-TESTS** |
| 254 | [`walk`](../src/core/paths.ts#L85) | BFS in one direction over flow edges. | upstream, downstream | no | **ONLY-USED-BY-TESTS** |
| 255 | [`upstream`](../src/core/paths.ts#L117) | Every node that can reach a node, with the edges between. | pathSet; tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 256 | [`downstream`](../src/core/paths.ts#L122) | Every node reachable from a node, with the edges between. | pathSet, unreachable, core/criteria.ts criteriaAhead; tests (2 files) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 257 | [`pathSet`](../src/core/paths.ts#L130) | Upstream + downstream + the node itself (path highlighting). | tests (4 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 258 | [`firstLeafOf`](../src/core/paths.ts#L147) | First leaf of a container, over the Graph (twin of resolve.firstLeaf over DOM). *Note: intentional Graph-level twin of `resolve.firstLeaf` (DOM); not a removable duplicate.* | firstLeafOf; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 259 | [`predecessors`](../src/core/paths.ts#L172) | Direct predecessors of a node. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 260 | [`successors`](../src/core/paths.ts#L177) | Direct successors of a node. | none | yes — **never imported** | **UNUSED** |
| 261 | [`terminals`](../src/core/paths.ts#L185) | Leaves with no outbound edge. | core/lint.ts multipleTerminals, core/duration.ts terminalCount; tests (2 files) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 262 | [`unreachable`](../src/core/paths.ts#L198) | Leaves never reachable from the entry. | core/lint.ts unreachableSteps; tests (3 files) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |

### `src/core/similarity.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 263 | [`structureKey`](../src/core/similarity.ts#L29) | Canonical string of a subtree's shape (element names + nesting). | similarGroups; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 264 | [structureKey › `walk`](../src/core/similarity.ts#L32) | Recursive step of structureKey. | structureKey | no | **ONLY-USED-BY-TESTS** |
| 265 | [`subtree`](../src/core/similarity.ts#L46) | Nodes of a subtree in document order. | similarGroups, compare; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 266 | [subtree › `walk`](../src/core/similarity.ts#L50) | Recursive step of subtree. | subtree | no | **ONLY-USED-BY-TESTS** |
| 267 | [`similarGroups`](../src/core/similarity.ts#L80) | Groups containers that share an identical structure. | core/lint.ts siblingDifferences; tests (2 files) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 268 | [`flatAttrs`](../src/core/similarity.ts#L136) | A node's own attributes plus lifted child attributes, flattened to one map. | compare, core/diff.ts attrChanges | yes — imported by src | **ONLY-USED-BY-TESTS** |
| 269 | [`compare`](../src/core/similarity.ts#L171) | Lists every attribute that differs across structurally identical containers. | core/lint.ts siblingDifferences; tests (1 file) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |

### `src/core/lint.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 270 | [`classify`](../src/core/lint.ts#L80) | Classifies a set of values as boolean / reference / number / enum / text. | siblingDifferences; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 271 | [`siblingDifferences`](../src/core/lint.ts#L142) | Classified, sorted attribute differences within each group of identical siblings. | lint; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 272 | [`oddMembers`](../src/core/lint.ts#L178) | Indices of members holding the minority value. | oddSiblingAttrs | no | **ONLY-USED-BY-TESTS** |
| 273 | [`oddSiblingAttrs`](../src/core/lint.ts#L190) | ODD_SIBLING_ATTR findings. | lint | no | **ONLY-USED-BY-TESTS** |
| 274 | [`staleTargets`](../src/core/lint.ts#L241) | STALE_TARGET findings (jump target set but not selected by its action). | lint | no | **ONLY-USED-BY-TESTS** |
| 275 | [`duplicateNames`](../src/core/lint.ts#L290) | DUPLICATE_NAME findings. | lint | no | **ONLY-USED-BY-TESTS** |
| 276 | [`unreachableSteps`](../src/core/lint.ts#L319) | UNREACHABLE findings. | lint | no | **ONLY-USED-BY-TESTS** |
| 277 | [`multipleTerminals`](../src/core/lint.ts#L343) | MULTIPLE_TERMINALS findings. | lint | no | **ONLY-USED-BY-TESTS** |
| 278 | [`externalCriteria`](../src/core/lint.ts#L375) | EXTERNAL_CRITERIA findings. | lint | no | **ONLY-USED-BY-TESTS** |
| 279 | [`referenceId`](../src/core/lint.ts#L425) | Definition id inside an external reference string. | externalCriteria, core/criteria.ts criteriaTable; tests (1 file) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 280 | [`referenceMembers`](../src/core/lint.ts#L431) | Member list inside an external reference string. | core/criteria.ts criteriaTable; tests (1 file) | yes — imported by src, tests | **ONLY-USED-BY-TESTS** |
| 281 | [`documentOrder`](../src/core/lint.ts#L441) | uid → document index map. *Note: thin index over `ancestry.outlineOrder`.* | multipleTerminals, lint | no | **ONLY-USED-BY-TESTS** |
| 282 | [`plural`](../src/core/lint.ts#L447) | Appends "s" unless n is 1. | oddSiblingAttrs, duplicateNames, externalCriteria | no | **ONLY-USED-BY-TESTS** |
| 283 | [`quote`](../src/core/lint.ts#L451) | Quotes a value, or says "nothing" for empty. | oddSiblingAttrs | no | **ONLY-USED-BY-TESTS** |
| 284 | [`lint`](../src/core/lint.ts#L488) | Runs every lint rule and returns sorted findings. | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/criteria.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 285 | [`criteriaTable`](../src/core/criteria.ts#L80) | One row per external criterion definition, most-used first. | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 286 | [`nodesForCriterion`](../src/core/criteria.ts#L123) | Steps carrying a given criterion. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 287 | [`failEdges`](../src/core/criteria.ts#L153) | Criteria fail edges (dotted criteria-reason edges). | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 288 | [`criteriaAhead`](../src/core/criteria.ts#L184) | Criteria still downstream of a step. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 289 | [`criteriaSteps`](../src/core/criteria.ts#L204) | Every criteria step in document order. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/diff.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 290 | [`commonRanks`](../src/core/diff.ts#L143) | Rank of each child among siblings present in both revisions. | diffGraphs | no | **ONLY-USED-BY-TESTS** |
| 291 | [`attrChanges`](../src/core/diff.ts#L158) | Attribute-level changes between two versions of a node. | diffGraphs | no | **ONLY-USED-BY-TESTS** |
| 292 | [`edgeKey`](../src/core/diff.ts#L172) | Identity string for an edge. | diffGraphs | no | **ONLY-USED-BY-TESTS** |
| 293 | [`diffGraphs`](../src/core/diff.ts#L183) | Compares two revisions: added / removed / changed / moved nodes and edge counts. | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 294 | [diffGraphs › `anchor`](../src/core/diff.ts#L291) | Finds where a removed node used to sit. | diffGraphs | no | **ONLY-USED-BY-TESTS** |
| 295 | [`mergedGraph`](../src/core/diff.ts#L351) | New revision with removed steps put back as ghost nodes. | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 296 | [mergedGraph › `ghost`](../src/core/diff.ts#L394) | Inserts one ghost node. | mergedGraph | no | **ONLY-USED-BY-TESTS** |
| 297 | [`summarise`](../src/core/diff.ts#L426) | One-line summary of a diff. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/duration.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 298 | [`stepSeconds`](../src/core/duration.ts#L61) | A step's wait and timeout seconds from its attributes. | pathTotals, durations, offsets; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 299 | [stepSeconds › `sum`](../src/core/duration.ts#L62) | Sums the listed attributes. | stepSeconds | no | **ONLY-USED-BY-TESTS** |
| 300 | [`loopReports`](../src/core/duration.ts#L135) | Repeating containers with their count and period. | durations | yes — **never imported** | **ONLY-USED-BY-TESTS** |
| 301 | [loopReports › `num`](../src/core/duration.ts#L137) | Parses a numeric attribute. | loopReports | no | **ONLY-USED-BY-TESTS** |
| 302 | [`reverseTopo`](../src/core/duration.ts#L169) | Reverse topological order of the reachable subgraph. | pathTotals, offsets | no | **ONLY-USED-BY-TESTS** |
| 303 | [`pathTotals`](../src/core/duration.ts#L204) | Min/max remaining time and path counts per step (one DP pass). | durations, offsets | yes — **never imported** | **ONLY-USED-BY-TESTS** |
| 304 | [`durations`](../src/core/duration.ts#L284) | Whole-file nominal vs worst-case duration estimate. | tests (4 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 305 | [`offsets`](../src/core/duration.ts#L353) | How far into the test a step sits and how much remains. | tests (2 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 306 | [`humanSeconds`](../src/core/duration.ts#L431) | Seconds formatted as s or min. | humanRange; tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 307 | [`humanRange`](../src/core/duration.ts#L440) | A min–max range formatted, collapsed when equal. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 308 | [`round`](../src/core/duration.ts#L445) | Rounds to N places and returns a string. | humanSeconds | no | **ONLY-USED-BY-TESTS** |
| 309 | [`terminalCount`](../src/core/duration.ts#L451) | Number of terminals. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/signals.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 310 | [`signalIndex`](../src/core/signals.ts#L34) | Index of signal tag → steps that reference it. | tests (3 files) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 311 | [signalIndex › `record`](../src/core/signals.ts#L37) | Records one signal reference. | signalIndex | no | **ONLY-USED-BY-TESTS** |
| 312 | [`nodesFor`](../src/core/signals.ts#L64) | Distinct steps touching a signal. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 313 | [`signalRows`](../src/core/signals.ts#L78) | Signal index as sorted display rows. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

### `src/core/signalNames.ts` — *not imported by the app or the CLI*

| ID | Name | What it does | Called by | Exported | Status |
|---:|---|---|---|---|---|
| 314 | [`noSignalNames`](../src/core/signalNames.ts#L39) | Empty signal dictionary. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 315 | [`fields`](../src/core/signalNames.ts#L48) | Splits one CSV/TSV row (handles quotes). | parseSignalNames | no | **ONLY-USED-BY-TESTS** |
| 316 | [`parseSignalNames`](../src/core/signalNames.ts#L87) | Parses a tag → human-name dictionary file. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 317 | [`signalLabel`](../src/core/signalNames.ts#L126) | Human name for a tag, or the tag itself. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 318 | [`enumLabel`](../src/core/signalNames.ts#L131) | Label for an enum member (`tag:value`). | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |
| 319 | [`unnamedTags`](../src/core/signalNames.ts#L140) | Tags the dictionary does not name. | tests (1 file) | yes — imported by tests | **ONLY-USED-BY-TESTS** |

## List 1 — The bridge surface

### Commands accepted by `handleCommand` / `handleCommandSync`

All 13 are parsed by `parseCommand` (28) and routed by `dispatch` (45). `handleCommand` returns an
acceptance envelope and reports failures as a `commandError` event too; `handleCommandSync` returns
`{ok, result|error, id}`.

| Command | Payload | What it does | Implemented by (IDs) |
|---|---|---|---|
| `loadXml` | `{text, fileName}` | Parse and show a sequence | `asFilePayload` 30 → `App.load` 3 |
| `loadRuleFile` | `{text, fileName}` | Replace the rule file and re-parse the sequence on screen | 30 → `App.loadRuleFile` 4 |
| `loadLayout` | `{text, fileName}` | Apply a layout sidecar (collapsed set, then positions) | 30 → `App.loadLayout` 6 → `parseSidecar` 150, `applySidecar` 151 |
| `clearRuleFile` | none | Back to the built-in rules and re-parse | `App.clearRuleFile` 5 |
| `selectStep` | `{uid}` | Select, expand ancestors, centre the canvas | 31 → `onSelectStep` 50 → `bridgeSelectStep` 16 → `reveal` 10 |
| `setStepStatus` | `{uid, status}` | Set one step's live execution colour | 33 → `bridgeSetStepStatus` 17 |
| `setStepStatuses` | `{statuses: [...]}` | Set many at once (bad rows dropped) | 34 → `bridgeSetStepStatuses` 18 |
| `resetExecution` | none | Clear all execution colours | `bridgeResetExecution` 19 |
| `setView` | `{view}` | Show tree, canvas, or both | 32 → `bridgeSetView` 20 |
| `exportMermaid` | none | Returns the full graph as Mermaid text | `bridgeExportMermaid` 21 → `toMermaid` 163 |
| `exportSvg` | none | Returns the canvas as SVG text | `bridgeExportSvg` 22 → `toSvg` 177 |
| `exportPng` | none | Starts a PNG render; result arrives as an event (never synchronous) | `bridgeExportPng` 23 → `toSvg` 177, `svgToPng` 110, `blobToBase64` 67 |
| `getState` | none | `{fileName, nodeCount, warnings, selected, view}` | `bridgeGetState` 24 → `selectedDetail` 15 |

### The other `window.SeqFlowBridge` methods

| Method | Returns | Implemented by (IDs) |
|---|---|---|
| `loadXml(text, fileName?)` / `loadRuleFile(…)` / `loadLayout(…)` | `{ok, result:null, id:null}` | 55 / 56 / 57 → `raw` 53 → App 3 / 4 / 6 |
| `pollEvents()` | queue as JSON, payloads nested | 60 → `poll` 54 → `serialiseEvents` 42 |
| `pollEventsFlat()` | queue as JSON, payloads stringified | 61 → `poll` 54 → `serialiseEventsFlat` 43 → `flatEvent` 69 |
| `setEventSink(fn \| null)` | number of backlog events flushed | 62 → `detach` 48 on a throw |
| `attachLabVIEW(refnum)` | count pushed, as a string | 63 → `pushToLabVIEW` 70 |
| `isReady()` / `ping()` / `version()` | `"true"` / `"pong"` / `"4"` | 64 / 65 / 66 |

`loadRuleFile` and `loadLayout` (56, 57) are the only two methods no test calls.

### Events the bridge sends

All leave through `emit` 49 → `deliver` 47 (LabVIEW refnum, else JS sink, else the queue).

| Event | When | Payload | Sent by |
|---|---|---|---|
| `bridgeReady` | First thing `attachLabVIEW` pushes | `null` | `api.attachLabVIEW` 63 |
| `stepSelected` | Selection changed (by a click or by `selectStep`); carries `origin: user\|host`, suppressed when unchanged | `selectedDetail` object or `null` | App effect on `selected` → `enqueue` → `selectionEvent` 51 |
| `viewChanged` | View mode changed (also fires on mount) | `{view}` | App effect on `viewMode` |
| `fileLoaded` | A sequence parsed | `{fileName, nodeCount, warnings}` | App effect on `loaded` |
| `loadError` | *Any* error the banner would show — bad XML, bad rule file, bad sidecar, layout timeout | `{message}` | App effect on `error` |
| `exportPngResult` | PNG render finished | `{id, base64, width, height}` | `dispatch` 45 |
| `exportPngError` | PNG render failed | `{id, message}` | `dispatch` 45 |
| `commandError` | `handleCommand` could not parse or dispatch a command | `{id, message, raw}` or `{id, type, message}` | `api.handleCommand` 58 |
| `pollError` | A drained batch would not serialise | `{message}` | `poll` 54 |

## List 2 — Other dead code

### Unused CSS (`src/ui/styles.css`)

Checked by matching every class selector against the class strings in `src/ui/*.tsx`, `App.tsx` and
`emit/flow.ts`, with the dynamic prefixes (`shape-*`, `exec-*`, `kind-*`) resolved by hand. Nothing
in the page renders these any more — almost all belonged to the drawer, the settings panel or the old
toolbar.

| Selector(s) | Line(s) | Probably from |
|---|---|---|
| `.segmented` (+ `button` variants) | 92–113 | old toolbar mode toggle |
| `.stat`, `.stat b`, `.stat .auto-folded` | 118–124, 1548 | toolbar "opened folded (N)" |
| `.spacer` | 67, 1314 | toolbar / export controls |
| `.banner.warn` | 241 | warnings banner (only `.banner.error` is rendered) |
| `.rf-node .fanin` | 418 | fan-in badge on nodes |
| `.section`, `.section > h3` | 467–471 | inspector sections |
| `pre.xml` | 510 | inspector raw-XML view |
| `.legend`, `.legend i` | 532–540 | canvas legend |
| `.detail-path` | 1112 | inspector |
| `.warn-row`, `.warn-code`, `.warn-message` | 1122–1143 | Warnings tab |
| `.export-controls`, `-depth`, `-files`, `-preview`, `-rule`, `-note`, `-error`, `-image`, `-layout` | 1305–1432 | Export tab |
| `button.tool.save-png` | 1438 | Export tab |
| `.row-name + .row-count` | 1538 | drawer list rows |

`button.tool` itself *is* still used (Outline buttons).

### State fields and props

| Item | Where | Finding |
|---|---|---|
| `ruleSet.file` | `App.tsx:88` | Written on every rule-file load, **never read**. Only `ruleSet.rules` is used. |
| `hiddenColumns` setter | `App.tsx:179` | Destructured as `[hiddenColumns]` — the setter is discarded, so the value can only come from an old localStorage entry. Known and deliberate per CLAUDE.md, but it is a read-only preference nothing can change. |
| `OutlineProps.graph: Graph \| null` | `ui/Outline.tsx:41`, `:386` | `App` only renders `<Outline>` when `graph !== null`, so the "No file loaded." branch is unreachable. |
| `err instanceof ParseError \|\| err instanceof Error` (and the same for `RuleFileError`, `SidecarError`) | `App.tsx:423, 452, 491` | The subclass check is redundant — all three extend `Error`. The classes are still thrown, so they are not dead. |

No prop passed to `Canvas`, `Outline`, `SplitBar`, `StepNum` or `Icon` goes unread.

### Branches that can no longer fire

These functions are reachable (via `exportSvg`/`exportPng`), but the input they test for is never produced now:

- **`emit/svg.ts` — diff and path-trace styling.** `diffClass` (171) looks for `diff-added/removed/changed`,
  and `onPath` / `direction` (179, 180) look for `on-path` / `path-up` / `path-down`. Nothing in the app puts
  those classes on a node or edge any more — only `dimmed` and `exec-*` — so those branches, the palette
  colours behind them, and the matching arms of `strokeFor` (172) and `shapeOf` (173) are dead in practice.
- **`childAttrs`** is still built by `parse` (`childAttrsOf`, 213), but its only readers are in the test-only
  modules (`signals`, `similarity`, `lint`). Nothing shipped displays it since the inspector went.

### Types and constants

`tsc --noUnusedLocals` is clean, so there are no unused *local* declarations. What remains is at the export level:

| Item | Where | Finding |
|---|---|---|
| `type Parse` | `core/types.ts:200` | **Unused anywhere.** |
| `DIFF_CLASS_DEFS` | `emit/mermaid.ts:89` | Only a test reads it; `mermaid.ts` itself never uses it. |
| `DARK`, `LIGHT` | `emit/svg.ts:53, 79` | Used inside `svg.ts`; exported only for `svg.test.ts`. |
| `SIDECAR_VERSION` | `emit/sidecar.ts:20` | Used inside; exported for a test. |
| `LAYOUT_TIMEOUT_MS`, `LAYOUT_OPTIONS`, `MAX_PIXELS` | `layout/elk.ts:38`, `layout/elkGraph.ts:81`, `ui/raster.ts:27` | Used inside their files; the `export` is unused. |
| Rule-file fields `signalAttrs`, `durations` (`waits`/`timeouts`), `loops.*.period` | `core/types.ts` / `rules.yaml` | Validated by `loadRules`, then read only by the test-only `signals.ts` and `duration.ts`. |
| 29 exported interfaces/types | see knip below | Used inside their own file; `export` unused. Harmless. |

## Tooling cross-check

### `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`

**No output.** `tsconfig.json` already enables both flags, so this is the normal build check. It confirms
there are no unused locals or parameters, but it cannot see unused *exports* or dead-by-reachability code,
which is where everything in this report sits.

### `npx knip` (6.38)

**With tests as entry points**, knip reports 1 unused file (`ui/download.ts`), 13 unused exports and 29
unused exported types. **With only `main.tsx` and `bin/` as entries**, it also reports the eight core modules
above as unused files, plus 35 unused exports.

Where I agree: `ui/download.ts`, `downloadBlob`, `collapsibleUids`, `successors`, and all eight modules as
shipping nowhere.

Where I disagree, or where the finding needs qualifying:

- **`isStep`, `holdsStepChildren`, `inboundCounts`, `loopReports`, `pathTotals`, `RoutedEdge`,
  `LAYOUT_TIMEOUT_MS`, `LAYOUT_OPTIONS`, `MAX_PIXELS`, `RasterError`.** Knip flags the *export*; every one of
  these is called or read inside its own file. The fix is to drop the `export` keyword, not the function.
  (`LAYOUT_TIMEOUT_MS` is only named in a comment in `scale.test.ts`, which is why knip is right about the
  export.)
- **Production-mode exports such as `esc`, `wrapText`, `diffClass`, `mermaidId`, `escapeLabel`, `paramText`,
  `convergentNodes`, `collapseCollinear`, `isStepNumberQuery`, `indexElements`, `isExecStatus`.** All used
  internally by live code; exported so tests can pin them. Not removable.
- **`toSidecar`, `serialiseSidecar`, `sidecarName`, `byStepNumber`, `nameCounts`, `outlineOrder`,
  `topLevelSequences`, `slug`, `mermaidModel`, `collapsedFor`.** Knip's production run lists them all
  together, but they differ. The first five are genuinely test-only (the sidecar *writer* went with the Export
  tab; only the *reader* is live). `outlineOrder` is test-only once the eight modules are excluded. The
  Mermaid ones are live through the CLI and `exportMermaid`.
- **What knip cannot see.** Nested functions, the BRIDGE-ONLY distinction (it treats `App`'s `bridge*`
  callbacks as used because `App` references them), handlers reached through the `BridgeHandlers` interface,
  CSS, state fields, and the branches above. Those came from the compiler-API script and reading the code.

### Limits of this survey

- A function is USED if *any* path reaches it. `toSvg` is BRIDGE-ONLY but still has the dead diff/path
  branches noted above; reachability does not mean every line runs.
- Callers are resolved by name within a file. Two nested helpers with the same name in one file (e.g. the
  two `walk`s in `parse.ts`) share a caller entry; both are live, so no status changed because of it.
- The three duplicates flagged are the ones that do the same job. Name clashes that do *different* jobs
  are not duplicates: `svg.ts polyline` (SVG `points`) vs `edges.tsx polyline` (path `d`), `parse.ts shapeOf`
  vs `svg.ts shapeOf`, `flow.ts measure` vs `Canvas measure`, `duration.ts round` (returns a string) vs the
  two numeric `round`s.
