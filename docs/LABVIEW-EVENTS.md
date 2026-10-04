# SeqFlow bridge — event and method reference

The exact wire surface of `window.SeqFlowBridge`, for the LabVIEW side.

Everything here is taken from the code — `src/bridge/protocol.ts`,
`src/bridge/install.ts` and the `enqueue` calls in `src/App.tsx` — not from
the build guide. Where the guide disagrees, the code wins; every
disagreement is listed at the end.

Bridge protocol version: **4** (`BRIDGE_PROTOCOL_VERSION`, returned by
`version()`).

Every envelope and every event payload quoted below was taken off the built
`dist/index.html` running in a real browser, not composed by hand.

## 0. The rules that shape all of this

Verified in LabVIEW 26.0:

- **`ExecuteJavaScript` runs the snippet as the body of an anonymous
  function**, and only an explicit `return` produces a return value. Every
  snippet that returns data starts with `return`. `Arg` is a JS *variable*
  holding the Argument string, not a token substituted into the text.
- **Every call uses Wait for Return Value? = TRUE**, with Exception wired to
  the error cluster.
- **Page → LabVIEW is pushed** through `window.LabVIEW.FireUserEvent(refnum,
  string)` into a private **string** User Event, once `attachLabVIEW` (§2.0)
  has the refnum. LabVIEW does not poll.
- **Every JSON string the bridge returns or fires is pure ASCII.** LabVIEW
  strings are Windows-1252 bytes, so every character from U+007F up is
  written as a `\uXXXX` escape — `›` is `\u203a`. Still valid JSON; it parses
  identically everywhere. `toAsciiJson` in `src/bridge/labview.ts` is the only
  place this happens. *Open item:* what Unflatten From JSON turns `\u203a`
  into has not been confirmed yet — Windows-1252 `›` is the expectation.

Two consequences run through the whole design:

- **Every public method returns a string, synchronously, and never throws.**
  A thrown JS exception is indistinguishable at this boundary from a method
  that returned nothing — same empty string, no error. So a failure is a
  string that says so, in the same envelope a success uses.
- **Nothing is computed in the wrapper.** `pollEventsFlat()` exists because
  LabVIEW cannot post-process `pollEvents()`'s nested payloads in JS; the
  flattening happens here instead.

`setEventSink` (§2.4) is the one call whose *argument* is JS rather than a
string, and the one place JS you supply outlives the call that sent it — the
closure stays installed and runs on every later event. The rule above is
unchanged for everything else. It predates `attachLabVIEW`, and its snippet's
`JSON.stringify` is **not** ASCII-safe; LabVIEW should use `attachLabVIEW`.

Send:

```
return window.SeqFlowBridge.handleCommandSync(Arg);
```

Never (the call succeeds and returns an empty string):

```
window.SeqFlowBridge.handleCommandSync(Arg);
```

## 1. Public methods

| Method | Argument(s) | Returns | Wait for Return Value? |
|---|---|---|---|
| `attachLabVIEW(refnum)` | the User Event refnum, Type Cast to U32 | how many events it pushed, `bridgeReady` included (bare, not JSON) | **True** |
| `handleCommand(text)` | command JSON | acceptance envelope | **True** — read the envelope |
| `handleCommandSync(text)` | command JSON | result envelope | **True** |
| `pollEvents()` | — | JSON array, payloads nested — debugging probe only | **True** |
| `pollEventsFlat()` | — | JSON array, payloads as strings — not used by LabVIEW any more | **True** |
| `loadXml(text, fileName?)` | file text, name | result envelope | **True** |
| `loadRuleFile(text, fileName?)` | file text, name | result envelope | **True** |
| `loadLayout(text, fileName?)` | file text, name | result envelope | **True** |
| `isReady()` | — | `true` / `false` (bare, not JSON) | **True** |
| `ping()` | — | `pong` (bare, not JSON) | **True** |
| `version()` | — | `4` (bare, not JSON) | **True** |
| `setEventSink(fn)` | a JS function, or `null` | **a number** — how many queued events were flushed | **True**, if you want the count |

`isReady`, `ping` and `version` return a **bare string**, not JSON — compare
them with String Equal, do not unflatten them.

`setEventSink` is the only method that does not return a string at all. Its
argument is a JS closure, so its caller is JS either way and has no
marshalling problem to solve — see §2.4.

### 1.1 The envelopes

Three shapes, and one LabVIEW cluster unflattens all three.

