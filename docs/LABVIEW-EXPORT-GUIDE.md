# SeqFlow Bridge — PNG and PDF export, LabVIEW side

This guide builds two DQMH **Request and Wait for Reply** events, `Export PNG` and
`Export PDF`. Each one saves a file to a path the caller chooses and replies once the
file is on disk. It also broadcasts that the file was written.

It assumes the module from `.claude/LABVIEW-BRIDGE-WALKTHROUGH.md` already works:

- the page loads,
- the `Load Finished` handler has called `attachLabVIEW`,
- `Bridge Message` events are arriving.

Every key and payload below comes from the code and from a run on the fixture. The exact
wire reference is in [`LABVIEW-EVENTS.md`](LABVIEW-EVENTS.md), sections 3.5, 3.6, 3.9 and 3.10.

PNG and PDF use **the same mechanism**. Build PDF first, then copy it for PNG and change
the four values in §1.

---

## 0. Why this is not an ordinary Request-and-Wait

`Get State` replies from the same MHL case that asked, because `handleCommandSync` returns
the answer in its own return value. An export can't work that way:

1. `ExecuteJavaScript` returns at once with `{"ok":true,"id":"pdf-1"}`. That means
   *accepted*, not *finished*.
2. The page lays the diagram out, renders it and encodes it. That takes 1–10 s.
3. The bytes arrive later as a **`Bridge Message`** event (`exportPdfResult`), and only the
   `id` connects it to the request that started it.

So the request case cannot reply. It **stores the reply notifier under the `id`**, and a
second MHL case, triggered by the result event, finds it, writes the file and sends the
reply. That deferred reply is all the extra work. Everything else is the plumbing you
already have.

```
caller ── Export PDF request ──► MHL "Export PDF"
                                   │ handleCommand {"id":"pdf-7","type":"exportPdf",...}
                                   │ store {notifier, path} under "pdf-7"
                                   ▼ (case ends; caller is still waiting)
page … renders …
page ── Bridge Message {"type":"exportPdfResult","payload":"{\"id\":\"pdf-7\",...}"}
         ──► Bridge Message case ── enqueue "Export Finished" ──► MHL "Export Finished"
                                   │ look up "pdf-7" → {notifier, path}
                                   │ base64 → bytes → Write to Binary File
                                   │ Send Notification (caller wakes up)
                                   ▼ broadcast "File Exported"
```

---

## 1. PNG and PDF side by side

| | PNG | PDF |
|---|---|---|
| Command `type` | `exportPng` | `exportPdf` |
| Result event | `exportPngResult` | `exportPdfResult` |
| Error event | `exportPngError` | `exportPdfError` |
| `width` / `height` | pixels | points (1 pt = 1/72 in) |
| First 4 decoded bytes | `89 50 4E 47` (`‰PNG`) | `25 50 44 46` (`%PDF`) |
| Base64 starts with | `iVBORw0KGgo` | `JVBERi0` |
| Size on the fixture | ~1 MB, whole file; viewport is the pane's own size | ~145 KB whole file |
| Refuses when | over 120 megapixels: an error event explains why | never; pages over 14 400 pt are scaled down to fit |
| Id prefix (suggested) | `png-` | `pdf-` |

`view` works the same for both. Either way it is the canvas **as it is now**, with its
folds and its highlight. To export a different fold state, change the canvas first.

- **`{"view":"full"}`** (also the default with no payload): the whole diagram.
- **`{"view":"viewport"}`**: only what is visible in the canvas pane.
  - The PNG is the pane's size in screen pixels: a 1280×720 pane on a 125 % display
    gives 1600×900.
  - The PDF page is the same rectangle in diagram units, still vector.
  - It fails with an error event if the canvas is hidden, for example in `tree` view.

`depth` was removed on 2026-10-04. A payload that still carries it is refused with
`payload.depth is no longer supported`.

The canvas also has a **copy button** (the fifth control, under the minimap toggle). It
puts the viewport on the clipboard as a PNG. That is the page's own feature and needs
nothing from LabVIEW.

---

## 2. Typedefs

Build these first, in the module's `Type Definitions` folder. The rule from walkthrough §E
still applies: **in a wire cluster the label is the JSON key, exactly, case-sensitive.**

### `Export Kind.ctl`
Enum `PNG, PDF`.

### `Export Command.ctl` (private, wire)
What the command is flattened from.

| Label | Type |
|---|---|
| `id` | String |
| `type` | String |
| `payload` | Cluster: `view` (String, `full` or `viewport`) |

