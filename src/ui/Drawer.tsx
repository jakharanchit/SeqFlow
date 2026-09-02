/**
 * Settings panel — a right-side overlay, opened from the gear button.
 *
 * Two tabs: View (the app's own controls, stats, and a warnings list) and
 * Export (the thing that makes the emitters worth having). This used to be
 * ten tabs across four clusters — Signals, Criteria, Repeats, Warnings,
 * Findings, Schema, Timing, Diff — each with its own canvas cross-link
 * (signal spotlight, criteria dimming, diff ghosting) and, for Trace paths, a
 * whole highlighting mode of its own. All of that was removed: a
 * LabVIEW-embedded viewer does not need a corpus-analysis suite, and every
 * one of those computations still lives in `core/` (and, for the schema
 * profiler, in the CLI's `--profile`/`--audit`) for whoever needs it outside
 * this page. Only the UI and its `App.tsx` wiring went.
 *
 * Warnings survive as a count/list inside View rather than as their own tab —
 * they're the read-only correctness signal invariant 7 cares about, not
 * optional. `graph.warnings` never had anywhere else to be seen once its tab
 * went with the rest.
 */

import { pathLabel } from '../core/ancestry';
import { StepNum } from './StepNum';
import type { Graph, Rules, Warning } from '../core/types';
import type { FlowEdge, FlowNode } from '../emit/flow';
import type { Point } from '../layout/elkGraph';
import { Export } from './Export';
import { CanvasHelp } from './Inspector';
import type { HideableColumn } from './Outline';

export type DrawerTab = 'view' | 'export';

/** Column id -> its label in the show/hide list, in display order. */
const COLUMN_LABELS: readonly (readonly [HideableColumn, string])[] = [
  ['desc', 'Description'],
  ['logStart', 'Log Start'],
  ['logCompletion', 'Log Completion'],
];

/** The app-level controls and live stats that used to live in the toolbar
 * header — relocated here now that the header is gone. */
export interface ViewInfo {
  visibleCount: number;
  totalCount: number;
  edgeCount: number;
  elapsedMs: number;
  /** Sequences the tool folded on load, before the reader touched anything. */
  autoFolded: number;
  onRelayout: () => void;
  busy: boolean;
  /** The rule file in force, and where it came from. Null means the built-in. */
  rulesFile: string | null;
  onClearRules: () => void;
  showMinimap: boolean;
  onShowMinimap: (on: boolean) => void;
  /** Which of the tree's optional columns are hidden right now. */
  hiddenColumns: ReadonlySet<HideableColumn>;
  onToggleColumn: (column: HideableColumn) => void;
}

export interface DrawerProps {
  graph: Graph | null;
  rules: Rules;
  view: ViewInfo;
  /** The loaded file name. Names every export. */
  fileName: string;
  /** The canvas as it stands, for the image export. */
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  routes: ReadonlyMap<string, Point[]>;
  /** True when something on the canvas is dimmed or lit right now. */
  highlighted: boolean;
  collapsed: ReadonlySet<string>;
  warnings: Warning[];

  open: boolean;
  tab: DrawerTab;
  selected: string | null;
  onTab: (tab: DrawerTab) => void;
  onOpen: (open: boolean) => void;
  onSelect: (uid: string) => void;
}

interface TabProps {
  id: DrawerTab;
  label: string;
  count?: number;
  className?: string;
  title?: string;
  /** The currently open tab, and whether the drawer is open at all. */
  tab: DrawerTab;
  open: boolean;
  onTab: (tab: DrawerTab) => void;
  onOpen: (open: boolean) => void;
}

/**
 * Every tab button behaves the same: click the open one to close it.
 *
 * Declared here rather than inside `Drawer`, which would give React a new
 * component type on every render and remount both buttons each time.
 */
