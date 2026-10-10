// One simulated rat driven by the controller: the browser counterpart of
// c2a/webdemo/c_sim.py::Body + rollout (decoder-only, deterministic, 100 Hz
// control, 5 physics substeps, no termination).
import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import { buildProprio, makeObsIndex, PROPRIO_SIZE, type ObsIndex } from './observation';
import type { Policy, PolicyOutput } from './policy';

export const CTRL_DT = 0.01;

export class Runner {
  readonly data: MjData;
  readonly idx: ObsIndex;
  readonly nSub: number;
  private proprio = new Float32Array(PROPRIO_SIZE);
  // Env bookkeeping: info["action"] / info["prev_action"]. The observation
  // carries prev_action, i.e. the action from two control steps ago.
  private action: Float32Array;
  private prevAction: Float32Array;
  private hidden: Float32Array[];
  step_ = 0;

  constructor(
    private mj: MainModule, readonly model: MjModel, private policy: Policy,
    private hiddenSizes: number[],
  ) {
    this.data = new mj.MjData(model);
    this.idx = makeObsIndex(mj, model);
    this.nSub = Math.round(CTRL_DT / model.opt.timestep);
    this.action = new Float32Array(model.nu);
    this.prevAction = new Float32Array(model.nu);
    this.hidden = hiddenSizes.map((s) => new Float32Array(s));
  }

  /** Start from a reference pose at rest (qvel = 0), GRU carry at zero. */
  reset(qpos: ArrayLike<number>): void {
    const { mj, model, data } = this;
    mj.mj_resetData(model, data);
    data.qpos.set(qpos);
    data.qvel.fill(0);
    mj.mj_forward(model, data);
    this.action.fill(0);
    this.prevAction.fill(0);
    this.hidden = this.hiddenSizes.map((s) => new Float32Array(s));
    this.step_ = 0;
  }

  observe(): Float32Array {
    return buildProprio(this.model, this.data, this.idx, this.prevAction, this.proprio);
  }

  /** One 10 ms control step with forward code window `window`. */
  async step(window: ArrayLike<number>): Promise<PolicyOutput> {
    const { mj, model, data } = this;
    const out = await this.policy(window, this.observe(), this.hidden);
    this.hidden = out.hidden;
    data.ctrl.set(out.action);
    for (let s = 0; s < this.nSub; s++) mj.mj_step(model, data);
    this.prevAction = this.action;
    this.action = Float32Array.from(out.action);
    this.step_ += 1;
    return out;
  }

  dispose(): void {
    this.data.delete();
  }
}
