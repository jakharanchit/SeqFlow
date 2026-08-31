# Changelog

All notable changes to this project are documented here.

## [1.0.0] - 2026-08-31

Initial public release.

- XML parser with schema knowledge held entirely in `rules.yaml`, supporting
  two dialects (a battery-test sequence and a gas-analyzer integration test)
  with anonymized fixtures for both.
- Interactive canvas: collapse/expand, semantic zoom, path tracing,
  drag-and-drop loading, minimap, keyboard zoom, bounded panning.
- Outline tree, inspector panel, and a searchable signal index.
- Linter, a criteria/fail-route table, and nominal-vs-worst-case duration
  estimation.
- Revision diff engine with ghost nodes on the canvas and matching Mermaid
  and SVG diff styling — validated against synthetic mutations of a single
  fixture; not yet validated against two real revisions of one sequence.
- Export to Mermaid (four modes), SVG, and PNG, plus a layout sidecar for
  persisting manual node positions across reloads.
- Command-line interface (`bin/seqflow.mjs`) with `--check`, `--profile`,
  and `--audit` for CI staleness gates and corpus-wide validation.
- Schema profiler that reports what an unfamiliar XML dialect needs added to
  `rules.yaml`, usable from the app, the CLI, or a corpus audit.
