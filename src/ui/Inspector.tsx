/**
 * Reference material for the View tab: step-type counts, canvas shortcuts,
 * and the edge legend.
 *
 * This used to also export `StepDetails` — the panel docked under the outline
 * tree that showed a selected step's attributes, ancestry and raw XML. It's
 * gone: the tree's own Description/Log Start/Log Completion columns cover
 * what a reader needs while browsing, and this file now holds only the
 * reference material that was never about a selected step in the first place.
 */

import type { Graph } from '../core/types';
import { EDGE_COLOR } from '../emit/flow';

/** reason, label, dashed. Ordered by how often a reader meets them. */
const LEGEND: readonly (readonly [string, string, boolean])[] = [
  ['fallthrough', 'fall-through', false],
  ['branch', 'branch', false],
  ['criteria', 'criteria fail', true],
  ['goto', 'goto', false],
  ['loop', 'loop back', true],
];

/**
 * Reference material for the View tab: step-type counts, canvas shortcuts,
 * and the edge legend.
 */
export function CanvasHelp({ graph }: { graph: Graph }): React.JSX.Element {
  const counts = [...graph.nodes.values()].reduce<Record<string, number>>((acc, n) => {
    acc[n.element] = (acc[n.element] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="section">
        <h3>Step types</h3>
        <table className="attrs">
          <tbody>
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([element, n]) => (
                <tr key={element}>
                  <td className="k">{element}</td>
                  <td className="v">{n}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h3>Canvas</h3>
        <table className="attrs">
          <tbody>
            <tr>
              <td className="k">scroll</td>
              <td className="v">pan up and down</td>
            </tr>
            <tr>
              <td className="k">+ / −</td>
              <td className="v">zoom in / out</td>
            </tr>
            <tr>
              <td className="k">0 / 1</td>
              <td className="v">fit to view / 100%</td>
            </tr>
            <tr>
              <td className="k">double-click</td>
              <td className="v">collapse or expand a sequence</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section">
        <h3>Edges</h3>
        <div className="legend">
          {/*
            Colours come from the emitter's own map so the key cannot drift
            from the canvas. The dash is the rule file's choice per edge, not
            per reason; these are the styles those reasons actually carry.
          */}
          {LEGEND.map(([reason, label, dashed]) => (
            <span key={reason}>
              <i
                style={{
                  borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${EDGE_COLOR[reason]}`,
                }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