| Method | Success | Failure |
|---|---|---|
| `handleCommandSync` | `{"ok":true,"result":<value or null>,"id":<string or null>}` | `{"ok":false,"error":"<message>","id":<string or null>}` |
| `handleCommand` | `{"ok":true,"id":<string or null>}` | `{"ok":false,"error":"<message>","id":<string or null>}` |
| `loadXml` / `loadRuleFile` / `loadLayout` | `{"ok":true,"result":null,"id":null}` | `{"ok":false,"error":"<message>","id":null}` |

Notes that matter on the LabVIEW side:

- **Keys are omitted, not nulled**, where a shape has no use for them:
  `handleCommand`'s success envelope carries no `result` and no `error`.
  Unflatten into a 4-element cluster `{ok (bool), result (string), error
  (string), id (string)}` with **strict validation = FALSE** (the default) and
  the missing elements keep their defaults. With strict validation TRUE this
  errors.
- **`result` is only a string for the two text exports.** For `getState` it is
  a nested object — unflatten the envelope first, then unflatten `result`
  again into `Get State Reply.ctl`. For every other command it is `null`.
- **"Accepted" is not "succeeded", on four commands.** `handleCommand` returns
  `{"ok":true,...}` for an `exportPng` the moment rasterising *starts* — the
  bytes arrive later as an `exportPngResult` event. The three loads are the
  same, through either entry point: the app catches its own parse failures
  and reports them as events, so `loadXml` returns `{"ok":true,...}` for a
  file that turns out not to parse, and the real answer is the `fileLoaded`
  or `loadError` that lands on a **later** poll — not the same one. Verified
  against the built page: a `loadXml('<nope/>', 'bad.xml')` returns
  `{"ok":true,"result":null,"id":null}`, and the next poll carries
  `loadError` with
  `bad.xml: document element <nope> contains no steps — is this a test sequence? …`.
  Everything else — `selectStep`, `setView`, `setZoomMode`, `clearRuleFile` — is
  genuinely done when the envelope comes back.
- **`id` is echoed even when parsing failed**, best-effort: a command whose
  `type` is unknown still has its `id` read back out of the raw text, so a
  caller can match the failure to the request it sent.
- **A failure on `handleCommand` is reported twice** — in the returned
  envelope *and* as a `commandError` event. A Helper Loop that logs
  `commandError` keeps working unchanged.

### 1.2 `getState`'s result

`handleCommandSync('{"type":"getState"}')` → `result` is an object with
exactly these six keys (`bridgeGetState` in `App.tsx`):

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `fileName` | string | **yes** | `null` when nothing is loaded |
| `nodeCount` | number | no | `0` when nothing is loaded |
| `warnings` | number | no | count, not the warnings themselves |
| `selected` | object | **yes** | `null` when nothing is selected — the `stepSelected` payload, below |
| `view` | string | no | `"tree"`, `"canvas"` or `"both"` |
| `zoomMode` | string | no | `"fit"`, `"top"`, `"centre"` or `"keep"` — see §4 |

A full reply, nothing loaded:

```json
{"ok":true,"result":{"fileName":null,"nodeCount":0,"warnings":0,"selected":null,"view":"both","zoomMode":"fit"},"id":null}
```

## 2. Getting events out

**LabVIEW uses `attachLabVIEW` (§2.0) and nothing else.** Every event is
pushed into a User Event the moment it happens.

The queue and the poll methods stay, as the fallback / non-LabVIEW event path:
they buffer events from before `attachLabVIEW` runs (it flushes them), catch
any event whose push failed, are the only event path for a browser console or
a test, and serve as a debugging probe from LabVIEW —
`return window.SeqFlowBridge.pollEvents();`. While attached, the queue holds
only pre-attach and failed-push events. LabVIEW should not poll it.

`setEventSink` (§2.4) is the older, generic push, for a JS host. While
`attachLabVIEW` is attached it takes precedence over any sink.

Both poll methods **drain the same queue**. Poll one, never both — whichever
runs first takes the events. The queue holds 500 events; past that the oldest
are dropped.

### 2.0 `attachLabVIEW(refnum)` — the LabVIEW path

Send once, from the Web Browser Control's `Load Finished` event (it fires
once, and `window.SeqFlowBridge` already exists by then):

```
window.SeqFlowBridge.attachLabVIEW(JSON.parse(Arg).refnum); return 0;
```

`Arg` = Flatten To JSON of a cluster `{refnum: U32}`, the U32 being the
**User Event** refnum from Create User Event Type Cast to U32 — not the Event
Registration refnum. The User Event's data type is a **string**.

What happens, in order:

1. The refnum is stored.
2. `{"type":"bridgeReady","at":...,"payload":"null"}` is fired.
3. Everything already queued is fired, oldest first, and the queue is empty.
4. From then on every event is fired as it happens. Nothing is queued unless
   a fire fails.

