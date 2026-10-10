// Compare MuJoCo WASM against native MuJoCo C (same version) on fixed controls.
// Usage: node scripts/wasm_engine_check.mjs <scene.xml> <starts.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import loadMujoco from '@mujoco/mujoco';

const [xmlPath, startsPath, outPath] = process.argv.slice(2);
const mj = await loadMujoco();
const model = mj.MjModel.from_xml_string(readFileSync(xmlPath, 'utf8'));
const data = new mj.MjData(model);
const q0 = JSON.parse(readFileSync(startsPath, 'utf8')).qpos[0];
data.qpos.set(q0);
mj.mj_forward(model, data);
const traj = [];
const t0 = performance.now();
for (let k = 0; k < 200; k++) {
  for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0.5 * Math.sin(0.05 * k + i);
  for (let s = 0; s < 5; s++) mj.mj_step(model, data);
  traj.push(Array.from(data.qpos));
}
const ms = (performance.now() - t0) / 1000;
writeFileSync(outPath, JSON.stringify({ traj, ms_per_mj_step: ms }));
console.log(`nq=${model.nq} nu=${model.nu} timestep=${model.opt.timestep} ` +
  `iters=${model.opt.iterations}/${model.opt.ls_iterations}; ${ms.toFixed(3)} ms per mj_step`);
data.delete(); model.delete();
