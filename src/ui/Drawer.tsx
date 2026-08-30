/**
 * Bottom drawer — spec 7.1. Eight tabs.
 *
 * Everything here is a question about the whole file rather than about the
 * selected node, which is why it sits under the canvas rather than in the
 * inspector. Signals, criteria, repeats and the diff are cross-cutting tables;
 * timing is a whole-file number; export is a view of the whole graph.
 *
 * **Findings and warnings are two tabs and stay two tabs.** A warning means the
 * parser could not make sense of something. A finding means it parsed fine and
 * still looks wrong. The fixture has 52 findings and zero warnings, and a
 * single list would make that file look broken while burying the four warnings
 * that would matter on a file that had them.
 *
 * The warnings list used to live in a dismissible banner. A list you can
 * dismiss is a list nobody reads twice, and NFR-6 wants unknown elements
 * surfaced, not merely mentioned once.
 */

import { pathLabel } from '../core/ancestry';
import type { CriteriaAhead, Criterion } from '../core/criteria';
import type { GraphDiff } from '../core/diff';
import type { DurationReport, Offset } from '../core/duration';
import type { LintResult } from '../core/lint';
import type { SignalIndex, SignalRow } from '../core/signals';
import { nodesFor } from '../core/signals';
import type { Comparison, SimilarGroup } from '../core/similarity';
import type { Graph, Rules, Warning } from '../core/types';
import type { FlowEdge, FlowNode } from '../emit/flow';
import type { Point } from '../layout/elkGraph';
import { Criteria } from './Criteria';
import { Diff } from './Diff';
import { Export } from './Export';
import { Findings } from './Findings';
import { Timing } from './Timing';

export type DrawerTab =
  | 'signals'
  | 'criteria'
  | 'timing'
  | 'repeats'
  | 'findings'
  | 'warnings'
  | 'diff'
  | 'export';

export interface DrawerProps {
  graph: Graph | null;
  rules: Rules;
  /** The loaded file name. Names every export. */
  fileName: string;
  /** The canvas as it stands, for the image export. */
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  routes: ReadonlyMap<string, Point[]>;
  /** True when something on the canvas is dimmed or lit right now. */
  highlighted: boolean;
  layoutMode: string;
  collapsed: ReadonlySet<string>;
  index: SignalIndex;
  rows: SignalRow[];
  warnings: Warning[];
  /** Structurally identical sibling sequences, biggest repeat first. */
  repeats: SimilarGroup[];
  /** The chosen repeat, compared. Null when there is nothing to compare. */
  comparison: Comparison | null;
  repeat: number;
  onRepeat: (index: number) => void;

  /* Phase 4 */
  lint: LintResult;
  finding: number | null;
  onFinding: (index: number | null) => void;
  criteria: Criterion[];
  criterion: string | null;
  onCriterion: (key: string | null) => void;
  failRoutes: boolean;
  onFailRoutes: (on: boolean) => void;
  failCount: number;
  ahead: CriteriaAhead | null;
  duration: DurationReport;
  offset: Offset | null;
  terminals: number;
  diff: GraphDiff | null;
  baselineName: string | null;
  onBaseline: (text: string, fileName: string) => void;
  onClearBaseline: () => void;
  diffRow: string | null;
  onDiffRow: (uid: string | null) => void;

  open: boolean;
  tab: DrawerTab;
  /** The signal whose steps are spotlit on the canvas. */
  signal: string | null;
  selected: string | null;
  onTab: (tab: DrawerTab) => void;
  onOpen: (open: boolean) => void;
  onSignal: (signal: string | null) => void;
  onSelect: (uid: string) => void;
}

