/**
 * The LabVIEW bridge's wire format.
 *
 * `protocol.ts` is pure and tested directly. `install.ts` touches `window`,
 * which this suite's `environment: 'node'` does not provide (see
 * vitest.config.ts) — but the one thing that matters about it is a promise
 * about *return values*, not about the DOM: every method returns a string
 * and never throws, because LabVIEW's ExecuteJavaScript cannot tell a thrown
 * exception from a method that returned nothing at all. A bare object
 * standing in for `window` pins that without pulling in jsdom.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  BridgeError,
  EventQueue,
  asFilePayload,
  asSelectStepPayload,
  asExportPayload,
  asZoomModePayload,
  parseCommand,
  serialiseEvents,
  serialiseEventsFlat,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeEvent,
} from '../src/bridge/protocol';
import {
  installBridge,
  type BridgeHandlers,
  type InstalledBridge,
} from '../src/bridge/install';
import { toAsciiJson } from '../src/bridge/labview';

describe('parseCommand', () => {
  test('a known command type round-trips id, type and payload', () => {
    const command = parseCommand(
      '{"id":"c1","type":"loadXml","payload":{"text":"<a/>","fileName":"a.xml"}}',
    );
    expect(command).toEqual({
      id: 'c1',
      type: 'loadXml',
      payload: { text: '<a/>', fileName: 'a.xml' },
    });
  });

  test('id is optional — null, not undefined, so JSON.stringify keeps the key', () => {
    const command = parseCommand('{"type":"getState"}');
    expect(command.id).toBeNull();
    expect(JSON.stringify(command)).toContain('"id":null');
  });

  test('not JSON', () => {
    expect(() => parseCommand('not json')).toThrow(BridgeError);
  });

  test('JSON, but not an object', () => {
    expect(() => parseCommand('null')).toThrow(/not an object/);
    expect(() => parseCommand('"loadXml"')).toThrow(/not an object/);
  });

  test('an array is an object with no "type", same as parseSidecar treats it', () => {
    expect(() => parseCommand('[]')).toThrow(/unknown command type/);
  });

  test('an unknown or missing type names itself', () => {
    expect(() => parseCommand('{"type":"deleteEverything"}')).toThrow(
      /unknown command type "deleteEverything"/,
    );
    expect(() => parseCommand('{}')).toThrow(/unknown command type/);
  });
});

describe('file payloads (loadXml, loadRuleFile, loadLayout)', () => {
  test('text and fileName both required', () => {
    expect(asFilePayload({ text: '<a/>', fileName: 'a.xml' })).toEqual({
      text: '<a/>',
      fileName: 'a.xml',
    });
    expect(() => asFilePayload({ text: '<a/>' })).toThrow(/payload.fileName must be a string/);
    expect(() => asFilePayload({ fileName: 'a.xml' })).toThrow(/payload.text must be a string/);
    expect(() => asFilePayload(null)).toThrow(BridgeError);
    expect(() => asFilePayload('a.xml')).toThrow(BridgeError);
  });
});

describe('selectStep payload', () => {
  test('a bare uid', () => {
    expect(asSelectStepPayload({ uid: 'STEP-1' })).toEqual({ uid: 'STEP-1' });
    expect(() => asSelectStepPayload({})).toThrow(/payload.uid must be a string/);
  });
});

describe('setZoomMode payload', () => {
  test('the four modes, and nothing else', () => {
    for (const mode of ['fit', 'top', 'centre', 'keep']) {
      expect(asZoomModePayload({ mode })).toEqual({ mode });
    }
    expect(() => asZoomModePayload({ mode: 'center' })).toThrow(/payload.mode/);
    expect(() => asZoomModePayload(undefined)).toThrow(BridgeError);
  });
});

describe('export payload (exportPng, exportPdf)', () => {
  test('absent means the full diagram', () => {
    expect(asExportPayload(undefined)).toEqual({ view: 'full' });
    expect(asExportPayload(null)).toEqual({ view: 'full' });
    expect(asExportPayload({})).toEqual({ view: 'full' });
  });

  test('view is full or viewport', () => {
    expect(asExportPayload({ view: 'full' })).toEqual({ view: 'full' });
    expect(asExportPayload({ view: 'viewport' })).toEqual({ view: 'viewport' });
    for (const view of ['screen', '', 1, true]) {
      expect(() => asExportPayload({ view })).toThrow(/"full", "viewport"/);
    }
  });

  test('depth is refused by name, so an old caller fails loudly', () => {
    for (const depth of [3, 0, null]) {
      expect(() => asExportPayload({ depth })).toThrow(/depth is no longer supported/);
    }
  });
});

describe('EventQueue', () => {
  test('drain returns everything queued, then empties', () => {
    const queue = new EventQueue();
    queue.push('fileLoaded', { fileName: 'a.xml' });
    queue.push('stepSelected', { uid: 'STEP-1' });
    expect(queue.size).toBe(2);

    const drained = queue.drain();
    expect(drained.map((e) => e.type)).toEqual(['fileLoaded', 'stepSelected']);
    expect(drained[0]!.payload).toEqual({ fileName: 'a.xml' });
    expect(typeof drained[0]!.at).toBe('number');
    expect(queue.size).toBe(0);
    expect(queue.drain()).toEqual([]);
  });

  test('an event needs no payload', () => {
    const queue = new EventQueue();
    queue.push('bridgeReady');
    expect(queue.drain()[0]!.payload).toBeUndefined();
  });

  test('a LabVIEW side that never polls does not grow the queue without bound', () => {
    const queue = new EventQueue();
    for (let i = 0; i < 600; i++) queue.push('stepSelected', { uid: `STEP-${i}` });
    expect(queue.size).toBe(500);
    const drained = queue.drain();
    // Oldest dropped first: the earliest surviving event is #100, not #0.
    expect(drained[0]!.payload).toEqual({ uid: 'STEP-100' });
    expect(drained[drained.length - 1]!.payload).toEqual({ uid: 'STEP-599' });
  });
});

describe('serialiseEvents', () => {
  test('is what pollEvents() hands back — a plain JSON array', () => {
    const queue = new EventQueue();
    queue.push('stepSelected', { uid: 'STEP-1' });
    const text = serialiseEvents(queue.drain());
    const parsed = JSON.parse(text) as unknown[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: 'stepSelected', payload: { uid: 'STEP-1' } });
  });

  test('an empty queue serialises to an empty array, not null or missing', () => {
    expect(serialiseEvents([])).toBe('[]');
  });
});

describe('serialiseEventsFlat', () => {
  const at = 1_700_000_000_000;

  test('an empty queue serialises to an empty array, same as serialiseEvents', () => {
    expect(serialiseEventsFlat([])).toBe('[]');
  });

  test('an object payload arrives as a string LabVIEW unflattens a second time', () => {
    const text = serialiseEventsFlat([
      { type: 'stepSelected', at, payload: { uid: 'STEP-1', stepNumber: '2.1' } },
    ]);
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { type: 'stepSelected', at, payload: '{"uid":"STEP-1","stepNumber":"2.1"}' },
    ]);
    // The point of the whole method: the payload round-trips on its own.
    expect(JSON.parse(parsed[0]!['payload'] as string)).toEqual({
      uid: 'STEP-1',
      stepNumber: '2.1',
    });
  });

  test('a null payload is the string "null", not an absent key', () => {
    const parsed = JSON.parse(
      serialiseEventsFlat([{ type: 'stepSelected', at, payload: null }]),
    ) as Array<Record<string, unknown>>;
    expect(parsed[0]).toEqual({ type: 'stepSelected', at, payload: 'null' });
  });

  test('an undefined payload is "null" too — one cluster unflattens every event', () => {
    const queue = new EventQueue();
    queue.push('bridgeReady');
    const parsed = JSON.parse(serialiseEventsFlat(queue.drain())) as Array<Record<string, unknown>>;
    expect(parsed[0]!['payload']).toBe('null');
  });

  test('quotes and newlines in a payload survive the extra layer of escaping', () => {
    const message = 'could not parse "a.xml":\nline 3';
    const parsed = JSON.parse(
      serialiseEventsFlat([{ type: 'loadError', at, payload: { message } }]),
    ) as Array<Record<string, unknown>>;
    expect(JSON.parse(parsed[0]!['payload'] as string)).toEqual({ message });
  });

  test('every event keeps its own type and timestamp', () => {
    const parsed = JSON.parse(
      serialiseEventsFlat([
        { type: 'a', at: 1, payload: 1 },
        { type: 'b', at: 2, payload: 'two' },
      ]),
    ) as Array<Record<string, unknown>>;
    expect(parsed.map((e) => [e['type'], e['at'], e['payload']])).toEqual([
      ['a', 1, '1'],
      ['b', 2, '"two"'],
    ]);
  });
});

/**
 * `installBridge` against a stand-in `window`. What is pinned here is the
 * promise LabVIEW depends on and cannot check for itself: a string back from
 * every method, on every path, including the ones where a handler throws.
 */
