/**
 * A `Promise` polyfill, installed only where the runtime's own is missing.
 *
 * LabVIEW 2026's Web Browser control is community-reported to lack native
 * `Promise` support (see a LabVIEW user's own report:
 * <https://forums.ni.com/t5/LabVIEW/Anyone-making-UI-s-using-the-2026-web-control/td-p/4482407>)
 * — confirmed against a real customer sequence in this project's own LabVIEW
 * testing: a file loaded and parsed correctly (parsing, the signal index, the
 * criteria table and the linter are all synchronous, plain JS) but the canvas
 * never rendered and the toolbar stuck on "Laying out…", because
 * `layout/elk.ts`'s ELK pipeline is built entirely on `Promise` — a Web
 * Worker wrapped in `Promise.race` for its own timeout guard, consumed with
 * `.then()` in `App.tsx`.
 *
 * Imported first in `main.tsx`, before anything else, so every later
 * module — elkjs's own internals included, which use `Promise` themselves to
 * wrap the worker's `postMessage`/`onmessage` handshake — sees a working
 * `Promise` from the moment it runs. A no-op wherever a real `Promise`
 * already exists, so this changes nothing for the browser/Electron/Tauri
 * builds this app already ships as.
 */

import PromisePolyfill from 'promise-polyfill';

/**
 * A microtask-speed scheduler for the polyfill's `.then()` continuations.
 *
 * **Confirmed in production, not theoretical**: installing the polyfill alone
 * made the app correct again — a 133-node file rendered — but layout took
 * 5-9 s where a native `Promise` does it in a few hundred ms. The cause is
 * the polyfill's own default: `Promise._immediateFn` falls back to
 * `setTimeout(fn, 0)` (`setImmediate` does not exist in a browser), and
 * browsers clamp a timeout nested more than a few levels deep in the same
 * task chain to a ~4 ms minimum. elkjs's worker handshake and our own
 * `layout()` chain many `.then()` hops per layout — dozens on a small file,
 * hundreds on this one — so a few milliseconds of clamped delay *per hop*
 * compounds into seconds. `queueMicrotask` schedules a true microtask with no
 * timer involved at all, so no clamp applies; it is a separate Window API
 * from `Promise` itself and a reasonable bet to still be present even where
 * the `Promise` constructor specifically is not. `MutationObserver` is the
 * fallback below it — the classic zero-dependency microtask emulation technique
 * predating `queueMicrotask`, needing nothing but the DOM. Only if neither
 * exists does this fall through to the polyfill's own (slow, but correct)
 * default.
 */
/**
 * The polyfill's own `_immediateFn` type accepts `string | (() => void)` to
 * match `setTimeout`'s signature — in practice, the library only ever calls
 * it with a function (see the source it overrides), never a string.
 */
type Immediate = (handler: string | (() => void)) => void;

function fastImmediate(): Immediate | null {
  if (typeof queueMicrotask === 'function') {
    return (handler) => queueMicrotask(handler as () => void);
  }

  if (typeof MutationObserver === 'function') {
    const queue: Array<() => void> = [];
    const node = document.createTextNode('');
    new MutationObserver(() => {
      const pending = queue.splice(0, queue.length);
      for (const fn of pending) fn();
    }).observe(node, { characterData: true });
    let toggle = 0;
    return (handler) => {
      queue.push(handler as () => void);
      toggle = toggle ? 0 : 1;
      node.data = String(toggle);
    };
  }

  return null;
}

if (typeof window.Promise === 'undefined') {
  window.Promise = PromisePolyfill;
  const immediate = fastImmediate();
  if (immediate !== null) PromisePolyfill._immediateFn = immediate;
}
