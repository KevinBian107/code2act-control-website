// Simulation worker: MuJoCo WASM + the exported controller, stepping in real
// time and posting the rat's geom poses to the UI thread.
import loadMujoco from '@mujoco/mujoco';
import mujocoWasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import type { MjModel } from '@mujoco/mujoco';
import { createPolicy } from './policy';
import type { Command, GeomInfo, WorkerMessage } from './protocol';
import { Runner } from './runner';
import { timelineLength, timelineWindow, type Block } from './sequencer';

const BASE = import.meta.env.BASE_URL;
const RAT_GEOM_GROUP = 2;
const MAX_STEPS_PER_TICK = 10;

const post = (msg: WorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

interface Manifest {
  code_stack_size: number;
  hidden_sizes: number[];
}
interface Pca {
  mean: number[];
  components: number[][];
}

let runner: Runner;
let model: MjModel;
let starts: number[][];
let manifest: Manifest;
let pca: Pca;
let ratGeoms: number[] = [];

let playing = false;
let speed = 1;
let blocks: Block[] = [];
let position = 0;
let pendingReset: number | null = null;
let rootSpeed = 0;
let msPerStep = 0;
let realtime = 1;

const fetchJson = async <T>(path: string): Promise<T> => (await fetch(BASE + path)).json();

async function init(): Promise<void> {
  post({ type: 'progress', stage: 'Loading physics engine' });
  const mj = await loadMujoco({ locateFile: () => mujocoWasmUrl });
  const [xml, manifest_, starts_, pca_] = await Promise.all([
    fetch(BASE + 'assets/rodent_c2a.xml').then((r) => r.text()),
    fetchJson<Manifest>('assets/manifest.json'),
    fetchJson<{ qpos: number[][] }>('assets/starts.json'),
    fetchJson<Pca>('assets/pca.json'),
  ]);
  manifest = manifest_;
  starts = starts_.qpos;
  pca = pca_;
  model = mj.MjModel.from_xml_string(xml);

  post({ type: 'progress', stage: 'Loading controller' });
  const onnx = new Uint8Array(await (await fetch(BASE + 'assets/controller.onnx')).arrayBuffer());
  const isolated = self.crossOriginIsolated === true;
  const threads = isolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
  const policy = await createPolicy(onnx, manifest.hidden_sizes, manifest.code_stack_size, {
    wasmPaths: BASE + 'ort/', numThreads: threads,
  });
  runner = new Runner(mj, model, policy, manifest.hidden_sizes);
  runner.reset(starts[0]);

  const geoms: GeomInfo[] = [];
  for (let g = 0; g < model.ngeom; g++) {
    if (model.geom_group[g] !== RAT_GEOM_GROUP) continue;
    ratGeoms.push(g);
    geoms.push({
      type: model.geom_type[g],
      size: [model.geom_size[3 * g], model.geom_size[3 * g + 1], model.geom_size[3 * g + 2]],
    });
  }
  post({ type: 'ready', geoms, threads, isolated });
  postFrame(8);
  void loop();
}

function project(h: Float32Array): [number, number] {
  const out: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    let s = 0;
    const comp = pca.components[c];
    for (let i = 0; i < h.length; i++) s += (h[i] - pca.mean[i]) * comp[i];
    out[c] = s;
  }
  return out;
}

let lastPc: [number, number] = [0, 0];

function postFrame(code: number): void {
  const d = runner.data;
  const gx = d.geom_xpos, gm = d.geom_xmat;
  const xpos = new Float32Array(ratGeoms.length * 3);
  const xmat = new Float32Array(ratGeoms.length * 9);
  ratGeoms.forEach((g, i) => {
    for (let k = 0; k < 3; k++) xpos[3 * i + k] = gx[3 * g + k];
    for (let k = 0; k < 9; k++) xmat[9 * i + k] = gm[9 * g + k];
  });
  const q = d.qpos;
  post({
    type: 'frame', step: runner.step_, position, code, xpos, xmat,
    root: [q[0], q[1], q[2]], speed: rootSpeed, pc: lastPc, msPerStep, realtime,
  }, [xpos.buffer, xmat.buffer]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(): Promise<void> {
  const stack = manifest.code_stack_size;
  let budget = 0;
  let last = performance.now();
  let code = 8;
  for (;;) {
    if (pendingReset !== null) {
      runner.reset(starts[pendingReset]);
      pendingReset = null;
      position = 0;
      rootSpeed = 0;
      lastPc = [0, 0];
      code = blocks.length ? blocks[0].code : code;
      postFrame(code);
    }
    const now = performance.now();
    if (!playing) {
      last = now;
      budget = 0;
      await sleep(30);
      continue;
    }
    budget = Math.min(budget + ((now - last) / 1000) * speed * 100, MAX_STEPS_PER_TICK);
    last = now;
    let n = 0;
    const t0 = performance.now();
    while (budget >= 1 && n < MAX_STEPS_PER_TICK) {
      if (pendingReset !== null) break; // a reset (new timeline) arrived mid-tick
      if (!blocks.length || position >= timelineLength(blocks)) {
        playing = false;
        post({ type: 'ended' });
        break;
      }
      const window = timelineWindow(blocks, position, stack);
      code = window[0];
      const x0 = runner.data.qpos[0], y0 = runner.data.qpos[1];
      const out = await runner.step(window);
      const q = runner.data.qpos;
      const v = Math.hypot(q[0] - x0, q[1] - y0) * 100;
      rootSpeed += 0.05 * (v - rootSpeed);
      lastPc = project(out.hidden[out.hidden.length - 1]);
      position += 1;
      budget -= 1;
      n += 1;
    }
    if (n > 0) {
      const ms = (performance.now() - t0) / n;
      msPerStep = msPerStep ? 0.9 * msPerStep + 0.1 * ms : ms;
      realtime = Math.min(speed, 10 / Math.max(msPerStep, 1e-3)) / speed;
      postFrame(code);
    }
    await sleep(n ? 0 : 4);
  }
}

self.onmessage = (e: MessageEvent<Command>) => {
  const c = e.data;
  switch (c.type) {
    case 'reset': pendingReset = c.start; blocks = c.blocks; break;
    case 'play': playing = c.playing; break;
    case 'speed': speed = c.speed; break;
  }
};

init().catch((err: unknown) => post({ type: 'error', message: String(err) }));
