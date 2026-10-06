import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Absolute, not '/src/...': the dev pre-bundler (esbuild) reads a leading
// slash as the drive root, while the build reads it as the project root.
const empty = fileURLToPath(new URL('./src/ui/empty.ts', import.meta.url));

// NFR-2/NFR-3: one self-contained .html, no network at runtime. The ELK
// worker is inlined as a blob by `worker.format: 'es'` + singlefile.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // jsPDF's optional deps serve only its .html(); singlefile would inline them.
  resolve: {
    alias: {
      html2canvas: empty,
      dompurify: empty,
      canvg: empty,
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    cssCodeSplit: false,
  },
});
