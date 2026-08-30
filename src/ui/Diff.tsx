/**
 * Diff tab — Phase 4 task 5. Spec 7.7.
 *
 * Two revisions, one canvas. The loaded file is the new revision; dropping an
 * earlier one here compares against it. A split view of two 8886 px columns is
 * not something anyone can align by eye, so removed steps are drawn into the
 * new revision as ghosts instead — a deletion has to be *visible*, and an
 * absence is exactly what a reader cannot see.
 *
 * The panel says out loud what this has been tested against, because it is
 * still a diff of one file against a mutation of itself. See the note at the
 * top of `core/diff.ts`.
 */

import { useRef, useState } from 'react';

import { pathLabel } from '../core/ancestry';
import { StepNum } from './StepNum';
import type { GraphDiff, NodeDiff } from '../core/diff';
import type { Graph } from '../core/types';

export interface DiffProps {
  /** The merged graph the canvas is showing: new revision plus ghosts. */
  graph: Graph;
  /** The earlier revision's file name, when one is loaded. */
  baselineName: string | null;
  fileName: string;
  diff: GraphDiff | null;
  onDrop: (text: string, fileName: string) => void;
  onClear: () => void;
  onSelect: (uid: string) => void;
  /** The row whose attribute changes are expanded. */
  expanded: string | null;
  onExpand: (uid: string | null) => void;
}

const KIND_LABEL: Record<NodeDiff['kind'], string> = {
  added: 'added',
  removed: 'removed',
  changed: 'changed',
  same: 'same',
};

export function Diff({
  graph,
  baselineName,
  fileName,
  diff,
  onDrop,
  onClear,
  onSelect,
  expanded,
  onExpand,
}: DiffProps): React.JSX.Element {
  const [over, setOver] = useState(false);
  const errors = useRef<string | null>(null);

  /* The page-wide drop handler loads a new sequence. This one loads a
     baseline, so it has to stop the event before it gets there. */
  const receive = (e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const file = e.dataTransfer.files.item(0);
    if (file === null) return;
    const reader = new FileReader();
    reader.onload = () => onDrop(String(reader.result ?? ''), file.name);
    reader.onerror = () => {
      errors.current = `${file.name}: could not be read`;
    };
    reader.readAsText(file);
  };

  if (diff === null || baselineName === null) {
    return (
      <div className="drawer-list wide diff-empty">
        <div
          className={`diff-drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={receive}
        >
          <h3>Drop an earlier revision here</h3>
          <p>
            <b>{fileName}</b> stays on the canvas as the new revision. The file you drop is
            compared against it: steps it had and this one does not are drawn as ghosts, in the
            place they used to occupy.
          </p>
        </div>
        <p className="hint">
          Steps are paired by <code>uid</code>, as spec 7.7 asks. Whether the authoring tool
          keeps a step&rsquo;s GUID across an edit is open question Q5 — if it re-issues them,
          every edited step will read here as one deletion plus one addition, and the matcher
          needs replacing rather than the diff.
        </p>
        {errors.current !== null && <p className="export-error">{errors.current}</p>}
      </div>
    );
  }

  const { counts } = diff;

  return (
    <>
      <div className="drawer-list diff-list">
        <div className="diff-summary">
          <span className="pill added">{counts.added} added</span>
          <span className="pill removed">{counts.removed} removed</span>
          <span className="pill changed">{counts.changed} changed</span>
          <span className="pill moved">{counts.moved} moved</span>
          <span className="pill same">{counts.same} unchanged</span>
        </div>

        {diff.identical ? (
          <p className="hint">
            No differences. Every step in <b>{baselineName}</b> is in <b>{fileName}</b> with the
            same attributes, in the same place, joined the same way.
          </p>
        ) : (
          diff.nodes.map((node) => (
            <div
              key={`${node.kind}-${node.uid}`}
              className={`finding-row diff-${node.kind}${expanded === node.uid ? ' selected' : ''}`}
              role="option"
              aria-selected={expanded === node.uid}
              tabIndex={0}
              onClick={() => {
                onExpand(expanded === node.uid ? null : node.uid);
                if (graph.nodes.has(node.uid)) onSelect(node.uid);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onExpand(expanded === node.uid ? null : node.uid);
                }
              }}
            >
              <code className={`finding-code diff-${node.kind}`}>
                {KIND_LABEL[node.kind]}
                {node.moved && node.kind === 'changed' && node.attrs.length === 0 ? ' · moved' : ''}
              </code>
              <StepNum number={node.stepNumber} />
              <span className="finding-name">
                {node.name}
                {/* Inserting one step renumbers everything after it. Saying so
                    is cheaper than letting a reader rediscover it. */}
                {node.wasStepNumber !== '' && (
                  <span className="was-num"> was {node.wasStepNumber}</span>
                )}
              </span>
              <span className="detail-path">
                {graph.nodes.has(node.uid) ? pathLabel(graph, node.uid) : node.element}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="drawer-detail diff-detail">
        <div className="diff-heading">
          <span>
            <b>{baselineName}</b> → <b>{fileName}</b>
          </span>
          <button type="button" className="tool" onClick={onClear}>
            Stop comparing
          </button>
        </div>

        {expanded === null ? (
          <>
            <p className="hint">
              {counts.edgesAdded} {counts.edgesAdded === 1 ? 'edge' : 'edges'} gained,{' '}
              {counts.edgesRemoved} lost. Select a step to see what changed about it. A ghost on
              the canvas is a step this revision no longer has.
            </p>
            <p className="hint">
              Paired by <code>{diff.matcher}</code>. Validated so far only against known
              mutations of a single file — see Q5.
            </p>
          </>
        ) : (
          (() => {
            const node = diff.nodes.find((n) => n.uid === expanded);
            if (node === undefined) return null;
            if (node.attrs.length === 0) {
              return (
                <p className="hint">
                  {node.kind === 'added'
                    ? 'This step is new in this revision.'
                    : node.kind === 'removed'
                      ? 'This step was in the earlier revision and is not in this one. It is drawn on the canvas as a ghost, where it used to be.'
                      : 'No attribute changed — only the position did.'}
                  {node.moved &&
                    node.before !== node.after &&
                    ' It also moved to a different sequence.'}
                </p>
              );
            }
            return (
              <table className="diff">
                <thead>
                  <tr>
                    <th>Attribute</th>
                    <th>{baselineName}</th>
                    <th>{fileName}</th>
                  </tr>
                </thead>
                <tbody>
                  {node.attrs.map((change) => (
                    <tr key={change.attr}>
                      <td className="diff-attr">{change.attr}</td>
                      <td className="diff-value was">
                        {change.before === '' ? '—' : change.before}
                      </td>
                      <td className="diff-value now">
                        {change.after === '' ? '—' : change.after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()
        )}
      </div>
    </>
  );
}