Each fire is **one event per call**, the same object `pollEventsFlat()` puts
in its array, as ASCII JSON:

```json
{"type":"stepSelected","at":1789999921302,"payload":"{\"uid\":\"10000110-0000-0000-0000-000000004000\",\"name\":\"4R Cycle (10s)\",\"stepNumber\":\"2.1.6.7\",\"numbered\":\"2.1.6.7 - 4R Cycle (10s)\",\"element\":\"WaitStep\",\"kind\":\"action\",\"path\":\"XTR Module Test \\u203a Main \\u203a Cycle 1 - 4R \\u203a Draw down at 4R\"}","origin":"user"}
```

`payload` is itself an ASCII JSON **string** — double-encoded on purpose.
Unflatten the outer message into `Bridge Event.ctl` = `{type, payload, at,
origin}` to get `type`, then unflatten `payload` into that type's typedef. No
Variants. `origin` is on `stepSelected` only.

| | |
|---|---|
| **Returns** | bare string: how many events were pushed, `bridgeReady` included. `"0"` outside LabVIEW |
| **Called again, same refnum** | does nothing, returns `"0"` — never double-sends |
| **Called with a new refnum** | re-attaches: `bridgeReady` again, then whatever is queued |
| **A fire throws** | that event is queued (pollable), the error message goes to `window.__seqflowError`, and the refnum **stays attached** — the next event is pushed again |
| **Outside LabVIEW** | inert: no `window.LabVIEW`, nothing fires, everything queues as before |
| **Bad argument** | `{"ok":false,"error":"refnum must be a number, ..."}` |

Register for the User Event **before** the page can load: the flush is
synchronous, and an event fired at a User Event nothing has registered for is
gone.

### 2.1 `pollEventsFlat()` — the flat queue drain

A JSON array of objects with three keys always present and a fourth on
`stepSelected` only:

| Key | JSON type | Always? | Notes |
|---|---|---|---|
| `type` | string | yes | see §3 |
| `at` | number | yes | `Date.now()` when queued — milliseconds since the epoch, an I64 on the LabVIEW side. An ordering aid, never a key |
| `payload` | **string** | yes | the payload, JSON-encoded a second time. `"null"` when the event has none |
| `origin` | string | **`stepSelected` only** | `"user"` or `"host"` — see §3.1. Emitted last, after `payload` |

Each element is exactly what §2.0 fires. Empty queue → `[]`.

**`Origin` is why strict validation must stay FALSE.** It is absent on seven
of the eight event types, and with strict validation off a missing element
simply keeps its default — an empty string, which is exactly what "this event
has no origin" should look like. A cluster written before protocol 3 still
unflattens unchanged; it just ignores the key.

### 2.2 `pollEvents()` — the nested form

Same events, `payload` nested as its real object and the key order
`{type, payload, at}` — with `origin` last, on `stepSelected` only. Kept
working, but **an event with no payload has no `payload` key at all**
(`JSON.stringify` drops `undefined`), and the payload shape varies per event
type — which is what makes it hard to unflatten into a LabVIEW cluster and why
§2.1 exists.

### 2.3 A real poll, from the fixture

`pollEventsFlat()` after selecting step 2.1.6.7 in `fixtures/Sequence_XML.xml`,
loading the file, switching view and clearing the selection — generated from
the real parse, not hand-written:

```json
[{"type":"stepSelected","at":1789999921302,"payload":"{\"uid\":\"10000110-0000-0000-0000-000000004000\",\"name\":\"4R Cycle (10s)\",\"stepNumber\":\"2.1.6.7\",\"numbered\":\"2.1.6.7 - 4R Cycle (10s)\",\"element\":\"WaitStep\",\"kind\":\"action\",\"path\":\"XTR Module Test \\u203a Main \\u203a Cycle 1 - 4R \\u203a Draw down at 4R\"}","origin":"user"},{"type":"fileLoaded","at":1789999921302,"payload":"{\"fileName\":\"Sequence_XML.xml\",\"nodeCount\":133,\"warnings\":0}"},{"type":"viewChanged","at":1789999921302,"payload":"{\"view\":\"both\"}"},{"type":"stepSelected","at":1789999921302,"payload":"null","origin":"user"}]
```

The same four through `pollEvents()`, for comparison:

```json
[{"type":"stepSelected","payload":{"uid":"10000110-0000-0000-0000-000000004000","name":"4R Cycle (10s)","stepNumber":"2.1.6.7","numbered":"2.1.6.7 - 4R Cycle (10s)","element":"WaitStep","kind":"action","path":"XTR Module Test \u203a Main \u203a Cycle 1 - 4R \u203a Draw down at 4R"},"at":1789999921302,"origin":"user"},{"type":"fileLoaded","payload":{"fileName":"Sequence_XML.xml","nodeCount":133,"warnings":0},"at":1789999921302},{"type":"viewChanged","payload":{"view":"both"},"at":1789999921302},{"type":"stepSelected","payload":null,"at":1789999921302,"origin":"user"}]
```

