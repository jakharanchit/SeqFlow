/**
 * Left pane: search, the Step Types filter panel, and the sequence tree.
 *
 * The primary navigation surface, and the UI for the collapse model. Selection
 * is one uid in app state with three views of it — outline, canvas, inspector
 * so a click here is the same event as a click on the canvas.
 *
 * The tree is a small multi-column table — Step, Description, Log Start, Log
 * Completion — because those last three are real XML attributes already
 * carried verbatim in `node.attrs` (see CLAUDE.md), just never surfaced
 * outside the inspector's generic attribute table until now.
 *
 * When a query is active the tree gives way to a result list, because a result
 * needs its parent path beside it and the tree cannot show that in a row. 27
 * names cover 106 of the 133 nodes in the sample: a bare name is not an answer.
 * The Step Types panel is a different kind of narrowing — it dims non-matching
 * rows in the tree in place, rather than replacing it with a flat list, so the
 * structure around a match stays visible.
 *
 * All 133 rows render at once. Virtualising them would be premature — the whole
 * file is one flat list of small divs, and collapsing four sequences takes it
 * to 21.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { displayName, numberedName } from '../core/ancestry';
import { Icon } from './Icon';
import { StepNum } from './StepNum';
import { useResizable } from './useResizable';
import type { ElementCount, SearchResult } from '../core/search';
import type { Graph, SeqNode } from '../core/types';

/**
 * The three columns a reader can hide. Step never joins this list — it is
 * the tree, not an optional field on top of it.
 */
export type HideableColumn = 'desc' | 'logStart' | 'logCompletion';

export interface OutlineProps {
  graph: Graph | null;
  selected: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (uid: string) => void;
  onToggle: (uid: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;

  /* Search and filter. */
  text: string;
  onTextChange: (text: string) => void;
  elements: ReadonlySet<string>;
  onElementsChange: (elements: ReadonlySet<string>) => void;
  available: ElementCount[];
  /** Element -> category, for the Step Types panel. From `rules.categories`. */
  categories: Record<string, string[]>;
  results: SearchResult[];
  searching: boolean;

  /** How large the tree's rows render. Persisted by the caller. */
  textSize: OutlineTextSize;
  onTextSizeChange: (size: OutlineTextSize) => void;

  /**
   * Description/Log Start/Log Completion each hideable from the View tab's
   * show/hide section — that control lives in `Drawer.tsx`, so the set itself
   * is owned by `App.tsx` and only read here.
   */
  hiddenColumns: ReadonlySet<HideableColumn>;
}

/**
 * Row font-size/height pairs, biggest lever a reader has over how much of the
 * tree fits on screen at once. `row` also drives the windowing arithmetic
 * below and is applied to the DOM as `--outline-row-height`, so this table is
 * the one place both have to agree — there is no second copy to drift.
 */
export const OUTLINE_SIZES = [
  { level: 'S', font: 11, row: 20 },
  { level: 'M', font: 12, row: 22 },
  { level: 'L', font: 14, row: 26 },
  { level: 'XL', font: 16, row: 30 },
] as const;

export type OutlineTextSize = (typeof OUTLINE_SIZES)[number]['level'];

interface Row {
  node: SeqNode;
  /** Indent level within the outline, not the parse depth. */
  level: number;
  isContainer: boolean;
}

/**
 * Rows in document order, skipping the subtrees of collapsed sequences. The
 * collapsed sequence itself stays — it is how you expand it again.
 */
function rowsFor(graph: Graph, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  const visit = (uid: string, level: number): void => {
    if (seen.has(uid)) return;
    seen.add(uid);
    const node = graph.nodes.get(uid);
    if (node === undefined) return;

    const children = graph.containers.get(uid);
    rows.push({ node, level, isContainer: children !== undefined });
    if (children === undefined || collapsed.has(uid)) return;
    for (const child of children) visit(child, level + 1);
  };

  for (const node of graph.nodes.values()) {
    if (node.parent === null) visit(node.uid, 0);
  }
  return rows;
}

/** The matched run of the name, marked so the eye lands on it. */
function Marked({ name, at, length }: { name: string; at: number; length: number }): React.JSX.Element {
  if (at < 0 || length === 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + length)}</mark>
      {name.slice(at + length)}
    </>
  );
}

