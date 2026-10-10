import { css, pretty, type SymbolInfo } from '../data';
import { switchHint } from '../switches';
import type { Block } from '../sim/sequencer';

interface Props {
  blocks: Block[];
  symbols: SymbolInfo[];
  position: number; // control steps
  selected: number | null;
  onSelect: (i: number | null) => void;
  onChange: (blocks: Block[]) => void;
}

const fmt = (steps: number) => `${(steps / 100).toFixed(1)} s`;

/** The command sequence: one colored block per symbol, width = duration. */
export default function Timeline({ blocks, symbols, position, selected, onSelect, onChange }: Props) {
  const total = blocks.reduce((n, b) => n + b.steps, 0);
  // Weak switches between consecutive blocks (index i = switch into block i).
  const hints = blocks.map((b, i) => (i === 0 ? null : switchHint(
    i >= 2 ? symbols[blocks[i - 2].code] : null, symbols[blocks[i - 1].code], symbols[b.code], symbols)));
  const starts = blocks.map((_, i) => blocks.slice(0, i).reduce((n, b) => n + b.steps, 0));
  const insert = (i: number, code: number, steps: number) => {
    const next = blocks.slice();
    next.splice(i, 0, { code, steps });
    onChange(next);
    onSelect(null);
  };
  const sel = selected !== null ? blocks[selected] : null;
  const update = (i: number, b: Block | null) => {
    const next = blocks.slice();
    if (b) next[i] = b; else next.splice(i, 1);
    onChange(next);
    if (!b) onSelect(null);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    onSelect(j);
  };

  return (
    <div className="timeline">
      <div className="track" onClick={() => onSelect(null)}>
        {blocks.length === 0 && <span className="empty">Click symbols above to build a sequence</span>}
        {blocks.map((b, i) => (
          <button
            key={i}
            className={`block${selected === i ? ' selected' : ''}`}
            style={{ flexGrow: b.steps, background: css(symbols[b.code].color) }}
            onClick={(e) => { e.stopPropagation(); onSelect(selected === i ? null : i); }}
            title={`${pretty(symbols[b.code].name)}, ${fmt(b.steps)}`}
            aria-label={`Block ${i + 1}: ${pretty(symbols[b.code].name)}, ${fmt(b.steps)}`}
          />
        ))}
        {total > 0 && (
          <div className="playhead" style={{ left: `${Math.min(100, (100 * position) / total)}%` }} />
        )}
        {hints.map((h, i) => h && (
          <span key={`w${i}`} className="switch-mark" style={{ left: `${(100 * starts[i]) / total}%` }}
            title={h.message} aria-hidden>!</span>
        ))}
      </div>
      <div className="timeline-meta">
        <span>{blocks.length} symbols · {fmt(total)}</span>
        {blocks.length > 0 && <button className="link" onClick={() => onChange([])}>Clear</button>}
      </div>
      {hints.some(Boolean) && (
        <ul className="switch-hints">
          {hints.map((h, i) => h && (
            <li key={i}>
              <span className="pair">
                <span className="swatch" style={{ background: css(symbols[blocks[i - 1].code].color) }} />
                {pretty(symbols[blocks[i - 1].code].name)} → {pretty(symbols[blocks[i].code].name)}
              </span>
              <span className="msg">{h.message}</span>
              {h.fix && (
                <button className="link" onClick={() => insert(i, h.fix!.code, h.fix!.steps)}>
                  {h.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {sel && selected !== null && (
        <div className="block-editor">
          <span className="swatch" style={{ background: css(symbols[sel.code].color) }} />
          <span className="name">{pretty(symbols[sel.code].name)}</span>
          <input
            type="range" min={50} max={600} step={25} value={sel.steps}
            aria-label="Hold duration"
            onChange={(e) => update(selected, { ...sel, steps: Number(e.target.value) })}
          />
          <span className="dur">{fmt(sel.steps)}</span>
          <button className="icon" onClick={() => move(selected, -1)} aria-label="Move earlier">←</button>
          <button className="icon" onClick={() => move(selected, 1)} aria-label="Move later">→</button>
          <button className="icon" onClick={() => update(selected, null)} aria-label="Remove">✕</button>
        </div>
      )}
    </div>
  );
}
