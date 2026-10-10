// The exported controller (code window + proprio + GRU carry -> action).
import * as ort from 'onnxruntime-web/wasm';

export interface PolicyOutput {
  action: Float32Array;
  hidden: Float32Array[];
  z: Float32Array;
}

export type Policy = (
  codes: ArrayLike<number>, proprio: Float32Array, hidden: Float32Array[],
) => Promise<PolicyOutput>;

export interface PolicyOptions {
  wasmPaths?: string;
  numThreads?: number;
}

export async function createPolicy(
  model: Uint8Array, hiddenSizes: number[], stack: number, opts: PolicyOptions = {},
): Promise<Policy> {
  if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
  if (opts.numThreads) ort.env.wasm.numThreads = opts.numThreads;
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const codesBuf = new BigInt64Array(stack);
  return async (codes, proprio, hidden) => {
    for (let i = 0; i < stack; i++) codesBuf[i] = BigInt(codes[i]);
    const feeds: Record<string, ort.Tensor> = {
      codes: new ort.Tensor('int64', codesBuf.slice(), [1, stack]),
      proprio: new ort.Tensor('float32', proprio.slice(), [1, proprio.length]),
    };
    hiddenSizes.forEach((s, i) => {
      feeds[`h${i}`] = new ort.Tensor('float32', hidden[i], [1, s]);
    });
    const r = await session.run(feeds);
    return {
      action: r.action.data as Float32Array,
      hidden: hiddenSizes.map((_, i) => r[`h${i}_out`].data as Float32Array),
      z: r.z.data as Float32Array,
    };
  };
}
