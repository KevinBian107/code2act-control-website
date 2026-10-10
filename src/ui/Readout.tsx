import { useEffect, useRef } from 'react';
import { css, type PcaFile, type SymbolInfo } from '../data';

export interface History {
  step: number[];
  code: number[];
  speed: number[];
  pc: [number, number][];
}

export const emptyHistory = (): History => ({ step: [], code: [], speed: [], pc: [] });

const WINDOW_STEPS = 1000; // 10 s of strip chart
const TRAIL = 240; // frames of hidden-state trail

function setup(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const { clientWidth: w, clientHeight: h } = cv;
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr;
    cv.height = h * dpr;
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Commanded symbol and root speed over the last 10 s, and the GRU state on
 * the sequence-viewer PCA plane (clouds = each symbol held constant). */
export default function Readout({ history, symbols, palette, pca }: {
  history: React.MutableRefObject<History>; symbols: SymbolInfo[]; palette: string[]; pca: PcaFile;
}) {
  const strip = useRef<HTMLCanvasElement>(null);
  const plane = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const clouds = pca.clouds.filter((c) => palette.includes(c.name));
    const pts = clouds.flatMap((c) => c.points);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 0.08;
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x1 - x0) * pad, sy = (y1 - y0) * pad;
    const bounds = { x0: x0 - sx, x1: x1 + sx, y0: y0 - sy, y1: y1 + sy };
    let raf = 0;
    const draw = () => {
      const h = history.current;
      const fg = getComputedStyle(document.documentElement).getPropertyValue('--muted-fg');
      if (strip.current) {
        const ctx = setup(strip.current);
        const { clientWidth: w, clientHeight: H } = strip.current;
        const now = h.step.length ? h.step[h.step.length - 1] : 0;
        const x = (s: number) => w - ((now - s) / WINDOW_STEPS) * w;
        for (let i = 1; i < h.step.length; i++) {
          if (now - h.step[i] > WINDOW_STEPS) continue;
          ctx.fillStyle = css(symbols[h.code[i]].color);
          ctx.fillRect(x(h.step[i - 1]), 0, Math.max(1, x(h.step[i]) - x(h.step[i - 1]) + 0.5), 8);
        }
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < h.step.length; i++) {
          if (now - h.step[i] > WINDOW_STEPS) continue;
          const y = H - 4 - (Math.min(h.speed[i], 0.5) / 0.5) * (H - 18);
          if (first) ctx.moveTo(x(h.step[i]), y); else ctx.lineTo(x(h.step[i]), y);
          first = false;
        }
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('root speed, 0–0.5 m/s · last 10 s', 4, H - 6);
      }
      if (plane.current) {
        const ctx = setup(plane.current);
        const { clientWidth: w, clientHeight: H } = plane.current;
        const px = (p: [number, number]) => [
          ((p[0] - bounds.x0) / (bounds.x1 - bounds.x0)) * w,
          H - ((p[1] - bounds.y0) / (bounds.y1 - bounds.y0)) * H,
        ];
        for (const c of clouds) {
          ctx.fillStyle = css(c.color, 0.22);
          for (const p of c.points) {
            const [a, b] = px(p);
            ctx.fillRect(a - 1, b - 1, 2, 2);
          }
        }
        const n = h.pc.length;
        for (let i = Math.max(1, n - TRAIL); i < n; i++) {
          const [a0, b0] = px(h.pc[i - 1]);
          const [a1, b1] = px(h.pc[i]);
          ctx.strokeStyle = css(symbols[h.code[i]].color, 0.25 + 0.75 * (1 - (n - i) / TRAIL));
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(a0, b0); ctx.lineTo(a1, b1); ctx.stroke();
        }
        if (n) {
          const [a, b] = px(h.pc[n - 1]);
          ctx.fillStyle = css(symbols[h.code[n - 1]].color);
          ctx.strokeStyle = fg;
          ctx.beginPath(); ctx.arc(a, b, 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = fg;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('controller state (GRU, PCA)', 4, 13);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [history, symbols, palette, pca]);

  return (
    <div className="readout">
      <canvas ref={strip} className="strip" aria-label="Commanded symbol and root speed" />
      <canvas ref={plane} className="plane" aria-label="Controller hidden state" />
    </div>
  );
}