const noop = (): void => {};

/**
 * The string-in/string-out face of the bridge — how LabVIEW sees it. The push
 * sink is not that shape (its argument is a JS closure), so the suites below
 * reach for the real types where they need them.
 */
type Api = Record<string, (...args: string[]) => string>;

function installed(overrides: Partial<BridgeHandlers> = {}): {
  api: Api;
  bridge: InstalledBridge;
} {
  (globalThis as { window?: unknown }).window = {};
  const bridge = installBridge({
    loadXml: noop,
    loadRuleFile: noop,
    loadLayout: noop,
    clearRuleFile: noop,
    selectStep: noop,
    setView: noop,
    setZoomMode: noop,
    exportMermaid: () => 'flowchart TD',
    exportSvg: () => '<svg/>',
    exportPng: () => Promise.resolve({ base64: 'AA==', width: 1, height: 2 }),
    exportPdf: () => Promise.resolve({ base64: 'JVBERi0=', width: 1, height: 2 }),
    getState: () => ({ fileName: null, nodeCount: 0 }),
    ...overrides,
  });
  const api = (globalThis as unknown as { window: { SeqFlowBridge: Api } }).window.SeqFlowBridge;
  return { api, bridge };
}

function install(overrides: Partial<BridgeHandlers> = {}): Api {
  return installed(overrides).api;
}