/** Tabs that need more room than a signal list. */
const TALL: ReadonlySet<DrawerTab> = new Set<DrawerTab>(['export', 'timing', 'findings', 'diff']);

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
 * component type on every render and remount all eight buttons each time.
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
    fileName,
    nodes,
    edges,
    routes,
    highlighted,
    layoutMode,
    collapsed,
    index,
    rows,
    warnings,
    repeats,
    comparison,
    repeat,
    onRepeat,
    lint,
    finding,
    onFinding,
    criteria,
    criterion,
    onCriterion,
    failRoutes,
    onFailRoutes,
    failCount,
    ahead,
    duration,
    offset,
    terminals,
    diff,
    baselineName,
    onBaseline,
    onClearBaseline,
    diffRow,
    onDiffRow,
    open,
    tab,
    signal,
    selected,
    onTab,
    onOpen,
    onSignal,
    onSelect,
  } = props;

  if (graph === null) return null;

  const uids = signal === null ? [] : [...nodesFor(index, signal)];

  /** What every tab button needs to know: which is open, and how to switch. */
  const shared = { tab, open, onTab, onOpen };

  return (
    <div className={`drawer${open ? ' open' : ''}${open && TALL.has(tab) ? ' tall' : ''}`}>
      <div className="drawer-tabs">
        <Tab {...shared} id="signals" label="Signals" count={rows.length} />
        <Tab
          {...shared}
          id="criteria"
          label="Criteria"
          count={criteria.length}
          title="What can reject this unit"
        />
        <Tab {...shared} id="timing" label="Timing" title="How long this sequence takes — a range" />
        <Tab {...shared} id="repeats" label="Repeats" count={repeats.length} />
        <Tab
          {...shared}
          id="findings"
          label="Findings"
          count={lint.findings.length}
          className={lint.findings.some((f) => f.severity === 'warn') ? 'has-findings' : ''}
          title="Things that parsed correctly and still look wrong"
        />
        <Tab
          {...shared}
          id="warnings"
          label="Warnings"
          count={warnings.length}
          className={warnings.length > 0 ? 'has-warnings' : ''}
          title="Things the parser could not make sense of"
        />
        <Tab
          {...shared}
          id="diff"
          label="Diff"
          {...(diff === null ? {} : { count: diff.nodes.length })}
          className={diff === null ? '' : 'has-diff'}
          title="Compare against an earlier revision"
        />
        <Tab {...shared} id="export" label="Export" />

        <div className="spacer" />
        {signal !== null && (
          <button type="button" className="clear-signal" onClick={() => onSignal(null)}>
            Clear “{signal}” spotlight
          </button>
        )}
        {criterion !== null && (
          <button type="button" className="clear-signal" onClick={() => onCriterion(null)}>
            Clear criterion spotlight
          </button>
        )}
        {open && (
          <button type="button" className="collapse" title="Hide" onClick={() => onOpen(false)}>
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="drawer-body">
          {tab === 'signals' ? (
            <>
              <div className="drawer-list">
                {rows.map((row) => (
                  <div
                    key={row.signal}
                    className={`signal-row${signal === row.signal ? ' selected' : ''}`}
                    onClick={() => onSignal(signal === row.signal ? null : row.signal)}
                    role="option"
                    aria-selected={signal === row.signal}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSignal(signal === row.signal ? null : row.signal);
                      }
                    }}
                  >
                    <span className="signal-name">{row.signal}</span>
                    <span className="signal-attrs">{row.attrs.join(', ')}</span>
                    <span className="signal-count">{row.count}</span>
                  </div>
                ))}
                {rows.length === 0 && <p className="hint">No signals in this file.</p>}
              </div>

              <div className="drawer-detail">
                {signal === null ? (
                  <p className="hint">Select a signal to see the steps that touch it.</p>
                ) : (
                  uids.map((uid) => {
                    const node = graph.nodes.get(uid);
                    if (node === undefined) return null;
                    return (
                      <div key={uid} className="detail-row" onClick={() => onSelect(uid)}>
                        <span className={`dot kind-${node.kind}`} />
                        <span className="detail-name">
                          {node.name === '' ? node.element : node.name}
                        </span>
                        {/* Names collide; the path is what identifies the step. */}
                        <span className="detail-path">{pathLabel(graph, uid)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : tab === 'criteria' ? (
            <Criteria
              graph={graph}
              table={criteria}
              criterion={criterion}
              onCriterion={onCriterion}
              failRoutes={failRoutes}
              onFailRoutes={onFailRoutes}
              failCount={failCount}
              selected={selected}
              ahead={ahead}
              onSelect={onSelect}
            />
          ) : tab === 'timing' ? (
            <Timing
              graph={graph}
              report={duration}
              selected={selected}
              offset={offset}
              terminals={terminals}
            />
          ) : tab === 'findings' ? (
            <Findings
              graph={graph}
              lint={lint}
              selected={finding}
              onSelect={onFinding}
              onReveal={onSelect}
            />
          ) : tab === 'diff' ? (
            <Diff
              graph={graph}
              baselineName={baselineName}
              fileName={fileName}
              diff={diff}
              onDrop={onBaseline}
              onClear={onClearBaseline}
              onSelect={onSelect}
              expanded={diffRow}
              onExpand={onDiffRow}
            />
          ) : tab === 'repeats' ? (
            <>
              <div className="drawer-list">
                {repeats.map((group, i) => (
                  <div
                    key={group.key}
                    className={`signal-row${repeat === i ? ' selected' : ''}`}
                    onClick={() => onRepeat(i)}
                    role="option"
                    aria-selected={repeat === i}
                    tabIndex={0}
                  >
                    <span className="signal-name">
                      {group.members.length}× {group.size - 1} steps
                    </span>
                    <span className="signal-attrs">
                      in {graph.nodes.get(group.parent ?? '')?.name ?? 'this file'}
                    </span>
                    <span className="signal-count">
                      {(group.size - 1) * group.members.length}
                    </span>
                  </div>
                ))}
                {repeats.length === 0 && (
                  <p className="hint">
                    No two sequences in this file share a structure. Nothing to compare.
                  </p>
                )}
              </div>

              <div className="drawer-detail">
                {comparison === null ? (
                  <p className="hint">Select a repeat to see how its siblings differ.</p>
                ) : (
                  <table className="diff">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Attribute</th>
                        {comparison.names.map((name, i) => (
                          <th key={i}>{name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.differences.map((d, i) => (
                        <tr key={i} onClick={() => onSelect(d.uids[0] ?? '')}>
                          <td className="diff-step" title={d.element}>
                            {d.label}
                          </td>
                          <td className="diff-attr">{d.attr}</td>
                          {d.values.map((v, j) => (
                            <td key={j} className="diff-value">
                              {v === '' ? '—' : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {comparison.differences.length === 0 && (
                        <tr>
                          <td colSpan={2 + comparison.names.length} className="diff-attr">
                            {comparison.identical
                              ? 'Identical in every attribute.'
                              : 'These sequences do not share a structure.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : tab === 'export' ? (
            <Export
              graph={graph}
              rules={rules}
              fileName={fileName}
              nodes={nodes}
              edges={edges}
              routes={routes}
              highlighted={highlighted}
              layoutMode={layoutMode}
              collapsed={collapsed}
              diff={diff}
            />
          ) : (
            <div className="drawer-list wide">
              {warnings.length === 0 ? (
                <p className="hint">
                  No warnings. Every element in this file is known to the rule file and every
                  jump target resolved. {lint.findings.length > 0 && (
                    <>
                      That is a different question from whether the sequence looks right —{' '}
                      <b>Findings</b> has {lint.findings.length} of those.
                    </>
                  )}
                </p>
              ) : (
                warnings.map((w, i) => (
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
                      <span className="detail-path">{pathLabel(graph, w.uid)}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
