import { css, pretty, type SymbolInfo } from '../data';

interface Props {
  symbols: SymbolInfo[];
  palette: string[];
  allowed: Set<string>; // symbols verified to follow the current sequence
  onPick: (code: number) => void;
}

/** The offered MLB symbols; only verified next steps are enabled. */
export default function Palette({ symbols, palette, allowed, onPick }: Props) {
  const byName = new Map(symbols.map((s) => [s.name, s]));
  return (
    <div className="palette" role="group" aria-label="Symbols">
      {palette.map((name, i) => {
        const s = byName.get(name)!;
        const ok = allowed.has(name);
        return (
          <button
            key={name}
            className="symbol"
            disabled={!ok}
            onClick={() => onPick(s.code)}
            title={ok ? `Append ${pretty(s.name)}` : `${pretty(s.name)} is not verified to work after the current sequence`}
          >
            <span className="swatch" style={{ background: css(s.color) }} />
            <span className="name">{s.name.replace('_', ' ')}</span>
            <kbd>{i + 1}</kbd>
          </button>
        );
      })}
    </div>
  );
}
