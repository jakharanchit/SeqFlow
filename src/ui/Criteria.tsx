/**
 * Criteria tab — Phase 4 tasks 2 and 4.
 *
 * "What can reject this unit", in four rows rather than sixteen scattered
 * hexagons. Modelled on the signal drawer down to the spotlight: selecting a
 * criterion lights its four evaluations on the canvas exactly the way selecting
 * a signal lights the steps that touch it.
 *
 * Task 4 lives here too, and the tab is honest about what it is. It is not a
 * failure-*path* view: 99 of the 107 leaves can reach the abort, so a filter to
 * them would hide almost nothing. What it offers instead is the fail routes as
 * one set, and — for a selected step — the criteria that still lie ahead of it,
 * which is the question that actually discriminates between steps.
 */

import type { CriteriaAhead, Criterion } from '../core/criteria';
import { pathLabel } from '../core/ancestry';
import type { Graph } from '../core/types';

export interface CriteriaProps {
  graph: Graph;
  table: Criterion[];
  /** The selected criterion's key, spotlit on the canvas. */
  criterion: string | null;
  onCriterion: (key: string | null) => void;
  /** Whether the 16 fail routes are lit. */
  failRoutes: boolean;
  onFailRoutes: (on: boolean) => void;
  /** How many edges the fail-route highlight covers. */
  failCount: number;
  /** The selected step, and what lies ahead of it. Null with no selection. */
  selected: string | null;
  ahead: CriteriaAhead | null;
  onSelect: (uid: string) => void;
}

export function Criteria({
  graph,
  table,
  criterion,
  onCriterion,
  failRoutes,
  onFailRoutes,
  failCount,
  selected,
  ahead,
  onSelect,
}: CriteriaProps): React.JSX.Element {
  const current = table.find((row) => row.key === criterion) ?? null;
  const step = selected === null ? undefined : graph.nodes.get(selected);

  return (
    <>
      <div className="drawer-list">
        <div className="criteria-tools">
          <button
            type="button"
            className={`tool${failRoutes ? ' on' : ''}`}
            aria-pressed={failRoutes}
            disabled={failCount === 0}
            onClick={() => onFailRoutes(!failRoutes)}
            title="Light every edge a criterion takes when it is not met, and the steps at both ends"
          >
            Fail routes<b>{failCount}</b>
          </button>
        </div>

        {table.map((row) => (
          <div
            key={row.key}
            className={`signal-row${criterion === row.key ? ' selected' : ''}`}
            role="option"
            aria-selected={criterion === row.key}
            tabIndex={0}
            onClick={() => onCriterion(criterion === row.key ? null : row.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCriterion(criterion === row.key ? null : row.key);
              }
            }}
          >
            <span className="signal-name">{row.name}</span>
            <span className="signal-attrs">
              {row.limits ?? 'limits not in this file'}
              {row.members.length > 0 && ` · ${row.members.length} measured`}
            </span>
            <span className="signal-count">{row.uses.length}</span>
          </div>
        ))}

        {table.length === 0 && (
          <p className="hint">
            No acceptance criteria in this file. Nothing here can reject a unit.
          </p>
        )}
      </div>

      <div className="drawer-detail">
        {step !== undefined && ahead !== null && (
          <div className="criteria-ahead">
            <b>{ahead.uids.length}</b>
            {ahead.uids.length === 1 ? ' criterion' : ' criteria'} ahead of “
            {step.name === '' ? step.element : step.name}”
            {ahead.uids.length > 0 && (
              <>
                {' '}
                across <b>{ahead.keys.length}</b>{' '}
                {ahead.keys.length === 1 ? 'definition' : 'definitions'}
              </>
            )}
            {ahead.uids.length === 0 && (
              <span className="hint">
                {' '}
                — nothing after this step can reject the unit.
              </span>
            )}
          </div>
        )}

        {current === null ? (
          <p className="hint">
            {table.length} {table.length === 1 ? 'definition' : 'definitions'} behind{' '}
            {table.reduce((n, row) => n + row.uses.length, 0)} evaluations. Select one to see
            where it is applied, and to light those steps on the canvas.
          </p>
        ) : (
          <div className="criteria-detail">
            <table className="attrs">
              <tbody>
                <tr>
                  <td className="k">{current.attr}</td>
                  <td className="v">{current.id}</td>
                </tr>
                <tr>
                  <td className="k">limits</td>
                  <td className="v empty">
                    {/* Q3. Blank would read as "no limits", which is the one
                        thing it certainly does not mean. */}
                    {current.limits ?? 'defined outside this file — not available here'}
                  </td>
                </tr>
                {current.members.length > 0 && (
                  <tr>
                    <td className="k">covers</td>
                    <td className="v">{current.members.join(', ')}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <h4>
              Applied at {current.uses.length}{' '}
              {current.uses.length === 1 ? 'step' : 'steps'}
            </h4>
            {current.uids.map((uid) => {
              const node = graph.nodes.get(uid);
              if (node === undefined) return null;
              return (
                <div key={uid} className="detail-row" onClick={() => onSelect(uid)}>
                  <span className={`dot kind-${node.kind}`} />
                  <span className="detail-name">
                    {node.name === '' ? node.element : node.name}
                  </span>
                  <span className="detail-path">{pathLabel(graph, uid)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
