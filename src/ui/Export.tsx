/**
 * Export panel — Phase 3 tasks 3 and 5. The thing that makes the emitters
 * worth having.
 *
 * Two formats behind one tab. Mermaid gets a mode selector, a preview and two
 * buttons; the preview matters more than it looks, because Mermaid text is the
 * one output nobody can eyeball on the canvas and copying 133 nodes of it blind
 * is how a bad emit reaches a repository. Image gets a theme, a scale and the
 * pixel dimensions *before* the click — grouped at 2x is 34.6 Mpx and roughly
 * 10 MB, and nobody should discover that after waiting for it.
 *
 * Everything is computed in the page. No network, no worker, no file dialog.
 */

import { useMemo, useState } from 'react';

import type { GraphDiff } from '../core/diff';
import type { Graph, Rules } from '../core/types';
import type { FlowEdge, FlowNode } from '../emit/flow';
import {
  DIFF_CLASS_DEFS,
  mermaidModel,
  toMermaid,
  toMermaidSplit,
  type MermaidFile,
  type MermaidMode,
} from '../emit/mermaid';
import { serialiseSidecar, sidecarName, toSidecar } from '../emit/sidecar';
import { toSvg, type Theme } from '../emit/svg';
import type { Point } from '../layout/elkGraph';
import { copyText, downloadText, stem } from './download';
import { downloadBlob, svgToPng } from './raster';

export type ExportMode = 'full' | 'overview' | 'depth' | 'split';
export type ExportFormat = 'mermaid' | 'image' | 'layout';

export interface ExportProps {
  graph: Graph;
  rules: Rules;
  /** The loaded file name, e.g. `Sequence_XML.xml`. Names every output. */
  fileName: string;
  /** The canvas as it stands: laid out, and carrying its dim/highlight classes. */
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  /** ELK's orthogonal routes. Absent until the first layout lands. */
  routes: ReadonlyMap<string, Point[]>;
  /** True when something on the canvas is dimmed or lit right now. */
  highlighted: boolean;
  /** The layout mode and collapsed set, for the sidecar. */
  layoutMode: string;
  collapsed: ReadonlySet<string>;
  /**
   * The loaded revision diff, when there is one. The image export needs
   * nothing from it — `nodes` already carries the diff classes — but Mermaid
   * has no classes until it is told about them.
   */
  diff: GraphDiff | null;
}

/** Deepest container in the file: the depth slider has no reason to go past it. */
function maxDepth(graph: Graph): number {
  let deepest = 1;
  for (const uid of graph.containers.keys()) {
    const node = graph.nodes.get(uid);
    if (node !== undefined && node.depth > deepest) deepest = node.depth;
  }
  return deepest;
}

