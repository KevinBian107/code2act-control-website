// Copy the Python export (c2a/webdemo) into public/assets and tests/fixtures,
// and onnxruntime-web's WASM runtime into public/ort.
// Usage: node scripts/sync_assets.mjs [path/to/code2act/outputs/webdemo]
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(process.argv[2] ?? '../outputs/webdemo');
const assets = resolve('public/assets');
const ort = resolve('public/ort');

mkdirSync(assets, { recursive: true });
mkdirSync(ort, { recursive: true });
mkdirSync(resolve('tests/fixtures'), { recursive: true });

const LIMIT = 25 * 1024 * 1024; // Cloudflare per-file limit
const copy = (from, to) => {
  const size = statSync(from).size;
  if (size > LIMIT) throw new Error(`${from} is ${size} bytes, over the 25 MiB limit`);
  copyFileSync(from, to);
  console.log(`${(size / 1e6).toFixed(1).padStart(6)} MB  ${to}`);
};
for (const f of ['rodent_c2a.xml', 'controller.onnx', 'manifest.json', 'starts.json',
  'symbols.json', 'pca.json']) copy(`${src}/${f}`, `${assets}/${f}`);
copy(`${src}/fixture_tour.json`, resolve('tests/fixtures/fixture_tour.json'));
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  copy(resolve('node_modules/onnxruntime-web/dist', f), `${ort}/${f}`);
}
