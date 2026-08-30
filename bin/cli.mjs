/**
 * seqviz CLI, the part that does the work. `bin/seqviz.mjs` is the entry point;
 * it teaches Node how to resolve the core's imports before loading this.
 *
 * Read a sequence XML, emit Mermaid. That is the whole of it: the core has been
 * Node-clean since Phase 1 and every test already runs it under @xmldom/xmldom,
 * so this is an entry point rather than a port.
 *
 * The point is the staleness check spec section 8 alludes to — a CI job that
 * regenerates the .mmd and fails if it differs. That is only possible because
 * the emitter is byte-deterministic, and it is the strongest test of that
 * guarantee there is: two different runtimes, same bytes.
 *
 * This writes .mmd and nothing else. It never writes sequence XML (invariant 4).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';

import { parse, ParseError } from '../src/core/parse.ts';
import { loadRules } from '../src/core/rules.ts';
import { toMermaid, toMermaidSplit } from '../src/emit/mermaid.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const USAGE = `seqviz — test sequence XML to Mermaid

  node bin/seqviz.mjs <sequence.xml> [options]

  --mode <mode>     full (default) | overview | depth-N | split
  --out <path>      output file, or directory for --mode split
  --rules <path>    rule file (default: rules.yaml beside the repo)
  --direction <d>   TD (default) | LR
  --no-groups       do not draw sequences as subgraphs
  --stdout          write to stdout instead of a file
  --check           write nothing; exit 1 if the file on disk differs
  --help
`;

/** Minimal flag parsing. A dependency for this would be absurd. */
function parseArgs(argv) {
  const options = {
    input: null,
    mode: 'full',
    out: null,
    rules: null,
    direction: 'TD',
    groups: true,
    stdout: false,
    check: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--stdout':
        options.stdout = true;
        break;
      case '--check':
        options.check = true;
        break;
      case '--no-groups':
        options.groups = false;
        break;
      case '--mode':
      case '--out':
      case '--rules':
      case '--direction': {
        const value = argv[++i];
        if (value === undefined) throw new Error(`${arg} needs a value`);
        options[arg.slice(2)] = value;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        if (options.input !== null) throw new Error('only one input file');
        options.input = arg;
    }
  }
  return options;
}

/** `depth-3` -> { kind: 'depth', depth: 3 }. Same modes the app offers. */
function toMode(text) {
  if (text === 'full' || text === 'split') return { kind: text };
  if (text === 'overview') return { kind: 'overview' };
  const match = /^depth-(\d+)$/.exec(text);
  if (match !== null) return { kind: 'depth', depth: Number(match[1]) };
  throw new Error(`unknown mode "${text}" — full, overview, depth-N or split`);
}

function stem(fileName) {
  const base = basename(fileName);
  const cut = base.lastIndexOf('.');
  return cut <= 0 ? base : base.slice(0, cut);
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help || options.input === null) {
    process.stdout.write(USAGE);
    return options.help ? 0 : 1;
  }

  const rulesPath = options.rules ?? join(repoRoot, 'rules.yaml');
  const rules = loadRules(readFileSync(rulesPath, 'utf8'));
  const xml = readFileSync(options.input, 'utf8');
  const graph = parse(xml, { rules, domParser: new DOMParser() });

  for (const warning of graph.warnings) {
    process.stderr.write(`warning ${warning.code}: ${warning.message}\n`);
  }

  const mode = toMode(options.mode);
  const base = stem(options.input);
  const emitOptions = { direction: options.direction === 'LR' ? 'LR' : 'TD', groups: options.groups };

  const files =
    mode.kind === 'split'
      ? toMermaidSplit(graph, rules, base, emitOptions)
      : [{ name: `${base}.mmd`, title: base, text: toMermaid(graph, rules, { ...emitOptions, mode }) }];

  if (options.stdout) {
    for (const file of files) process.stdout.write(file.text);
    return 0;
  }

  // --out names the file for a single emit and the directory for a split.
  const directory =
    mode.kind === 'split'
      ? (options.out ?? dirname(resolve(options.input)))
      : dirname(resolve(options.out ?? join(dirname(resolve(options.input)), files[0].name)));
  const pathFor = (file) =>
    mode.kind === 'split' || options.out === null
      ? join(directory, file.name)
      : resolve(options.out);

  if (options.check) {
    let stale = 0;
    for (const file of files) {
      const path = pathFor(file);
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (current === file.text) continue;
      stale++;
      process.stderr.write(
        `${path}: ${current === null ? 'missing' : 'out of date'} — regenerate it\n`,
      );
    }
    if (stale === 0) process.stderr.write(`${files.length} file(s) up to date\n`);
    return stale === 0 ? 0 : 1;
  }

  mkdirSync(directory, { recursive: true });
  for (const file of files) {
    const path = pathFor(file);
    writeFileSync(path, file.text);
    process.stderr.write(`${path}\n`);
  }
  return 0;
}

/** Returns a process exit code. Never throws: a bad file is a message, not a stack. */
export function run(argv) {
  try {
    return main(argv);
  } catch (err) {
    const message = err instanceof ParseError || err instanceof Error ? err.message : String(err);
    process.stderr.write(`seqviz: ${message}\n`);
    return 2;
  }
}
