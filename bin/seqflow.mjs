#!/usr/bin/env node
/**
 * seqflow CLI entry point — spec section 10, Phase 3 task 7.
 *
 *   node bin/seqflow.mjs fixtures/Sequence_XML.xml --mode depth-2
 *   node bin/seqflow.mjs seq.xml --mode split --out docs/
 *   node bin/seqflow.mjs seq.xml --check       # exit 1 if the .mmd is stale
 *
 * All this file does is make `src/` importable, then hand over to `cli.mjs`.
 *
 * The core is written for a bundler: `import { … } from './resolve'`, no
 * extension. Node's ESM resolver requires one, so a bare `node bin/…` fails on
 * the parser's *internal* imports — nothing the CLI writes could avoid it. The
 * options were a build step, a runtime dependency (vite-node), or teaching the
 * resolver the one rule it is missing. This is the third: a synchronous resolve
 * hook that appends `.ts` when a relative specifier inside `src/` has no
 * extension. Node 22.15+ strips the types itself, so nothing is compiled and
 * the CLI has no dependency the app does not already have.
 *
 * The hook has to be registered before anything imports the core, and static
 * imports are hoisted — hence the dynamic import at the bottom, and hence two
 * files rather than one.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      const parent = context.parentURL;
      if (parent !== undefined && parent.startsWith('file:')) {
        const candidate = new URL(`${specifier}.ts`, parent);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { run } = await import('./cli.mjs');
process.exitCode = run(process.argv.slice(2));
