// Opt-in: replays chains x start poses through the browser sim core (WASM
// MuJoCo + onnxruntime-web + the app's Runner and sequencer) and dumps each
// phase's settled window for labeling by `c2a.webdemo.chain_select label-ts`.
// Skipped unless VERIFY_JOB is set:
//   VERIFY_JOB=job.json SHARD=0 NSHARD=1 OUT=dir npx vitest run tests/verify_chains.test.ts
// job.json: {"clips": [...], "chains": ["Rear_R>Rear_L", ...]} (all pairs),
// or {"pairs": [["Rear_R>Rear_L", 12], ...]}; optional "hold" (steps per block, 250)
// PHYS=1 dumps per-step body signals for the whole chain instead (as
// chain_tree --phys: root speed, root height, up-axis z, mean joint speed),
// for `chain_select phys-ts`.
import { readFileSync, writeFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { it } from 'vitest';
import { createPolicy } from '../src/sim/policy';
import { Runner } from '../src/sim/runner';
import { timelineWindow, type Block } from '../src/sim/sequencer';
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
it.skipIf(!process.env.VERIFY_JOB)('replay chains for labeling', async () => {
  const job = json(process.env.VERIFY_JOB!);
  const shard = Number(process.env.SHARD), nshard = Number(process.env.NSHARD);
  const manifest = json('public/assets/manifest.json');
  const starts = json('public/assets/starts.json').qpos;
  const meta = json('public/assets/symbols.json');
  const id = new Map(meta.symbols.map((s: any) => [s.name, s.code]));
  const mj = await loadMujoco();
  const model = mj.MjModel.from_xml_string(readFileSync('public/assets/rodent_c2a.xml', 'utf8'));
  const policy = await createPolicy(new Uint8Array(readFileSync('public/assets/controller.onnx')),
    manifest.hidden_sizes, manifest.code_stack_size, { numThreads: 1 });
  const runner = new Runner(mj, model, policy, manifest.hidden_sizes);
  const hold: number = job.hold ?? 250;
  const runs: [string, number][] = job.pairs ?? [];
  if (!job.pairs) job.chains.forEach((c: string) => job.clips.forEach((k: number) => runs.push([c, k])));
  const mine = runs.filter((_, i) => i % nshard === shard);
  const phys = !!process.env.PHYS;
  const index: any[] = []; const chunks: Float32Array[] = []; let off = 0;
  for (const [chain, clip] of mine) {
    const blocks: Block[] = chain.split('>').map((n) => ({ code: id.get(n) as number, steps: hold }));
    runner.reset(starts[clip]);
    const T = blocks.length * hold;
    for (let t = 0; t < T; t++) {
      if (!phys && t % hold >= hold - 100) { chunks.push(Float32Array.from(runner.data.qpos)); }
      const before = Float64Array.from(runner.data.qpos);
      await runner.step(timelineWindow(blocks, t, manifest.code_stack_size));
      if (phys) {
        const q = runner.data.qpos;
        let j = 0;
        for (let i = 7; i < q.length; i++) j += Math.abs(q[i] - before[i]);
        chunks.push(Float32Array.of(
          Math.hypot(q[0] - before[0], q[1] - before[1], q[2] - before[2]) * 100, q[2],
          1 - 2 * (q[4] ** 2 + q[5] ** 2), (j / (q.length - 7)) * 100));
      }
    }
    index.push({ chain, clip, offset: off, blocks: blocks.length }); off += blocks.length * (phys ? hold : 100);
  }
  const nq = phys ? 4 : model.nq; const buf = new Float32Array(off * nq);
  chunks.forEach((c, i) => buf.set(c, i * nq));
  writeFileSync(`${process.env.OUT}/ts_${shard}.bin`, Buffer.from(buf.buffer));
  writeFileSync(`${process.env.OUT}/ts_${shard}.json`, JSON.stringify({ nq, hold, index }));
}, 24 * 3600_000);
