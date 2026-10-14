import { css, pretty, type SymbolInfo } from '../data';
import type { Block } from '../sim/sequencer';

interface Props {
  blocks: Block[];
  symbols: SymbolInfo[];
  position: number; // control steps
  maxBlocks: number;
  onChange: (blocks: Block[]) => void;
}

const fmt = (steps: number) => `${(steps / 100).toFixed(1)} s`;

/** The command sequence: one colored block per symbol. Only the last block can
 * be removed, so every sequence stays a chain of verified switches. */
export default function Timeline({ blocks, symbols, position, maxBlocks, onChange }: Props) {
  const total = blocks.reduce((n, b) => n + b.steps, 0);
  return (
    <div className="timeline">
      <div className="track">
        {blocks.length === 0 && <span className="empty">Click a symbol above to start a sequence</span>}
        {blocks.map((b, i) => (
          <span
            key={i}
            className="block"
            style={{ flexGrow: b.steps, background: css(symbols[b.code].color) }}
            title={`${pretty(symbols[b.code].name)}, ${fmt(b.steps)}`}
          />
        ))}
        {total > 0 && (
          <div className="playhead" style={{ left: `${Math.min(100, (100 * position) / total)}%` }} />
        )}
      </div>
      <div className="timeline-meta">
        <span>{blocks.length} / {maxBlocks} symbols · {fmt(total)}</span>
        {blocks.length > 0 && (
          <span className="actions">
            <button className="link" onClick={() => onChange(blocks.slice(0, -1))}>Undo</button>
            <button className="link" onClick={() => onChange([])}>Clear</button>
          </span>
        )}
      </div>
    </div>
  );
}