### 2.4 `setEventSink()` — the generic JS push

**Superseded for LabVIEW by §2.0**, kept for other JS hosts. Its snippet
below uses plain `JSON.stringify`, so it is **not** ASCII-safe, and a sink
that throws is detached rather than retried.

LabVIEW's Web Browser Control (2026 Q1 and later) exposes
`LabVIEW.FireUserEvent(refnum, string)` to code run through
`ExecuteJavaScript`. `setEventSink` takes a JS closure and calls it for every
outbound event, so the Helper Loop's timer can go away entirely.

Send this **once**, after the page is ready, with the User Event refnum in
`Arg`:

```js
var refnum = JSON.parse(Arg).refnum;
window.SeqFlowBridge.setEventSink(function (evt) {
  LabVIEW.FireUserEvent(refnum, JSON.stringify({
    type: evt.type,
    at: evt.at,
    origin: evt.origin || "",
    payload: JSON.stringify(evt.payload === undefined ? null : evt.payload)
  }));
});
return 0;
```

`Arg` is `{"refnum":<n>}`, built with Format Into String — Flatten To JSON
will not take a refnum directly.

**How the refnum becomes `<n>` is the one thing here that is not verified
against anything.** Everything else in this file was read off the code or the
running page; NI documents neither `FireUserEvent`'s signature nor its
parameter types, and their WebBrowser FAQ says outright that they *"do not
advise on how to author JavaScript code."* A User Event refnum is a 32-bit
cookie, so **Type Cast → U32** is the first thing to try. Settle it in two
minutes instead of guessing — run this through `ExecuteJavaScript` with
*Wait for Return Value* = TRUE:

```js
return JSON.stringify({
  has: typeof LabVIEW,
  fn: typeof (LabVIEW || {}).FireUserEvent,
  arity: ((LabVIEW || {}).FireUserEvent || {}).length,
  src: String((LabVIEW || {}).FireUserEvent).slice(0, 200)
});
```

`arity` gives the parameter count and native bindings usually print their
expected types in `src`. If U32 is wrong, try the refnum as a decimal string,
then as an I32. **Record the answer here when you have it.**

**Re-flatten the payload in the snippet, as above.** The sink is handed the
event *object*, nested, because serialising it is the caller's job and this
file has no business guessing which wire shape a host wants. Send `evt`
straight through and you have reintroduced exactly the problem §2.1 exists to
solve: one User Event string whose shape changes per event type, which
Unflatten From JSON cannot decode. The four lines above produce the same
shape `pollEventsFlat()` does, so **an existing Helper Loop case structure
works unchanged** — only where the string came from differs.

| | |
|---|---|
| **Returns** | a **number** — how many already-queued events were flushed to the sink as it attached |
| **Detach** | `window.SeqFlowBridge.setEventSink(null);` — later events go back to the queue |
| **While attached** | `pollEvents()` and `pollEventsFlat()` both return `[]` |

Three things about the order of operations, each of which has a failure mode
that looks like something else:

- **Register for events before you attach.** The flush is synchronous, inside
  the `setEventSink` call. Events flushed to a User Event that nothing has
  registered for are gone — they have already left the queue. Create User
  Event → Register For Events → *then* `ExecuteJavaScript`.
- **The return value is the backlog count.** A non-zero number on a freshly
  loaded page means the operator already did something before you connected —
  which is the one thing a `pollEvents()` call you are about to stop making
  would have told you.
- **A sink that throws is detached and the page falls back to queueing.** The
  usual cause is a stale refnum after the LabVIEW module stopped without
  detaching. The event it failed on, and any others not yet delivered from a
  flush, go back to the **front** of the queue in order, and the failure is
  logged to the browser console once. Nothing throws into the page: the
  diagram keeps working, and a Helper Loop restarted afterwards picks up
  exactly where the sink left off.

What the snippet above actually fires, for a selection and then a
payload-less event:

```json
{"type":"stepSelected","at":1789999921302,"origin":"user","payload":"{\"uid\":\"10000110-0000-0000-0000-000000004000\",\"name\":\"4R Cycle (10s)\",\"stepNumber\":\"2.1.6.7\",\"numbered\":\"2.1.6.7 - 4R Cycle (10s)\",\"element\":\"WaitStep\",\"kind\":\"action\",\"path\":\"XTR Module Test › Main › Cycle 1 - 4R › Draw down at 4R\"}"}
{"type":"bridgeReady","at":1789999921302,"origin":"","payload":"null"}
```