/** Attach a push sink and collect what it receives. */
function sink(api: Api): { seen: BridgeEvent[]; attach: (fn: (e: BridgeEvent) => void) => number } {
  const real = api as unknown as { setEventSink(s: ((e: BridgeEvent) => void) | null): number };
  const seen: BridgeEvent[] = [];
  real.setEventSink((e) => seen.push(e));
  return { seen, attach: (fn) => real.setEventSink(fn) };
}

function setSink(api: Api, fn: ((e: BridgeEvent) => void) | null): number {
  return (api as unknown as { setEventSink(s: typeof fn): number }).setEventSink(fn);
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the installed API', () => {

  test('the three diagnostics answer without an argument', () => {
    const api = install();
    expect(api['ping']!()).toBe('pong');
    expect(api['isReady']!()).toBe('true');
    expect(api['version']!()).toBe(BRIDGE_PROTOCOL_VERSION);
  });

  test('handleCommandSync echoes the id on success and on failure', () => {
    const api = install();
    expect(JSON.parse(api['handleCommandSync']!('{"id":"c1","type":"exportMermaid"}'))).toEqual({
      ok: true,
      result: 'flowchart TD',
      id: 'c1',
    });
    expect(JSON.parse(api['handleCommandSync']!('{"id":"c2","type":"nope"}'))).toEqual({
      ok: false,
      error: 'unknown command type "nope"',
      id: 'c2',
    });
  });

  test('handleCommand returns an acceptance envelope and still queues the error', () => {
    const api = install();
    expect(JSON.parse(api['handleCommand']!('{"id":"c3","type":"clearRuleFile"}'))).toEqual({
      ok: true,
      id: 'c3',
    });
    const bad = JSON.parse(api['handleCommand']!('{"id":"c4","type":"selectStep"}')) as {
      ok: boolean;
      id: string;
    };
    expect(bad).toMatchObject({ ok: false, id: 'c4' });
    const events = JSON.parse(api['pollEventsFlat']!()) as Array<Record<string, string>>;
    expect(events.map((e) => e['type'])).toEqual(['commandError']);
  });

  test('a handler that throws comes back as a string, not as an exception', () => {
    const api = install({
      selectStep: () => {
        throw new Error('no such step');
      },
    });
    expect(
      JSON.parse(api['handleCommandSync']!('{"type":"selectStep","payload":{"uid":"X"}}')),
    ).toEqual({ ok: false, error: 'no such step', id: null });
    expect(JSON.parse(api['loadXml']!('<a/>'))).toEqual({ ok: true, result: null, id: null });
  });

  test('setZoomMode reaches its handler', () => {
    const seen: string[] = [];
    const api = install({ setZoomMode: (mode) => seen.push(mode) });
    api['handleCommand']!('{"type":"setZoomMode","payload":{"mode":"keep"}}');
    expect(seen).toEqual(['keep']);
  });

  test('exportPng hands its view to the handler, and rejects a bad one up front', () => {
    const seen: unknown[] = [];
    const api = install({
      exportPng: (options) => {
        seen.push(options);
        return Promise.resolve({ base64: 'AA==', width: 1, height: 2 });
      },
    });
    api['handleCommand']!('{"type":"exportPng","payload":{"view":"viewport"}}');
    api['handleCommand']!('{"type":"exportPng"}');
    expect(seen).toEqual([{ view: 'viewport' }, { view: 'full' }]);

    const bad = JSON.parse(api['handleCommand']!('{"id":"p","type":"exportPng","payload":{"depth":2}}'));
    expect(bad).toMatchObject({ ok: false, id: 'p' });
    expect(seen).toHaveLength(2);
  });

  test('exportPdf replies later with its id, or an error event', async () => {
    const seen: unknown[] = [];
    const api = install({
      exportPdf: (options) => {
        seen.push(options);
        return options.view === 'viewport'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ base64: 'JVBERi0=', width: 3, height: 4 });
      },
    });
    expect(JSON.parse(api['handleCommand']!('{"id":"a","type":"exportPdf","payload":{"view":"full"}}'))).toMatchObject({
      ok: true,
      id: 'a',
    });
    api['handleCommand']!('{"id":"b","type":"exportPdf","payload":{"view":"viewport"}}');
    const bad = JSON.parse(api['handleCommand']!('{"id":"c","type":"exportPdf","payload":{"view":"page"}}'));
    expect(bad).toMatchObject({ ok: false, id: 'c' });
    expect(seen).toEqual([{ view: 'full' }, { view: 'viewport' }]);

    await new Promise((r) => setTimeout(r, 0));
    const events = (JSON.parse(api['pollEvents']!()) as BridgeEvent[]).filter((e) => e.type.startsWith('exportPdf'));
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ['exportPdfResult', { id: 'a', base64: 'JVBERi0=', width: 3, height: 4 }],
      ['exportPdfError', { id: 'b', message: 'boom' }],
    ]);
  });

  test('both poll methods drain the same queue — poll one, never both', () => {
    const api = install();
    api['handleCommand']!('{"type":"nope"}');
    expect(JSON.parse(api['pollEvents']!())).toHaveLength(1);
    expect(api['pollEventsFlat']!()).toBe('[]');
  });
});

