import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMeta, presetBlocks, pretty, type PcaFile, type SymbolsFile } from './data';
import { RatScene } from './render/scene';
import type { Command, Frame, Mode, WorkerMessage } from './sim/protocol';
import type { Block } from './sim/sequencer';
import Palette from './ui/Palette';
import Readout, { emptyHistory, type History } from './ui/Readout';
import Timeline from './ui/Timeline';

const BASE = import.meta.env.BASE_URL;
const PAPER_URL = 'https://kbian.org/Code2Act-website/';
const DEFAULT_HOLD = 200; // 2 s
const N_STARTS = 48;

interface Hud {
  code: number;
  position: number;
  msPerStep: number;
  realtime: number;
}

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const scene = useRef<RatScene | null>(null);
  const history = useRef<History>(emptyHistory());
  const [meta, setMeta] = useState<{ symbols: SymbolsFile; pca: PcaFile } | null>(null);
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [threads, setThreads] = useState(1);
  const [mode, setMode] = useState<Mode>('timeline');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [preset, setPreset] = useState('tour');
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [start, setStart] = useState(0);
  const [hud, setHud] = useState<Hud>({ code: 8, position: 0, msPerStep: 0, realtime: 1 });

  const send = useCallback((c: Command) => worker.current?.postMessage(c), []);

  useEffect(() => {
    loadMeta(BASE).then((m) => {
      setMeta(m);
      setBlocks(presetBlocks(m.symbols.presets.tour, m.symbols.symbols));
    }).catch((e) => setError(String(e)));
  }, []);

  // Worker + renderer lifecycle.
  useEffect(() => {
    if (!meta || !host.current) return;
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    let lastHud = 0;
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') setStatus(m.stage);
      else if (m.type === 'error') setError(m.message);
      else if (m.type === 'ready') {
        scene.current = new RatScene(host.current!, m.geoms, meta.symbols.symbols.map((s) => s.color));
        setThreads(m.threads);
        setReady(true);
      } else if (m.type === 'ended') setPlaying(false);
      else if (m.type === 'frame') onFrame(m);
    };
    const onFrame = (f: Frame) => {
      scene.current?.update(f);
      const h = history.current;
      if (h.step.length && f.step < h.step[h.step.length - 1]) history.current = emptyHistory();
      const hh = history.current;
      hh.step.push(f.step); hh.code.push(f.code); hh.speed.push(f.speed); hh.pc.push(f.pc);
      if (hh.step.length > 4000) for (const k of ['step', 'code', 'speed', 'pc'] as const) hh[k].splice(0, 1000);
      const now = performance.now();
      if (now - lastHud > 100) {
        lastHud = now;
        setHud({ code: f.code, position: f.position, msPerStep: f.msPerStep, realtime: f.realtime });
      }
    };
    return () => {
      w.terminate();
      scene.current?.dispose();
      scene.current = null;
      worker.current = null;
    };
  }, [meta]);

  // Mirror UI state into the worker.
  useEffect(() => { send({ type: 'timeline', blocks }); }, [blocks, send, ready]);
  useEffect(() => { send({ type: 'mode', mode }); }, [mode, send, ready]);
  useEffect(() => { send({ type: 'live', code: live }); }, [live, send, ready]);
  useEffect(() => { send({ type: 'speed', speed }); }, [speed, send, ready]);
  useEffect(() => { send({ type: 'play', playing }); }, [playing, send, ready]);

  const restart = useCallback((s = start) => {
    history.current = emptyHistory();
    scene.current?.clearHistory();
    send({ type: 'reset', start: s });
  }, [send, start]);

  const pick = useCallback((code: number) => {
    if (mode === 'live') {
      setLive(code);
      setPlaying(true);
    } else {
      setBlocks((b) => [...b, { code, steps: DEFAULT_HOLD }]);
    }
  }, [mode]);

  const togglePlay = useCallback(() => {
    if (!playing && mode === 'timeline' && hud.position >= blocks.reduce((n, b) => n + b.steps, 0)) {
      restart();
    }
    setPlaying((p) => !p);
  }, [playing, mode, hud.position, blocks, restart]);

  const loadPreset = (key: string) => {
    if (!meta) return;
    setPreset(key);
    setSelected(null);
    setBlocks(presetBlocks(meta.symbols.presets[key], meta.symbols.symbols));
    restart();
    setPlaying(true);
  };

  // Keyboard: 1–N symbols, space play/pause, R restart.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!meta || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      const n = Number(e.key);
      const palette = meta.symbols.palette;
      if (n >= 1 && n <= palette.length) {
        const s = meta.symbols.symbols.find((x) => x.name === palette[n - 1])!;
        pick(s.code);
      } else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'r' || e.key === 'R') restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta, pick, togglePlay, send, restart]);

  const symbols = meta?.symbols.symbols ?? [];
  const current = symbols[hud.code];
  const presetInfo = meta?.symbols.presets[preset];

  return (
    <div className="app">
      <header>
        <div>
          <h1>Code2Act <span>· steer a simulated rat with symbols</span></h1>
          <p className="sub">
            One controller turns a stream of discrete behavior symbols into torques for a
            38-actuator biomechanical rat. It runs live in your browser: MuJoCo physics plus the paper's MLB
            controller, with no server.
          </p>
        </div>
        <a className="paper" href={PAPER_URL} target="_blank" rel="noreferrer">Project page ↗</a>
      </header>

      <main>
        <section className="stage">
          <div ref={host} className="canvas" />
          {!ready && (
            <div className="overlay">
              {error ? <p className="error">Could not start the simulation: {error}</p>
                : <><div className="spinner" /><p>{status}…</p><p className="hint">About 40 MB on first load</p></>}
            </div>
          )}
          {ready && current && (
            <div className="hud">
              <span className="chip" style={{ ['--chip' as string]: `rgb(${current.color.map((c) => Math.round(c * 255)).join(',')})` }}>
                {pretty(current.name)}
              </span>
              <span className="t">{(hud.position / 100).toFixed(1)} s</span>
            </div>
          )}
          {ready && (
            <div className="perf" title="Physics and controller cost per 10 ms control step">
              {hud.realtime > 0.97 ? 'real time' : `${hud.realtime.toFixed(2)}× real time`}
              {' · '}{hud.msPerStep.toFixed(1)} ms/step · {threads} thread{threads > 1 ? 's' : ''}
            </div>
          )}
          {ready && (
            <div className="stage-controls">
              <button className="primary" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
              <button onClick={() => restart()} title="R">Restart</button>
            </div>
          )}
        </section>

        <aside className="panel">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'timeline'} onClick={() => setMode('timeline')}>Sequence</button>
            <button role="tab" aria-selected={mode === 'live'} onClick={() => { setMode('live'); setPlaying(true); }}>Live</button>
          </div>
          <p className="help">
            {mode === 'timeline'
              ? `Click symbols (or press 1–${meta?.symbols.palette.length ?? 6}) to append them; click a block to change its hold or remove it.`
              : `Click a symbol (or press 1–${meta?.symbols.palette.length ?? 6}) and the controller switches to it immediately.`}
          </p>

          {meta && <Palette symbols={symbols} palette={meta.symbols.palette} mode={mode} active={mode === 'live' ? live : null} onPick={pick} />}

          {meta && mode === 'timeline' && (
            <>
              <div className="row">
                <label htmlFor="preset">Preset</label>
                <select id="preset" value={preset} onChange={(e) => loadPreset(e.target.value)}>
                  {Object.entries(meta.symbols.presets).map(([k, p]) => <option key={k} value={k}>{p.title}</option>)}
                </select>
              </div>
              {presetInfo && <p className="help">{presetInfo.blurb}</p>}
              <Timeline blocks={blocks} symbols={symbols} position={hud.position}
                selected={selected} onSelect={setSelected} onChange={setBlocks} />
            </>
          )}

          <div className="row">
            <label htmlFor="start">Start pose</label>
            <select id="start" value={start} onChange={(e) => { const s = Number(e.target.value); setStart(s); restart(s); }}>
              {Array.from({ length: N_STARTS }, (_, i) => <option key={i} value={i}>Test clip {i + 1}</option>)}
            </select>
            <button className="link" onClick={() => { const s = Math.floor(Math.random() * N_STARTS); setStart(s); restart(s); }}>Random</button>
          </div>
          <div className="row">
            <label htmlFor="speed">Speed</label>
            <input id="speed" type="range" min={0.25} max={2} step={0.25} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))} />
            <span className="dur">{speed}×</span>
          </div>

          {meta && <Readout history={history} symbols={symbols} palette={meta.symbols.palette} pca={meta.pca} />}

          <details className="notes">
            <summary>Why a later symbol can fail</summary>
            <p>
              Each symbol starts from wherever the previous one left the body. If a symbol goes
              wrong (the rat stumbles or ends in an unusual posture), the
              body can land in an out-of-distribution (OOD) state that the controller rarely saw in
              training. The next symbols may then not be followed well until it recovers.
            </p>
            <p>Two situations are especially fragile, because real rats rarely do them:</p>
            <ul>
              <li>
                <strong>Rearing straight out of a walk.</strong> Rats stop before they rear, so the
                controller usually keeps walking. A 1 s Immobile in between fixes most of these.
              </li>
              <li>
                <strong>Walking from a standstill.</strong> Once the rat has stalled (after a failed
                symbol, or after a rear that began from a stop) it can stay frozen, and a walk
                command alone rarely restarts it. A 1 s Turn R gets about 4 in 5 frozen rats moving.
                Note that a stalled rat looks correct during Immobile, so the problem often only
                shows on the next symbol.
              </li>
            </ul>
            <p>
              The timeline flags these switches with <span className="switch-inline">!</span> and
              offers the fix. Nothing resets between symbols: the physics state and the controller's
              recurrent memory both carry through the whole sequence. Restart, or pick another start
              pose, to try again.
            </p>
          </details>
        </aside>
      </main>
    </div>
  );
}
