import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts on purpose: vitest bundles its own copy of
// vite, and mixing the two Plugin type declarations trips
// exactOptionalPropertyTypes. The core is pure TS, so the tests need no plugins.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