**Version floor: LabVIEW 2026 Q1 Patch 1.** Bug 3739525 — *"LabVIEW sometimes
crashes when using ExecuteJavaScript and FireUserEvent in Web Browser
Control"* — was only fixed there. On plain 2026 Q1 this exact pattern is the
known crash, so check the version before debugging anything else.

## 3. Every event

Eleven types. Nine are pushed by the app; `bridgeReady` only ever comes from
`attachLabVIEW`, and `pollError` only from the poll methods.

**Two of them fire once at start-up**, before LabVIEW has sent anything: a
`stepSelected` with a `null` payload and a `viewChanged` carrying whatever
view mode was persisted. They are queued, so `attachLabVIEW` delivers them
right after `bridgeReady` — that is not a stale queue.

### 3.0 `bridgeReady`

**Emitted** by `attachLabVIEW`, first, before its flush. Payload always
`null`. The LabVIEW side's readiness signal: Initialize waits on a notifier
that the `Bridge Message` handler sends when this arrives.

```json
{"type":"bridgeReady","at":1789999921302,"payload":"null"}
```

Key case is exact — JSON is case-sensitive and LabVIEW's Unflatten From JSON
matches cluster element names against these spellings.

### 3.1 `stepSelected`

**Emitted** whenever the selection **changes** — a reader clicking the canvas
or the outline, *or* LabVIEW's own `selectStep` command. Also fires with a
`null` payload when the selection is cleared.

**Carries a top-level `origin`**, and it is the only event that does. This is
the one piece of state both ends write, so it is the only one that can loop:
LabVIEW sends `selectStep`, the app reports `stepSelected`, LabVIEW reacts by
selecting again.

| `origin` | Means | What the Helper Loop should do |
|---|---|---|
| `"user"` | an operator clicked the canvas or the outline | act on it — this is the event worth having |
| `"host"` | the echo of your own `selectStep` | ignore it. It confirms the state took, nothing more |

`origin` sits beside `type` and `at`, **not** inside `payload` — a cleared
selection has `payload: "null"` and still carries an origin.

**A selection that did not change emits nothing at all.** A `selectStep` for
the step already selected produces no event, in either direction. The command
is still honoured — the step is re-revealed and re-centred, which is the point
of sending it to a reader who has scrolled away — but there is no state change
to report, so nothing is reported. Do not wait on an event to confirm a
redundant `selectStep`; use the `handleCommandSync` envelope, which comes back
`{"ok":true,...}` either way.

**Payload**: an object, **or JSON `null`**.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `uid` | string | no | the GUID from the XML, verbatim. The only safe key |
| `name` | string | no | the `name` attribute, or the element name when it is empty. **Not unique** |
| `stepNumber` | string | no | `"2.1.6.7"`. `""` on the document root and on an orphan — never absent, never null |
| `numbered` | string | no | `"2.1.6.7 - 4R Cycle (10s)"`, or just the name when `stepNumber` is `""` |
| `element` | string | no | XML element name, e.g. `WaitStep` |
| `kind` | string | no | one of `action`, `decision`, `criteria`, `jump`, `container` |
| `path` | string | no | ancestor names joined by ` › ` (U+203A), root first, excluding the step itself |

The whole payload being `null` is the "nothing selected" case; a LabVIEW
cluster cannot express that, so carry an explicit `Has Selection` boolean.

An operator's click:

```json
{"type":"stepSelected","at":1789999921302,"payload":"{\"uid\":\"10000110-0000-0000-0000-000000004000\",\"name\":\"4R Cycle (10s)\",\"stepNumber\":\"2.1.6.7\",\"numbered\":\"2.1.6.7 - 4R Cycle (10s)\",\"element\":\"WaitStep\",\"kind\":\"action\",\"path\":\"XTR Module Test \\u203a Main \\u203a Cycle 1 - 4R \\u203a Draw down at 4R\"}","origin":"user"}
```

The same step, reached by `selectStep` instead — identical but for the last
key:

```json
{"type":"stepSelected","at":1789999921302,"payload":"{\"uid\":\"10000110-0000-0000-0000-000000004000\",\"name\":\"4R Cycle (10s)\",\"stepNumber\":\"2.1.6.7\",\"numbered\":\"2.1.6.7 - 4R Cycle (10s)\",\"element\":\"WaitStep\",\"kind\":\"action\",\"path\":\"XTR Module Test \\u203a Main \\u203a Cycle 1 - 4R \\u203a Draw down at 4R\"}","origin":"host"}
```

Cleared:

