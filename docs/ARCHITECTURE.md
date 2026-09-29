# Architecture

## Layout

```
src/
  core/     pure TypeScript — parsing, search, schema profiling; no DOM beyond an injected parser, no React
  emit/     Graph -> Mermaid / SVG / React Flow nodes+edges; layout sidecar reader, all pure
  layout/   ELK layout, run in a web worker
  ui/       React components: canvas, step tree, split bar
  bridge/   window.SeqFlowBridge, the LabVIEW command/event surface
bin/        CLI entry point
rules.yaml  the schema — never hard-coded in source
```

`core/` has no dependency on React or the DOM beyond the interface
`DOMParser` exposes, which is why the exact same parser runs under the
browser's own `DOMParser` and under `@xmldom/xmldom` in Node — the CLI and
the test suite exercise the same code path the app does, not a reimplementation
of it.

## The five parsing rules

A sequence XML file is a tree. Getting from that tree to a flowchart with the
right edges depends on five specific rules, not general tree-walking:

1. **Node identity is the `uid` GUID, verbatim.** Step names are not unique —
   the same name commonly appears four or more times in one file — so nothing
   is ever looked up by name.
2. **A jump attribute (`trueStep`, `falseStep`, `passStep`, `failStep`) is
   only read when its paired action attribute selects it** (typically
   `"Go To Step"`). The same attributes hold stale values otherwise — a
   `passStep` populated on every row even where the actual action is
   `Continue`.
3. **A jump target usually resolves to a container, not a leaf.** Descend
   into it to find the first step that will actually execute.
4. **Fall-through walks up the tree.** The step after the last one in a
   sequence is the parent's next sibling; if the parent is also last, keep
   walking up. No successor anywhere means the sequence ends there.
5. **A step where every exit is an explicit jump has no fall-through edge;
   anything else does.** Where more than a handful of edges converge on one
   target, its inbound edges are drawn dotted, so the busiest target in the
   file doesn't visually dominate the layout.

## What must never break

- **Schema knowledge lives only in `rules.yaml`.** No source file outside the
  loader that defines the rule file's own shape may name a specific element
  or attribute of the sequence schema. A new dialect is a YAML change, not a
  code change.
- **Node IDs are always the uid, verbatim** — never derived from a name, an
  index, or a position.
- **The tool never writes sequence XML.** The only output is what a caller
  explicitly asks for (Mermaid, SVG, PNG — handed back over the bridge or
  written by the CLI). It reads layout sidecars but no longer writes them.
- **No network at runtime.** Everything, including the ELK layout engine, is
  inlined into the built HTML. It runs from a local file with no server.
- **Mermaid output is deterministic.** The same graph produces byte-identical
  text on every run, which is what makes a CI staleness check (`--check`)
  possible at all.
- **Unknown elements render and warn instead of disappearing.** A step type
  or container the rule file has never seen still shows up on the canvas as a
  plain rectangle and gets listed as a warning — never silently dropped, and
  this extends to its children even where the rule file calls it a leaf.
- **An empty parse result is an error, not a result.** A file that produces
  zero nodes throws rather than returning a graph indistinguishable from one
  with genuinely no steps.

## Extending it

**A new `rules.yaml`** can be dropped onto the running app, sent over the
bridge (`loadRuleFile`), or passed to the CLI (`--rules`), with no rebuild.
`--profile` walks the raw document and reports which elements hold steps,
which attributes look like jump targets, and prints a starter YAML fragment
for anything the current rule file doesn't cover.

## Performance

Everything in the pipeline — parsing, search, converting to a flow graph —
runs in well under 300ms even at several thousand steps. The
layout pass (ELK) is the exception, dominating total runtime by roughly sixty
to one over everything else combined. That's why:

- **Large files auto-collapse on open**, folding the deepest containers first
  until the visible graph is under a fixed node budget — the only real lever
  on ELK's runtime is handing it fewer nodes.
- **Layout results are cached** per collapsed set, so re-expanding something
  already computed is instant.
- **A layout pass has a hard timeout.** If it doesn't finish, the app keeps
  the last arrangement it had and says so, rather than leaving the UI hung on
  a view it can't produce.
