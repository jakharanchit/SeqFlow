/// <reference types="vite/client" />

/**
 * `?raw` imports: rules.yaml and the ELK worker are both bundled as text, not
 * fetched (NFR-2) — `*?raw` is already declared by vite/client, but this one
 * is kept for the more specific `.yaml?raw` extension.
 */
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