```json
{"type":"stepSelected","at":1789999921302,"payload":"null","origin":"user"}
```

### 3.2 `viewChanged`

**Emitted** whenever the view mode changes, including on a bridge-driven
`setView` and once at start-up with whatever mode was persisted.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `view` | string | no | `"tree"`, `"canvas"` or `"both"` |

```json
{"type":"viewChanged","at":1789999921302,"payload":"{\"view\":\"both\"}"}
```

### 3.3 `fileLoaded`

**Emitted** every time a sequence XML parses successfully — a `loadXml`
command, the raw `loadXml` pass-through, or a file dropped on the page by
hand. Not emitted for a rule file or a layout sidecar.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `fileName` | string | no | as supplied; defaults to `sequence.xml` on the raw pass-through |
| `nodeCount` | number | no | 133 for the shipped fixture |
| `warnings` | number | no | count only. 0 for the fixture |

```json
{"type":"fileLoaded","at":1789999921302,"payload":"{\"fileName\":\"Sequence_XML.xml\",\"nodeCount\":133,\"warnings\":0}"}
```

### 3.4 `loadError`

**Emitted** on anything the app surfaces as an error, not only loads: bad XML,
a rule file that will not validate, a sidecar with no sequence loaded yet, a
parse that produced no nodes at all (invariant 8) — and **a layout failure or
a layout timeout**, which is not a load at all but reaches LabVIEW through
this same event. Covers the bridge and drag-and-drop alike.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `message` | string | no | human-readable. Prefixed `<fileName>: ` for a load failure; a layout failure begins `layout failed — ` or names the timeout |

```json
{"type":"loadError","at":1789999921302,"payload":"{\"message\":\"bad.xml: not valid XML\"}"}
```

### 3.5 `exportPngResult`

**Emitted** when an `exportPng` command finishes rasterising. This is the only
way a PNG comes back — never through a return value; see §1.1.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `id` | string | **yes** | the `id` from the command that started it; `null` if the caller sent none |
| `base64` | string | no | raw base64, **no `data:` prefix** — feed it straight to LabVIEW's base64 decode |
| `width` | number | no | pixels, at 1× |
| `height` | number | no | pixels, at 1× |

From the built page, base64 truncated (it is about 1 MB for the fixture's
grouped layout):

```json
{"type":"exportPngResult","at":1790000484000,"payload":"{\"id\":\"png7\",\"base64\":\"iVBORw0KGgoAAAANSUhEUgAABKcAAC3qCAYAAADZY36A...\",\"width\":1023,\"height\":8934}"}
```

`handleCommand('{"id":"png7","type":"exportPng"}')` returned
`{"ok":true,"id":"png7"}` immediately; the event above arrived roughly five
seconds later. Budget for that: a Request-and-Wait-for-Reply would time out.

### 3.6 `exportPngError`

**Emitted** when that rasterising fails instead.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `id` | string | **yes** | as above |
| `message` | string | no | |

```json
{"type":"exportPngError","at":1789999921302,"payload":"{\"id\":\"c7\",\"message\":\"could not encode the image\"}"}
```

### 3.7 `commandError`

**Emitted** from `handleCommand` only — `handleCommandSync` reports in its
return envelope and queues nothing. Two payload shapes, by where it failed:

**Parse or envelope failure** (bad JSON, unknown `type`):

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `id` | string | **yes** | read best-effort out of the raw text |
| `message` | string | no | e.g. `unknown command type "deleteEverything"` |
| `raw` | string | no | the text as sent. Can be large — it is the whole command |

**Validation or handler failure** (the type was known, the payload was not):

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `id` | string | **yes** | |
| `type` | string | no | the command type that failed |
| `message` | string | no | e.g. `payload.uid must be a string` |

There is no `type` key on the first shape and no `raw` key on the second —
one cluster of `{Id, Type, Message, Raw}` unflattens both, with strict
validation FALSE.

Both, as the built page emitted them — a `selectStep` with no payload, then a
command that was not JSON at all:

```json
{"type":"commandError","at":1790000396086,"payload":"{\"id\":\"c4\",\"type\":\"selectStep\",\"message\":\"payload must be an object with \\\"uid\\\"\"}"}
{"type":"commandError","at":1790000396087,"payload":"{\"id\":null,\"message\":\"not valid JSON\",\"raw\":\"{\\\"id\\\":\\\"c5\\\", this is not json\"}"}
```

Note the second one's `id`: the text never parsed, so there was no command to
read it from, and `peekCommandId` could not recover it either — `"c5"` was
only reachable if the JSON had been well formed up to that point. An `id`
comes back whenever it can, and `null` says it could not.

### 3.8 `pollError`

