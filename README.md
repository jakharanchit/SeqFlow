# SeqFlow

Turn a test-sequence XML file into an interactive flowchart you can actually
read.

Test-automation tools export their sequences as XML — steps, branches, jump
targets, pass/fail criteria — but the XML itself is not something anyone
reviews line by line. SeqFlow parses that file into a graph and renders it as
a flowchart: collapsible sequences, path tracing, a searchable signal index, a
linter, a criteria table, duration estimates, and a diff between two
revisions. It never writes back to the source file.

Built for reviewing automated test procedures in a regulated setting, where
"what does this sequence actually do" needs a real answer, not a read-through
of a few thousand lines of GUIDs.

## What it does

- **Canvas** — drag the XML onto the page and get a laid-out flowchart.
  Collapse or expand any sequence, semantic zoom drops step labels at low
  scale, click a node to inspect every attribute.
- **Search & signal index** — find a step by name or step number, or find
  every step that reads or writes a given signal tag.
- **Path tracing** — select a step, see everything upstream and downstream of
  it, in two colors.
- **Linter** — flags stale jump targets, duplicate names, odd siblings, and
  elements the rule file doesn't recognize.
- **Criteria & fail routes** — every acceptance-criteria step, how many places
  it's used, and the routes a failure actually takes to the abort sequence.
- **Duration estimate** — nominal vs. worst-case time along a path, waits and
  timeouts kept separate.
- **Revision diff** — drop a second version of the same sequence and see
  what was added, removed, or changed, by uid.
- **Export** — Mermaid text, SVG, and PNG, plus a layout sidecar so manual
  node positions survive a reload.
- **CLI** — `--check` for CI staleness gates, `--profile` for what a rule
  file doesn't know yet, `--audit` for parsing an entire corpus and reporting
  on it.
- **Extensible schema** — the rules a file's elements and attributes get
  parsed against live in `rules.yaml`, which can be dropped onto the running
  page. A new XML dialect doesn't need a rebuild.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL and drag a sequence XML onto the page. Or build the
standalone artifact:

```bash
npm run build
```

`dist/index.html` is a single self-contained file — no server, no network
calls, works offline, opens in any modern browser.

## Command line

```bash
node bin/seqflow.mjs <sequence.xml> [options]
```

| Flag | What it does |
|---|---|
| `--mode <mode>` | `full` (default), `overview`, `depth-N`, or `split` |
| `--out <path>` | output file, or directory for `--mode split` |
| `--rules <path>` | rule file to use (default: `rules.yaml` at the repo root) |
| `--direction <d>` | `TD` (default) or `LR` |
| `--no-groups` | draw sequences flat instead of as subgraphs |
| `--stdout` | write to stdout instead of a file |
| `--check` | write nothing; exit 1 if the `.mmd` on disk is stale |
| `--profile` | write nothing; report what the rule file doesn't know |
| `--audit <dir>` | parse every `.xml` under a directory, report, exit 1 on any hard failure |

`--check` is the CI hook: regenerate the `.mmd` and fail the build if it
doesn't match what's committed — Mermaid output is byte-deterministic, so a
genuine mismatch means the diagram is actually stale. `--audit` is meant for
a real corpus of files; it asserts only what's true of any sequence (a
non-empty graph, no orphaned steps, deterministic output) and stores nothing.

## Teaching it a new schema

Every element name, container, jump attribute, and shape lives in
`rules.yaml`, never in source. Point the app or the CLI at a schema it hasn't
seen and it will still render — unknown elements draw as plain rectangles and
get collected into a warnings list, never silently dropped — but `--profile`
(or the Schema tab in the app) will say exactly what to add: which elements
hold steps, which attributes look like jump targets, and a ready-to-paste
YAML fragment.

## Status

Two dialects are supported today — a battery-test sequence and a
gas-analyzer integration test, both anonymized from real customer files
before being checked in. The parser, canvas, search, linter, criteria table,
and duration estimator are all tested against both.

The revision diff is built and tested — its engine compares any two graphs
by uid and reports added, removed, and changed steps — but it has only ever
run against synthetic mutations of one file, not two real revisions of the
same sequence. The app's Diff tab says so rather than presenting the feature
as validated.

## License

All rights reserved. See [LICENSE](LICENSE).

## More detail

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the module layout, the
parsing rules, and the invariants that keep the tool safe to use in a
regulated context.
