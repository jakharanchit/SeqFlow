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
import {
  criteriaAhead,
  criteriaTable,
  failEdges,
  nodesForCriterion,
} from './core/criteria';
import { diffGraphs, mergedGraph, summarise } from './core/diff';
import {
  durations,
  offsets,
  terminalCount,
  type DurationReport,
  type Offset,
} from './core/duration';
import { lint } from './core/lint';
import { adjacency, pathSet } from './core/paths';
import { elementCounts, isActive, matchSet, search } from './core/search';
import {
  noSignalNames,
  parseSignalNames,
  type SignalNameFile,
} from './core/signalNames';
import { nodesFor, signalIndex, signalRows } from './core/signals';
import { compare, similarGroups } from './core/similarity';
import { asGraph, visibleGraph } from './emit/collapse';
import {
  SidecarError,
  applySidecar,
  parseSidecar,
  type Sidecar,
} from './emit/sidecar';
import { toFlow, type FlowEdge, type FlowNode } from './emit/flow';
import { layout } from './layout/elk';
import type { LayoutMode, Point } from './layout/elkGraph';
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

/** Placeholders so the drawer's props never go optional before a file lands. */
const EMPTY_COUNTS = {
  ODD_SIBLING_ATTR: 0,
  UNREACHABLE: 0,
  MULTIPLE_TERMINALS: 0,
  STALE_TARGET: 0,
  DUPLICATE_NAME: 0,
  EXTERNAL_CRITERIA: 0,
} as const;