/**
 * `description`/`logStart`/`logCompletion` are real XML attributes present on
 * almost every element in both fixtures, carried verbatim in `node.attrs`
 * (invariant: keep attrs verbatim). These read them for display; they invent
 * nothing and name no element of the sequence schema.
 */
function cellText(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  return v === '' ? '—' : v;
}

/**
 * TRUE/FALSE -> a glyph for fast scanning. Anything else (an unfamiliar
 * dialect's own convention) is shown verbatim rather than hidden — this is a
 * read-only tool and a surprising value is exactly the kind of thing it must
 * never silently absorb.
 */
function logGlyph(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (v === '') return '—';
  const upper = v.toUpperCase();
  if (upper === 'TRUE') return 'check';
  if (upper === 'FALSE') return 'close';
  return v;
}

/** The Log Start / Log Completion cell body: an icon for the two values the
 * dialects agree on, the raw text for anything else. Same split as
 * `logGlyph`, kept beside it so the two cannot drift. */
function LogCell({ raw }: { raw: string | undefined }): React.JSX.Element {
  const v = logGlyph(raw);
  if (v === 'check') return <Icon name="check" label="Yes" />;
  if (v === 'close') return <Icon name="close" label="No" />;
  return <>{v}</>;
}

/**
 * The Description/Log Start/Log Completion cells, identical for a tree row
 * and a search-result row — one definition so the two views can't drift.
 * A hidden column's cell is omitted entirely — its grid track is gone too,
 * not just blank — so it never reserves space it isn't using.
 */
function DataCells({
  node,
  hiddenColumns,
}: {
  node: SeqNode;
  hiddenColumns: ReadonlySet<HideableColumn>;
}): React.JSX.Element {
  const description = node.attrs['description'];
  const logStart = node.attrs['logStart'];
  const logCompletion = node.attrs['logCompletion'];
  return (
    <>
      {!hiddenColumns.has('desc') && (
        <span className="col-desc" title={cellText(description)}>
          {cellText(description)}
        </span>
      )}
      {!hiddenColumns.has('logStart') && (
        <span className="col-log" title={logStart ?? ''}>
          <LogCell raw={logStart} />
        </span>
      )}
      {!hiddenColumns.has('logCompletion') && (
        <span className="col-log" title={logCompletion ?? ''}>
          <LogCell raw={logCompletion} />
        </span>
      )}
    </>
  );
}

interface CategoryGroup {
  category: string;
  items: ElementCount[];
}

/**
 * `available` grouped by `categories` (element -> category name, inverted
 * from the rule file's category -> elements mapping). An element the rule
 * file never mentions lands under "Other" rather than disappearing —
 * invariant 7 applies to this filter panel too.
 */
function groupByCategory(
  available: ElementCount[],
  categories: Record<string, string[]>,
): CategoryGroup[] {
  const elementCategory = new Map<string, string>();
  for (const [category, elements] of Object.entries(categories)) {
    for (const element of elements) elementCategory.set(element, category);
  }

  const groups = new Map<string, ElementCount[]>();
  for (const item of available) {
    const category = elementCategory.get(item.element) ?? 'Other';
    const list = groups.get(category);
    if (list === undefined) groups.set(category, [item]);
    else list.push(item);
  }

  const ordered: CategoryGroup[] = [];
  for (const category of Object.keys(categories)) {
    const items = groups.get(category);
    if (items !== undefined) ordered.push({ category, items });
  }
  const other = groups.get('Other');
  if (other !== undefined) ordered.push({ category: 'Other', items: other });
  return ordered;
}

/**
 * Rows to render beyond the visible slice, above and below. Enough that a fast
 * scroll does not reach the edge before the next render lands.
 */
const OVERSCAN = 12;

/**
 * Below this, every row is rendered and the window is not used at all.
 *
 * A 133-row outline has never been the problem; a corpus has sequences several
 * times that, and 5 733 rows is 5 733 DOM subtrees that re-render on every
 * selection. Keeping the small case unwindowed means the common path has no
 * spacers in it and nothing to get wrong.
 */