/**
 * The push channel.
 *
 * LabVIEW's newer Web Browser control exposes `LabVIEW.FireUserEvent` to code
 * run through Execute JavaScript, so the host can hand the page a closure and
 * stop draining a queue on a 200 ms timer. Everything below is that closure's
 * contract: what reaches it, in what order, and what happens when the refnum
 * behind it has gone stale.
 */
describe('setEventSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('every event reaches the sink, in dispatch order', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);

    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    bridge.enqueue('viewChanged', { view: 'tree' });
    bridge.enqueue('loadError', { message: 'bad' });

    expect(seen.map((e) => e.type)).toEqual(['fileLoaded', 'viewChanged', 'loadError']);
    expect(seen[0]!.payload).toEqual({ fileName: 'a.xml' });
    expect(typeof seen[0]!.at).toBe('number');
  });

  test('attaching flushes the backlog in order and returns how many', () => {
    const { api, bridge } = installed();
    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    bridge.enqueue('viewChanged', { view: 'both' });

    const seen: BridgeEvent[] = [];
    expect(setSink(api, (e) => seen.push(e))).toBe(2);
    expect(seen.map((e) => e.type)).toEqual(['fileLoaded', 'viewChanged']);
    // Drained by the attach, not merely copied.
    expect(api['pollEvents']!()).toBe('[]');
  });

  test('attaching to an empty queue flushes nothing', () => {
    const { api } = installed();
    expect(setSink(api, () => {})).toBe(0);
  });

  test('with a sink attached the queue stays empty — no double delivery', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.enqueue('viewChanged', { view: 'canvas' });
    // An event a command raises goes the same way.
    api['handleCommand']!('{"type":"nope"}');

    expect(seen.map((e) => e.type)).toEqual(['viewChanged', 'commandError']);
    expect(api['pollEvents']!()).toBe('[]');
    expect(api['pollEventsFlat']!()).toBe('[]');
  });

  test('detaching with null goes back to queueing', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.enqueue('viewChanged', { view: 'tree' });

    expect(setSink(api, null)).toBe(0);
    bridge.enqueue('loadError', { message: 'after' });

    expect(seen.map((e) => e.type)).toEqual(['viewChanged']);
    const queued = JSON.parse(api['pollEvents']!()) as BridgeEvent[];
    expect(queued.map((e) => e.type)).toEqual(['loadError']);
  });

  test('a sink that throws is detached, and its event is requeued', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, bridge } = installed();
    setSink(api, () => {
      throw new Error('stale refnum');
    });

    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    // Detached by that throw, so this one queues rather than throwing again.
    bridge.enqueue('loadError', { message: 'after' });

    const queued = JSON.parse(api['pollEvents']!()) as BridgeEvent[];
    expect(queued.map((e) => e.type)).toEqual(['fileLoaded', 'loadError']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('stale refnum');
  });

  test('a sink that throws mid-flush requeues the rest in order, ahead of what follows', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, bridge } = installed();
    bridge.enqueue('a');
    bridge.enqueue('b');
    bridge.enqueue('c');

    const seen: string[] = [];
    const flushed = setSink(api, (e) => {
      if (e.type === 'b') throw new Error('stale refnum');
      seen.push(e.type);
    });

    expect(flushed).toBe(1);
    expect(seen).toEqual(['a']);
    bridge.enqueue('d');
    const queued = JSON.parse(api['pollEvents']!()) as BridgeEvent[];
    expect(queued.map((e) => e.type)).toEqual(['b', 'c', 'd']);
    expect(error).toHaveBeenCalledTimes(1);
  });

  test('a throwing sink never reaches the caller — enqueue is a UI effect', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, bridge } = installed();
    setSink(api, () => {
      throw new Error('stale refnum');
    });
    expect(() => bridge.enqueue('fileLoaded', { fileName: 'a.xml' })).not.toThrow();
  });

  test('dispose drops the sink', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.dispose();
    bridge.enqueue('loadError', { message: 'after' });
    expect(seen).toEqual([]);
  });
});

