/// <reference types="vite/client" />

/** `?raw` imports: rules.yaml is bundled as text, not fetched (NFR-2). */
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

/**
 * `?worker&inline` emits the worker as a blob rather than a separate asset,
 * which is what keeps the build to a single self-contained .html (NFR-3).
 */
declare module '*?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
