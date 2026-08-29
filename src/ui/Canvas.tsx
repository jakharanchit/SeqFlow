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
import { useCallback, useEffect, useRef } from 'react';

import { EDGE_COLOR, type FlowEdge, type FlowNode, type FlowNodeData } from '../emit/flow';
import { fitZoom, graphBounds } from '../layout/elkGraph';
import { nodeTypes } from './nodes';

/**
 * A request to bring a node into view, from the outline or the search results.
 * `seq` makes a repeat click on the same row a fresh request.
 */
export interface FocusRequest {
  uid: string;
  seq: number;
}

/** Below this scale, step labels are unreadable and are not drawn. */
const FAR_SCALE = 0.25;

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.5;
const FIT_PADDING = 0.06;

const KIND_COLOR: Record<string, string> = {
  action: '#3c86c9',
  decision: '#c98f2e',
  criteria: '#cf5b52',
  jump: '#9a6bd0',
  container: '#2a313d',
};

export interface CanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: (changes: unknown[]) => void;
  onSelect: (uid: string | null) => void;
  /** Collapse or expand a sequence. Double-clicking one is the canvas gesture. */
  onToggle: (uid: string) => void;
  /** Bumped whenever a fresh layout lands, to refit the view. */
  layoutKey: number;
  /** Centre on this node. Null after a canvas click, which must not re-centre. */
  focus: FocusRequest | null;
}

export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onSelect,
  onToggle,
  layoutKey,
  focus,
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
  const fitAll = useCallback((): void => {
    const box = graphBounds(nodes);
    const el = wrap.current;
    if (box === null || el === null) return;
    const zoom = fitZoom(box, el.clientWidth, el.clientHeight, FIT_PADDING, MIN_ZOOM, MAX_ZOOM);
    void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration: 0 });
    setZoomVar(zoom);
  }, [nodes, flow, setZoomVar]);

  /*
   * Only a fresh layout refits. `fitAll` changes identity whenever the node
   * array does — and selecting a node emits a change, so depending on it here
   * meant every click zoomed the graph back out.
   */
  const latestFit = useRef(fitAll);
  useEffect(() => {
    latestFit.current = fitAll;
  }, [fitAll]);

  useEffect(() => {
    if (layoutKey === 0) return;
    const id = window.setTimeout(() => latestFit.current(), 60);
    return () => window.clearTimeout(id);
  }, [layoutKey]);

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
      <ReactFlow
        nodes={nodes as unknown as Node[]}
        edges={edges as unknown as Edge[]}
        nodeTypes={nodeTypes}
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
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#252b36" />
        {/* The fit button uses the same computed fit, not React Flow's. */}
        <Controls showInteractive={false} onFitView={fitAll} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(10,12,16,0.72)"
          nodeColor={(n) => {
            const data = n.data as unknown as FlowNodeData;
            return KIND_COLOR[data.kind] ?? EDGE_COLOR['fallthrough']!;
          }}
        />
      </ReactFlow>
    </div>
  );
}