export function Export({
  graph,
  rules,
  fileName,
  nodes,
  edges,
  routes,
  highlighted,
  layoutMode,
  collapsed,
  diff,
}: ExportProps): React.JSX.Element {
  const [format, setFormat] = useState<ExportFormat>('mermaid');
  const [mode, setMode] = useState<ExportMode>('full');
  const [depth, setDepth] = useState(2);
  const [direction, setDirection] = useState<'TD' | 'LR'>('TD');
  const [groups, setGroups] = useState(true);
  const [which, setWhich] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  /** The fourth Mermaid state: added / removed / changed as three classes. */
  const [marked, setMarked] = useState(true);

  const [theme, setTheme] = useState<Theme>('dark');
  const [scale, setScale] = useState(1);
  const [withHighlight, setWithHighlight] = useState(true);
  const [rasterising, setRasterising] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  /**
   * A rendered PNG, waiting for a click to save it.
   *
   * Not saved automatically, and that is deliberate. Rasterising the grouped
   * layout takes over a second, and by the time it resolves the click that
   * started it no longer counts as user activation — the browser drops the
   * download without a word, which is the worst outcome available. The second
   * click is synchronous and always lands, and it is where the file size
   * belongs anyway: 1x grouped is about 1 MB and 2x is nearer ten.
   */
  const [png, setPng] = useState<{ blob: Blob; w: number; h: number } | null>(null);

  const base = stem(fileName);
  const deepest = useMemo(() => maxDepth(graph), [graph]);

  const emitMode: MermaidMode = useMemo(() => {
    if (mode === 'overview') return { kind: 'overview' };
    if (mode === 'depth') return { kind: 'depth', depth };
    return { kind: 'full' };
  }, [mode, depth]);

  /**
   * uid -> diff class. Nodes the diff calls unchanged carry no class at all,
   * so an unmarked diagram is byte-identical to one emitted without a diff.
   */
  const classes = useMemo(() => {
    if (diff === null || !marked) return undefined;
    const out = new Map<string, string>();
    for (const [uid, kind] of diff.status) {
      if (kind !== 'same') out.set(uid, kind);
    }
    return out;
  }, [diff, marked]);

  /** Split emits several files; every other mode emits exactly one. */
  const files: MermaidFile[] = useMemo(() => {
    const options = {
      direction,
      groups,
      ...(classes === undefined ? {} : { classes, classDefs: DIFF_CLASS_DEFS }),
    };
    if (mode === 'split') return toMermaidSplit(graph, rules, base, options);
    return [
      {
        name: `${base}.mmd`,
        title: fileName,
        text: toMermaid(graph, rules, { ...options, mode: emitMode }),
      },
    ];
  }, [graph, rules, base, fileName, mode, emitMode, direction, groups, classes]);

  const active = files[Math.min(which, files.length - 1)] ?? files[0]!;

  /** Counts for the shown file. Split's per-file counts come from its mode. */
  const counts = useMemo(() => {
    if (mode === 'split') return null;
    const model = mermaidModel(graph, emitMode);
    return { nodes: model.nodes.length, edges: model.edges.length };
  }, [graph, mode, emitMode]);

  /**
   * The image. Recomputed on every control change, which is cheap — the whole
   * fixture is about 300 KB of markup and no layout pass is involved.
   */
  const image = useMemo(
    () =>
      toSvg(nodes, edges, {
        theme,
        routes,
        highlight: withHighlight,
        title: fileName,
      }),
    [nodes, edges, theme, routes, withHighlight, fileName],
  );

  const pngWidth = Math.round(image.width * scale);
  const pngHeight = Math.round(image.height * scale);
  const megapixels = (pngWidth * pngHeight) / 1e6;

  const onCopy = (): void => {
    void copyText(active.text).then((ok) => {
      setCopied(ok ? active.name : 'failed');
      setTimeout(() => setCopied(null), 1600);
    });
  };

  const discardPng = (): void => setPng(null);

  const onPng = (): void => {
    setImageError(null);
    discardPng();
    setRasterising(true);
    void svgToPng(image.text, image.width, image.height, scale)
      .then((result) => setPng({ blob: result.blob, w: result.width, h: result.height }))
      .catch((err: unknown) => setImageError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRasterising(false));
  };

  return (
    <div className="export">
      <div className="export-controls">
        <div className="segmented">
          <button
            type="button"
            aria-pressed={format === 'mermaid'}
            onClick={() => setFormat('mermaid')}
            title="Mermaid text for Git and documentation"
          >
            Mermaid
          </button>
          <button
            type="button"
            aria-pressed={format === 'image'}
            onClick={() => setFormat('image')}
            title="SVG or PNG of the canvas as it stands"
          >
            Image
          </button>
          <button
            type="button"
            aria-pressed={format === 'layout'}
            onClick={() => setFormat('layout')}
            title="Save this arrangement beside the sequence file"
          >
            Layout
          </button>
        </div>

        <span className="export-rule" />

        {format === 'mermaid' ? (
          <>
            <div className="segmented">
              {(['full', 'overview', 'depth', 'split'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setWhich(0);
                  }}
                  title={
                    m === 'full'
                      ? 'Every step, every edge'
                      : m === 'overview'
                        ? 'Top-level sequences only'
                        : m === 'depth'
                          ? 'Expand to a depth, fold everything below'
                          : 'One file per top-level sequence, plus a linked overview'
                  }
                >
                  {m === 'full'
                    ? 'Full'
                    : m === 'overview'
                      ? 'Overview'
                      : m === 'depth'
                        ? 'Depth'
                        : 'Split'}
                </button>
              ))}
            </div>

            {mode === 'depth' && (
              <label className="export-depth">
                Depth
                <input
                  type="range"
                  min={1}
                  max={deepest}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                />
                <b>{depth}</b>
              </label>
            )}

            <div className="segmented">
              <button
                type="button"
                aria-pressed={direction === 'TD'}
                onClick={() => setDirection('TD')}
              >
                Top-down
              </button>
              <button
                type="button"
                aria-pressed={direction === 'LR'}
                onClick={() => setDirection('LR')}
              >
                Left-right
              </button>
            </div>

            <button
              type="button"
              className={`tool${groups ? ' on' : ''}`}
              aria-pressed={groups}
              onClick={() => setGroups((g) => !g)}
              title="Draw each sequence as a Mermaid subgraph"
            >
              Sequence boxes
            </button>

            <button
              type="button"
              className={`tool${marked && diff !== null ? ' on' : ''}`}
              aria-pressed={marked && diff !== null}
              disabled={diff === null}
              onClick={() => setMarked((m) => !m)}
              title={
                diff === null
                  ? 'Load an earlier revision on the Diff tab to mark what changed'
                  : 'Mark added, removed and changed steps with Mermaid classes'
              }
            >
              Mark changes
            </button>

            <div className="spacer" />

            {counts !== null && (
              <span className="stat">
                <b>{counts.nodes}</b> nodes · <b>{counts.edges}</b> edges
              </span>
            )}

            <button type="button" className="tool" onClick={onCopy}>
              {copied === null ? 'Copy' : copied === 'failed' ? 'Copy failed' : 'Copied'}
            </button>
            <button
              type="button"
              className="tool"
              onClick={() => downloadText(active.name, active.text, 'text/vnd.mermaid')}
            >
              Download {active.name}
            </button>
            {files.length > 1 && (
              <button
                type="button"
                className="tool"
                onClick={() => {
                  for (const file of files) downloadText(file.name, file.text, 'text/vnd.mermaid');
                }}
                title={`Download all ${files.length} files`}
              >
                Download all
              </button>
            )}
          </>
        ) : format === 'image' ? (
          <>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={theme === 'dark'}
                onClick={() => {
                  setTheme('dark');
                  discardPng();
                }}
              >
                Dark
              </button>
              <button
                type="button"
                aria-pressed={theme === 'light'}
                onClick={() => {
                  setTheme('light');
                  discardPng();
                }}
                title="For a printed traveller or a report"
              >
                Light
              </button>
            </div>

            <div className="segmented">
              <button
                type="button"
                aria-pressed={scale === 1}
                onClick={() => {
                  setScale(1);
                  discardPng();
                }}
              >
                1×
              </button>
              <button
                type="button"
                aria-pressed={scale === 2}
                onClick={() => {
                  setScale(2);
                  discardPng();
                }}
              >
                2×
              </button>
            </div>

            <button
              type="button"
              className={`tool${withHighlight ? ' on' : ''}`}
              aria-pressed={withHighlight}
              disabled={!highlighted}
              onClick={() => {
                setWithHighlight((h) => !h);
                discardPng();
              }}
              title={
                highlighted
                  ? 'Carry the dimming and highlighting from the canvas into the export'
                  : 'Nothing is highlighted on the canvas right now'
              }
            >
              Match canvas
            </button>

            <div className="spacer" />

            <span className="stat">
              SVG <b>{image.width}</b> × <b>{image.height}</b> · PNG <b>{pngWidth}</b> ×{' '}
              <b>{pngHeight}</b> ({megapixels.toFixed(1)} Mpx)
            </span>

            <button
              type="button"
              className="tool"
              onClick={() => downloadText(`${base}.svg`, image.text, 'image/svg+xml')}
            >
              Download .svg
            </button>
            <button type="button" className="tool" disabled={rasterising} onClick={onPng}>
              {rasterising ? 'Rendering…' : 'Render .png'}
            </button>
            {png !== null && (
              <button
                type="button"
                className="tool save-png"
                onClick={() => downloadBlob(`${base}.png`, png.blob)}
              >
                Save {base}.png · {png.w} × {png.h} · {(png.blob.size / 1e6).toFixed(1)} MB
              </button>
            )}
          </>
        ) : (
          <>
            <span className="stat">
              <b>{nodes.length}</b> positions · <b>{collapsed.size}</b> collapsed ·{' '}
              <b>{layoutMode}</b>
            </span>

            <div className="spacer" />

            <button
              type="button"
              className="tool"
              onClick={() =>
                downloadText(
                  sidecarName(base),
                  serialiseSidecar(toSidecar(fileName, layoutMode, collapsed, nodes)),
                  'application/json',
                )
              }
            >
              Download {sidecarName(base)}
            </button>
          </>
        )}
      </div>

      {format === 'mermaid' && files.length > 1 && (
        <div className="export-files">
          {files.map((file, i) => (
            <button
              key={file.name}
              type="button"
              className={i === which ? 'on' : ''}
              onClick={() => setWhich(i)}
            >
              {file.title}
            </button>
          ))}
        </div>
      )}

      {format === 'image' && (
        <p className="export-note">
          {/* Task 5: a screenshot that silently drops the highlight the reader
              set up is worse than no export, so the panel always says which
              one it is about to produce. */}
          {highlighted
            ? withHighlight
              ? 'Exporting the canvas as it stands, dimming and highlight included.'
              : 'Exporting the whole graph plain — the canvas highlight is not carried over.'
            : 'Exporting the whole graph. Select a step with Trace paths on to export a highlight.'}
          {imageError !== null && <span className="export-error"> {imageError}</span>}
        </p>
      )}

      {format === 'layout' && (
        <div className="export-layout">
          <p>
            Drag steps where you want them, then save. The sidecar records every
            position, the layout mode and which sequences are folded — restoring an
            arrangement with every sequence re-expanded would not be restoring it.
          </p>
          <p>
            <b>Drop the .layout.json back onto this page</b> to restore it. Load the
            sequence first. A position for a step this file no longer has is dropped
            and reported in Warnings rather than failing the load, and a step with no
            saved position keeps the automatic one.
          </p>
          <p className="hint">
            This is the only file seqflow writes. It never writes sequence XML.
          </p>
        </div>
      )}

      {format === 'mermaid' && (
        /* readOnly, not disabled: the text must stay selectable by hand. */
        <textarea className="export-preview" readOnly value={active.text} spellCheck={false} />
      )}

      {format === 'image' && (
        <div
          className="export-image"
          /* The emitter's own output, so what is previewed is what downloads.
             The string is built here from the parsed graph — never from the
             loaded file's text — so there is nothing user-authored to inject. */
          dangerouslySetInnerHTML={{ __html: image.text }}
        />
      )}
    </div>
  );
}
