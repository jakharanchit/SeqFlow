/**
 * seqflow CLI, the part that does the work. `bin/seqflow.mjs` is the entry
 * point; it teaches Node how to resolve the core's imports before loading this.
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

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';

import { parse, ParseError } from '../src/core/parse.ts';
import { mergeProfiles, profile, suggestRules, unknowns } from '../src/core/profile.ts';
import { loadRules } from '../src/core/rules.ts';
import { toMermaid, toMermaidSplit } from '../src/emit/mermaid.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const USAGE = `seqflow — test sequence XML to Mermaid

  node bin/seqflow.mjs <sequence.xml> [options]

  --mode <mode>     full (default) | overview | depth-N | split
  --out <path>      output file, or directory for --mode split
  --rules <path>    rule file (default: rules.yaml beside the repo)
  --direction <d>   TD (default) | LR
  --no-groups       do not draw sequences as subgraphs
  --stdout          write to stdout instead of a file
  --check           write nothing; exit 1 if the file on disk differs
  --profile         write nothing; report what the rule file does not know
  --audit <dir>     parse every .xml under a directory; report, and exit 1 on
                    any hard failure. Point it at a corpus, not a fixture.
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
    profile: false,
    audit: null,
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
      case '--profile':
        options.profile = true;
        break;
      case '--no-groups':
        options.groups = false;
        break;
      case '--audit':
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

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/**
 * Lines are assembled into an array and joined with this, rather than carrying
 * escape sequences around. Report text is the one place a stray escape is both
 * easy to introduce and invisible until someone reads the output.
 */
const NL = String.fromCharCode(10);

/** Every .xml under a directory, recursively, in a stable order. */
function xmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...xmlFiles(path));
    else if (/[.]xml$/i.test(name)) out.push(path);
  }
  return out;
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * The table both --profile and --audit print: what the rule file knows, what
 * it does not, and the YAML to close the gap. Returns the number of gaps.
 */
function writeProfileReport(p, rules, out) {
  const rows = [...p.values()].sort(
    (a, b) => b.count - a.count || (a.element < b.element ? -1 : 1),
  );
  const width = Math.max(7, ...rows.map((r) => r.element.length));

  const lines = [`${pad('element', width)}  count  status`];
  for (const r of rows) {
    // An element the rules call a leaf while the file nests steps inside it is
    // the one disagreement worth shouting about: left alone it loses a subtree.
    const note =
      r.withStepChildren > 0 && r.status !== 'container'
        ? 'HOLDS STEPS -> containers:'
        : r.status;
    const targets =
      r.targets.length === 0 ? '' : `  targets: ${r.targets.map((t) => t.attr).join(', ')}`;
    lines.push(`${pad(r.element, width)}  ${String(r.count).padStart(5)}  ${note}${targets}`);
  }

  const gaps = unknowns(p);
  lines.push('', `${gaps.length} element(s) the rule file has no answer for`);
  const fragment = suggestRules(p, rules);
  if (fragment !== '') lines.push('', 'starter rules.yaml fragment:', '', fragment);
  out.write(lines.join(NL) + NL);
  return gaps.length;
}

/**
 * Parse every file in a corpus and check the invariants that hold for *any*
 * sequence, whatever its dialect.
 *
 * Deliberately not counts. A corpus is too large and too varied to have
 * expected numbers, and pinning them would make this a fixture pile by another
 * name — which is the thing it exists to avoid. What it can insist on is that
 * every file produced a graph, that the graph hangs together, and that the
 * emitter is deterministic. The aggregate profile underneath is the work list.
 */
function auditCorpus(dir, rules, emitOptions) {
  const files = xmlFiles(dir);
  if (files.length === 0) throw new Error(`no .xml files under ${dir}`);

  const parts = [];
  const rows = [];
  let failed = 0;

  for (const path of files) {
    const name = path.slice(dir.length + 1);
    const xml = readFileSync(path, 'utf8');

    try {
      const graph = parse(xml, { rules, domParser: new DOMParser() });
      parts.push(profile(new DOMParser().parseFromString(xml, 'application/xml'), rules));

      const problems = [];
      if (!graph.nodes.has(graph.entry)) problems.push('entry is not a node');
      const orphans = [...graph.nodes.values()].filter(
        (n) => n.parent !== null && !graph.nodes.has(n.parent),
      );
      if (orphans.length > 0) problems.push(`${orphans.length} orphaned node(s)`);
      const again = parse(xml, { rules, domParser: new DOMParser() });
      if (toMermaid(graph, rules, emitOptions) !== toMermaid(again, rules, emitOptions)) {
        problems.push('emit is not deterministic');
      }

      if (problems.length > 0) failed++;
      rows.push({
        name,
        nodes: graph.nodes.size,
        edges: graph.edges.length,
        warnings: graph.warnings.length,
        status: problems.length === 0 ? 'ok' : problems.join('; '),
      });
    } catch (err) {
      failed++;
      rows.push({
        name,
        nodes: 0,
        edges: 0,
        warnings: 0,
        status: `FAILED - ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const width = Math.max(4, ...rows.map((r) => r.name.length));
  const lines = [`${pad('file', width)}  nodes  edges  warn  status`];
  for (const r of rows) {
    lines.push(
      `${pad(r.name, width)}  ${String(r.nodes).padStart(5)}  ${String(r.edges).padStart(5)}` +
        `  ${String(r.warnings).padStart(4)}  ${r.status}`,
    );
  }
  lines.push('', `${rows.length} file(s), ${failed} failed`, '', 'across the corpus:', '');
  process.stdout.write(lines.join(NL) + NL);

  writeProfileReport(mergeProfiles(parts), rules, process.stdout);
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help || (options.input === null && options.audit === null)) {
    process.stdout.write(USAGE);
    return options.help ? 0 : 1;
  }

  const rulesPath = options.rules ?? join(repoRoot, 'rules.yaml');
  const rules = loadRules(readFileSync(rulesPath, 'utf8'));

  if (options.audit !== null) {
    return auditCorpus(resolve(options.audit), rules, { direction: 'TD', groups: true });
  }

  const xml = readFileSync(options.input, 'utf8');

  // --profile reads the document, not the graph. The elements it reports on are
  // precisely the ones the parser could not place, and a file that fails to parse
  // outright still has them — so it runs before `parse` and never needs it to
  // have succeeded.
  if (options.profile) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return writeProfileReport(profile(doc, rules), rules, process.stdout) === 0 ? 0 : 1;
  }

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
    process.stderr.write(`seqflow: ${message}\n`);
    return 2;
  }
}
