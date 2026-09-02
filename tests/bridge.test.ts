/**
 * The LabVIEW bridge's wire format. Only `protocol.ts` is tested here —
 * `install.ts` touches `window`, which this suite's `environment: 'node'`
 * does not provide (see vitest.config.ts), so it is verified by hand in a
 * browser instead, the same way `ui/download.ts` and `Export.tsx` are.
 */

import { describe, expect, test } from 'vitest';

import {
  BridgeError,
  EventQueue,
  asFilePayload,
  asSelectStepPayload,
  asStepStatusPayload,
  asStepStatusesPayload,
  isExecStatus,
  parseCommand,
  serialiseEvents,
} from '../src/bridge/protocol';

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

describe('execution status', () => {
  test('isExecStatus recognises exactly the five values', () => {
    for (const status of ['pending', 'running', 'pass', 'fail', 'skipped']) {
      expect(isExecStatus(status)).toBe(true);
    }
    expect(isExecStatus('done')).toBe(false);
    expect(isExecStatus(1)).toBe(false);
    expect(isExecStatus(null)).toBe(false);
  });

  test('setStepStatus payload', () => {
    expect(asStepStatusPayload({ uid: 'STEP-1', status: 'running' })).toEqual({
      uid: 'STEP-1',
      status: 'running',
    });
    expect(() => asStepStatusPayload({ uid: 'STEP-1', status: 'jogging' })).toThrow(
      /payload.status must be one of pending\/running\/pass\/fail\/skipped/,
    );
    expect(() => asStepStatusPayload({ status: 'pass' })).toThrow(/payload.uid must be a string/);
  });

  test('setStepStatuses keeps the well-formed entries and drops the rest', () => {
    const parsed = asStepStatusesPayload({
      statuses: [
        { uid: 'A', status: 'pass' },
        { uid: 'B', status: 'not-a-status' },
        { status: 'fail' },
        'not even an object',
        { uid: 'C', status: 'fail' },
      ],
    });
    expect(parsed.statuses).toEqual([
      { uid: 'A', status: 'pass' },
      { uid: 'C', status: 'fail' },
    ]);
  });

  test('a non-array statuses field is rejected outright', () => {
    expect(() => asStepStatusesPayload({ statuses: 'nope' })).toThrow(
      /payload.statuses must be an array/,
    );
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
    queue.push('resetExecution');
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