### `Export View.ctl` (public)
Enum `Full, Viewport`, the argument callers see. Convert it with **To Lower Case** on its
string form, `full` / `viewport`, when bundling `payload.view`.

### `Ack Wire.ctl` (private, wire), already in the module
`ok` (Boolean), `error` (String). Unflatten with **strict validation? = FALSE**, so the
echoed `id` is ignored.

### `Export Result Wire.ctl` (private, wire)
One cluster for both the result and the error payload. With non-strict Unflatten,
missing keys keep their defaults.

| Label | Type | Present in |
|---|---|---|
| `id` | String | both |
| `base64` | String | result |
| `width` | DBL | result |
| `height` | DBL | result |
| `message` | String | error |

This is the one wire cluster that **keeps `id`**, against walkthrough §E's general rule.
Here `id` is the whole point.

`width`/`height` are DBL, not I32. A PDF scaled down to the page cap has fractional
points. Integers in JSON unflatten into a DBL without complaint.

### `Pending Export.ctl` (private)
What the request case leaves behind for the result case.

| Label | Type |
|---|---|
| `Reply Notifier` | the reply notifier refnum **exactly as your wizard generated it**. Get the type by right-clicking that wire in the generated case → `Create » Constant`, then make it a control |
| `Path` | Path |
| `Kind` | `Export Kind.ctl` |

### `MHL Data.ctl`, add two elements

| Label | Type |
|---|---|
| `Pending Exports` | **Map**, key String, value `Pending Export.ctl` |
| `Export Counter` | U32 |

Drop a Map constant, wire a String constant to its key and `Pending Export.ctl` to its
value, then make it a control inside the cluster. If you're on a LabVIEW version without
Maps, use a Variant with **attributes** (Set Variant Attribute / Get Variant Attribute /
Delete Variant Attribute) in the same role.

### `Export Reply.ctl` (public), the reply payload

| Label | Type |
|---|---|
| `Path` | Path |
| `Width` | DBL |
| `Height` | DBL |
| `Bytes` | I32, size of the file written |
| `Error` | Error cluster |

### `File Exported.ctl` (public), the broadcast payload
`Path` (Path), `Kind` (`Export Kind.ctl`), `Width` (DBL), `Height` (DBL).

---

## 3. Run the wizards

`Tools > DQMH Consortium > DQMH > Event > Create New DQMH Event`, once per event:

| Name | Type | Arguments | Reply / payload |
|---|---|---|---|
| `Export PDF` | Request and Wait for Reply | `Path` (Path), `View` (`Export View.ctl`, default Full) | `Export Reply.ctl` fields |
| `Export PNG` | Request and Wait for Reply | `Path` (Path), `View` (`Export View.ctl`, default Full) | `Export Reply.ctl` fields |
| `File Exported` | Broadcast | — | `File Exported.ctl` fields |

Check **Add button to API Tester** for both requests.

Then create one **private MHL message** called `Export Finished`, with no wizard event.
Add a case with that exact string to the MHL Case Structure. Its data is the
`Bridge Event.ctl` cluster the `Bridge Message` case already has (§6).

### Timeout: change it

The DQMH default suits commands that answer in milliseconds. Exports take seconds: about
5 s for a whole-file PNG on the fixture, and longer on a big file.

- In each request VI, set the **timeout default to 60 000 ms**, or have callers wire it.
- If the caller times out first, it gets a timeout error, and §5 still writes the file.
  It just has nobody to reply to.

---

## 4. The MHL case `Export PDF`

The wizard generated this case. It unpacks the arguments, gives you the reply notifier,
and ends by bundling the reply and calling **Send Notification**.
**Remove that final Send Notification from the success path.** Replying is now §5's job.
Keep it only on the failure branch in step 6.

1. **Make an id.** Unbundle `Export Counter` from `MHL Data`, increment it, and Format Into
   String with `pdf-%u`, giving `pdf-7`. Bundle the counter back. Ids must be unique among
   exports in flight. A counter is enough, since there is one module instance per page.

2. **Build the command.** Bundle By Name into `Export Command.ctl`:
   - `id` = the id
   - `type` = `exportPdf`
   - `payload.view` = `View` as lower-case text (§2)

   Then Flatten To JSON:
   ```json
   {"id":"pdf-7","type":"exportPdf","payload":{"view":"viewport"}}
   ```

3. **Send it.** Invoke Node → `ExecuteJavaScript` on `Browser Ref`:
   - JavaScript text: `return window.SeqFlowBridge.handleCommand(Arg);`
   - Argument: the JSON from step 2
   - **Wait for Return Value? = TRUE**, Exception → error cluster

   Use **`handleCommand`**, not `handleCommandSync`. Both are fire-and-forget for exports,
   but `handleCommand` is the one documented for them.

