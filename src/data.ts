// Static metadata exported by c2a/webdemo/export_assets.py.
import type { Block } from './sim/sequencer';

export interface SymbolInfo {
  code: number;
  name: string; // e.g. "Walk_L"
  color: [number, number, number];
  behavior: string;
  behavior_recall: number; // labeler reads the commanded behavior (60 starts)
  symbol_recall: number; // ...and the commanded direction
}

export interface Preset {
  title: string;
  blocks: [string, number][];
}

/** The verified sequences, one tree per start pose. Every chain in
 * `chains[i]` (and every prefix of it) passed in every run from start pose
 * `starts[i]`, each phase read as commanded. */
export interface Graph {
  chains: string[][]; // per start pose; symbol names joined by '>'
  max_blocks: number;
  hold: number; // control steps per block (fixed)
  starts: number[]; // start poses (indices into starts.json), shown as clips 1..n
  runs: number; // runs every offered chain passed
  held: number; // held-out replicas (not used for selection)
  held_fails: [number, number] | null; // failed / total chain x clip runs in them
}

export interface SymbolsFile {
  symbols: SymbolInfo[]; // all 9, indexed by code
  palette: string[]; // the subset offered in the demo, in display order
  presets: Record<string, Preset>;
  graph: Graph;
}

export interface PcaFile {
  explained: number[];
  clouds: { code: number; name: string; color: number[]; points: [number, number][] }[];
}

export const pretty = (name: string) =>
  name.replace('_L', ' left').replace('_R', ' right').replace('_S', ' straight');

export const css = (c: number[], a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/** Symbols that may follow the sequence `prefix` (symbol names) from start pose `clip`. */
export function allowedNext(g: Graph, clip: number, prefix: string[]): Set<string> {
  const head = prefix.length ? prefix.join('>') + '>' : '';
  const out = new Set<string>();
  for (const c of g.chains[clip]) {
    if (!c.startsWith(head)) continue;
    const rest = c.slice(head.length);
    if (rest && !rest.includes('>')) out.add(rest);
  }
  return out;
}

/** Is the sequence (symbol names) verified from start pose `clip`? */
export function isVerified(g: Graph, clip: number, seq: string[]): boolean {
  return seq.length === 0 || g.chains[clip].includes(seq.join('>'));
}

export function presetBlocks(p: Preset, symbols: SymbolInfo[]): Block[] {
  const id = new Map(symbols.map((s) => [s.name, s.code]));
  return p.blocks.map(([name, steps]) => ({ code: id.get(name)!, steps }));
}

export async function loadMeta(base: string): Promise<{ symbols: SymbolsFile; pca: PcaFile }> {
  const [symbols, pca] = await Promise.all([
    fetch(base + 'assets/symbols.json').then((r) => r.json()),
    fetch(base + 'assets/pca.json').then((r) => r.json()),
  ]);
  return { symbols, pca };
}