**Emitted** by `pollEvents` / `pollEventsFlat` themselves, in place of the
batch, when a queued payload will not serialise. The events in that batch are
already gone — this says so rather than returning an empty array that reads as
"nothing happened". Not expected in normal operation; nothing the app queues
today can trigger it.

**`attachLabVIEW`'s push failing** queues the event and records the error in
`window.__seqflowError` — probe it with `return window.__seqflowError || "";`.

**There is no equivalent event for a `setEventSink` sink that fails.** A sink that
throws is detached and its events go back on the queue (§2.4); there is
nowhere left to deliver an event *about* that failure, so it goes to the
browser console instead. From the LabVIEW side the symptom is that User Events
stop arriving — poll once to find out whether the queue has been filling up.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `message` | string | no | |

```json
[{"type":"pollError","at":1789999921302,"payload":"{\"message\":\"Converting circular structure to JSON\"}"}]
```

### 3.9 `exportPdfResult`

**Emitted** when an `exportPdf` command finishes. Same keys as
`exportPngResult` (§3.5); the PDF is vector, with real, selectable text.

| Key | JS type | Null? | Notes |
|---|---|---|---|
| `id` | string | **yes** | the `id` from the command that started it |
| `base64` | string | no | the whole `.pdf` file, raw base64, no `data:` prefix — always starts `JVBERi0` (`%PDF-`) |
| `width` | number | no | page width in **pt** |
| `height` | number | no | page height in **pt** |

From the built page with the fixture fully expanded, `{"view":"full"}`, base64
truncated (about 200 KB in full):

```json
{"type":"exportPdfResult","at":1791000360000,"payload":"{\"id\":\"p3\",\"base64\":\"JVBERi0xLjMKJbrfrOAK...\",\"width\":1191,\"height\":11754}"}
```

A page longer than 14 400 pt (the limit in Acrobat and most PDF viewers) is
scaled down to fit, and `width`/`height` give the scaled size. It is still
vector, so zooming in brings the detail back.

### 3.10 `exportPdfError`

As `exportPngError` (§3.6): `{"id":...,"message":"..."}`.

## 4. Commands, for completeness

Unchanged in shape by protocol 3. `id` is optional on every one and is echoed
back. One behavioural change: a **`selectStep` for the step already selected
emits no `stepSelected`** — see §3.1.

| `type` | `payload` | Through |
|---|---|---|
| `loadXml` | `{"text":"...","fileName":"..."}` | either (or the raw pass-through) |
| `loadRuleFile` | same | either (or the raw pass-through) |
| `loadLayout` | same | either (or the raw pass-through) |
| `clearRuleFile` | — | either |
| `selectStep` | `{"uid":"..."}` | either |
| `setView` | `{"view":"tree\|canvas\|both"}` | either |
| `setZoomMode` | `{"mode":"fit\|top\|centre\|keep"}` | either |
| `exportMermaid` | — | **`handleCommandSync`** — `result` is the `.mmd` text |
| `exportSvg` | — | **`handleCommandSync`** — `result` is the SVG text |
| `exportPng` | optional `{"view":"full\|viewport"}` (top-level `id`) | `handleCommand`; result arrives as an event |
| `exportPdf` | optional `{"view":"full\|viewport"}` (top-level `id`) | `handleCommand`; result arrives as an event |
| `getState` | — | **`handleCommandSync`** — `result` is §1.2's object |

### `setZoomMode`

What a fresh layout does to the viewport. A fresh layout is a load, a rule-file
re-parse, or a collapse/expand. Persisted in the page like `setView`; default `fit`.
There is no echo event, because nothing on screen can change it.

| `mode` | Effect |
|---|---|
| `fit` | zoom out to fit the whole diagram (the old, only behaviour) |
| `top` | keep the current zoom; centre horizontally, diagram's first step at the top |
| `centre` | keep the current zoom; centre on the middle of the diagram |
| `keep` | leave zoom and pan exactly where they were |

A view-mode change (`setView`) still fits, whatever the mode: it exists to stop
a resized pane from showing blank canvas.

### `exportPng` / `exportPdf` and `view`

Both export the canvas **as it is now**, with its folds and its search highlight,
always in the light palette.

| `view` | Exports | PNG size | PDF page |
|---|---|---|---|
| `full` (default; also no payload) | the whole diagram | diagram size, 1 px per unit | diagram size, 1 pt per unit |
| `viewport` | only what the canvas pane shows | the pane in **screen** pixels (CSS size × zoom × display scaling) | the same rectangle in diagram units, vector |

Measured on a 1280×720 pane at 125 % display scaling: the viewport PNG is
1600×900. A viewport export with the canvas hidden (`tree` view) fails with
`exportPngError` / `exportPdfError`, message `the canvas is not visible`.

