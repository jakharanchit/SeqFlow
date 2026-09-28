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
import { ParseError, parse } from './core/parse';
import { RuleFileError, loadRules } from './core/rules';
import type { Graph, Rules, Warning } from './core/types';
import { ancestorUids, displayName, numberedName, pathLabel } from './core/ancestry';
import { elementCounts, isActive, matchSet, search } from './core/search';
import { asGraph, autoCollapse, visibleGraph } from './emit/collapse';
import {
  SidecarError,
  applySidecar,
  parseSidecar,
  type Sidecar,
} from './emit/sidecar';
import { toFlow, type FlowEdge, type FlowNode } from './emit/flow';
import { toMermaid } from './emit/mermaid';
import { toSvg } from './emit/svg';
import { LayoutTimeout, layout, type LayoutResult } from './layout/elk';
import type { Point } from './layout/elkGraph';
import { blobToBase64, installBridge, type InstalledBridge } from './bridge/install';
import { isViewMode, type ExecStatus, type StepStatusPayload, type ViewMode } from './bridge/protocol';
import { svgToPng } from './ui/raster';
import { Canvas, type FocusRequest } from './ui/Canvas';
import { Icon } from './ui/Icon';
import { SplitBar } from './ui/SplitBar';
import { Outline, type HideableColumn } from './ui/Outline';
import { usePersistedState, useResizable } from './ui/useResizable';
import './ui/styles.css';

/**
 * The rule file the build shipped with. It is the default, not the only one:
 * a schema this file has never seen arrives as a dropped `.yaml`, and the
 * whole point is that a new dialect does not need a rebuild to be read.
 */
const BUILT_IN_RULES = loadRules(rulesText);

interface Loaded {
  graph: Graph;
  fileName: string;
}

const NO_COLLAPSE: ReadonlySet<string> = new Set();

/**
 * Visible nodes a first layout is allowed to hand ELK.
 *
 * Measured over generated graphs: 581 nodes lay out in 1.2 s, 2 295 in 2.9 s,
 * 5 733 in 10.7 s. Everything else in the pipeline together is under 200 ms at
 * the largest size, so the budget is entirely about ELK. 600 keeps the first
 * paint near a second; a file under it is not folded at all, which is every
 * file this tool was built on.
 */
const LAYOUT_BUDGET = 600;

/** Distinct arrangements kept per file. A fold and its undo are two. */
const LAYOUT_CACHE_LIMIT = 12;

/** Highest-attention execution status wins when lifting several onto one
 * folded sequence node — see `execLight` below. */
