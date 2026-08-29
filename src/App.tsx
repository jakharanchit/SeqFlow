/**
 * App shell: toolbar, outline, canvas, inspector, and the drop target.
 *
 * Loading is entirely local — a dropped file is read with FileReader and
 * parsed in the page. No server, no file dialog, no network (NFR-2).
 *
 * One selected uid lives here and three views render it: the outline row, the
 * canvas node, the inspector panel. Collapse is the same story — one set of
 * container uids, honoured by the outline and by the layout.
 */

import { ReactFlowProvider, applyNodeChanges, type NodeChange } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import rulesText from '../rules.yaml?raw';
import { ParseError, indexElements, parse } from './core/parse';
import { loadRules } from './core/rules';
import type { Graph, Warning } from './core/types';
import { ancestorUids } from './core/ancestry';
import { pathSet } from './core/paths';
import { elementCounts, isActive, matchSet, search } from './core/search';
import { nodesFor, signalIndex, signalRows } from './core/signals';
import { compare, similarGroups } from './core/similarity';
import { asGraph, visibleGraph } from './emit/collapse';
import { toFlow, type FlowEdge, type FlowNode } from './emit/flow';
import { layout } from './layout/elk';
import type { LayoutMode } from './layout/elkGraph';
import { Canvas, type FocusRequest } from './ui/Canvas';
import { Drawer, type DrawerTab } from './ui/Drawer';
import { Inspector } from './ui/Inspector';
import { Outline } from './ui/Outline';
import './ui/styles.css';

const rules = loadRules(rulesText);

interface Loaded {
  graph: Graph;
  fileName: string;
  snippets: Map<string, string>;
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

const NO_COLLAPSE: ReadonlySet<string> = new Set();

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [mode, setMode] = useState<LayoutMode>('grouped');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [text, setText] = useState('');
  const [elements, setElements] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [trace, setTrace] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('signals');
  const [signal, setSignal] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(0);

  // Guards against a slow layout from an earlier file or toggle landing after
  // a newer one.
  const run = useRef(0);
  const focusSeq = useRef(0);

  const graph = loaded?.graph ?? null;

  /** The graph as the canvas currently shows it: collapsed sequences folded. */
  const view = useMemo(
    () => (graph === null ? null : visibleGraph(graph, collapsed)),
    [graph, collapsed],
  );

  const query = useMemo(() => ({ text, elements }), [text, elements]);
  const searching = isActive(query);
  const results = useMemo(
    () => (graph === null || !searching ? [] : search(graph, query)),
    [graph, query, searching],
  );
  const available = useMemo(() => (graph === null ? [] : elementCounts(graph)), [graph]);

  const index = useMemo(
    () => (graph === null ? new Map<string, never[]>() : signalIndex(graph, rules)),
    [graph],
  );
  const signals = useMemo(() => signalRows(index), [index]);

  /**
   * Structurally identical sibling sequences. On the fixture this is one group:
   * the four Pulses, 112 of the 133 nodes, differing in eight attributes.
   */
  const repeats = useMemo(() => (graph === null ? [] : similarGroups(graph)), [graph]);
  const comparison = useMemo(() => {
    const group = repeats[repeat];
    if (graph === null || group === undefined) return null;
    return compare(graph, group.members);
  }, [graph, repeats, repeat]);

  /**
   * Layout runs whenever the visible graph or the mode changes — a collapse
   * toggle produces a different graph, so it needs a fresh arrangement.
   */
  useEffect(() => {
    if (graph === null || view === null) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const ticket = ++run.current;
    setBusy(true);

    const flow = toFlow(asGraph(graph, view), rules, {
      collapsedCounts: view.collapsedCounts,
    });
    void layout(flow.nodes, flow.edges, mode)
      .then((placed) => {
        if (ticket !== run.current) return;
        setNodes(placed.nodes);
        setEdges(flow.edges);
        setElapsedMs(placed.elapsedMs);
        setLayoutKey((k) => k + 1);
      })
      .catch((err: unknown) => {
        if (ticket !== run.current) return;
        setError(`layout failed — ${(err as Error).message}`);
      })
      .finally(() => {
        if (ticket === run.current) setBusy(false);
      });
  }, [graph, view, mode]);

