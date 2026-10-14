# Code2Act Control

Steer a simulated biomechanical rat with discrete behavior symbols, live in the browser.

This demo accompanies *Discrete Actions for Naturalistic Behavior in Embodied
Biomechanical Animal Models* (Bian et al., NEmo 2026, oral). See the
[project page](https://kbian.org/Code2Act-website/).

You compose a sequence of behavior symbols, or switch symbols live with
keys 1–6. The paper's MLB controller then executes them on a 38-actuator
MuJoCo rat.

The demo offers six of the controller's nine symbols: Walk L, Walk R,
Rear L, Rear R, Turn R and Immobile. The other three are left out because the
paper's held-symbol test shows they aren't performed distinctly. Walk S and
Rear S are read as Walk L and Rear R (exact recall 0.00 and 0.07), and Turn L
is almost never performed (0.02). Everything runs client-side:

- [MuJoCo WASM](https://www.npmjs.com/package/@mujoco/mujoco) 3.13.0 handles
  the physics, in a Web Worker.
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) 1.23.2 runs
  the controller: a 4-layer GRU, a distillation head and the frozen MIMIC-MJX
  decoder, 4.9M parameters.
- three.js does the rendering.

## What you are looking at

- **Model:** the controller is the paper's MLB checkpoint
  (`260629_212713_669229_step208`). It runs decoder-only and deterministic,
  exactly as in the paper's evaluations, at 100 Hz control with 5 physics
  substeps.
- **Start poses:** the 48 start poses are the test clips used by the project
  page's sequence viewer.
- **Only verified sequences can be built.** From some states a symbol pushes
  the rat into a posture where the controller loses control, and the rest of
  the sequence is lost.
  - The palette lights only the symbols that keep the sequence inside the
    verified tree of the chosen start pose (up to 5 symbols, 4 s each). Each
    of the 10 offered clips has its own tree of 399–725 chains. In every
    chain the body never lost control in 17 runs (MuJoCo C clean plus 16
    replicas with small action noise). "Lost control" means moving faster than
    2.5 m/s, sinking and freezing for 1 s, or lying upside down.
  - The behavior itself is not checked: the rat may answer a symbol with a
    neighboring behavior.
  - Changing the clip keeps the longest verified prefix; choosing an example
    moves to a clip that has it. Editing resets the rat, so a run always plays
    one whole tested sequence.
  - In a held-out replay of sampled sequences through this app's TS runner,
    about 1 run in 32 lost control.
  - See "Verified sequences" in `c2a/webdemo/README.md`, and
    `tests/verify_chains.test.ts` for the TS replay.

## Acknowledgements

Inspired by the [MIMIC-MJX web demo](https://mimic-mjx-web-demo.pages.dev/)
by Charles Y. Zhang ([source](https://github.com/charles-zhng/mimic-mjx-web-demo)),
which showed that the MIMIC-MJX rat can run in real time in the browser with
MuJoCo WASM and onnxruntime-web. Built on [MIMIC-MJX](https://mimic-mjx.talmolab.org/).

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (sends COOP/COEP for threaded WASM)
npm test           # closed-loop parity of the TS sim core vs the Python spec
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ with the production headers
```

The assets in `public/assets/` are generated in the
[code2act](https://github.com/talmolab/code2act) repo by `c2a/webdemo/`. That
package's README covers the export pipeline and its verification. To refresh
them:

```bash
node scripts/sync_assets.mjs /path/to/code2act/outputs/webdemo
```

## Deploy (Cloudflare Workers, static assets)

`wrangler.jsonc` serves `dist/` as a static-assets-only Worker named
`code2act-demo`. `public/_headers` sets
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. These headers enable
SharedArrayBuffer, so onnxruntime-web can use several threads. Every file is
under Cloudflare's 25 MiB per-file limit; the largest is `controller.onnx` at
19.7 MB.

- **From Git:** in the Worker's *Settings → Build*, connect this repo with
  build command `npm run build` and deploy command `npx wrangler deploy`.
- **From a local machine:** run `npx wrangler login` once, then
  `npm run deploy`.

## Layout

```
src/sim/observation.ts  277-d proprioception (port of c2a/webdemo/c_sim.py)
src/sim/runner.ts       control loop: env action bookkeeping, substeps
src/sim/policy.ts       onnxruntime-web session
src/sim/sequencer.ts    timeline -> forward code window
src/sim/worker.ts       real-time loop in a Web Worker
src/render/scene.ts     three.js rat, ghost trail, root trace, follow camera
src/ui/                 palette (verified next symbols), timeline, readouts
```