/**
 * Echo-loop protection. Selection is the one piece of state both ends write,
 * so it is the one that can round-trip forever: LabVIEW sends `selectStep`,
 * the app reports `stepSelected`, LabVIEW reacts by selecting again.
 *
 * The real `selectStep` handler reaches `App.tsx`'s `reveal`, which sets React
 * state; the echo arrives later, from the effect keyed on it. These model that
 * two-step directly — a command, then the enqueue it eventually causes.
 */
describe('stepSelected origin', () => {
  test('a canvas click is "user"', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.enqueue('stepSelected', { uid: 'STEP-1', name: 'Turn off Load' });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('stepSelected');
    expect(seen[0]!.origin).toBe('user');
    expect(seen[0]!.payload).toEqual({ uid: 'STEP-1', name: 'Turn off Load' });
  });

  test('the echo of a selectStep command is "host"', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    api['handleCommand']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });

    expect(seen.map((e) => e.origin)).toEqual(['host']);
  });

  test('the host flag is one-shot — the next click is "user" again', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    api['handleCommand']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });
    bridge.enqueue('stepSelected', { uid: 'STEP-2' });

    expect(seen.map((e) => e.origin)).toEqual(['host', 'user']);
  });

  test('handleCommandSync tags its echo the same way', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    api['handleCommandSync']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });

    expect(seen.map((e) => e.origin)).toEqual(['host']);
  });

  test('a selectStep for the step already selected emits nothing', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });
    expect(seen).toHaveLength(1);

    api['handleCommand']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });
    expect(seen).toHaveLength(1);

    // And the suppressed echo left no flag behind to mis-tag the next click.
    bridge.enqueue('stepSelected', { uid: 'STEP-2' });
    expect(seen.map((e) => e.origin)).toEqual(['user', 'user']);
  });

  test('the step is still revealed, even when the selection does not change', () => {
    const revealed: string[] = [];
    const { api } = installed({ selectStep: (uid) => revealed.push(uid) });
    api['handleCommand']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    api['handleCommand']!('{"type":"selectStep","payload":{"uid":"STEP-1"}}');
    // Suppressing the *event* is not the same as ignoring the command: a
    // second selectStep still re-centres a step the operator scrolled away
    // from.
    expect(revealed).toEqual(['STEP-1', 'STEP-1']);
  });

  test('clearing the selection reports once, and only once', () => {
    const { api, bridge } = installed();
    const { seen } = sink(api);
    bridge.enqueue('stepSelected', null);
    bridge.enqueue('stepSelected', null);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.origin).toBe('user');
    expect(seen[0]!.payload).toBeNull();
  });

  test('origin survives both wire shapes', () => {
    const { api, bridge } = installed();
    bridge.enqueue('stepSelected', { uid: 'STEP-1' });
    const nested = JSON.parse(api['pollEvents']!()) as BridgeEvent[];
    expect(nested[0]!.origin).toBe('user');

    bridge.enqueue('stepSelected', { uid: 'STEP-2' });
    const flat = JSON.parse(api['pollEventsFlat']!()) as Array<Record<string, unknown>>;
    expect(flat[0]!['origin']).toBe('user');
    expect(flat[0]!['payload']).toBe('{"uid":"STEP-2"}');
  });

  test('every other event type carries no origin key at all', () => {
    const { api, bridge } = installed();
    bridge.enqueue('viewChanged', { view: 'tree' });
    const flat = JSON.parse(api['pollEventsFlat']!()) as Array<Record<string, unknown>>;
    expect(flat[0]).not.toHaveProperty('origin');

    const { api: api2, bridge: bridge2 } = installed();
    bridge2.enqueue('viewChanged', { view: 'tree' });
    const nested = JSON.parse(api2['pollEvents']!()) as BridgeEvent[];
    expect(nested[0]).not.toHaveProperty('origin');
  });
});

