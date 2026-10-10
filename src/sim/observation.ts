// 277-d proprioception, in vnl_playground `_get_proprioception` order.
// Line-for-line port of c2a/webdemo/c_sim.py::proprioception (the spec);
// fixtures in tests/ check the two agree.
import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';

export const SUFFIX = '-rodent';
export const PROPRIO_SIZE = 277;
const END_EFFECTORS = ['lower_arm_R', 'lower_arm_L', 'foot_R', 'foot_L', 'skull'];
const KINEMATIC_SENSORS = ['accelerometer', 'velocimeter', 'gyro'];
const TOUCH_SENSORS = ['palm_L', 'palm_R', 'sole_L', 'sole_R'];
const OBJ_BODY = 1;
const OBJ_SENSOR = 20;

export interface ObsIndex {
  torso: number;
  walker: number;
  endEffectors: number[];
  sensors: Array<[adr: number, dim: number]>; // kinematic then touch
}

export function makeObsIndex(mj: MainModule, model: MjModel): ObsIndex {
  const body = (name: string) => {
    const id = mj.mj_name2id(model, OBJ_BODY, name + SUFFIX);
    if (id < 0) throw new Error(`body ${name} not found`);
    return id;
  };
  const sensor = (name: string): [number, number] => {
    const id = mj.mj_name2id(model, OBJ_SENSOR, name + SUFFIX);
    if (id < 0) throw new Error(`sensor ${name} not found`);
    return [model.sensor_adr[id], model.sensor_dim[id]];
  };
  return {
    torso: body('torso'),
    walker: body('walker'),
    endEffectors: END_EFFECTORS.map(body),
    sensors: [...KINEMATIC_SENSORS, ...TOUCH_SENSORS].map(sensor),
  };
}

/**
 * Fill `out` with the proprioception of the current state.
 *
 * Two quirks of the training env are reproduced on purpose: the
 * "actuator_ctrl" slot is `qfrc_actuator` (nv values), and `prevAction` is the
 * action from two control steps ago (see Runner).
 */
export function buildProprio(
  model: MjModel, data: MjData, idx: ObsIndex, prevAction: Float32Array, out: Float32Array,
): Float32Array {
  const qpos = data.qpos, qvel = data.qvel, qfrc = data.qfrc_actuator;
  const xpos = data.xpos, xmat = data.xmat, sd = data.sensordata;
  let k = 0;
  for (let i = 7; i < model.nq; i++) out[k++] = qpos[i];        // joint_angles
  for (let i = 6; i < model.nv; i++) out[k++] = qvel[i];        // joint_ang_vels
  for (let i = 0; i < model.nv; i++) out[k++] = qfrc[i];        // actuator_ctrl
  const t3 = 3 * idx.torso, t9 = 9 * idx.torso;
  out[k++] = xpos[t3 + 2];                                       // body_height
  const w9 = 9 * idx.walker;
  for (let i = 6; i < 9; i++) out[k++] = xmat[w9 + i];          // world_zaxis
  for (const b of idx.endEffectors) {                            // appendages_pos
    const dx = xpos[3 * b] - xpos[t3];
    const dy = xpos[3 * b + 1] - xpos[t3 + 1];
    const dz = xpos[3 * b + 2] - xpos[t3 + 2];
    for (let c = 0; c < 3; c++) {
      // (x_b - x_torso) @ R_torso, R row-major
      out[k++] = dx * xmat[t9 + c] + dy * xmat[t9 + 3 + c] + dz * xmat[t9 + 6 + c];
    }
  }
  for (const [adr, dim] of idx.sensors) {                        // kinematic, touch
    for (let i = 0; i < dim; i++) out[k++] = sd[adr + i];
  }
  for (let i = 0; i < prevAction.length; i++) out[k++] = prevAction[i];
  if (k !== PROPRIO_SIZE) throw new Error(`proprio size ${k} != ${PROPRIO_SIZE}`);
  for (let i = 0; i < k; i++) if (!Number.isFinite(out[i])) out[i] = 0;
  return out;
}