  const load = useCallback((xml: string, fileName: string): void => {
    setBusy(true);
    setError(null);
    setDismissed(false);
    try {
      const parsed = parse(xml, { rules, domParser: new DOMParser() });
      setLoaded({ graph: parsed, fileName, snippets: snippetsFor(xml, parsed) });
      setCollapsed(NO_COLLAPSE);
      setWarnings(parsed.warnings);
      setSelected(null);
      setFocus(null);
      setSignal(null);
      setRepeat(0);
      // A warning has to be seen. The drawer opens itself rather than relying
      // on a banner the reader can dismiss and never look at again.
      if (parsed.warnings.length > 0) {
        setDrawerTab('warnings');
        setDrawerOpen(true);
      }
    } catch (err) {
      const message =
        err instanceof ParseError || err instanceof Error
          ? err.message
          : 'could not read that file';
      setError(`${fileName}: ${message}`);
      setLoaded(null);
      setWarnings([]);
      setBusy(false);
    }
  }, []);

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
        load(String(reader.result ?? ''), file.name);
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
  }, [load]);

  /**
   * Select, expand whatever is hiding it, and bring it into view. A search hit
   * inside a collapsed sequence has to reveal itself or the click does nothing
   * visible. Canvas clicks select without re-centring, so they call setSelected
   * directly instead.
   */
  const reveal = useCallback(
    (uid: string): void => {
      setSelected(uid);
      if (graph !== null) {
        const chain = ancestorUids(graph, uid);
        setCollapsed((current) => {
          if (![...chain].some((a) => current.has(a))) return current;
          const next = new Set(current);
          for (const a of chain) next.delete(a);
          return next;
        });
      }
      setFocus({ uid, seq: ++focusSeq.current });
    },
    [graph],
  );

  const toggle = useCallback((uid: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(uid)) next.add(uid);
      return next;
    });
  }, []);

  const collapseAll = useCallback((): void => {
    if (graph === null) return;
    // The outermost sequence stays open; collapsing it would hide the file.
    setCollapsed(
      new Set(
        [...graph.containers.keys()].filter((uid) => graph.nodes.get(uid)?.parent !== null),
      ),
    );
  }, [graph]);

  const expandAll = useCallback((): void => setCollapsed(NO_COLLAPSE), []);

  const relayout = useCallback((): void => setLayoutKey((k) => k + 1), []);

  const onNodesChange = useCallback((changes: unknown[]): void => {
    setNodes(
      (current) =>
        applyNodeChanges(changes as NodeChange[], current as never) as unknown as FlowNode[],
    );
  }, []);

  /**
   * Path highlighting — spec 7.3. Computed on the *full* graph and then lifted
   * through the collapse view, so the highlight survives a collapse toggle: the
   * 16 criteria steps that reach the abort still light up their Pulse when the
   * Pulse is folded shut.
   */
  const highlight = useMemo(() => {
    if (graph === null || view === null || selected === null || !trace) return null;
    const subject = view.lifted.get(selected) ?? selected;
    const set = pathSet(graph, selected);
    const lift = (uid: string): string => view.lifted.get(uid) ?? uid;
    return {
      nodes: new Set([subject, ...[...set.nodes].map(lift)]),
      edges: new Set(
        set.edges
          .map((e) => `${lift(e.src)}|${e.reason}|${lift(e.dst)}`)
          .filter((key) => {
            const [src, , dst] = key.split('|');
            return src !== dst;
          }),
      ),
    };
  }, [graph, view, selected, trace]);

  /** Search matches, lifted the same way so a hit inside a fold still reads. */
  const matches = useMemo(() => {
    if (view === null || !searching) return null;
    const raw = matchSet(results);
    return new Set([...raw].map((uid) => view.lifted.get(uid) ?? uid));
  }, [view, searching, results]);

  /** The steps touching the signal picked in the drawer. */
  const spotlight = useMemo(() => {
    if (view === null || signal === null) return null;
    return new Set([...nodesFor(index, signal)].map((uid) => view.lifted.get(uid) ?? uid));
  }, [view, signal, index]);

  /* Selection is app state; React Flow is told about it rather than owning it. */
  const renderNodes = useMemo(
    () =>
      nodes.map((n) => {
        // Group boxes are scaffolding, not steps: they never carry flow, so
        // they are never "on a path" and dimming them would delete exactly the
        // context that makes a highlight readable. A *collapsed* sequence is a
        // seqNode, not a group, and dims and highlights like any other node.
        const isGroup = n.type === 'seqGroup';
        const dim =
          !isGroup &&
          ((matches !== null && !matches.has(n.id)) ||
            (spotlight !== null && !spotlight.has(n.id)) ||
            (highlight !== null && !highlight.nodes.has(n.id)));
        const onPath = !isGroup && highlight !== null && highlight.nodes.has(n.id);
        const className = [dim ? 'dimmed' : '', onPath ? 'on-path' : ''].filter(Boolean).join(' ');
        const isSelected = n.id === selected;
        if (n.selected === isSelected && (n.className ?? '') === className) return n;
        return { ...n, selected: isSelected, className };
      }),
    [nodes, selected, matches, spotlight, highlight],
  );

  const renderEdges = useMemo(
    () =>
      edges.map((e) => {
        const key = `${e.source}|${String(e.data.reason)}|${e.target}`;
        const onPath = highlight !== null && highlight.edges.has(key);
        const dim =
          (highlight !== null && !onPath) ||
          (matches !== null && !(matches.has(e.source) && matches.has(e.target))) ||
          (spotlight !== null && !(spotlight.has(e.source) && spotlight.has(e.target)));
        const className = [dim ? 'dimmed' : '', onPath ? 'on-path' : ''].filter(Boolean).join(' ');
        return (e.className ?? '') === className ? e : { ...e, className };
      }),
    [edges, matches, spotlight, highlight],
  );

  const showBanner = !dismissed && error !== null;
  const visibleCount = view?.nodes.size ?? 0;

  return (
    <div className={`app${dragging ? ' dragging' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          seqviz<span>{loaded?.fileName ?? 'no file loaded'}</span>
        </div>
        <div className="spacer" />

        {graph !== null && (
          <div className="stat">
            <b>{visibleCount}</b>
            {visibleCount === graph.nodes.size ? '' : ` / ${graph.nodes.size}`} nodes ·{' '}
            <b>{edges.length}</b> edges · <b>{elapsedMs}</b> ms
          </div>
        )}

        <div className="segmented">
          <button
            type="button"
            aria-pressed={mode === 'grouped'}
            disabled={graph === null || busy}
            onClick={() => setMode('grouped')}
            title="Draw each sequence as a labelled box"
          >
            Grouped
          </button>
          <button
            type="button"
            aria-pressed={mode === 'compact'}
            disabled={graph === null || busy}
            onClick={() => setMode('compact')}
            title="Wrap the chain into columns; no sequence boxes"
          >
            Compact
          </button>
        </div>

        <button
          type="button"
          className={`tool${trace ? ' on' : ''}`}
          aria-pressed={trace}
          disabled={graph === null}
          onClick={() => setTrace((t) => !t)}
          title="Highlight every path into and out of the selected step, dimming the rest"
        >
          Trace paths
        </button>

        <button
          type="button"
          className="tool"
          disabled={graph === null || busy}
          onClick={relayout}
          title="Discard manual positions and restore the automatic layout"
        >
          {busy ? 'Laying out…' : 'Re-layout'}
        </button>
      </header>

      {showBanner && (
        <div className="banner error">
          <div className="body">
            <strong>Could not load that file.</strong> <code>{error}</code>
          </div>
          <button type="button" onClick={() => setDismissed(true)} title="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="panes">
        <Outline
          graph={graph}
          selected={selected}
          collapsed={collapsed}
          onSelect={reveal}
          onToggle={toggle}
          onCollapseAll={collapseAll}
          onExpandAll={expandAll}
          text={text}
          onTextChange={setText}
          elements={elements}
          onElementsChange={setElements}
          available={available}
          results={results}
          searching={searching}
        />

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
                nodes={renderNodes}
                edges={renderEdges}
                onNodesChange={onNodesChange}
                onSelect={setSelected}
                onToggle={toggle}
                layoutKey={layoutKey}
                focus={focus}
              />
            </ReactFlowProvider>
          )}
        </div>

        <Inspector
          graph={graph}
          selected={selected}
          snippets={loaded?.snippets ?? new Map()}
          onSelect={reveal}
        />
      </div>

      <Drawer
        graph={graph}
        index={index}
        rows={signals}
        warnings={warnings}
        repeats={repeats}
        comparison={comparison}
        repeat={repeat}
        onRepeat={setRepeat}
        open={drawerOpen}
        tab={drawerTab}
        signal={signal}
        onTab={setDrawerTab}
        onOpen={setDrawerOpen}
        onSignal={setSignal}
        onSelect={reveal}
      />
    </div>
  );
}
