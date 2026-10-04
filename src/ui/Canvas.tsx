/**
 * The canvas. React Flow with minimap, controls, pan, zoom and fit-to-view.
 *
 * Node positions are component state: dragging a node moves it, and Re-layout
 * puts everything back where ELK had it. Nothing here writes to the sequence
 * file — the tool is read-only (NFR-4).
 */

import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  PanOnScrollMode,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ZoomMode } from '../bridge/protocol';
import { EDGE_COLOR, type FlowEdge, type FlowNode, type FlowNodeData } from '../emit/flow';
import { fitZoom, graphBounds, type Point } from '../layout/elkGraph';
import { Icon } from './Icon';
import { RouteContext, edgeTypes } from './edges';
import { nodeTypes } from './nodes';

/**
 * A request to bring a node into view, from the outline or the search results.
 * `seq` makes a repeat click on the same row a fresh request.
 */
export interface FocusRequest {
  uid: string;
  seq: number;
}

/** The visible part of the diagram, in flow coordinates, and the zoom it is
 * shown at. What a viewport export crops to. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

/** How long the copy button shows its result before going back to the icon. */
const COPY_FEEDBACK_MS = 1500;

/** Below this scale, step labels are unreadable and are not drawn. */
const FAR_SCALE = 0.25;

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.5;
const FIT_PADDING = 0.06;
/** Screen px between the pane's top and the diagram's, in `top` zoom mode. */
const TOP_GAP = 24;

/**
 * Retry rather than firing once and hoping. A large file finishes its layout
 * while the pane is still being measured, and a move that no-ops there leaves
 * the reader looking at blank canvas with no clue a graph was drawn.
 *
 * On a timer and *not* on requestAnimationFrame. Frames do not run in a hidden
 * or throttled pane, which is precisely when the pane also measures zero and
 * the retry is most needed: rAF here means one attempt, silently, forever.
 * Returns the cleanup.
 */
function retry(attemptOnce: () => boolean): () => void {
  let attempts = 0;
  let id = 0;
  const attempt = (): void => {
    if (attemptOnce()) return;
    if (++attempts > 40) return;
    id = window.setTimeout(attempt, 50);
  };
  id = window.setTimeout(attempt, 60);
  return () => window.clearTimeout(id);
}

/**
 * Slack around the diagram, in flow units, beyond which panning stops.
 *
 * Without a `translateExtent` React Flow pans forever, and an 8900 px column is
 * easy to lose off the edge of an empty canvas with nothing but the fit button
 * to get back. The margin has to be at least half a viewport or a node at the
 * extreme edge could never be brought to the centre, so it is measured from the
 * pane rather than being a constant — with a floor for the case where the pane
 * has not been measured yet.
 *
 * It is a margin at zoom 1. Zoomed in, half a viewport is *fewer* flow units,
 * so this is more than enough; zoomed out, more of the graph is on screen and
 * React Flow clamps the pan to the extent on its own.
 */
const MIN_PAN_MARGIN = 400;

const KIND_COLOR: Record<string, string> = {
  action: '#1264a3',
  decision: '#9a6a00',
  criteria: '#a52a1f',
  jump: '#6b3fa0',
  container: '#a8a8a8',
};

export interface CanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /**
   * ELK's orthogonal routes, by edge id. The canvas draws these rather than
   * letting React Flow invent a path, which is what keeps it agreeing with the
   * SVG export. Empty means every edge falls back to a smoothstep curve.
   */
  routes: ReadonlyMap<string, Point[]>;
  onNodesChange: (changes: unknown[]) => void;
  onSelect: (uid: string | null) => void;
  /** Collapse or expand a sequence. Double-clicking one is the canvas gesture. */
  onToggle: (uid: string) => void;
  /** Bumped whenever a fresh layout lands, to place the view per `zoomMode`. */
  layoutKey: number;
  /** What a fresh layout does to the viewport — see `ZoomMode`. */
  zoomMode: ZoomMode;
  /**
   * Anything whose change should re-fit the viewport without re-laying out —
   * today, the view mode. Going from flowchart-only back to both halves this
   * pane's width, and a fit computed for the wider one leaves the diagram
   * centred off the right-hand edge: a blank canvas, the failure `fitAll`
   * exists to catch. A *resize* deliberately does not refit — dragging the
   * seam would fight the reader's zoom on every pixel — so it is the mode
   * change, not the size change, that is the signal.
   */
  refitOn: string;
  /** Centre on this node. Null after a canvas click, which must not re-centre. */
  focus: FocusRequest | null;
  showMinimap: boolean;
  onShowMinimap: (on: boolean) => void;
  /** The canvas fills this with a reader of its visible rectangle. */
  viewportRef: React.MutableRefObject<(() => ViewportRect | null) | null>;
  /** Copy the viewport to the clipboard. Called inside the click. */
  onCopy: () => Promise<void>;
}