const EMPTY_DURATION: DurationReport = {
  timed: false,
  waitAttrs: [],
  timeoutAttrs: [],
  waitSteps: 0,
  waitSeconds: 0,
  pollingSteps: 0,
  pollingSeconds: 0,
  paths: 0,
  cyclic: false,
  nominal: { min: 0, max: 0 },
  worst: { min: 0, max: 0 },
  ratio: Infinity,
};

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  /**
   * ELK's orthogonal edge routes. React Flow ignores them — it draws its own
   * smoothstep curves — but the SVG export draws them rather than inventing a
   * routing of its own.
   */
  const [routes, setRoutes] = useState<ReadonlyMap<string, Point[]>>(new Map());
  /**
   * A loaded layout sidecar, waiting for the next layout to land. Positions
   * cannot be applied on arrival: loading one usually changes the mode and the
   * collapsed set, and that starts a fresh ELK pass that would overwrite them.
   */
  const [sidecar, setSidecar] = useState<Sidecar | null>(null);
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
  /**
   * Bumped by Re-layout. Before Phase 3 that button only refit the viewport,
   * which was harmless while nothing could move a node but a drag nobody kept.
   * Now a sidecar can, so the button has to mean what its tooltip says: a
   * fresh ELK pass, discarding every manual position.
   */
  const [pass, setPass] = useState(0);
  const [text, setText] = useState('');
  const [elements, setElements] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [trace, setTrace] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('signals');
  const [signal, setSignal] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(0);
  /* Phase 4. */
  const [finding, setFinding] = useState<number | null>(null);
  const [criterion, setCriterion] = useState<string | null>(null);
  const [failRoutes, setFailRoutes] = useState(false);
  /** The earlier revision, when one has been dropped on the Diff tab. */
  const [baseline, setBaseline] = useState<Loaded | null>(null);
  const [diffRow, setDiffRow] = useState<string | null>(null);
  /**
   * The optional signal dictionary — human names for the tags. Empty until one
   * is dropped, and an empty one means every tag shows exactly as the XML
   * spells it. See `core/signalNames.ts` for why none is derived.
   */
  const [signalNames, setSignalNames] = useState<SignalNameFile>(noSignalNames);
  const [signalNamesFile, setSignalNamesFile] = useState<string | null>(null);

  // Guards against a slow layout from an earlier file or toggle landing after
  // a newer one.
  const run = useRef(0);
  const focusSeq = useRef(0);
  /** Read by `loadLayout`, which must not be rebuilt every time the graph is. */
  const graphRef = useRef<Graph | null>(null);

  /**
   * The file as parsed: what every analysis panel is about. When a baseline is
   * loaded this is still the *new* revision — the ghosts belong to the canvas,
   * not to the linter.
   */
  const subject = loaded?.graph ?? null;

  const diff = useMemo(
    () => (subject === null || baseline === null ? null : diffGraphs(baseline.graph, subject)),
    [subject, baseline],
  );

  /**
   * What the canvas, outline and inspector show. With no baseline that is the
   * parsed file. With one it is the new revision plus the removed steps drawn
   * back in where they were — a deletion has to be visible, and an absence is
   * exactly what a reader cannot see.
   */
  const graph = useMemo(
    () =>
      subject === null || baseline === null || diff === null
        ? subject
        : mergedGraph(baseline.graph, subject, diff),
    [subject, baseline, diff],
  );
  graphRef.current = graph;

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

  /* Every analysis below is about the parsed file, so it reads `subject`. A
     ghost is a step this revision does not have; counting its signals, timing
     it, or linting it would be reporting on a file that is not the subject. */
  const index = useMemo(
    () => (subject === null ? new Map<string, never[]>() : signalIndex(subject, rules)),
    [subject],
  );
  const signals = useMemo(() => signalRows(index), [index]);

  /**
   * Structurally identical sibling sequences. On the fixture this is one group:
   * the four Pulses, 112 of the 133 nodes, differing in eight attributes.
   */
  const repeats = useMemo(() => (subject === null ? [] : similarGroups(subject)), [subject]);
  const comparison = useMemo(() => {
    const group = repeats[repeat];
    if (subject === null || group === undefined) return null;
    return compare(subject, group.members);
  }, [subject, repeats, repeat]);

  /* ---------------------------------------------------------------- */
  /* Phase 4 analysis                                                   */
  /* ---------------------------------------------------------------- */

  const findings = useMemo(
    () =>
      subject === null
        ? { findings: [], counts: EMPTY_COUNTS, siblings: [] }
        : lint(subject, rules),
    [subject],
  );

  const criteria = useMemo(
    () => (subject === null ? [] : criteriaTable(subject, rules)),
    [subject],
  );

  const abortRoutes = useMemo(
    () => (subject === null ? null : failEdges(subject)),
    [subject],
  );

  const duration = useMemo(
    () => (subject === null ? EMPTY_DURATION : durations(subject, rules)),
    [subject],
  );

  const stepOffsets = useMemo(
    () => (subject === null ? new Map<string, Offset>() : offsets(subject, rules)),
    [subject],
  );

  const terminals = useMemo(
    () => (subject === null ? 0 : terminalCount(subject)),
    [subject],
  );

  /** Which criteria still lie in front of the selected step. */
  const ahead = useMemo(() => {
    if (subject === null || selected === null || !subject.nodes.has(selected)) return null;
    return criteriaAhead(subject, selected, criteria, adjacency(subject));
  }, [subject, selected, criteria]);

  /**
   * Layout runs whenever the visible graph or the mode changes — a collapse
   * toggle produces a different graph, so it needs a fresh arrangement.
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

    const flow = toFlow(asGraph(graph, view), rules, {
      collapsedCounts: view.collapsedCounts,
    });
    void layout(flow.nodes, flow.edges, mode)
      .then((placed) => {
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
            setDrawerTab('warnings');
            setDrawerOpen(true);
          }
          setSidecar(null);
        }
        setNodes(laid);
        setEdges(flow.edges);
        setRoutes(placed.routes);
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
  }, [graph, view, mode, sidecar, pass]);

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
      setFinding(null);
      setCriterion(null);
      setFailRoutes(false);
      setDiffRow(null);
      // A baseline is a comparison against *this* file. Loading a different
      // one leaves it comparing two files the reader never asked about.
      setBaseline(null);
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

  /**
   * A layout sidecar — spec 7.8. The mode and the collapsed set land now; the
   * positions wait for the layout pass those two changes are about to start.
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
        setMode(parsed.mode === 'compact' ? 'compact' : 'grouped');
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

  /**
   * An earlier revision, dropped on the Diff tab — spec 7.7.
   *
   * The canvas keeps showing the loaded file; this one only supplies the
   * ghosts. Parsed with the same rules and the same parser, so a revision that
   * does not parse fails here the way it would on the page.
   */
  const loadBaseline = useCallback((xml: string, name: string): void => {
    try {
      const parsed = parse(xml, { rules, domParser: new DOMParser() });
      setBaseline({ graph: parsed, fileName: name, snippets: snippetsFor(xml, parsed) });
      setDiffRow(null);
      setError(null);
    } catch (err) {
      const message =
        err instanceof ParseError || err instanceof Error
          ? err.message
          : 'could not read that file';
      setError(`${name}: ${message}`);
      setDismissed(false);
    }
  }, []);

  /**
   * A signal dictionary — two columns, tag then human name. Dropped like
   * everything else; the extension routes it. It changes nothing but the
   * words on screen, so it deliberately does not reset the selection, the
   * collapse set or the layout.
   */
  const loadSignalNames = useCallback((text: string, name: string): void => {
    const parsed = parseSignalNames(text);
    if (parsed.size === 0) {
      setError(`${name}: no tag,name rows in that file`);
      setDismissed(false);
      return;
    }
    setSignalNames(parsed);
    setSignalNamesFile(name);
    setError(null);
    setDrawerTab('signals');
    setDrawerOpen(true);
  }, []);

  const clearSignalNames = useCallback((): void => {
    setSignalNames(noSignalNames());
    setSignalNamesFile(null);
  }, []);

  const clearBaseline = useCallback((): void => {
    setBaseline(null);
    setDiffRow(null);
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
        const text = String(reader.result ?? '');
        // A layout sidecar and a sequence both arrive by drop; the extension
        // is what tells them apart, and a mislabelled one fails loudly rather
        // than being fed to the XML parser.
        if (/\.json$/i.test(file.name)) loadLayout(text, file.name);
        else if (/\.(csv|tsv)$/i.test(file.name)) loadSignalNames(text, file.name);
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

  /** Its tooltip promises manual positions are discarded, so discard them. */
  const relayout = useCallback((): void => {
    setSidecar(null);
    setPass((p) => p + 1);
  }, []);

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

  /** The four steps applying the criterion picked in the drawer. */
  const criterionLight = useMemo(() => {
    if (view === null || criterion === null) return null;
    return new Set(
      [...nodesForCriterion(criteria, criterion)].map((uid) => view.lifted.get(uid) ?? uid),
    );
  }, [view, criterion, criteria]);

  /**
   * The 16 fail routes as one set — Phase 4 task 4. Lifted through the collapse
   * view the same way path highlighting is, so folding the Pulses keeps it.
   */
  const failLight = useMemo(() => {
    if (view === null || abortRoutes === null || !failRoutes) return null;
    const lift = (uid: string): string => view.lifted.get(uid) ?? uid;
    return {
      nodes: new Set([...abortRoutes.nodes].map(lift)),
      edges: new Set(
        abortRoutes.edges
          .map((e) => `${lift(e.src)}|${e.reason}|${lift(e.dst)}`)
          .filter((key) => {
            const [src, , dst] = key.split('|');
            return src !== dst;
          }),
      ),
    };
  }, [view, abortRoutes, failRoutes]);

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
            (criterionLight !== null && !criterionLight.has(n.id)) ||
            (failLight !== null && !failLight.nodes.has(n.id)) ||
            (highlight !== null && !highlight.nodes.has(n.id)));
        const onPath =
          !isGroup &&
          ((highlight !== null && highlight.nodes.has(n.id)) ||
            (failLight !== null && failLight.nodes.has(n.id)));
        // Diff classes are not a highlight: they say what happened to the step,
        // and a dimmed ghost is still a ghost. Both may apply at once.
        const change = diff === null ? undefined : diff.status.get(n.id);
        const className = [
          dim ? 'dimmed' : '',
          onPath ? 'on-path' : '',
          change === undefined || change === 'same' ? '' : `diff-${change}`,
        ]
          .filter(Boolean)
          .join(' ');
        const isSelected = n.id === selected;
        if (n.selected === isSelected && (n.className ?? '') === className) return n;
        return { ...n, selected: isSelected, className };
      }),
    [nodes, selected, matches, spotlight, criterionLight, failLight, highlight, diff],
  );

  const renderEdges = useMemo(
    () =>
      edges.map((e) => {
        const key = `${e.source}|${String(e.data.reason)}|${e.target}`;
        const onPath =
          (highlight !== null && highlight.edges.has(key)) ||
          (failLight !== null && failLight.edges.has(key));
        const dim =
          (highlight !== null && !highlight.edges.has(key)) ||
          (failLight !== null && !failLight.edges.has(key)) ||
          (matches !== null && !(matches.has(e.source) && matches.has(e.target))) ||
          (spotlight !== null && !(spotlight.has(e.source) && spotlight.has(e.target))) ||
          (criterionLight !== null &&
            !(criterionLight.has(e.source) && criterionLight.has(e.target)));
        const ghost =
          diff !== null &&
          (diff.status.get(e.source) === 'removed' || diff.status.get(e.target) === 'removed');
        const className = [
          dim ? 'dimmed' : '',
          onPath ? 'on-path' : '',
          ghost ? 'diff-removed' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (e.className ?? '') === className ? e : { ...e, className };
      }),
    [edges, matches, spotlight, criterionLight, failLight, highlight, diff],
  );

  /** A ghost's XML comes from the earlier revision; nothing else does. */
  const snippets = useMemo(() => {
    if (loaded === null) return new Map<string, string>();
    if (baseline === null) return loaded.snippets;
    return new Map([...baseline.snippets, ...loaded.snippets]);
  }, [loaded, baseline]);

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
            {diff !== null && (
              <>
                {' · '}
                <b className="diff-stat">{summarise(diff)}</b>
              </>
            )}
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

        <button
          type="button"
          className={`tool${drawerOpen && drawerTab === 'export' ? ' on' : ''}`}
          disabled={graph === null}
          onClick={() => {
            if (drawerOpen && drawerTab === 'export') setDrawerOpen(false);
            else {
              setDrawerTab('export');
              setDrawerOpen(true);
            }
          }}
          title="Mermaid text for Git and documentation"
        >
          Export
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
          snippets={snippets}
          onSelect={reveal}
          ahead={ahead}
          offset={selected === null ? null : (stepOffsets.get(selected) ?? null)}
          change={selected === null || diff === null ? null : (diff.status.get(selected) ?? null)}
          signalNames={signalNames.names}
        />
      </div>

      <Drawer
        graph={graph}
        signalNames={signalNames}
        signalNamesFile={signalNamesFile}
        onClearSignalNames={clearSignalNames}
        rules={rules}
        fileName={loaded?.fileName ?? 'sequence.xml'}
        nodes={renderNodes}
        edges={renderEdges}
        routes={routes}
        highlighted={highlight !== null || matches !== null || spotlight !== null}
        layoutMode={mode}
        collapsed={collapsed}
        index={index}
        rows={signals}
        warnings={warnings}
        repeats={repeats}
        comparison={comparison}
        repeat={repeat}
        onRepeat={setRepeat}
        lint={findings}
        finding={finding}
        onFinding={setFinding}
        criteria={criteria}
        criterion={criterion}
        onCriterion={setCriterion}
        failRoutes={failRoutes}
        onFailRoutes={setFailRoutes}
        failCount={abortRoutes?.edges.length ?? 0}
        ahead={ahead}
        duration={duration}
        offset={selected === null ? null : (stepOffsets.get(selected) ?? null)}
        terminals={terminals}
        diff={diff}
        baselineName={baseline?.fileName ?? null}
        onBaseline={loadBaseline}
        onClearBaseline={clearBaseline}
        diffRow={diffRow}
        onDiffRow={setDiffRow}
        open={drawerOpen}
        tab={drawerTab}
        signal={signal}
        selected={selected}
        onTab={setDrawerTab}
        onOpen={setDrawerOpen}
        onSignal={setSignal}
        onSelect={reveal}
      />
    </div>
  );
}
