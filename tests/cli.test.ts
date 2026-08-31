/**
 * The CLI — spec section 10, Phase 3 task 7.
 *
 * This is the sharpest determinism test in the suite. Every other one compares
 * two calls inside one process; this one compares a Node child process against
 * the emitter running here, so a `Map` order or a locale that happened to agree
 * within one run has to agree across two.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { parse } from '../src/core/parse';
import { toMermaid, toMermaidSplit } from '../src/emit/mermaid';
import { domParser, fixtureXml, repoRoot, rules } from './helpers';

const graph = parse(fixtureXml, { rules, domParser });
const cli = join(repoRoot, 'bin', 'seqflow.mjs');
const fixture = join(repoRoot, 'fixtures', 'Sequence_XML.xml');
const work = mkdtempSync(join(tmpdir(), 'seqflow-cli-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function seqflow(...args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('emitting', () => {
  test('depth-2 writes the same bytes the app produces', () => {
    const out = join(work, 'depth2.mmd');
    const run = seqflow(fixture, '--mode', 'depth-2', '--out', out);
    expect(run.status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(
      toMermaid(graph, rules, { mode: { kind: 'depth', depth: 2 } }),
    );
  });

  test('full and overview agree too', () => {
    expect(seqflow(fixture, '--stdout').stdout).toBe(toMermaid(graph, rules));
    expect(seqflow(fixture, '--mode', 'overview', '--stdout').stdout).toBe(
      toMermaid(graph, rules, { mode: { kind: 'overview' } }),
    );
  });

  test('--direction and --no-groups reach the emitter', () => {
    expect(seqflow(fixture, '--direction', 'LR', '--stdout').stdout).toBe(
      toMermaid(graph, rules, { direction: 'LR' }),
    );
    expect(seqflow(fixture, '--no-groups', '--stdout').stdout).toBe(
      toMermaid(graph, rules, { groups: false }),
    );
  });

  test('split writes four files, matching the app', () => {
    const dir = join(work, 'split');
    expect(seqflow(fixture, '--mode', 'split', '--out', dir).status).toBe(0);
    const expected = toMermaidSplit(graph, rules, 'Sequence_XML');
    expect(expected.length).toBe(4);
    for (const file of expected) {
      expect(readFileSync(join(dir, file.name), 'utf8')).toBe(file.text);
    }
  });

  test('a second run produces no diff', () => {
    const out = join(work, 'twice.mmd');
    seqflow(fixture, '--mode', 'depth-3', '--out', out);
    const first = readFileSync(out, 'utf8');
    seqflow(fixture, '--mode', 'depth-3', '--out', out);
    expect(readFileSync(out, 'utf8')).toBe(first);
  });
});

describe('--check, the staleness guard', () => {
  const out = join(work, 'check.mmd');

  test('exits 0 when the file on disk is current', () => {
    seqflow(fixture, '--mode', 'depth-2', '--out', out);
    expect(seqflow(fixture, '--mode', 'depth-2', '--out', out, '--check').status).toBe(0);
  });

  test('exits 1 and names the file when it is stale', () => {
    writeFileSync(out, 'flowchart TD\n  n1["nope"]\n');
    const run = seqflow(fixture, '--mode', 'depth-2', '--out', out, '--check');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('out of date');
    // ...and it wrote nothing.
    expect(readFileSync(out, 'utf8')).toContain('nope');
  });

  test('a missing file is stale, not a crash', () => {
    const run = seqflow(fixture, '--out', join(work, 'absent.mmd'), '--check');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing');
  });
});

describe('argument handling', () => {
  test('no input prints usage and exits 1', () => {
    const run = seqflow();
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('--mode');
  });

  test('--help exits 0', () => {
    expect(seqflow('--help').status).toBe(0);
  });

  test('an unreadable file is a message, not a stack trace', () => {
    const run = seqflow(join(work, 'nope.xml'));
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/^seqflow: /);
    expect(run.stderr).not.toContain('at Object');
  });

  test('an unknown mode names the modes that exist', () => {
    const run = seqflow(fixture, '--mode', 'sideways');
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('depth-N');
  });

  test('an unknown option is refused rather than ignored', () => {
    expect(seqflow(fixture, '--colour').status).toBe(2);
  });

  test('broken XML reports the parse error', () => {
    const bad = join(work, 'bad.xml');
    writeFileSync(bad, '<TestSequence><Sequence></TestSequence>');
    const run = seqflow(bad);
    expect(run.status).toBe(2);
    // xmldom writes its own fatalError line first, so this is not anchored.
    expect(run.stderr).toContain('seqflow: ');
  });
});

describe('what it writes', () => {
  test('it never writes sequence XML — invariant 4', () => {
    const before = readFileSync(fixture, 'utf8');
    seqflow(fixture, '--mode', 'split', '--out', join(work, 'guard'));
    expect(readFileSync(fixture, 'utf8')).toBe(before);
  });
});