Any other `view` fails in the envelope and as a `commandError`. So does `depth`,
which was removed on 2026-10-04 and is refused by name,
`payload.depth is no longer supported`, so that an old caller fails loudly.

The canvas's copy button (under the minimap toggle) puts the viewport PNG on the
clipboard. It is page-only: it fires no event and LabVIEW sends nothing for it.

### `exportPdf`, and writing the file in LabVIEW

`view` works exactly as it does for `exportPng`. Request-and-wait-for-reply:

1. The request case sends `handleCommand` with a fresh `id`. A `{"ok":false}`
   reply means the command was refused: reply with that error now.
2. Otherwise, store the reply token and target path under that `id`.
3. On `exportPdfResult` (or `exportPdfError`) carrying that `id`:
   - decode `base64` to a U8 array, with .NET `System.Convert.FromBase64String`
     or a native Base64 decode;
   - write it with **Write to Binary File**, with **prepend array or string
     size? = False**. True adds a 4-byte length header and the PDF will not open;
   - send the reply, then broadcast.
4. Set the caller's timeout to 30–60 s. A whole-diagram PNG takes a few seconds.

## 5. Where the build guide disagrees with the code

**Protocol 4: the guide and walkthrough were rewritten for `attachLabVIEW`**
— push only, no polling, `return`-prefixed snippets, string `Bridge Message`
User Event, wire clusters labelled with the JSON keys, a `bridgeReady`
notifier in place of the readiness loop. Items 1, 2, 9 and 10 below are
therefore historical. The list is kept as found.

`.claude/LABVIEW-BRIDGE-GUIDE.md` (and the walkthrough beside it) were written
against protocol 1. Both have been updated for the two that matter most — the
Helper Loop's poll and the readiness check — but the list below is the
complete set as found, so nothing is left implicit.

1. **The Helper Loop polled `pollEvents()`.** Step 7 had it unflatten
   `Payload` as a variant. LabVIEW's Unflatten From JSON cannot decode a
   nested payload whose shape varies by event type; use `pollEventsFlat()` and
   unflatten the payload string a second time per case. *Guide and walkthrough
   updated.*
2. **Readiness was `typeof window.SeqFlowBridge !== 'undefined'`.** Still
   works and is still the right fallback for an older build, but `isReady()`
   is the direct answer. *Guide and walkthrough updated.*
3. **`handleCommand` returned nothing.** The guide says to call it with
   *Wait for Return Value? = False*. It now returns an acceptance envelope,
   which is worth reading even on a fire-and-forget request — it catches a
   malformed command one poll interval sooner than `commandError` does.
4. **The sync envelope had no `id`.** §6 of the guide and worked example 5.6
   describe unflattening `{"ok":...,"result":...}`. There is now an `id` as
   well. Additive: a cluster without it still unflattens.
5. **The raw pass-throughs' envelope was `{"ok":true,"result":null}`.** It now
   carries `"id":null` too, so one cluster covers every envelope this bridge
   returns.
6. **`Command Error`'s payload was documented as `{Id, Type, Message}`.** The
   parse-failure shape has no `Type` and adds `Raw`; before protocol 2 it had
   no `Id` either. §3.7 is the actual pair of shapes.
7. **The guide's `Selected Detail.ctl` lists `Step Number` as a string.**
   Correct — but note the code never sends `null` or omits it; an unnumbered
   step sends `""`. The `Has Selection` boolean is for the payload being
   `null` as a whole, nothing finer.
8. **Nothing in the guide mentions `ping` or `version`.** Both are new in
   protocol 2. A module that checks `version()` at start-up can fail loudly
   against an old `dist/index.html` instead of on the first missing method.
9. **The guide's Helper Loop is built around a 200 ms poll.** Still correct,
   and still the fallback. But on a Web Browser Control that exposes
   `LabVIEW.FireUserEvent`, §2.4's sink replaces the timer entirely, and the
   case structure underneath it does not change — the flattened shape is the
   same. *Guide and walkthrough not updated; they predate protocol 3.*
10. **`Bridge Event.ctl` has three elements.** It needs a fourth, `Origin`
    (string), for §3.1. Additive, and only if you want the echo-loop
    protection: with strict validation FALSE a three-element cluster still
    unflattens every event, it just discards `origin` — and a module that
    discards it will act on its own `selectStep` echoes.
11. **The guide treats the `stepSelected` echo as unconditional.** It is not,
    in two ways: it carries `origin`, and a redundant `selectStep` produces no
    event at all. A Helper Loop that blocks waiting for the echo of a
    `selectStep` will wait forever when the step was already selected.
