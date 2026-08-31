/**
 * The canvas edge, drawn along ELK's own orthogonal route.
 *
 * React Flow's built-in edges route themselves: `smoothstep` draws handle to
 * handle and knows nothing about what lies between. On a flowchart that is
 * mostly one long column, a jump over a whole sequence therefore came out as a
 * straight vertical line down the middle of every node it skipped — the false
 * branch on the gas-analyzer fixture ran 1103 px at a constant x, straight
 * through eleven steps. ELK had already routed the same edge out to the side
 * and back, and the SVG export had been drawing that route all along, so the
 * picture on screen and the picture in the export disagreed about the one
 * thing a flowchart is for.
 *
 * This closes that: the canvas draws exactly what the export draws.
 *
 * The route is looked up from context rather than carried on each edge object.
 * `FlowEdge` belongs to the emitter, which is pure and Node-testable and has no
 * business holding layout geometry, and the alternative meant copying a point
 * array onto every edge on every re-render for the sake of a value that
 * changes only when a layout lands.
 */

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { createContext, useContext } from 'react';

import type { Point } from '../layout/elkGraph';

/**
 * Edge id -> ELK's polyline, in absolute flow coordinates.
 *
 * Empty is the meaningful default: with no routes every edge falls back to
 * `smoothstep`, which is what should happen before the first layout lands and
 * after a node has been dragged away from the arrangement ELK computed.
 */
export const RouteContext = createContext<ReadonlyMap<string, Point[]>>(new Map());

/** `12.5,80 12.5,96 …` — an SVG path along the route, corners left sharp. */
function polyline(points: readonly Point[]): string {
  const [head, ...rest] = points;
  if (head === undefined) return '';
  return `M${head.x},${head.y}` + rest.map((p) => `L${p.x},${p.y}`).join('');
}

export function RoutedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
}: EdgeProps): React.JSX.Element {
  const routes = useContext(RouteContext);
  const points = routes.get(id);

  let path: string;
  let labelAt: Point;

  if (points !== undefined && points.length > 1) {
    path = polyline(points);
    // The midpoint of the polyline, not of the straight line between the ends:
    // on a route that goes out to the side and back, those are far apart and
    // the second one lands on top of whatever the edge was routed around.
    labelAt = points[Math.floor(points.length / 2)] ?? points[0]!;
  } else {
    // No route: before the first layout, or after a drag has moved a node out
    // from under the one ELK computed. React Flow's own path is then the only
    // one that still joins the two nodes.
    const [d, cx, cy] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = d;
    labelAt = { x: cx, y: cy };
  }

  return (
    <>
      {/* `exactOptionalPropertyTypes` will not pass an explicit undefined. */}
      <BaseEdge
        id={id}
        path={path}
        {...(style === undefined ? {} : { style })}
        {...(markerEnd === undefined ? {} : { markerEnd })}
      />
      {label !== undefined && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            data-source={source}
            data-target={target}
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { routed: RoutedEdge };
