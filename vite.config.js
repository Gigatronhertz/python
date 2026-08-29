import { defineConfig } from 'vite';

// SharedArrayBuffer (what makes blocking input() possible) is only exposed to
// cross-origin isolated pages, so dev and preview must send the same headers
// that vercel.json sets in production.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Pyodide is served from public/ untouched; don't let Vite try to inline it.
    assetsInlineLimit: 4096,
  },
});