4. **Read the acknowledgement.** Unflatten From JSON into `Ack Wire.ctl`. You get one of
   two replies:
   ```json
   {"ok":true,"id":"pdf-7"}
   {"ok":false,"error":"payload.view must be one of \"full\", \"viewport\"","id":"pdf-7"}
   ```

5. **On `ok = TRUE` and no error**: Bundle `Pending Export.ctl` with the wizard's
   **Reply Notifier**, `Path` and `Kind = PDF`. **Insert Into Map** under the id, then
   bundle the map back into `MHL Data`. **The case ends here, without replying.**

6. **On `ok = FALSE`, or any error from steps 3–4**: reply immediately. Build an error
   cluster from `error` (Error Cluster From Error Code, any code in your module's custom
   range), bundle it into `Export Reply.ctl` and **Send Notification**. Nothing is stored.

`Export PNG` is the same case with `png-%u`, `exportPng` and `Kind = PNG`.

---

## 5. The MHL case `Export Finished`

This case runs for **all four** result and error events, PNG and PDF.

1. **Get the event.** Variant To Data on the message data → `Bridge Event.ctl`
   (`type`, `payload`, `at`, `origin`).

2. **Unflatten `payload`** (the String) into `Export Result Wire.ctl`, with strict
   validation FALSE.

3. **Find who asked.** Look Up In Map, `Pending Exports` keyed by `id`.
   - **Not found**: ignore the event and exit the case. It answers a command this module
     instance didn't send: a test from the browser console, or a request from before the
     module restarted.
   - **Found**: **Delete From Map** right away and bundle the map back, so the entry
     can't be handled twice.

4. **Case on `type`**:

   **`exportPdfError` / `exportPngError`**
   - Build an error from `message`, for example:
     > `30 000 x 41 000 is 1230 Mpx, past what a browser canvas will hold. …`
   - Bundle it into `Export Reply.ctl` and go to step 6.

   **`exportPdfResult` / `exportPngResult`**
   - **Decode.** Invoke Node, right-click → `Select Class » .NET » Browse…` →
     `mscorlib` → `System` → **`Convert`**. Choose the **static** method
     **`FromBase64String(String)`** (a static method needs no constructor), and wire
     `base64` into it. The output is a **U8 array**, the file's exact bytes.
     If your LabVIEW has a native Base64 decode, you can use it instead; the bytes are
     the same.
   - **Check the magic number.** Use Array Subset (0, 4) and compare it with §1's table:
     `25 50 44 46` for a PDF, `89 50 4E 47` for a PNG. A mismatch means the string was
     altered somewhere, so raise an error rather than write a broken file.
   - **Write.** Use **Write to Binary File** with these inputs:
     - **file (use dialog)**: `Path` from the stored entry. It opens and closes the file
       itself. Create the parent folder first if it may not exist.
     - **data**: the U8 array.
     - **prepend array or string size? = FALSE**. *This is the one setting that matters.*
       Left TRUE, it writes a 4-byte length header in front, and the file won't open as
       a PDF or a PNG.
     - **byte order**: leave it as is. It has no effect on U8.

     Use Open/Create/Replace File set to **replace or create** first if you'd rather
     overwrite an existing file explicitly. Write to Binary File's path input creates or
     replaces the file anyway.
   - Bundle `Export Reply.ctl`:
     - `Path`, `Width` = `width`, `Height` = `height`
     - `Bytes` = Array Size of the U8 array
     - `Error` = the error from decode and write

5. **Broadcast** on success only: `File Exported` with `Path`, `Kind` from the stored
   entry, `Width` and `Height`.

6. **Reply.** **Send Notification** on the stored **Reply Notifier** with
   `Export Reply.ctl`.
   - If the caller already timed out (§3), the request VI has probably released that
     notifier, and Send Notification returns an invalid-refnum error.
   - **Clear that one error.** The file is written and the broadcast went out, so nothing
     was lost. Don't let it reach the MHL's error handler.

---

## 6. The `Bridge Message` case: four new frames

In the dispatcher from walkthrough §H1, **replace** the existing `exportPngResult` and
`exportPngError` frames, which used to fire `Png Exported` / `Png Export Failed`
broadcasts. Then add frames for `exportPdfResult` and `exportPdfError`. All four frames
are identical:

> Enqueue message **`Export Finished`**, with data = the whole `Bridge Event.ctl` you just
> unflattened. Use the module's enqueue VI, the same one every EHL case uses to hand work
> to the MHL.