export function Canvas({
  nodes,
  edges,
  routes,
  onNodesChange,
  onSelect,
  onToggle,
  layoutKey,
  zoomMode,
  refitOn,
  focus,
  showMinimap,
  onShowMinimap,
  viewportRef,
  onCopy,
}: CanvasProps): React.JSX.Element {
  const flow = useReactFlow();

  /**
   * Semantic zoom (task 9). Below a quarter scale a step label is a grey
   * smudge, so the labels go and only sequence titles remain — enlarged
   * inversely with the zoom so they stay the same size on screen.
   *
   * The selector returns a boolean, so React re-renders only when the
   * threshold is crossed, and `--zoom` is written straight to the DOM on every
   * move without a render at all. Nothing here recomputes layout: this is a
   * render concern only.
   */
  const far = useStore((s) => s.transform[2] < FAR_SCALE);
  const wrap = useRef<HTMLDivElement>(null);

  const setZoomVar = useCallback((zoom: number): void => {
    wrap.current?.style.setProperty('--zoom', String(Math.max(zoom, 0.02)));
  }, []);

  useEffect(() => {
    setZoomVar(flow.getZoom());
  }, [layoutKey, flow, setZoomVar]);

  /**
   * Positions move wholesale on re-layout; refit rather than leaving the reader
   * looking at empty canvas.
   *
   * The fit is computed from ELK's own geometry rather than delegated to
   * `fitView`. `fitView` needs React Flow's DOM measurement of every node,
   * which arrives a beat after the nodes render and never arrives at all where
   * ResizeObserver is throttled — and it fails silently, leaving the graph at
   * scale 1 off the top-left corner. Our node boxes already carry exact sizes
   * from the layout pass, so there is nothing to wait for.
   */
  /**
   * The pane's size in CSS pixels, tracked so the pan margin can be half of it.
   * Only the margin depends on this, so a resize that changes nothing visible
   * costs one state write and no layout.
   */
  const [pane, setPane] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const measure = (): void =>
      setPane((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** React Flow's transform is relative to this same box: screen = flow * zoom + (x, y). */
  useEffect(() => {
    viewportRef.current = () => {
      const el = wrap.current;
      if (el === null || el.clientWidth <= 0 || el.clientHeight <= 0) return null;
      const { x, y, zoom } = flow.getViewport();
      return { x: -x / zoom, y: -y / zoom, width: el.clientWidth / zoom, height: el.clientHeight / zoom, zoom };
    };
    return () => {
      viewportRef.current = null;
    };
  }, [flow, viewportRef]);

  /** The copy button says how it went; a clipboard refusal is never silent. */
  const [copied, setCopied] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const id = window.setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = (): void => {
    onCopy().then(
      () => setCopied({ ok: true, message: 'Copied' }),
      (err: unknown) => setCopied({ ok: false, message: `Copy failed: ${err instanceof Error ? err.message : String(err)}` }),
    );
  };

  /**
   * How far the canvas may be dragged: the diagram's own bounds plus enough
   * slack to bring any edge of it to the middle of the pane.
   *
   * Measured from ELK's geometry via `graphBounds`, the same source the fit
   * uses, so the two can never disagree about where the diagram is.
   */
  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    const box = graphBounds(nodes);
    if (box === null) return [[-Infinity, -Infinity], [Infinity, Infinity]];
    const mx = Math.max(MIN_PAN_MARGIN, pane.width / 2);
    const my = Math.max(MIN_PAN_MARGIN, pane.height / 2);
    return [
      [box.x - mx, box.y - my],
      [box.x + box.width + mx, box.y + box.height + my],
    ];
  }, [nodes, pane]);

  /**
   * Returns false when there was nothing to fit *yet* — no nodes, or a pane the
   * browser has not measured. The caller retries.
   *
   * That return value is the whole point. `fitZoom` falls back to a zoom of 1
   * on a zero-sized pane, and a silent scale-1 fit leaves a 27 000 px graph
   * off the corner of the screen looking like an empty canvas. It is the same
   * failure React Flow's own `fitView` has — which is why this function exists
   * — and it turns out our replacement could reach it too, on a big file where
   * the layout lands before the pane has settled.
   */
  const fitAll = useCallback((): boolean => {
    const box = graphBounds(nodes);
    const el = wrap.current;
    if (box === null || el === null) return false;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return false;

    const zoom = fitZoom(box, width, height, FIT_PADDING, MIN_ZOOM, MAX_ZOOM);
    void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration: 0 });

    // Check the move actually happened rather than trusting the call.
    //
    // `setCenter` is a no-op until React Flow has built its pan/zoom handler,
    // and it reports nothing when it declines — so on a big file, where the
    // layout lands early, the viewport stays at the identity transform and the
    // reader gets a blank canvas. Reading the zoom back is the only way to
    // know. `translateExtent` can shift the *translation* afterwards, which is
    // correct and expected, so only the zoom is compared.
    if (Math.abs(flow.getZoom() - zoom) > 1e-6) return false;

    setZoomVar(zoom);
    return true;
  }, [nodes, flow, setZoomVar]);

  /**
   * Where a fresh layout leaves the viewport. `fit` is `fitAll`; `top` and
   * `centre` keep the reader's zoom and move to the diagram's first step or
   * its middle; `keep` does nothing. Returns false when it could not act yet,
   * like `fitAll` — here judged by `viewportInitialized` rather than a zoom
   * read-back, because a move that keeps the zoom proves nothing by it.
   */
  const placeView = useCallback(
    (mode: ZoomMode): boolean => {
      if (mode === 'fit') return fitAll();
      if (mode === 'keep') return true;
      const box = graphBounds(nodes);
      const el = wrap.current;
      if (box === null || el === null || !flow.viewportInitialized) return false;
      if (el.clientWidth <= 0 || el.clientHeight <= 0) return false;
      const zoom = flow.getZoom();
      const x = box.x + box.width / 2;
      // `top`: the diagram's top edge a small gap below the pane's.
      const y =
        mode === 'top'
          ? box.y + (el.clientHeight / 2 - TOP_GAP) / zoom
          : box.y + box.height / 2;
      void flow.setCenter(x, y, { zoom, duration: 0 });
      return true;
    },
    [nodes, flow, fitAll],
  );

  /*
   * Read through refs: `fitAll` and `placeView` change identity whenever the
   * node array does — and selecting a node emits a change, so depending on
   * them here meant every click zoomed the graph back out. The mode is a ref
   * too, so changing it acts on the next layout rather than moving the view.
   */
  const latestFit = useRef(fitAll);
  const latestPlace = useRef(placeView);
  const zoomModeRef = useRef(zoomMode);
  useEffect(() => {
    latestFit.current = fitAll;
    latestPlace.current = placeView;
    zoomModeRef.current = zoomMode;
  }, [fitAll, placeView, zoomMode]);

  /*
   * A pane that had no size and now has one gets the fit it missed.
   *
   * The retry below gives up after a couple of seconds, which is right — it
   * must not spin forever — but a pane can be unmeasurable for much longer
   * than that: a collapsed split, a hidden tab, a window restored from
   * minimised. Refitting on the transition costs nothing and is the difference
   * between a graph and an apparently empty canvas.
   */
  const hadSize = useRef(false);
  useEffect(() => {
    const measured = pane.width > 0 && pane.height > 0;
    const appeared = measured && !hadSize.current;
    hadSize.current = measured;
    if (appeared && layoutKey > 0) latestFit.current();
  }, [pane, layoutKey]);

  /* A fresh layout — load, re-parse, collapse, expand — places the view. */
  useEffect(() => {
    if (layoutKey === 0) return;
    return retry(() => latestPlace.current(zoomModeRef.current));
  }, [layoutKey]);

  /* A view-mode change always fits: it is a blank-canvas guard, not a load. */
  useEffect(() => {
    if (layoutKey === 0) return;
    return retry(() => latestFit.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refitOn is the trigger
  }, [refitOn]);

  /**
   * Centring waits a beat: a focus request often arrives in the same commit as
   * a collapse toggle, and the node is only placed once layout lands.
   *
   * `setCenter` rather than `fitView({ nodes })`: the latter leaves the
   * viewport where it is once a fit has already happened, and this must move
   * every time. Zoom is nudged up only when it is too far out to read, so
   * clicking down the outline does not keep resetting the reader's zoom.
   */
  useEffect(() => {
    if (focus === null) return;
    const id = window.setTimeout(() => {
      const node = flow.getNode(focus.uid);
      if (node === undefined) return;

      // Positions are parent-relative for a node inside a group; walk up.
      let x = 0;
      let y = 0;
      let cursor: typeof node | undefined = node;
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        x += cursor.position.x;
        y += cursor.position.y;
        cursor = cursor.parentId === undefined ? undefined : flow.getNode(cursor.parentId);
      }

      const width = node.measured?.width ?? node.width ?? 0;
      const height = node.measured?.height ?? node.height ?? 0;
      // Instant, not animated. An animated pan is driven by requestAnimationFrame
      // and silently does nothing wherever those frames are throttled; it is also
      // sluggish when clicking down a list of 133 rows.
      void flow.setCenter(x + width / 2, y + height / 2, {
        zoom: Math.max(flow.getZoom(), 0.75),
        duration: 0,
      });
    }, 90);
    return () => window.clearTimeout(id);
  }, [focus, flow, layoutKey]);

  /**
   * Keyboard zoom. The wheel pans this canvas — a 8900 px column is scrolled
   * far more often than it is zoomed — so zoom needs its own gesture.
   *
   * Unmodified keys, as in every canvas tool: ctrl/cmd variants are the
   * browser's own zoom and are left alone. Typing in the search box is not a
   * shortcut, so anything with a focused field bails out.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return;

      switch (e.key) {
        case '+':
        case '=':
          flow.zoomIn({ duration: 0 });
          break;
        case '-':
        case '_':
          flow.zoomOut({ duration: 0 });
          break;
        case '0':
          latestFit.current();
          return;
        case '1':
          void flow.zoomTo(1, { duration: 0 });
          break;
        default:
          return;
      }
      e.preventDefault();
      setZoomVar(flow.getZoom());
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow, setZoomVar]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onSelect(node.id);
  };

  // Double-click is the canvas equivalent of the outline twisty. Harmless on a
  // leaf: the app only knows how to toggle containers.
  const handleNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    const data = node.data as unknown as FlowNodeData;
    if (data.kind === 'container') onToggle(node.id);
  };

  return (
    <div className={`canvas${far ? ' far' : ''}`} ref={wrap}>
      <RouteContext.Provider value={routes}>
      <ReactFlow
        nodes={nodes as unknown as Node[]}
        edges={edges as unknown as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange as never}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => onSelect(null)}
        onMove={(_event, viewport) => setZoomVar(viewport.zoom)}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        // The wheel scrolls the graph; zoom is on +/- and the controls. Ctrl or
        // pinch still zooms, which is what a trackpad user reaches for.
        zoomOnScroll={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        // Double-click toggles a sequence here, so it must not also zoom.
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Panning stops at the edge of the diagram. Zooming is not bounded by
        // this: MIN_ZOOM still pulls back far enough to see the whole column.
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'routed' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d8d8d8" />
        {/*
          * All five buttons are ours. React Flow's built-in zoom and fit
          * buttons carry their own inline SVGs, which are not reachable from
          * `src/` and so could not be brought onto the app's icon set — with
          * the minimap button beside them the row read as two icon sets in
          * one control. The fit button still uses the computed fit
          * (`fitAll`), not React Flow's DOM-measured one.
          */}
        <Controls showZoom={false} showFitView={false} showInteractive={false}>
          <ControlButton
            onClick={() => flow.zoomIn({ duration: 0 })}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Icon name="add" />
          </ControlButton>
          <ControlButton
            onClick={() => flow.zoomOut({ duration: 0 })}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Icon name="remove" />
          </ControlButton>
          <ControlButton onClick={fitAll} title="Fit the whole diagram" aria-label="Fit view">
            <Icon name="fit_screen" />
          </ControlButton>
          <ControlButton
            onClick={() => onShowMinimap(!showMinimap)}
            title={showMinimap ? 'Hide the minimap' : 'Show the minimap'}
            aria-pressed={showMinimap}
            className={showMinimap ? 'minimap-toggle on' : 'minimap-toggle'}
          >
            <Icon name="map" />
          </ControlButton>
          <ControlButton
            onClick={copy}
            title={copied?.message ?? 'Copy what is on screen as an image'}
            aria-label="Copy view as image"
            className={copied === null ? 'copy-view' : copied.ok ? 'copy-view ok' : 'copy-view fail'}
          >
            <Icon name={copied === null ? 'content_copy' : copied.ok ? 'check' : 'close'} />
          </ControlButton>
        </Controls>
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(0,0,0,0.08)"
            nodeColor={(n) => {
              const data = n.data as unknown as FlowNodeData;
              return KIND_COLOR[data.kind] ?? EDGE_COLOR['fallthrough']!;
            }}
          />
        )}
      </ReactFlow>
      </RouteContext.Provider>
    </div>
  );
}
