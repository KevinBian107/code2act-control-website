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
  blurb: string;
  blocks: [string, number][];
}

export interface SymbolsFile {
  symbols: SymbolInfo[]; // all 9, indexed by code
  palette: string[]; // the subset offered in the demo, in display order
  presets: Record<string, Preset>;
}

export interface PcaFile {
  explained: number[];
  clouds: { code: number; name: string; color: number[]; points: [number, number][] }[];
}

export const pretty = (name: string) =>
  name.replace('_L', ' left').replace('_R', ' right').replace('_S', ' straight');

export const css = (c: number[], a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

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
