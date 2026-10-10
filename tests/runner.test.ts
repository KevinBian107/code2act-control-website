// The browser sim core (WASM MuJoCo + onnxruntime-web + TS observation and
// runner) must reproduce the Python spec (native MuJoCo C + onnxruntime +
// c2a/webdemo/c_sim.py) on a closed-loop rollout of the 'tour' preset.
// Both sides start bit-identical; ~1e-7 ORT kernel rounding then grows
// exponentially through contact dynamics (x10 per ~0.25 s), so exactness is
// asserted over the first 0.5 s. Behavior-level agreement over whole
// sequences is checked offline (c2a/webdemo/score_sim_gap.py).
import { readFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { describe, expect, it } from 'vitest';
import { createPolicy } from '../src/sim/policy';
import { Runner } from '../src/sim/runner';

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = json('public/assets/manifest.json');
const starts = json('public/assets/starts.json');
const fixture = json('tests/fixtures/fixture_tour.json');

const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe('closed loop vs Python spec', () => {
  it('matches proprio, action and qpos', async () => {
    const mj = await loadMujoco();
    const model = mj.MjModel.from_xml_string(readFileSync('public/assets/rodent_c2a.xml', 'utf8'));
    const policy = await createPolicy(
      new Uint8Array(readFileSync('public/assets/controller.onnx')),
      manifest.hidden_sizes, manifest.code_stack_size, { numThreads: 1 });
    const runner = new Runner(mj, model, policy, manifest.hidden_sizes);
    runner.reset(starts.qpos[fixture.start]);

    const T = Math.min(50, fixture.window.length);
    let dq = 0, dp = 0, da = 0;
    for (let t = 0; t < T; t++) {
      dq = Math.max(dq, maxAbs(runner.data.qpos, fixture.qpos[t]));
      dp = Math.max(dp, maxAbs(runner.observe(), fixture.proprio[t]));
      const out = await runner.step(fixture.window[t]);
      da = Math.max(da, maxAbs(out.action, fixture.action[t]));
    }
    console.log(`first ${T / 100} s: max|d qpos| ${dq.toExponential(1)}, ` +
      `max|d proprio| ${dp.toExponential(1)}, max|d action| ${da.toExponential(1)}`);
    expect(dq).toBeLessThan(1e-4);
    expect(dp).toBeLessThan(1e-2);
    expect(da).toBeLessThan(1e-3);
    runner.dispose();
    model.delete();
  }, 120_000);
});
