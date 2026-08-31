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
import { profile, unknowns, type SchemaProfile } from './core/profile';
import { RuleFileError, loadRules } from './core/rules';
import type { Graph, Rules, SeqEdge, Warning } from './core/types';
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
import { adjacency, firstLeafOf, pathSet } from './core/paths';
import { elementCounts, isActive, matchSet, search } from './core/search';
import {
  noSignalNames,
  parseSignalNames,
  type SignalNameFile,
} from './core/signalNames';
import { nodesFor, signalIndex, signalRows } from './core/signals';
import { compare, similarGroups } from './core/similarity';
import { asGraph, autoCollapse, visibleGraph } from './emit/collapse';
import {
  SidecarError,
  applySidecar,
  parseSidecar,
  type Sidecar,
} from './emit/sidecar';
import { toFlow, type FlowEdge, type FlowNode } from './emit/flow';
import { LayoutTimeout, layout, type LayoutResult } from './layout/elk';
import type { LayoutMode, Point } from './layout/elkGraph';
import { Canvas, type FocusRequest } from './ui/Canvas';
import { Drawer, type DrawerTab } from './ui/Drawer';
import { Inspector } from './ui/Inspector';
import { Outline } from './ui/Outline';
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
  snippets: Map<string, string>;
  /**
   * Every element name in the document against what the rule file knows.
   * Computed from the XML rather than the graph, because the elements worth
   * reporting are exactly the ones the graph does not contain.
   */
  profile: SchemaProfile;
}

