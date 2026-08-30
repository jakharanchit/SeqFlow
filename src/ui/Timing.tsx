/**
 * Timing tab — Phase 4 task 3. Spec 7.6.
 *
 * Two numbers, always both, and a sentence saying which is which. The fixture's
 * ratio is 41: a reader shown "2 minutes" alone will plan a shift around it,
 * and a reader shown "82 minutes" alone will think the test is an hour and a
 * half of waiting when it is two minutes of waiting and eighty of watching.
 *
 * Nothing here is a measurement, and the panel says so in words rather than
 * relying on the reader to infer it from a tilde.
 */

import { humanRange, humanSeconds, type DurationReport, type Offset } from '../core/duration';
import type { Graph } from '../core/types';

export interface TimingProps {
  graph: Graph;
  report: DurationReport;
  /** The selected step, and where it sits. Null with no selection. */
  selected: string | null;
  offset: Offset | null;
  terminals: number;
}

export function Timing({
  graph,
  report,
  selected,
  offset,
  terminals,
}: TimingProps): React.JSX.Element {
  const step = selected === null ? undefined : graph.nodes.get(selected);

  if (!report.timed) {
    return (
      <div className="drawer-list wide">
        <p className="hint">
          No timed waits. Nothing in this file carries a{' '}
          <code>{report.waitAttrs.join(' / ') || 'duration'}</code> or a non-zero{' '}
          <code>{report.timeoutAttrs.join(' / ') || 'timeout'}</code>, so there is no duration
          to estimate — which is not the same as an estimate of zero.
        </p>
      </div>
    );
  }

  return (
    <div className="drawer-list wide timing">
      <div className="timing-headline">
        <div className="timing-figure">
          <span className="timing-label">Nominal</span>
          <b>{humanSeconds(report.nominal.max)}</b>
          <span className="timing-note">
            {report.waitSteps} timed {report.waitSteps === 1 ? 'wait' : 'waits'} on the longest
            route
          </span>
        </div>
        <div className="timing-figure worst">
          <span className="timing-label">Worst case</span>
          <b>{humanSeconds(report.worst.max)}</b>
          <span className="timing-note">
            plus {humanSeconds(report.pollingSeconds)} of polling across {report.pollingSteps}{' '}
            {report.pollingSteps === 1 ? 'step' : 'steps'}
          </span>
        </div>
        <div className="timing-figure ratio">
          <span className="timing-label">Ratio</span>
          <b>{Number.isFinite(report.ratio) ? `${round(report.ratio)}×` : '—'}</b>
          <span className="timing-note">
            {Math.round((report.pollingSeconds / report.worst.max) * 100)}% of the worst case is
            polling
          </span>
        </div>
      </div>

      <p className="timing-caveat">
        <b>An estimate, not a measurement.</b> It is the sum of the declared waits along a
        route, and it counts no execution time, no instrument settling and no operator. The
        worst case assumes every polling step runs to its full timeout, which no passing unit
        does — and the two figures are {round(report.ratio)}× apart, which is why neither is
        shown without the other.
      </p>

      <table className="attrs timing-table">
        <tbody>
          <tr>
            <td className="k">across routes</td>
            <td className="v">
              nominal {humanRange(report.nominal)} · worst {humanRange(report.worst)}
            </td>
          </tr>
          <tr>
            <td className="k">routes counted</td>
            <td className="v">
              {report.paths} distinct entry-to-terminal {report.paths === 1 ? 'path' : 'paths'},
              ending at {terminals} {terminals === 1 ? 'terminal' : 'terminals'}
              {report.cyclic && ' — the graph has a cycle, so this is a lower bound'}
            </td>
          </tr>
          <tr>
            <td className="k">waits</td>
            <td className="v">
              {report.waitSteps} × <code>{report.waitAttrs.join(', ')}</code>, total{' '}
              {humanSeconds(report.waitSeconds)}
            </td>
          </tr>
          <tr>
            <td className="k">polling</td>
            <td className="v">
              {report.pollingSteps} × non-zero <code>{report.timeoutAttrs.join(', ')}</code>,
              total {humanSeconds(report.pollingSeconds)}
            </td>
          </tr>
        </tbody>
      </table>

      {step !== undefined && offset !== null && (
        <>
          <h4>“{step.name === '' ? step.element : step.name}”</h4>
          {offset.unreachable ? (
            <p className="hint">
              The flow cannot reach this step from the entry, so it has no offset.
            </p>
          ) : (
            <table className="attrs timing-table">
              <tbody>
                <tr>
                  <td className="k">reached after</td>
                  <td className="v">
                    {humanRange(offset.nominal)} nominal · {humanRange(offset.worst)} worst case
                  </td>
                </tr>
                <tr>
                  <td className="k">remaining</td>
                  <td className="v">{humanRange(offset.remaining)} nominal after it</td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}
