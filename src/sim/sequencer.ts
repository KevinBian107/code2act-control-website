// Turns the user's command (a timeline of symbol blocks)
// into the controller's forward code window: the next `stack` control steps,
// padded with the last symbol (the convention of every paper rollout).

export interface Block {
  code: number;
  steps: number; // 100 Hz control steps
}

export function timelineLength(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.steps, 0);
}

/** Symbol commanded at step t (clamped to the last block). */
export function codeAt(blocks: Block[], t: number): number {
  let end = 0;
  for (const b of blocks) {
    end += b.steps;
    if (t < end) return b.code;
  }
  return blocks[blocks.length - 1].code;
}

export function timelineWindow(blocks: Block[], t: number, stack: number): number[] {
  const w = new Array<number>(stack);
  for (let i = 0; i < stack; i++) w[i] = codeAt(blocks, t + i);
  return w;
}
