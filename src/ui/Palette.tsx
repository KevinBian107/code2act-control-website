import { css, pretty, type SymbolInfo } from '../data';
import type { Mode } from '../sim/protocol';

interface Props {
  symbols: SymbolInfo[];
  palette: string[];
  mode: Mode;
  active: number | null; // live symbol, highlighted
  onPick: (code: number) => void;
}

/** The offered MLB symbols with how reliably the controller performs each. */
export default function Palette({ symbols, palette, mode, active, onPick }: Props) {
  const byName = new Map(symbols.map((s) => [s.name, s]));
  return (
    <div className="palette" role="group" aria-label="Symbols">
      {palette.map((name, i) => {
        const s = byName.get(name)!;
        const weak = s.behavior_recall < 0.5;
        const title =
          `${pretty(s.name)} — in the paper's held-symbol test (60 start poses), ` +
          `the motion was read as ${s.behavior} ${Math.round(100 * s.behavior_recall)}% ` +
          `of the time and as exactly ${pretty(s.name)} ${Math.round(100 * s.symbol_recall)}%.`;
        return (
          <button
            key={name}
            className={`symbol${active === s.code ? ' active' : ''}${weak ? ' weak' : ''}`}
            onClick={() => onPick(s.code)}
            title={title}
            aria-pressed={mode === 'live' ? active === s.code : undefined}
          >
            <span className="swatch" style={{ background: css(s.color) }} />
            <span className="label">
              <span className="name">{s.name.replace('_', ' ')}</span>
              <span className="meter" aria-hidden>
                <span style={{ width: `${100 * s.behavior_recall}%`, background: css(s.color, 0.45) }} />
                <span style={{ width: `${100 * s.symbol_recall}%`, background: css(s.color) }} />
              </span>
            </span>
            <kbd>{i + 1}</kbd>
          </button>
        );
      })}
    </div>
  );
}