const EXEC_PRIORITY: Record<ExecStatus, number> = {
  fail: 4,
  running: 3,
  pending: 2,
  pass: 1,
  skipped: 0,
};

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /**
   * The rule file in force. `file` is null while the built-in one is in use.
   * Held together so a re-parse can never read a new rule set and an old
   * name, which is the sort of mismatch a reader has no way to notice.
   */
  const [ruleSet, setRuleSet] = useState<{ rules: Rules; file: string | null }>({
    rules: BUILT_IN_RULES,
    file: null,
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  /**
   * ELK's orthogonal edge routes, by edge id.
   *
   * Both the canvas and the SVG export draw these, which is what keeps the two
   * pictures the same. Letting React Flow route its own edges put a straight
   * line through every node a jump skipped — see ui/edges.tsx.
   */
  const [routes, setRoutes] = useState<ReadonlyMap<string, Point[]>>(new Map());
  /**
   * A loaded layout sidecar, waiting for the next layout to land. Positions
   * cannot be applied on arrival: loading one usually changes the collapsed
   * set, and that starts a fresh ELK pass that would overwrite them.
   */
  const [sidecar, setSidecar] = useState<Sidecar | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [text, setText] = useState('');
  const [elements, setElements] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  /**
   * Live per-step execution status, pushed in over the LabVIEW bridge as a
   * test runs — see `bridge/install.ts`. Empty until something calls
   * `setStepStatus`/`setStepStatuses`; a plain browser session never touches
   * it.
   */
  const [executionStatus, setExecutionStatus] = useState<ReadonlyMap<string, ExecStatus>>(
    new Map(),
  );

  /* ---------------------------------------------------------------- */
  /* LabVIEW-embedded shell: panel sizing, text size, flowchart toggle   */
  /* ---------------------------------------------------------------- */

  /**
   * The left panel's width. Max shrinks the canvas can never fully starve.
   * Default and max are both larger than before the tree grew Description/Log
   * Start/Log Completion columns — the tree needs the room; the canvas keeps
   * filling whatever's left rather than claiming most of the window.
   */
  const outlinePanel = useResizable(
    'seqflow.outlineWidth',
    640,
    180,
    Math.min(1100, window.innerWidth * 0.75),
    'horizontal',
  );
  const [outlineTextSize, setOutlineTextSize] = usePersistedState<number>(
    'seqflow.outlineFontPx',
    12,
    (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 2 ? n : 12;
    },
    (v) => String(v),
  );
  /**
   * Which view is showing. Replaces a `flowchartVisible` boolean: three named
   * states, so "tree only" is as expressible as "flowchart only" and the
   * LabVIEW bridge has something to name (`setView`). The old key is
   * abandoned rather than migrated — one session opening in `both` costs a
   * reader nothing, and migration code for a preference outlives the
   * preference.
   */
  const [viewMode, setViewMode] = usePersistedState<ViewMode>(
    'seqflow.viewMode',
    'both',
    (raw) => (isViewMode(raw) ? raw : 'both'),
  );
  const [showMinimap, setShowMinimap] = usePersistedState<boolean>(
    'seqflow.showMinimap',
    true,
    (raw) => raw === 'true',
    (v) => String(v),
  );
  /**
   * Which of the tree's three optional columns are hidden — Step never joins
   * this set, it is the tree. Read from storage only; the per-column *widths*
   * stay local to `Outline.tsx` since nothing else reads them.
   */
  const [hiddenColumns] = usePersistedState<ReadonlySet<HideableColumn>>(
    'seqflow.outlineColsHidden',
    new Set<HideableColumn>(),
    (raw) =>
      new Set(
        raw
          .split(',')
          .filter((s): s is HideableColumn => s === 'desc' || s === 'logStart' || s === 'logCompletion'),
      ),
    (set) => [...set].join(','),
  );

  // Guards against a slow layout from an earlier file or toggle landing after
  // a newer one.
  const run = useRef(0);
  const focusSeq = useRef(0);
  /** Read by `loadLayout`, which must not be rebuilt every time the graph is. */
  const graphRef = useRef<Graph | null>(null);
  /** Read by `onNodesChange`, which must not be rebuilt on every layout. */
  const edgesRef = useRef<readonly FlowEdge[]>([]);
  /**
   * The last sequence XML as text, so a newly dropped rule file can re-parse
   * it. Kept in a ref rather than state: nothing renders from it, and it must
   * not put `load` back in the dependency list of the page-wide drop handler.
   */
  const sourceRef = useRef<{ xml: string; fileName: string } | null>(null);
  /**
   * The rule set, readable from `load` without putting it in the dependency
   * list. `load` is the page-wide drop handler's only dependency and rebuilding
   * it on every rule change would re-register the listener for no reason.
   */
  const ruleSetRef = useRef(ruleSet);
  ruleSetRef.current = ruleSet;
  /**
   * The LabVIEW bridge's read side. `installBridge` runs once, from a mount
   * effect below, with handlers built from `useCallback(..., [])` — stable
   * for the component's whole life, so the effect never re-registers
   * `window.SeqFlowBridge`. Those handlers see the *current* canvas and graph
   * anyway because they read through these refs rather than closing over
   * render-time values; each is updated every render, same as `graphRef` and
   * `edgesRef` above.
   */
  const renderNodesRef = useRef<readonly FlowNode[]>([]);
  const renderEdgesRef = useRef<readonly FlowEdge[]>([]);
  const routesRef = useRef<ReadonlyMap<string, Point[]>>(new Map());
  const selectedRef = useRef<string | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const warningsRef = useRef<Warning[]>([]);
  /** `reveal` closes over `graph`, so it is not stable — read through a ref. */
  const revealRef = useRef<(uid: string) => void>(() => {});
  /** Set once the mount effect below has installed the bridge. */
  const bridgeRef = useRef<InstalledBridge | null>(null);
  /** `usePersistedState`'s setter is not stable across renders — the bridge's
   * `setView` handler reads it through here, like every other handler. */
  const setViewModeRef = useRef<(mode: ViewMode) => void>(() => {});
  setViewModeRef.current = setViewMode;
  const viewModeRef = useRef<ViewMode>('both');
  viewModeRef.current = viewMode;

  /**
   * The file as parsed: what every analysis panel is about. When a baseline is
   * loaded this is still the *new* revision — the ghosts belong to the canvas,
   * not to the linter.
   */
  /** What the canvas, outline and inspector show — the parsed file, plainly. */
  const subject = loaded?.graph ?? null;
  const graph = subject;
  graphRef.current = graph;

  /** The graph as the canvas currently shows it: collapsed sequences folded. */
  const view = useMemo(
    () => (graph === null ? null : visibleGraph(graph, collapsed)),
    [graph, collapsed],
  );

  /**
   * The typed text, one beat behind.
   *
   * The box itself stays instant — it renders from `text` — but a keystroke
   * otherwise re-searches the whole graph *and* re-dims every node on the
   * canvas, and doing that per character is how a search box feels heavy on a
   * file with thousands of steps. The type filter is not debounced: it is a
   * click, and a click should land at once.
   */
  const [settled, setSettled] = useState('');
  useEffect(() => {
    if (settled === text) return;
    const id = window.setTimeout(() => setSettled(text), 120);
    return () => window.clearTimeout(id);
  }, [text, settled]);

  const query = useMemo(() => ({ text: settled, elements }), [settled, elements]);
  /**
   * `filtering` is text OR an active type filter — it still gates `results`
   * and the canvas's own dimming (`matches`, below), unchanged from before.
   * `searching` is text alone: it is what decides whether the *outline*
   * swaps its tree for the flat result list. A type-only filter dims
   * non-matching rows in place in the tree instead (`Outline.tsx`), keeping
   * its structure, rather than replacing it with a flat list — a typed query
   * still combines with an active type filter exactly as before.
   */
  const filtering = isActive(query);
  const searching = settled.trim() !== '';
  const results = useMemo(
    () => (graph === null || !filtering ? [] : search(graph, query)),
    [graph, query, filtering],
  );
  const available = useMemo(() => (graph === null ? [] : elementCounts(graph)), [graph]);

  /**
   * ELK results for this file, keyed by what determines one.
   *
   * A collapse toggle costs a full ELK pass — 10.7 s on a 5 733-node graph —
   * including re-opening a fold that was closed a second ago. ELK is
   * deterministic, so the second pass can only produce what the first one did.
   *
   * A fresh Map per graph, built during render rather than in an effect, so the
   * layout effect below can never read a cache belonging to the previous file.
   */
  const layoutCache = useMemo(
    () => new Map<string, LayoutResult>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity is the point
    [graph, ruleSet.rules],
  );

  /**
   * Layout runs whenever the visible graph changes — a collapse toggle
   * produces a different graph, so it needs a fresh arrangement.
   */
  useEffect(() => {
    if (graph === null || view === null) {
      setNodes([]);
      setEdges([]);
      setRoutes(new Map());
      return;
    }
    const ticket = ++run.current;
    setBusy(true);

    // Everything that determines an arrangement. The Map is already per graph
    // and per rule file, so only the fold state goes in the key.
    const key = [...collapsed].sort().join(',');
    const cached = layoutCache.get(key);

    // Always built: `toFlow` is 14 ms on a 5 733-node graph against ELK's
    // 10.7 s, so it is not worth the risk of caching an edge list beside the
    // positions and having the two disagree. Only the layout is cached.
    const flow = toFlow(asGraph(graph, view), ruleSet.rules, {
      collapsedCounts: view.collapsedCounts,
    });

    const pass: Promise<LayoutResult> =
      cached === undefined
        ? layout(flow.nodes, flow.edges)
        : // Positions are handed to React Flow, which replaces node objects as
          // they are dragged. Copy them so a cached arrangement cannot be
          // edited by the session that used it.
          Promise.resolve({
            ...cached,
            nodes: cached.nodes.map((n) => ({ ...n, position: { ...n.position } })),
            elapsedMs: 0,
          });

    void pass
      .then((placed) => {
        if (cached === undefined) {
          // Oldest out first. A Map iterates in insertion order, so the first
          // key is the least recently added.
          if (layoutCache.size >= LAYOUT_CACHE_LIMIT) {
            const oldest = layoutCache.keys().next().value;
            if (oldest !== undefined) layoutCache.delete(oldest);
          }
          layoutCache.set(key, placed);
        }
        if (ticket !== run.current) return;
        // A saved arrangement wins over the fresh one, node by node. A uid the
        // sidecar does not mention keeps its ELK position rather than piling up
        // at the origin; a uid this file does not have is reported, not fatal.
        let laid = placed.nodes;
        if (sidecar !== null) {
          const restored = applySidecar(placed.nodes, sidecar);
          laid = restored.nodes;
          if (restored.unknown.length > 0) {
            setWarnings((current) => [
              ...current,
              {
                code: 'UNRESOLVED_TARGET' as const,
                uid: '',
                message: `layout file: ${restored.unknown.length} saved position${restored.unknown.length === 1 ? ' is' : 's are'} for steps this sequence no longer has, and ${restored.unknown.length === 1 ? 'was' : 'were'} dropped. ${restored.placed} restored.`,
              },
            ]);
          }
          setSidecar(null);
        }
        setNodes(laid);
        setEdges(flow.edges);
        setRoutes(placed.routes);
        setLayoutKey((k) => k + 1);
      })
      .catch((err: unknown) => {
        if (ticket !== run.current) return;
        setError(
          err instanceof LayoutTimeout
            ? err.message
            : `layout failed — ${(err as Error).message}`,
        );
        setDismissed(false);
        // Keep the arrangement already on screen — a timed-out layout leaves
        // the canvas showing whatever it had before.
      })
      .finally(() => {
        if (ticket === run.current) setBusy(false);
      });
  }, [graph, view, collapsed, sidecar, layoutCache, ruleSet.rules]);

  /**
   * Parse and show a sequence. `withRules` lets a newly dropped rule file
   * re-parse the file already on screen without waiting for React to commit
   * the new rule set first.
   */
  const load = useCallback(
    (xml: string, fileName: string, withRules?: Rules): void => {
    const rules = withRules ?? ruleSetRef.current.rules;
    setBusy(true);
    setError(null);
    setDismissed(false);
    sourceRef.current = { xml, fileName };
    try {
      const parsed = parse(xml, { rules, domParser: new DOMParser() });
      setLoaded({ graph: parsed, fileName });
      // A large file opens folded. The alternative is a ten-second freeze on
      // arrival, and the reader has not yet said which part they want. Empty
      // for anything under the budget, so the usual case is untouched.
      const folded = autoCollapse(parsed, LAYOUT_BUDGET);
      setCollapsed(folded.size === 0 ? NO_COLLAPSE : folded);
      setWarnings(parsed.warnings);
      setSelected(null);
      setFocus(null);
      // A running status belongs to a test run against *this* file. A new
      // load — even a re-drop of the same file — has to be read as "nothing
      // has run yet", not as the previous run's steps still lit.
      setExecutionStatus(new Map());
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
    },
    [],
  );

  /**
   * A rule file, dropped like everything else — spec invariant 2 taken at its
   * word. Schema knowledge lives in `rules.yaml`, so a schema the build has
   * never seen is a file to drop, not a release to cut.
   *
   * The sequence on screen is re-parsed with the new rules immediately. A rule
   * file that loads but produces a worse graph is still an improvement over
   * one that silently does not apply until the next drop.
   */
  const loadRuleFile = useCallback((text: string, fileName: string): void => {
    let next: Rules;
    try {
      next = loadRules(text);
    } catch (err) {
      // RuleFileError already names the offending key, which is the whole
      // reason the loader is loud.
      setError(
        `${fileName}: ${err instanceof RuleFileError || err instanceof Error ? err.message : 'not a rule file'}`,
      );
      setDismissed(false);
      return;
    }

    setRuleSet({ rules: next, file: fileName });
    const source = sourceRef.current;
    if (source === null) {
      setError(null);
      return;
    }
    load(source.xml, source.fileName, next);
  }, [load]);

  const clearRuleFile = useCallback((): void => {
    setRuleSet({ rules: BUILT_IN_RULES, file: null });
    const source = sourceRef.current;
    if (source !== null) load(source.xml, source.fileName, BUILT_IN_RULES);
  }, [load]);

  /**
   * A layout sidecar — spec 7.8. The collapsed set lands now; the positions
   * wait for the layout pass that change is about to start.
   */
  const loadLayout = useCallback(
    (text: string, fileName: string): void => {
      if (graphRef.current === null) {
        setError(`${fileName}: load a sequence first, then its layout file`);
        setDismissed(false);
        return;
      }
      try {
        const parsed = parseSidecar(text);
        setCollapsed(new Set(parsed.collapsed));
        setSidecar(parsed);
        setError(null);
      } catch (err) {
        setError(
          `${fileName}: ${err instanceof SidecarError || err instanceof Error ? err.message : 'could not be read'}`,
        );
        setDismissed(false);
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
        const text = String(reader.result ?? '');
        // A layout sidecar and a sequence both arrive by drop; the extension
        // is what tells them apart, and a mislabelled one fails loudly rather
        // than being fed to the XML parser.
        if (/\.json$/i.test(file.name)) loadLayout(text, file.name);
        else if (/\.ya?ml$/i.test(file.name)) loadRuleFile(text, file.name);
        else load(text, file.name);
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
  }, [load, loadLayout, loadRuleFile]);

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
  revealRef.current = reveal;

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

  const onNodesChange = useCallback((changes: unknown[]): void => {
    setNodes(
      (current) =>
        applyNodeChanges(changes as NodeChange[], current as never) as unknown as FlowNode[],
    );

    // A dragged node invalidates the routes that end on it, and only those.
    //
    // ELK routed those edges around an arrangement that no longer holds, so
    // drawing them would leave a line ending in open space. Dropping them lets
    // those edges fall back to a smoothstep curve, which at least still joins
    // the two nodes; every other edge keeps the routing ELK computed. Re-layout
    // brings them all back.
    const moved = new Set(
      (changes as NodeChange[])
        .filter((c): c is NodeChange & { id: string } => c.type === 'position' && 'id' in c)
        .map((c) => c.id),
    );
    if (moved.size === 0) return;
    setRoutes((current) => {
      const next = new Map(current);
      let dropped = false;
      for (const edge of edgesRef.current) {
        if (!moved.has(edge.source) && !moved.has(edge.target)) continue;
        if (next.delete(edge.id)) dropped = true;
      }
      return dropped ? next : current;
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* LabVIEW bridge                                                     */
  /* ---------------------------------------------------------------- */

  /** The bare uid `selected` holds is opaque to anything outside this page —
   * a sibling LabVIEW module broadcasting it onward needs something a reader
   * or a log line can show. Used for both `getState`'s `selected` field and
   * the `stepSelected` event, so the two ways of learning the selection never
   * disagree. */
  function selectedDetail(graph: Graph | null, uid: string | null): Record<string, unknown> | null {
    if (graph === null || uid === null) return null;
    const node = graph.nodes.get(uid);
    if (node === undefined) return null;
    return {
      uid: node.uid,
      name: displayName(node),
      stepNumber: node.stepNumber,
      numbered: numberedName(node),
      element: node.element,
      kind: node.kind,
      path: pathLabel(graph, uid),
    };
  }

  /** `selectStep` — reuses `reveal`, which already selects, expands whatever
   * collapsed sequence is hiding the step, and centres the viewport on it. */
  const bridgeSelectStep = useCallback((uid: string): void => {
    revealRef.current(uid);
  }, []);

  const bridgeSetStepStatus = useCallback((uid: string, status: ExecStatus): void => {
    setExecutionStatus((current) => {
      const next = new Map(current);
      next.set(uid, status);
      return next;
    });
  }, []);

  const bridgeSetStepStatuses = useCallback(
    (entries: readonly StepStatusPayload[]): void => {
      if (entries.length === 0) return;
      setExecutionStatus((current) => {
        const next = new Map(current);
        for (const { uid, status } of entries) next.set(uid, status);
        return next;
      });
    },
    [],
  );

  const bridgeResetExecution = useCallback((): void => {
    setExecutionStatus(new Map());
  }, []);

  const bridgeSetView = useCallback((mode: ViewMode): void => {
    setViewModeRef.current(mode);
  }, []);

  const bridgeExportMermaid = useCallback((): string => {
    const g = graphRef.current;
    return g === null ? '' : toMermaid(g, ruleSetRef.current.rules);
  }, []);

  /** Honours whatever is dimmed/highlighted on the canvas right now, the same
   * default `Export.tsx`'s "Match canvas" starts on. */
  const bridgeExportSvg = useCallback((): string => {
    const loaded = loadedRef.current;
    return toSvg(renderNodesRef.current, renderEdgesRef.current, {
      routes: routesRef.current,
      highlight: true,
      ...(loaded === null ? {} : { title: loaded.fileName }),
    }).text;
  }, []);

  const bridgeExportPng = useCallback(async () => {
    const loaded = loadedRef.current;
    const svg = toSvg(renderNodesRef.current, renderEdgesRef.current, {
      routes: routesRef.current,
      highlight: true,
      ...(loaded === null ? {} : { title: loaded.fileName }),
    });
    const raster = await svgToPng(svg.text, svg.width, svg.height, 1);
    const base64 = await blobToBase64(raster.blob);
    return { base64, width: raster.width, height: raster.height };
  }, []);

  const bridgeGetState = useCallback(
    (): Record<string, unknown> => ({
      fileName: loadedRef.current?.fileName ?? null,
      nodeCount: graphRef.current?.nodes.size ?? 0,
      warnings: warningsRef.current.length,
      selected: selectedDetail(graphRef.current, selectedRef.current),
      view: viewModeRef.current,
    }),
    [],
  );

  /**
   * Installed once. Every handler above reads through a ref rather than
   * closing over render-time state, so `[]` here — mirroring the load*
   * functions' own stable identities — is not a lie: the bridge sees the
   * current graph and canvas on every call regardless of when it was
   * installed. Mirrors the page-wide drop-listener effect just above it.
   */
  useEffect(() => {
    const installed = installBridge({
      loadXml: load,
      loadRuleFile,
      loadLayout,
      clearRuleFile,
      selectStep: bridgeSelectStep,
      setStepStatus: bridgeSetStepStatus,
      setStepStatuses: bridgeSetStepStatuses,
      resetExecution: bridgeResetExecution,
      setView: bridgeSetView,
      exportMermaid: bridgeExportMermaid,
      exportSvg: bridgeExportSvg,
      exportPng: bridgeExportPng,
      getState: bridgeGetState,
    });
    bridgeRef.current = installed;
    return () => {
      installed.dispose();
      bridgeRef.current = null;
    };
  }, [
    load,
    loadRuleFile,
    loadLayout,
    clearRuleFile,
    bridgeSelectStep,
    bridgeSetStepStatus,
    bridgeSetStepStatuses,
    bridgeResetExecution,
    bridgeSetView,
    bridgeExportMermaid,
    bridgeExportSvg,
    bridgeExportPng,
    bridgeGetState,
  ]);

  /** Pushed out whenever the reader (or LabVIEW's own `selectStep`) changes
   * the selection — LabVIEW polls these to know what an operator clicked. */
  useEffect(() => {
    bridgeRef.current?.enqueue('stepSelected', selectedDetail(graphRef.current, selected));
  }, [selected]);

  useEffect(() => {
    if (loaded === null) return;
    bridgeRef.current?.enqueue('fileLoaded', {
      fileName: loaded.fileName,
      nodeCount: loaded.graph.nodes.size,
      warnings: loaded.graph.warnings.length,
    });
  }, [loaded]);

  useEffect(() => {
    if (error === null) return;
    bridgeRef.current?.enqueue('loadError', { message: error });
  }, [error]);

  /**
   * The view an operator chose, pushed out the same way a selection is.
   * Fires on a bridge-driven change too — that is an echo confirming the
   * state took, not a loop: `setView` is idempotent and nothing on the
   * LabVIEW side is obliged to act on the event.
   */
  useEffect(() => {
    bridgeRef.current?.enqueue('viewChanged', { view: viewMode });
  }, [viewMode]);

  /** Search matches, lifted the same way a highlight always was, so a hit
   * inside a fold still reads. */
  const matches = useMemo(() => {
    if (view === null || !filtering) return null;
    const raw = matchSet(results);
    return new Set([...raw].map((uid) => view.lifted.get(uid) ?? uid));
  }, [view, filtering, results]);

  /**
   * Live execution status, lifted through the collapse view the same way
   * every other overlay is — a status reported for a step hidden inside a
   * folded sequence has to land *somewhere* visible, or folding a sequence
   * while a test runs would go dark for it.
   *
   * A folded sequence can stand in for several statuses at once (steps at
   * different stages inside it), so lifting takes the most attention-worthy
   * one rather than the last one written: a single `fail` inside a folded
   * group must not be overwritten by nine `pass`es that happen to be later in
   * iteration order.
   */
  const execLight = useMemo(() => {
    if (view === null || executionStatus.size === 0) return null;
    const lifted = new Map<string, ExecStatus>();
    for (const [uid, status] of executionStatus) {
      const target = view.lifted.get(uid) ?? uid;
      const current = lifted.get(target);
      if (current === undefined || EXEC_PRIORITY[status] > EXEC_PRIORITY[current]) {
        lifted.set(target, status);
      }
    }
    return lifted;
  }, [view, executionStatus]);

  /* Selection is app state; React Flow is told about it rather than owning it. */
  const renderNodes = useMemo(
    () =>
      nodes.map((n) => {
        // Group boxes are scaffolding, not steps: they never carry flow, so
        // dimming them would delete exactly the context that makes a search
        // highlight readable. A *collapsed* sequence is a seqNode, not a
        // group, and dims like any other node.
        const isGroup = n.type === 'seqGroup';
        const dim = !isGroup && matches !== null && !matches.has(n.id);
        // Execution status says what LabVIEW reported for the step,
        // independent of whether it is dimmed.
        const exec = isGroup ? undefined : execLight?.get(n.id);
        const className = [dim ? 'dimmed' : '', exec === undefined ? '' : `exec-${exec}`]
          .filter(Boolean)
          .join(' ');
        const isSelected = n.id === selected;
        if (n.selected === isSelected && (n.className ?? '') === className) return n;
        return { ...n, selected: isSelected, className };
      }),
    [nodes, selected, matches, execLight],
  );

  const renderEdges = useMemo(
    () =>
      edges.map((e) => {
        const dim = matches !== null && !(matches.has(e.source) && matches.has(e.target));
        const className = dim ? 'dimmed' : '';
        if ((e.className ?? '') === className) return e;
        return { ...e, className };
      }),
    [edges, matches],
  );

  edgesRef.current = edges;
  renderNodesRef.current = renderNodes;
  renderEdgesRef.current = renderEdges;
  routesRef.current = routes;
  selectedRef.current = selected;
  loadedRef.current = loaded;
  warningsRef.current = warnings;

  const showBanner = !dismissed && error !== null;

  /* `hidden`, not a zero width: a pane the seam says is off must not be able
   * to take a click meant for the one that is on. */
  const showTree = viewMode !== 'canvas';
  const showCanvas = viewMode !== 'tree';

  return (
    <div className={`app${dragging ? ' dragging' : ''}`}>
      {showBanner && (
        <div className="banner error">
          <div className="body">
            <strong>Could not load that file.</strong> <code>{error}</code>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <div className="workspace">
        <section
          className="left-panel"
          hidden={!showTree}
          style={viewMode === 'both' ? { flex: `0 0 ${outlinePanel.size}px` } : undefined}
        >
          <div className="outline-section">
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
                categories={ruleSet.rules.categories}
                results={results}
                searching={searching}
                textSize={outlineTextSize}
                onTextSizeChange={setOutlineTextSize}
                hiddenColumns={hiddenColumns}
              />
            )}
          </div>
        </section>

        <SplitBar
          mode={viewMode}
          onHandleDown={outlinePanel.onHandleDown}
          onReset={outlinePanel.reset}
        />

        <div className="canvas-wrap" hidden={!showCanvas}>
          {graph !== null && (
            <ReactFlowProvider>
              <Canvas
                nodes={renderNodes}
                edges={renderEdges}
                routes={routes}
                onNodesChange={onNodesChange}
                onSelect={setSelected}
                onToggle={toggle}
                layoutKey={layoutKey}
                refitOn={viewMode}
                focus={focus}
                showMinimap={showMinimap}
                onShowMinimap={setShowMinimap}
              />
            </ReactFlowProvider>
          )}
        </div>
      </div>
    </div>
  );
}