/**
 * The exact text LabVIEW sends, run verbatim.
 *
 * Execute JavaScript hands the control a statement list with `Arg` in scope
 * and wraps it in a function itself, which is what `new Function` models here.
 * Everything else in this file tests the API as TypeScript sees it; this tests
 * it the way the only caller that matters will actually call it — untyped,
 * through a string, with a `LabVIEW` global this repo does not define and must
 * never reference.
 */
describe('the LabVIEW attach snippet', () => {
  const SNIPPET = [
    'var refnum = JSON.parse(Arg).refnum;',
    'window.SeqFlowBridge.setEventSink(function (evt) {',
    '  LabVIEW.FireUserEvent(refnum, JSON.stringify(evt));',
    '});',
    'return 0;',
  ].join('\n');

  afterEach(() => {
    delete (globalThis as { LabVIEW?: unknown }).LabVIEW;
  });

  test('attaches, and every event arrives at FireUserEvent as JSON text', () => {
    const fired: Array<[number, string]> = [];
    (globalThis as { LabVIEW?: unknown }).LabVIEW = {
      FireUserEvent: (ref: number, text: string) => fired.push([ref, text]),
    };
    const { bridge } = installed();

    const run = new Function('Arg', SNIPPET) as (arg: string) => number;
    expect(run('{"refnum":42}')).toBe(0);

    bridge.enqueue('stepSelected', { uid: 'STEP-1', stepNumber: '2.1' });

    expect(fired).toHaveLength(1);
    expect(fired[0]![0]).toBe(42);
    const evt = JSON.parse(fired[0]![1]) as BridgeEvent;
    expect(evt).toMatchObject({
      type: 'stepSelected',
      origin: 'user',
      payload: { uid: 'STEP-1', stepNumber: '2.1' },
    });
    expect(typeof evt.at).toBe('number');
  });

  test('a refnum that went stale detaches the sink rather than breaking the page', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as { LabVIEW?: unknown }).LabVIEW = {
      FireUserEvent: () => {
        throw new Error('invalid refnum');
      },
    };
    const { api, bridge } = installed();
    (new Function('Arg', SNIPPET) as (arg: string) => number)('{"refnum":42}');

    expect(() => bridge.enqueue('fileLoaded', { fileName: 'a.xml' })).not.toThrow();
    const queued = JSON.parse(api['pollEvents']!()) as BridgeEvent[];
    expect(queued.map((e) => e.type)).toEqual(['fileLoaded']);
    error.mockRestore();
  });
});