const WINDOW_ABOVE = 200;

export function Outline({
  graph,
  selected,
  collapsed,
  onSelect,
  onToggle,
  onCollapseAll,
  onExpandAll,
  text,
  onTextChange,
  elements,
  onElementsChange,
  available,
  categories,
  results,
  searching,
  textSize,
  onTextSizeChange,
  hiddenColumns,
}: OutlineProps): React.JSX.Element {
  const sizeIndex = OUTLINE_SIZES.findIndex((s) => s.level === textSize);
  const size = OUTLINE_SIZES[sizeIndex < 0 ? 1 : sizeIndex]!;
  const ROW_HEIGHT = size.row;

  /**
   * One resizable width per column, independent of the others — Step and
   * Description are the two a reader is likeliest to want wider; Log
   * Start/Completion rarely need more than their header text. `invert:
   * false` on every one: each handle sits at the right edge of the column it
   * resizes, same convention as the existing outline-panel handle.
   */
  const stepCol = useResizable('seqflow.outlineColWidth.step', 240, 140, 900, 'horizontal');
  const descCol = useResizable('seqflow.outlineColWidth.desc', 220, 100, 900, 'horizontal');
  const logStartCol = useResizable('seqflow.outlineColWidth.logStart', 80, 50, 220, 'horizontal');
  const logCompletionCol = useResizable(
    'seqflow.outlineColWidth.logCompletion',
    100,
    60,
    240,
    'horizontal',
  );
  const showDesc = !hiddenColumns.has('desc');
  const showLogStart = !hiddenColumns.has('logStart');
  const showLogCompletion = !hiddenColumns.has('logCompletion');
  const outlineCols = useMemo(() => {
    const parts = [`${stepCol.size}px`];
    if (showDesc) parts.push(`${descCol.size}px`);
    if (showLogStart) parts.push(`${logStartCol.size}px`);
    if (showLogCompletion) parts.push(`${logCompletionCol.size}px`);
    return parts.join(' ');
  }, [
    stepCol.size,
    descCol.size,
    logStartCol.size,
    logCompletionCol.size,
    showDesc,
    showLogStart,
    showLogCompletion,
  ]);

  const rowStyle = {
    '--outline-font-size': `${size.font}px`,
    '--outline-row-height': `${size.row}px`,
    '--outline-cols': outlineCols,
  } as React.CSSProperties;

  const rows = useMemo(
    () => (graph === null ? [] : rowsFor(graph, collapsed)),
    [graph, collapsed],
  );
  // The Step Types groups are a dozen rows of vertical space that most
  // sessions never touch, so each one stays folded until asked for.
  const [openCategories, setOpenCategories] = useState<ReadonlySet<string>>(new Set());
  const [showTypes, setShowTypes] = useState(false);

  const groups = useMemo(() => groupByCategory(available, categories), [available, categories]);

  /* ---------------------------------------------------------------- */
  /* Windowing                                                         */
  /* ---------------------------------------------------------------- */

  const scroller = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  /**
   * A callback ref, not an effect.
   *
   * The rows container is not mounted with the component — there is no file
   * yet, and the search results replace it when the box has a query — so an
   * effect that looks for it once on mount finds nothing, never runs again,
   * and leaves the viewport height at zero. Windowing is off while that is
   * zero, so the failure is silent: every row renders and the whole feature
   * quietly does not exist. A callback ref fires on each mount and unmount.
   */
  const attach = useCallback((el: HTMLDivElement | null): void => {
    observer.current?.disconnect();
    scroller.current = el;
    if (el === null) {
      observer.current = null;
      return;
    }
    setViewport(el.clientHeight);
    setScrollTop(el.scrollTop);
    observer.current = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.current.observe(el);
  }, []);

  const windowed = rows.length > WINDOW_ABOVE && viewport > 0;
  const first = windowed
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const last = windowed
    ? Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
    : rows.length;
  const slice = windowed ? rows.slice(first, last) : rows;

  /*
   * Bring the selected row into view.
   *
   * Without windowing an off-screen selection was merely out of sight; with it
   * the row is not in the DOM at all, so a canvas or search selection could
   * leave the outline showing nothing related. Scrolls only when the row is
   * outside the viewport, so clicking down the list does not fight the reader.
   */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null || selected === null) return;
    const index = rows.findIndex((r) => r.node.uid === selected);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, [selected, rows]);

  if (graph === null) {
    return (
      <aside className="outline" style={rowStyle}>
        <p className="hint">No file loaded.</p>
      </aside>
    );
  }

  const needle = text.trim();

  const toggleElement = (element: string): void => {
    const next = new Set(elements);
    if (!next.delete(element)) next.add(element);
    onElementsChange(next);
  };

  const toggleCategory = (category: string): void => {
    const next = new Set(openCategories);
    if (!next.delete(category)) next.add(category);
    setOpenCategories(next);
  };

  return (
    <aside className="outline" style={rowStyle}>
      {/* Step Types stays at the top: it narrows the tree in place, so it
          reads as something applied to the list below it. */}
      <div className="outline-filters">
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={showTypes || elements.size > 0}
          onClick={() => setShowTypes((v) => !v)}
        >
          <Icon
            name={showTypes || elements.size > 0 ? 'expand_more' : 'chevron_right'}
            className="twisty-inline"
          />
          Step Types
          {elements.size > 0 && <b>{elements.size}</b>}
        </button>

        {(showTypes || elements.size > 0) && (
          <div className="step-types">
            {groups.map(({ category, items }) => {
              const open = openCategories.has(category);
              return (
                <div key={category} className="type-category">
                  <button
                    type="button"
                    className="type-category-head"
                    aria-expanded={open}
                    onClick={() => toggleCategory(category)}
                  >
                    <Icon name={open ? 'expand_more' : 'chevron_right'} className="twisty-inline" />
                    {category}
                  </button>
                  {open && (
                    <div className="type-list">
                      {items.map(({ element, count }) => (
                        <button
                          key={element}
                          type="button"
                          className={`type-row${elements.has(element) ? ' on' : ''}`}
                          aria-pressed={elements.has(element)}
                          title={`${count} ${element} node${count === 1 ? '' : 's'}`}
                          onClick={() => toggleElement(element)}
                        >
                          <span className="type-name">{element}</span>
                          <span className="type-count">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {groups.length === 0 && <p className="hint">No step types in this file.</p>}
          </div>
        )}
      </div>

      <div className="outline-columns-head" role="row">
        <span className="col-step">
          Step
          <span
            className="col-resize-handle"
            onPointerDown={stepCol.onHandleDown}
            onDoubleClick={stepCol.reset}
            title="Drag to resize — double-click to reset"
          />
        </span>
        {showDesc && (
          <span className="col-desc">
            Description
            <span
              className="col-resize-handle"
              onPointerDown={descCol.onHandleDown}
              onDoubleClick={descCol.reset}
              title="Drag to resize — double-click to reset"
            />
          </span>
        )}
        {showLogStart && (
          <span className="col-log">
            Log Start
            <span
              className="col-resize-handle"
              onPointerDown={logStartCol.onHandleDown}
              onDoubleClick={logStartCol.reset}
              title="Drag to resize — double-click to reset"
            />
          </span>
        )}
        {showLogCompletion && (
          <span className="col-log">
            Log Completion
            <span
              className="col-resize-handle"
              onPointerDown={logCompletionCol.onHandleDown}
              onDoubleClick={logCompletionCol.reset}
              title="Drag to resize — double-click to reset"
            />
          </span>
        )}
      </div>

      {searching ? (
        <>
          <div className="result-count">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </div>
          <div className="outline-rows">
          {results.map((r) => {
            const node = graph.nodes.get(r.uid);
            const tooltip = r.path === '' ? r.element : `${r.element} — ${r.path}`;
            return (
              <div
                key={r.uid}
                className={`row result${selected === r.uid ? ' selected' : ''}`}
                onClick={() => onSelect(r.uid)}
                role="option"
                aria-selected={selected === r.uid}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.uid);
                  }
                }}
              >
                <span className="col-step" title={tooltip}>
                  <span className={`dot kind-${r.kind}`} />
                  <StepNum number={r.stepNumber} />
                  <span className="row-name">
                    <Marked name={r.name} at={r.at} length={needle.length} />
                  </span>
                </span>
                {node !== undefined && <DataCells node={node} hiddenColumns={hiddenColumns} />}
              </div>
            );
          })}
          {results.length === 0 && <p className="hint">Nothing matches.</p>}
          </div>
        </>
      ) : (
        <div
          className="outline-rows"
          ref={attach}
          onScroll={(e) => {
            if (windowed) setScrollTop(e.currentTarget.scrollTop);
          }}
        >
          {/* Spacers stand in for the rows above and below the window, so the
              scrollbar reflects the whole tree rather than the rendered slice. */}
          {first > 0 && <div style={{ height: first * ROW_HEIGHT }} />}
          {slice.map(({ node, level, isContainer }) => {
            const isCollapsed = collapsed.has(node.uid);
            const dimmed = elements.size > 0 && !elements.has(node.element);
            return (
              <div
                key={node.uid}
                className={[
                  'row',
                  selected === node.uid ? 'selected' : '',
                  isContainer ? 'is-container' : '',
                  dimmed ? 'dimmed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(node.uid)}
                role="treeitem"
                aria-selected={selected === node.uid}
                aria-expanded={isContainer ? !isCollapsed : undefined}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(node.uid);
                  }
                }}
              >
                <span className="col-step" style={{ paddingLeft: 6 + level * 13 }}>
                  {isContainer ? (
                    <button
                      type="button"
                      className="twisty"
                      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(node.uid);
                      }}
                    >
                      <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} />
                    </button>
                  ) : (
                    <span className={`dot kind-${node.kind}`} />
                  )}

                  <StepNum number={node.stepNumber} />
                  <span
                    className="row-name"
                    title={`${node.element} — ${numberedName(node)}`}
                  >
                    {displayName(node)}
                  </span>
                </span>
                <DataCells node={node} hiddenColumns={hiddenColumns} />
              </div>
            );
          })}
          {last < rows.length && <div style={{ height: (rows.length - last) * ROW_HEIGHT }} />}
        </div>
      )}

      <div className="outline-search">
        {/* One bar: the search box takes what the buttons beside it leave. The
            controls that used to sit in an "Outline" header live here instead
            the header carried a label and nothing else worth a row of its own. */}
        <div className="search-line">
          <div className="search-box">
            <input
              type="search"
              value={text}
              placeholder="Search names or a step number…"
              aria-label="Search step names"
              onChange={(e) => onTextChange(e.target.value)}
            />
            {searching && (
              <button
                type="button"
                className="clear"
                title="Clear search and filter"
                aria-label="Clear search and filter"
                onClick={() => {
                  onTextChange('');
                  onElementsChange(new Set());
                }}
              >
                <Icon name="close" />
              </button>
            )}
          </div>

          <div className="outline-textsize" role="group" aria-label="Tree text size">
            <button
              type="button"
              disabled={sizeIndex <= 0}
              onClick={() => onTextSizeChange(OUTLINE_SIZES[Math.max(0, sizeIndex - 1)]!.level)}
              title="Smaller text"
              aria-label="Smaller text"
            >
              <Icon name="text_decrease" />
            </button>
            <button
              type="button"
              disabled={sizeIndex >= OUTLINE_SIZES.length - 1}
              onClick={() =>
                onTextSizeChange(OUTLINE_SIZES[Math.min(OUTLINE_SIZES.length - 1, sizeIndex + 1)]!.level)
              }
              title="Larger text"
              aria-label="Larger text"
            >
              <Icon name="text_increase" />
            </button>
          </div>

          <div className="outline-actions">
            <button type="button" onClick={onCollapseAll} title="Collapse every sequence">
              Collapse all
            </button>
            <button type="button" onClick={onExpandAll} title="Expand every sequence">
              Expand all
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
