/**
 * Bottom drawer — spec 7.1. Four tabs: signals, repeats, warnings and export.
 *
 * The first three are cross-cutting tables: they answer questions about the
 * whole file rather than about the selected node, which is why they sit under
 * the canvas rather than in the inspector. Export joined them for the same
 * reason — Mermaid text is a view of the whole graph, not of a selection.
 *
 * The warnings list used to live in a dismissible banner. A list you can
 * dismiss is a list nobody reads twice, and NFR-6 wants unknown elements
 * surfaced, not merely mentioned once.
 */

import { pathLabel } from '../core/ancestry';
import type { SignalIndex, SignalRow } from '../core/signals';
import { nodesFor } from '../core/signals';
import type { Comparison, SimilarGroup } from '../core/similarity';
import type { Graph, Rules, Warning } from '../core/types';
import type { FlowEdge, FlowNode } from '../emit/flow';
import type { Point } from '../layout/elkGraph';
import { Export } from './Export';

export type DrawerTab = 'signals' | 'repeats' | 'warnings' | 'export';

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
  open: boolean;
  tab: DrawerTab;
  /** The signal whose steps are spotlit on the canvas. */
  signal: string | null;
  onTab: (tab: DrawerTab) => void;
  onOpen: (open: boolean) => void;
  onSignal: (signal: string | null) => void;
  onSelect: (uid: string) => void;
}

export function Drawer({
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
  open,
  tab,
  signal,
  onTab,
  onOpen,
  onSignal,
  onSelect,
}: DrawerProps): React.JSX.Element | null {
  if (graph === null) return null;

  const uids = signal === null ? [] : [...nodesFor(index, signal)];

  return (
    /* Export needs more room than a signal list: 300 lines of Mermaid read
       through a 216 px slot is not a preview. */
    <div className={`drawer${open ? ' open' : ''}${open && tab === 'export' ? ' tall' : ''}`}>
      <div className="drawer-tabs">
        <button
          type="button"
          className={tab === 'signals' && open ? 'on' : ''}
          onClick={() => {
            if (tab === 'signals' && open) onOpen(false);
            else {
              onTab('signals');
              onOpen(true);
            }
          }}
        >
          Signals<b>{rows.length}</b>
        </button>
        <button
          type="button"
          className={tab === 'repeats' && open ? 'on' : ''}
          onClick={() => {
            if (tab === 'repeats' && open) onOpen(false);
            else {
              onTab('repeats');
              onOpen(true);
            }
          }}
        >
          Repeats<b>{repeats.length}</b>
        </button>
        <button
          type="button"
          className={`${tab === 'warnings' && open ? 'on' : ''}${warnings.length > 0 ? ' has-warnings' : ''}`}
          onClick={() => {
            if (tab === 'warnings' && open) onOpen(false);
            else {
              onTab('warnings');
              onOpen(true);
            }
          }}
        >
          Warnings<b>{warnings.length}</b>
        </button>
        <button
          type="button"
          className={tab === 'export' && open ? 'on' : ''}
          onClick={() => {
            if (tab === 'export' && open) onOpen(false);
            else {
              onTab('export');
              onOpen(true);
            }
          }}
        >
          Export
        </button>
        <div className="spacer" />
        {signal !== null && (
          <button type="button" className="clear-signal" onClick={() => onSignal(null)}>
            Clear “{signal}” spotlight
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
            />
          ) : (
            <div className="drawer-list wide">
              {warnings.length === 0 ? (
                <p className="hint">
                  No warnings. Every element in this file is known to the rule file and every
                  jump target resolved.
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