/**
 * `attachLabVIEW` and the ASCII-only wire. LabVIEW strings are Windows-1252
 * bytes, so anything past U+007E has to cross as a `\uXXXX` escape.
 */
const ASCII = /^[\x00-\x7e]*$/;

describe('toAsciiJson', () => {
  const samples = ['2 › 2.1', '25 °C', '5 µA', '10 Ω', '± 0.5', 'ok \u{1f600}', '\u007f'];

  test.each(samples)('%s is ASCII and round-trips', (text) => {
    const value = { text, nested: [text] };
    const out = toAsciiJson(value);
    expect(out).toMatch(ASCII);
    expect(JSON.parse(out)).toEqual(value);
  });

  test('lowercase 4-digit hex, a surrogate pair as two escapes', () => {
    const bs = String.fromCharCode(92);
    expect(toAsciiJson(String.fromCodePoint(0x203a))).toBe(`"${bs}u203a"`);
    expect(toAsciiJson(String.fromCodePoint(0x1f600))).toBe(`"${bs}ud83d${bs}ude00"`);
  });
});

describe('attachLabVIEW', () => {
  type Fired = Array<[number, string]>;
  type Lv = Api & { attachLabVIEW(refnum: unknown): string };

  function withLabVIEW(fire: (ref: number, msg: string) => unknown = () => {}): {
    api: Lv;
    bridge: InstalledBridge;
    fired: Fired;
  } {
    const { api, bridge } = installed();
    const fired: Fired = [];
    (window as { LabVIEW?: unknown }).LabVIEW = {
      FireUserEvent: (ref: number, msg: string) => {
        fired.push([ref, msg]);
        return fire(ref, msg);
      },
    };
    return { api: api as Lv, bridge, fired };
  }

  const outer = (msg: string) =>
    JSON.parse(msg) as { type: string; payload: string; at: number; origin?: string };
  const types = (api: Api) => (JSON.parse(api['pollEvents']!()) as BridgeEvent[]).map((e) => e.type);

  test('not attached: the queue and pollEvents() behave exactly as before', () => {
    const { api, bridge, fired } = withLabVIEW();
    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    expect(fired).toEqual([]);
    expect(types(api)).toEqual(['fileLoaded']);
  });

  test('bridgeReady first, then the pre-attach backlog in order, then nothing queued', () => {
    const { api, bridge, fired } = withLabVIEW();
    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    bridge.enqueue('loadError', { message: 'b' });
    expect(api.attachLabVIEW(7)).toBe('3');
    expect(fired.map(([ref, m]) => [ref, outer(m).type])).toEqual([
      [7, 'bridgeReady'],
      [7, 'fileLoaded'],
      [7, 'loadError'],
    ]);
    expect(outer(fired[0]![1]).payload).toBe('null');
    expect(api['pollEvents']!()).toBe('[]');
  });

  test('a second call does not re-send anything', () => {
    const { api, fired } = withLabVIEW();
    api.attachLabVIEW(7);
    expect(api.attachLabVIEW(7)).toBe('0');
    expect(fired).toHaveLength(1);
  });

  test('attached: one fire per event, ASCII, payload a string that parses back', () => {
    const { api, bridge, fired } = withLabVIEW();
    api.attachLabVIEW(7);
    fired.length = 0;
    const payload = { uid: 'S1', path: 'Main › Pulse 1', unit: '°C' };
    bridge.enqueue('stepSelected', payload);
    bridge.enqueue('stepSelected', null);

    expect(fired).toHaveLength(2);
    for (const [, msg] of fired) {
      expect(msg).toMatch(ASCII);
      expect(typeof outer(msg).payload).toBe('string');
    }
    expect(outer(fired[0]![1])).toMatchObject({ type: 'stepSelected', origin: 'user' });
    expect(JSON.parse(outer(fired[0]![1]).payload)).toEqual(payload);
    expect(JSON.parse(outer(fired[1]![1]).payload)).toBeNull();
    expect(api['pollEvents']!()).toBe('[]');
  });

  test('FireUserEvent throws: the event is queued, stays pollable, and the error is recorded', () => {
    let fail = false;
    const { api, bridge } = withLabVIEW(() => {
      if (fail) throw new Error('invalid refnum');
    });
    api.attachLabVIEW(7);
    fail = true;
    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    expect(types(api)).toEqual(['fileLoaded']);
    expect((window as { __seqflowError?: string }).__seqflowError).toBe('invalid refnum');
    fail = false;
    bridge.enqueue('loadError', { message: 'x' });
    expect(api['pollEvents']!()).toBe('[]'); // still attached
  });

  test('outside LabVIEW it is inert: nothing is sent and every event queues', () => {
    const { api, bridge } = installed();
    expect((api as Lv).attachLabVIEW(7)).toBe('0');
    bridge.enqueue('fileLoaded', { fileName: 'a.xml' });
    expect(types(api)).toEqual(['bridgeReady', 'fileLoaded']);
  });

  test('a non-numeric refnum is an error envelope, not an exception', () => {
    const { api, fired } = withLabVIEW();
    expect(JSON.parse(api.attachLabVIEW('7'))).toMatchObject({ ok: false });
    expect(fired).toEqual([]);
  });

  test('handleCommandSync getState: ASCII, parses, and still echoes the id', () => {
    const state = { path: 'Main › Pulse 1', unit: 'Ω' };
    const { api } = installed({ getState: () => state });
    const out = api['handleCommandSync']!('{"type":"getState","id":"g1"}');
    expect(out).toMatch(ASCII);
    expect(JSON.parse(out)).toEqual({ ok: true, result: state, id: 'g1' });
    expect(JSON.parse(api['handleCommandSync']!('{"type":"getState"}'))).toHaveProperty('id', null);
  });
});
