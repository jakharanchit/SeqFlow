import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// NFR-2/NFR-3: one self-contained .html, no network at runtime. The ELK
// worker is inlined as a blob by `worker.format: 'es'` + singlefile.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    cssCodeSplit: false,
  },
});
