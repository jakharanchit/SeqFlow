/**
 * App shell: toolbar, canvas, inspector, and the drop target.
 *
 * Loading is entirely local — a dropped file is read with FileReader and
 * parsed in the page. No server, no file dialog, no network (NFR-2).
 */

import { ReactFlowProvider, applyNodeChanges, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import rulesText from '../rules.yaml?raw';
import { ParseError, indexElements, parse } from './core/parse';
import { loadRules } from './core/rules';
import type { Graph, Warning } from './core/types';
import { toFlow, type FlowEdge, type FlowNode } from './emit/flow';
import { layout } from './layout/elk';
import type { LayoutMode } from './layout/elkGraph';
import { Canvas } from './ui/Canvas';
import { Inspector } from './ui/Inspector';
import './ui/styles.css';

const rules = loadRules(rulesText);

interface Loaded {
  graph: Graph;
  fileName: string;
  snippets: Map<string, string>;
  /** ELK positions, kept so Re-layout can restore them after dragging. */
  laidOut: FlowNode[];
  edges: FlowEdge[];
  elapsedMs: number;
}

/** Raw XML per node, for the inspector. Serialising is a UI concern. */
function snippetsFor(xml: string, graph: Graph): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const serializer = new XMLSerializer();
    for (const [uid, el] of indexElements(doc, rules)) {
      if (!graph.nodes.has(uid)) continue;
      out.set(uid, serializer.serializeToString(el));
    }
  } catch {
    // The inspector simply omits the snippet if serialisation fails.
  }
  return out;
}

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<LayoutMode>('grouped');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);

  // Guards against a slow layout from an earlier file landing after a newer one.
  const run = useRef(0);

  const load = useCallback(
    async (xml: string, fileName: string, layoutMode: LayoutMode): Promise<void> => {
      const ticket = ++run.current;
      setBusy(true);
      setError(null);
      setDismissed(false);
      try {
        const graph = parse(xml, { rules, domParser: new DOMParser() });
        const flow = toFlow(graph, rules);
        const placed = await layout(flow.nodes, flow.edges, layoutMode);
        if (ticket !== run.current) return;

        setLoaded({
          graph,
          fileName,
          snippets: snippetsFor(xml, graph),
          laidOut: placed.nodes,
          edges: flow.edges,
          elapsedMs: placed.elapsedMs,
        });
        setNodes(placed.nodes);
        setLayoutKey((k) => k + 1);
        setWarnings(graph.warnings);
        setSelected(null);
      } catch (err) {
        if (ticket !== run.current) return;
        const message =
          err instanceof ParseError || err instanceof Error
            ? err.message
            : 'could not read that file';
        setError(`${fileName}: ${message}`);
        setLoaded(null);
        setNodes([]);
        setWarnings([]);
      } finally {
        if (ticket === run.current) setBusy(false);
      }
    },
    [],
  );

  /* Drag and drop, anywhere on the page. */
  useEffect(() => {
    const over = (e: DragEvent): void => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files.item(0);
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        void load(String(reader.result ?? ''), file.name, mode);
      };
      reader.onerror = () => setError(`${file.name}: could not be read`);
      reader.readAsText(file);
    };

    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [load, mode]);

  const relayout = useCallback(
    async (next: LayoutMode): Promise<void> => {
      if (loaded === null) return;
      setBusy(true);
      setMode(next);
      const flow = toFlow(loaded.graph, rules);
      const placed = await layout(flow.nodes, flow.edges, next);
      setLoaded({ ...loaded, laidOut: placed.nodes, elapsedMs: placed.elapsedMs });
      setNodes(placed.nodes);
      setLayoutKey((k) => k + 1);
      setBusy(false);
    },
    [loaded],
  );

  const onNodesChange = useCallback((changes: unknown[]): void => {
    setNodes(
      (current) =>
        applyNodeChanges(changes as NodeChange[], current as never) as unknown as FlowNode[],
    );
  }, []);

  const graph = loaded?.graph ?? null;
  const showBanner = !dismissed && (error !== null || warnings.length > 0);

  return (
    <div className={`app${dragging ? ' dragging' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          seqviz<span>{loaded?.fileName ?? 'no file loaded'}</span>
        </div>
        <div className="spacer" />

        {graph !== null && (
          <div className="stat">
            <b>{graph.nodes.size}</b> nodes · <b>{graph.edges.length}</b> edges ·{' '}
            <b>{loaded?.elapsedMs ?? 0}</b> ms
          </div>
        )}

        <div className="segmented">
          <button
            type="button"
            aria-pressed={mode === 'grouped'}
            disabled={graph === null || busy}
            onClick={() => void relayout('grouped')}
            title="Draw each sequence as a labelled box"
          >
            Grouped
          </button>
          <button
            type="button"
            aria-pressed={mode === 'compact'}
            disabled={graph === null || busy}
            onClick={() => void relayout('compact')}
            title="Wrap the chain into columns; no sequence boxes"
          >
            Compact
          </button>
        </div>

        <button
          type="button"
          className="tool"
          disabled={graph === null || busy}
          onClick={() => void relayout(mode)}
          title="Discard manual positions and restore the automatic layout"
        >
          {busy ? 'Laying out…' : 'Re-layout'}
        </button>
      </header>

      {showBanner && (
        <div className={`banner ${error !== null ? 'error' : 'warn'}`}>
          <div className="body">
            {error !== null ? (
              <>
                <strong>Could not load that file.</strong> <code>{error}</code>
              </>
            ) : (
              <>
                <strong>
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                </strong>{' '}
                — every element still renders.
                <ul>
                  {warnings.slice(0, 40).map((w, i) => (
                    <li key={i}>
                      <code>{w.code}</code> {w.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button type="button" onClick={() => setDismissed(true)} title="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="panes">
        <div className="canvas-wrap">
          {graph === null ? (
            <div className="empty">
              <div className="dropzone">
                <h1>Drop a test sequence XML file here</h1>
                <p>
                  Everything runs in this page. Nothing is uploaded, and the tool never writes
                  back to your sequence.
                </p>
              </div>
              {busy && <p className="hint">Parsing…</p>}
            </div>
          ) : (
            <ReactFlowProvider>
              <Canvas
                nodes={nodes}
                edges={loaded?.edges ?? []}
                onNodesChange={onNodesChange}
                onSelect={setSelected}
                layoutKey={layoutKey}
              />
            </ReactFlowProvider>
          )}
        </div>

        <Inspector
          graph={graph}
          selected={selected}
          snippets={loaded?.snippets ?? new Map()}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}