function Tab({
  id,
  label,
  count,
  className,
  title,
  tab,
  open,
  onTab,
  onOpen,
}: TabProps): React.JSX.Element {
  const active = tab === id && open;
  return (
    <button
      type="button"
      className={`${active ? 'on' : ''}${className === undefined ? '' : ` ${className}`}`}
      title={title}
      onClick={() => {
        if (active) onOpen(false);
        else {
          onTab(id);
          onOpen(true);
        }
      }}
    >
      {label}
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

export function Drawer(props: DrawerProps): React.JSX.Element | null {
  const {
    graph,
    rules,
    view,
    fileName,
    nodes,
    edges,
    routes,
    highlighted,
    collapsed,
    warnings,
    open,
    tab,
    onTab,
    onOpen,
    onSelect,
  } = props;

  if (graph === null) return null;

  /** What every tab button needs to know: which is open, and how to switch. */
  const shared = { tab, open, onTab, onOpen };

  return (
    <div className={`drawer${open ? ' open' : ''}`}>
      <div className="drawer-tabs">
        <Tab {...shared} id="view" label="View" />
        <Tab {...shared} id="export" label="Export" />

        <div className="spacer" />
        {open && (
          <button type="button" className="collapse" title="Hide" onClick={() => onOpen(false)}>
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="drawer-body">
          {tab === 'view' ? (
            <div className="drawer-list wide">
              <div className="section">
                <h3>This file</h3>
                <table className="attrs">
                  <tbody>
                    <tr>
                      <td className="k">nodes</td>
                      <td className="v">
                        {view.visibleCount}
                        {view.visibleCount === view.totalCount ? '' : ` / ${view.totalCount}`}
                      </td>
                    </tr>
                    <tr>
                      <td className="k">edges</td>
                      <td className="v">{view.edgeCount}</td>
                    </tr>
                    <tr>
                      <td className="k">layout time</td>
                      <td className="v">{view.elapsedMs} ms</td>
                    </tr>
                    {view.autoFolded > 0 && (
                      <tr>
                        <td className="k">opened folded</td>
                        <td className="v">
                          {view.autoFolded} sequences — laying out every node at once takes
                          seconds on a file this size. Expand all in the outline to see the whole
                          thing.
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="k">rules</td>
                      <td className="v">
                        {view.rulesFile === null ? (
                          'built-in'
                        ) : (
                          <>
                            {view.rulesFile}{' '}
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                view.onClearRules();
                              }}
                            >
                              Use built-in
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="section">
                <h3>Canvas controls</h3>
                <button
                  type="button"
                  className="tool"
                  disabled={view.busy}
                  onClick={view.onRelayout}
                  title="Discard manual positions and restore the automatic layout"
                >
                  {view.busy ? 'Laying out…' : 'Re-layout'}
                </button>
                <button
                  type="button"
                  className={`tool${view.showMinimap ? ' on' : ''}`}
                  aria-pressed={view.showMinimap}
                  onClick={() => view.onShowMinimap(!view.showMinimap)}
                >
                  Minimap
                </button>
              </div>

              <div className="section">
                <h3>Tree columns</h3>
                {COLUMN_LABELS.map(([column, label]) => {
                  const shown = !view.hiddenColumns.has(column);
                  return (
                    <button
                      key={column}
                      type="button"
                      className={`tool${shown ? ' on' : ''}`}
                      aria-pressed={shown}
                      onClick={() => view.onToggleColumn(column)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="section">
                <h3>Warnings</h3>
                {warnings.length === 0 ? (
                  <p className="hint">
                    No warnings. Every element in this file is known to the rule file and every
                    jump target resolved.
                  </p>
                ) : (
                  <details>
                    <summary className="hint">
                      {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                    </summary>
                    {warnings.map((w, i) => (
                      <div
                        key={i}
                        className="warn-row"
                        onClick={() => {
                          if (w.uid !== '' && graph.nodes.has(w.uid)) onSelect(w.uid);
                        }}
                      >
                        <code className="warn-code">{w.code}</code>
                        <span className="warn-message">{w.message}</span>
                        {w.uid !== '' && graph.nodes.has(w.uid) && (
                          <span className="detail-path">
                            <StepNum number={graph.nodes.get(w.uid)?.stepNumber ?? ''} />
                            {pathLabel(graph, w.uid)}
                          </span>
                        )}
                      </div>
                    ))}
                  </details>
                )}
              </div>

              <CanvasHelp graph={graph} />
            </div>
          ) : (
            <Export
              graph={graph}
              rules={rules}
              fileName={fileName}
              nodes={nodes}
              edges={edges}
              routes={routes}
              highlighted={highlighted}
              collapsed={collapsed}
            />
          )}
        </div>
      )}
    </div>
  );
}
