import react from '@vitejs/plugin-react';
/// <reference types="vitest/config" />
import { defaultClientConditions, defineConfig } from 'vite';

// Cross-origin isolation lets onnxruntime-web use multiple WASM threads.
// Production gets the same headers from public/_headers (Cloudflare).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  // Use onnxruntime-web's build that loads its WASM glue from wasmPaths
  // (public/ort/) instead of inlining it: inlined, its thread workers would
  // re-run our whole simulation worker.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@mujoco/mujoco', 'onnxruntime-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', testTimeout: 120_000 },
});
