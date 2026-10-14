// Messages between the UI thread and the simulation worker.
import type { Block } from './sequencer';

// The timeline only changes together with a reset, so every run plays one
// whole sequence from its start pose (the case the demo's chains were
// verified for).
export type Command =
  | { type: 'reset'; start: number; blocks: Block[] }
  | { type: 'play'; playing: boolean }
  | { type: 'speed'; speed: number };

export interface GeomInfo {
  type: number; // mjtGeom
  size: [number, number, number];
}

export interface Frame {
  type: 'frame';
  step: number; // control steps since reset
  position: number; // timeline position (control steps)
  code: number; // symbol commanded this step
  xpos: Float32Array; // rat geoms, 3 per geom
  xmat: Float32Array; // rat geoms, 9 per geom (row-major)
  root: [number, number, number];
  speed: number; // horizontal root speed, m/s (smoothed)
  pc: [number, number]; // last GRU layer on the sequence-viewer PCA basis
  msPerStep: number;
  realtime: number; // simulated / wall-clock time
}

export type WorkerMessage =
  | { type: 'progress'; stage: string }
  | { type: 'ready'; geoms: GeomInfo[]; threads: number; isolated: boolean }
  | Frame
  | { type: 'ended' }
  | { type: 'error'; message: string };