The `payload` is left unparsed here on purpose. The `Bridge Message` loop has to stay
free to receive the next event, and decoding plus file I/O belong in the MHL, next to the
map that says where the file goes.

One more frame is worth changing. In the **`bridgeReady`** frame, if the page reloads
mid-session, nothing in flight will ever answer. Enqueue a private `Fail Pending Exports`
message. Its MHL case walks `Pending Exports` and, for each entry, sends its notifier an
error reply ("page reloaded before the export finished"). Then it empties the map.
Without it, those callers just time out. That's not wrong, but it is slower and says less.

---

## 7. Calling it

From any caller, or from the API Tester:

```
SeqFlow Bridge.lvlib:Export PDF.vi
  Path    = C:\Reports\Sequence_XML.pdf
  View    = Full       (or Viewport: only what the pane shows)
  Timeout = 60000
→ Export Reply: Path, Width = 1191, Height = 11754, Bytes ≈ 145 000, Error = no error
  (the fixture with every sequence expanded; a folded canvas gives a smaller page)
```

A sibling module that only needs to know a file appeared registers for `File Exported`
instead of calling.

---

## 8. Smoke test, in order

Stop at the first failure.

1. **Load the fixture** (`Load Sequence XML`). `File Loaded` shows `Node Count = 133`.
2. **`Export PDF`, View Full, to a temp path.**
   - Reply: no error, and `Width` × `Height` matches the diagram (`1191 x 11754` pt with
     every sequence expanded).
   - The file opens in a PDF reader.
   - You can select the text "XTR MODULE TEST", which proves it is vector, not an image.
3. **Zoom into part of the canvas, then `Export PNG`, View Viewport.** The reply is the
   pane's size in screen pixels, and the image shows exactly what the pane showed.
4. **`Export PNG`, View Full.** The whole diagram, and the file opens in an image viewer.
5. **Switch the page to `tree` view, then `Export PNG`, View Viewport.** You get an error
   reply, `the canvas is not visible`. It arrives after the accept, as an `exportPngError`.
6. **Copy button.** Click it on `Main.vi`'s panel, then paste into Paint. If it shows a
   red cross, hover it: the tooltip says why the browser control refused. See §9.
7. **Two exports back to back** without waiting between them, one PNG and one PDF to
   different paths. Both files arrive and each reply carries its own path. That proves
   the map.
8. **`Validate DQMH Module`.**

---

## 9. When something doesn't work

| Symptom | Almost always |
|---|---|
| File written but won't open; it's 4 bytes larger than expected | **prepend array or string size?** left TRUE (§5 step 4) |
| Caller times out, file appears a little later | Request timeout too short (§3). Raise it to 60 s |
| Caller always times out, no file, no error | The `Bridge Message` frames weren't added (§6), or the `type` strings don't match exactly. Run `return window.SeqFlowBridge.pollEvents();` as a probe: if the result is sitting there, the push failed |
| Immediate error `payload.depth is no longer supported` | The command cluster still has `depth`. Replace it with `view` (§2) |
| Immediate error `payload.view must be one of "full", "viewport"` | The enum was flattened as `Full` / `Viewport`. Lower-case it (§2) |
| `exportPngError` `the canvas is not visible` | A viewport export with the canvas hidden (`tree` view). Switch to `canvas` or `both` first, or use Full |
| Copy button shows a red cross, `Write permission denied` | The browser control refuses clipboard writes. The page can't override that. The fallback is for LabVIEW to export a viewport PNG and put it on the clipboard itself |
| Reply arrives but `Width`/`Height` are 0 | `Export Result Wire.ctl` labels don't match `width`/`height` exactly, or step 2 of §5 unflattened the outer event instead of `payload` |
| `Export Finished` runs but the entry is never found | The id in the map differs from the one sent. Build the JSON from the same wire you insert under. Or the case read `Pending Exports` from a stale copy of `MHL Data` |
| Magic-number check fails | The base64 string was altered on the way. It is pure ASCII, so check for a Format Into String or a trim in the path |
| PNG error `… Mpx, past what a browser canvas will hold` | The whole diagram is too large for a PNG. Fold some sequences first, use View Viewport, or export a PDF, which has no such limit |
| Text in the PDF looks slightly different from the screen | Expected. PDFs use the built-in Helvetica and Courier fonts, so a long label can run a little wider than its box |

**Not yet confirmed in LabVIEW**: how large a string `FireUserEvent` will carry. A
whole-file PNG is about 1.4 MB of base64. If big PNGs fail while small ones and PDFs
work, that limit is the suspect. Probe it with `return window.__seqflowError || "";`.