/** Raw XML per node, for the inspector. Serialising is a UI concern. */
function snippetsFor(xml: string, graph: Graph, rules: Rules): Map<string, string> {
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

/** So the drawer's profile prop never goes optional before a file lands. */
const EMPTY_PROFILE: SchemaProfile = new Map();

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
  loops: [],
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
  /**
   * How many sequences the *tool* folded on load, as opposed to the reader.
   * Shown once in the toolbar: a file that opens folded has to say so, or it
   * reads as a file with fewer steps than it has.
   */
  const [autoFolded, setAutoFolded] = useState(0);
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
  /** Read by `onNodesChange`, which must not be rebuilt on every layout. */
  const edgesRef = useRef<readonly FlowEdge[]>([]);
  /**
   * The last sequence XML as text, so a newly dropped rule file can re-parse
   * it. Kept in a ref rather than state: nothing renders from it, and it must
   * not put `load` back in the dependency list of the page-wide drop handler.
   */
  const sourceRef = useRef<{ xml: string; fileName: string } | null>(null);
  /**
   * The last layout mode that actually finished. A mode that times out is
   * reverted to this one, so the toolbar never claims a view the canvas is not
   * showing.
   */
  const goodMode = useRef<LayoutMode>('grouped');
  /**
   * The rule set, readable from `load` without putting it in the dependency
   * list. `load` is the page-wide drop handler's only dependency and rebuilding
   * it on every rule change would re-register the listener for no reason.
   */
  const ruleSetRef = useRef(ruleSet);
  ruleSetRef.current = ruleSet;

  /**
   * The file as parsed: what every analysis panel is about. When a baseline is
   * loaded this is still the *new* revision — the ghosts belong to the canvas,
   * not to the linter.
   */
  const subject = loaded?.graph ?? null;

  /** Elements the rule file has no answer for — the Schema tab's badge. */
  const schemaGaps = useMemo(
    () => (loaded === null ? 0 : unknowns(loaded.profile).length),
    [loaded],
  );

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
  const searching = isActive(query);
  const results = useMemo(
    () => (graph === null || !searching ? [] : search(graph, query)),
    [graph, query, searching],
  );
  const available = useMemo(() => (graph === null ? [] : elementCounts(graph)), [graph]);

  /**
   * False until the canvas has painted once for this file.
   *
   * The nine whole-file analyses below cost about 180 ms together on a
   * 5 733-node graph — small beside ELK, and still 180 ms of blocked paint that
   * buys nothing, because eight of them feed drawer tabs nobody has opened yet.
   *
   * Deferring them *until their tab opens* would empty the tab badges, which
   * are the useful part of having them. Running them one frame late keeps every
   * badge and unblocks the first frame, and a reader cannot reach the drawer in
   * a frame.
   */
  const [analysed, setAnalysed] = useState(false);
  useEffect(() => {
    if (subject === null) {
      setAnalysed(false);
      return;
    }
    setAnalysed(false);
    // A timer, not requestAnimationFrame. Frames do not run in a hidden or
    // throttled tab, and an analysis gate that never opens there would leave
    // every drawer tab permanently empty with nothing to say why.
    const id = window.setTimeout(() => setAnalysed(true), 0);
    return () => window.clearTimeout(id);
  }, [subject]);

  /** The subject once the first paint is done — null before it. */
  const ready = analysed ? subject : null;

  /**
   * One edge index per graph, shared by every query that takes one. Each call
   * site used to default-build its own, which meant two full rebuilds on every
   * click — cheap at 126 edges and not at all cheap on a file ten times that.
   */
  const subjectAdj = useMemo(
    () => (subject === null ? null : adjacency(subject)),
    [subject],
  );
  const graphAdj = useMemo(() => (graph === null ? null : adjacency(graph)), [graph]);

  /* Every analysis below is about the parsed file, so it reads `subject`. A
     ghost is a step this revision does not have; counting its signals, timing
     it, or linting it would be reporting on a file that is not the subject.

     They read `ready` rather than `subject` so none of them runs in the commit
     that first shows the file — see `analysed` above. */
  const index = useMemo(
    () => (ready === null ? new Map<string, never[]>() : signalIndex(ready, ruleSet.rules)),
    [ready, ruleSet.rules],
  );
  const signals = useMemo(() => signalRows(index), [index]);

  /**
   * Structurally identical sibling sequences. On the fixture this is one group:
   * the four Pulses, 112 of the 133 nodes, differing in eight attributes.
   */
  const repeats = useMemo(() => (ready === null ? [] : similarGroups(ready)), [ready]);
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
      ready === null
        ? { findings: [], counts: EMPTY_COUNTS, siblings: [] }
        : lint(ready, ruleSet.rules),
    [ready, ruleSet.rules],
  );

  const criteria = useMemo(
    () => (ready === null ? [] : criteriaTable(ready, ruleSet.rules)),
    [ready, ruleSet.rules],
  );

  const abortRoutes = useMemo(
    () => (ready === null ? null : failEdges(ready)),
    [ready],
  );

  const duration = useMemo(
    () => (ready === null ? EMPTY_DURATION : durations(ready, ruleSet.rules, subjectAdj ?? undefined)),
    [ready, subjectAdj, ruleSet.rules],
  );

  const stepOffsets = useMemo(
    () => (ready === null ? new Map<string, Offset>() : offsets(ready, ruleSet.rules, subjectAdj ?? undefined)),
    [ready, subjectAdj, ruleSet.rules],
  );

  const terminals = useMemo(
    () => (ready === null ? 0 : terminalCount(ready, subjectAdj ?? undefined)),
    [ready, subjectAdj],
  );

  /** Which criteria still lie in front of the selected step. */
  const ahead = useMemo(() => {
    if (subject === null || subjectAdj === null) return null;
    if (selected === null || !subject.nodes.has(selected)) return null;
    return criteriaAhead(subject, selected, criteria, subjectAdj);
  }, [subject, subjectAdj, selected, criteria]);

  /**
   * ELK results for this file, keyed by what determines one.
   *
   * A collapse toggle and a Grouped/Compact flip each cost a full ELK pass —
   * 10.7 s on a 5 733-node graph — including re-opening a fold that was closed
   * a second ago. ELK is deterministic, so the second pass can only produce
   * what the first one did.
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

    // Everything that determines an arrangement. The Map is already per graph
    // and per rule file, so only the fold state and the mode go in the key.
    const key = `${mode}|${[...collapsed].sort().join(',')}`;
    const cached = layoutCache.get(key);

    // Always built: `toFlow` is 14 ms on a 5 733-node graph against ELK's
    // 10.7 s, so it is not worth the risk of caching an edge list beside the
    // positions and having the two disagree. Only the layout is cached.
    const flow = toFlow(asGraph(graph, view), ruleSet.rules, {
      collapsedCounts: view.collapsedCounts,
    });

    const pass: Promise<LayoutResult> =
      cached === undefined
        ? layout(flow.nodes, flow.edges, mode)
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
        goodMode.current = mode;
      })
      .catch((err: unknown) => {
        if (ticket !== run.current) return;
        setError(
          err instanceof LayoutTimeout
            ? err.message
            : `layout failed — ${(err as Error).message}`,
        );
        setDismissed(false);
        // Keep the arrangement already on screen and put the toolbar back in
        // step with it. Reverting re-runs the effect, which hits the cache for
        // the mode that worked and lands immediately.
        if (err instanceof LayoutTimeout && mode !== goodMode.current) {
          setMode(goodMode.current);
        }
      })
      .finally(() => {
        if (ticket === run.current) setBusy(false);
      });
  }, [graph, view, collapsed, mode, sidecar, pass, layoutCache, ruleSet.rules]);

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
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      setLoaded({
        graph: parsed,
        fileName,
        snippets: snippetsFor(xml, parsed, rules),
        profile: profile(doc, rules),
      });
      // A large file opens folded. The alternative is a ten-second freeze on
      // arrival, and the reader has not yet said which part they want. Empty
      // for anything under the budget, so the usual case is untouched.
      const folded = autoCollapse(parsed, LAYOUT_BUDGET);
      setCollapsed(folded.size === 0 ? NO_COLLAPSE : folded);
      setAutoFolded(folded.size);
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
      setAutoFolded(0);
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
      setDrawerTab('schema');
      setDrawerOpen(true);
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
    const rules = ruleSetRef.current.rules;
    try {
      const parsed = parse(xml, { rules, domParser: new DOMParser() });
      setBaseline({
        graph: parsed,
        fileName: name,
        snippets: snippetsFor(xml, parsed, rules),
        profile: profile(new DOMParser().parseFromString(xml, 'application/xml'), rules),
      });
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
  }, [load, loadLayout, loadRuleFile, loadSignalNames]);

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

  /**
   * Path highlighting — spec 7.3. Computed on the *full* graph and then lifted
   * through the collapse view, so the highlight survives a collapse toggle: the
   * 16 criteria steps that reach the abort still light up their Pulse when the
   * Pulse is folded shut.
   */
  const highlight = useMemo(() => {
    if (graph === null || view === null || selected === null || !trace) return null;

    // A container carries no flow, so tracing one returns nothing and dims all
    // 107 leaves. Trace where the flow actually enters it instead. The
    // container stays selected; only the subject of the walk differs.
    const from = firstLeafOf(graph, selected);
    if (from === null) return null;

    const set = pathSet(graph, from, graphAdj ?? undefined);
    const lift = (uid: string): string => view.lifted.get(uid) ?? uid;
    const liftNodes = (uids: Iterable<string>): Set<string> =>
      new Set([...uids].map(lift));
    // A lifted edge whose ends collapse to the same node is an edge *inside* a
    // folded sequence: it says nothing on the canvas and would draw a self-loop.
    const liftEdges = (edges: readonly SeqEdge[]): Set<string> =>
      new Set(
        edges
          .map((e) => [lift(e.src), e.reason, lift(e.dst)] as const)
          .filter(([src, , dst]) => src !== dst)
          .map(([src, reason, dst]) => `${src}|${reason}|${dst}`),
      );

    return {
      subject: lift(from),
      nodes: new Set([lift(selected), lift(from), ...liftNodes(set.nodes)]),
      edges: liftEdges(set.edges),
      // Kept apart so the canvas can say "before" and "after" rather than one
      // undifferentiated blob — on a linear sequence the union is the whole
      // file and tells the reader nothing.
      upNodes: liftNodes(set.up.nodes),
      downNodes: liftNodes(set.down.nodes),
      upEdges: liftEdges(set.up.edges),
      downEdges: liftEdges(set.down.edges),
    };
  }, [graph, graphAdj, view, selected, trace]);

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
        // Which side of the selected step it sits on. A node can be both, when
        // a jump makes a genuine loop, and then it gets neither: "before and
        // after" is what the union class already says.
        const up = !isGroup && highlight !== null && highlight.upNodes.has(n.id);
        const down = !isGroup && highlight !== null && highlight.downNodes.has(n.id);
        const direction =
          highlight === null || n.id === highlight.subject
            ? ''
            : up && !down
              ? 'path-up'
              : down && !up
                ? 'path-down'
                : '';
        // Diff classes are not a highlight: they say what happened to the step,
        // and a dimmed ghost is still a ghost. Both may apply at once.
        const change = diff === null ? undefined : diff.status.get(n.id);
        const className = [
          dim ? 'dimmed' : '',
          onPath ? 'on-path' : '',
          direction,
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
        const up = highlight !== null && highlight.upEdges.has(key);
        const down = highlight !== null && highlight.downEdges.has(key);
        const direction = up && !down ? 'path-up' : down && !up ? 'path-down' : '';
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
          direction,
          ghost ? 'diff-removed' : '',
        ]
          .filter(Boolean)
          .join(' ');

        // The stroke is set here, not in a stylesheet.
        //
        // `toFlow` writes stroke and width as an *inline* style, and an inline
        // declaration beats any rule a class can carry — so every highlight
        // rule for an edge lost silently, including the on-path thickening that
        // has been in styles.css since Phase 2 and never once applied. The UI
        // owns highlighting, so the UI computes the final stroke; the emitter
        // still supplies the colour an unhighlighted edge gets by reason.
        //
        // The colours stay in the stylesheet as custom properties, so the two
        // path directions are defined in exactly one place.
        const stroke =
          direction === 'path-up'
            ? 'var(--path-up)'
            : direction === 'path-down'
              ? 'var(--path-down)'
              : onPath
                ? 'var(--accent)'
                : e.style.stroke;
        const width = onPath ? 2.4 : e.style.strokeWidth;
        const restyled =
          stroke === e.style.stroke && width === e.style.strokeWidth
            ? e.style
            : { ...e.style, stroke, strokeWidth: width };

        if ((e.className ?? '') === className && restyled === e.style) return e;
        return { ...e, className, style: restyled };
      }),
    [edges, matches, spotlight, criterionLight, failLight, highlight, diff],
  );

  /** A ghost's XML comes from the earlier revision; nothing else does. */
  const snippets = useMemo(() => {
    if (loaded === null) return new Map<string, string>();
    if (baseline === null) return loaded.snippets;
    return new Map([...baseline.snippets, ...loaded.snippets]);
  }, [loaded, baseline]);

  edgesRef.current = edges;

  const showBanner = !dismissed && error !== null;
  const visibleCount = view?.nodes.size ?? 0;

  return (
    <div className={`app${dragging ? ' dragging' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          seqflow<span>{loaded?.fileName ?? 'no file loaded'}</span>
        </div>
        <div className="spacer" />

        {graph !== null && (
          <div className="stat">
            <b>{visibleCount}</b>
            {visibleCount === graph.nodes.size ? '' : ` / ${graph.nodes.size}`} nodes ·{' '}
            <b>{edges.length}</b> edges · <b>{elapsedMs}</b> ms
            {autoFolded > 0 && (
              <>
                {' · '}
                <span
                  className="auto-folded"
                  title="Laying out every node at once takes ten seconds on a file this size. Expand all in the outline to see the whole thing."
                >
                  opened folded ({autoFolded} sequences)
                </span>
              </>
            )}
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
          title="Colour what runs before the selected step and what runs after it, dimming the rest"
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
                routes={routes}
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
        profile={loaded?.profile ?? EMPTY_PROFILE}
        schemaGaps={schemaGaps}
        rulesFile={ruleSet.file}
        onClearRules={clearRuleFile}
        rules={ruleSet.rules}
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
