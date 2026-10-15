import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allowedNext, isVerified, loadMeta, presetBlocks, pretty, type PcaFile, type SymbolsFile } from './data';
import { RatScene } from './render/scene';
import type { Command, Frame, WorkerMessage } from './sim/protocol';
import type { Block } from './sim/sequencer';
import Palette from './ui/Palette';
import Readout, { emptyHistory, type History } from './ui/Readout';
import Timeline from './ui/Timeline';

const BASE = import.meta.env.BASE_URL;
const heldRate = ([f, n]: [number, number]) => f ? `about 1 run in ${Math.round(n / f)}` : `none of ${n} runs`;
/** Held-out failure rate of the two longest chain lengths, e.g. "about 1 in 14 of the 7–8 symbol". */
const longRate = (g: SymbolsFile['graph']) => {
  const h = g.held_by_length;
  if (!h || h.length < 2) return '';
  const [f, n] = h.slice(-2).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return f ? `about 1 in ${Math.round(n / f)} of the ${h.length - 1}–${h.length} symbol` : '';
};
const PAPER_URL = 'https://kbian.org/Code2Act-website/';

const names = (m: SymbolsFile, b: Block[]) => b.map((x) => m.symbols[x.code].name);

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
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [preset, setPreset] = useState('tour'); // '' = your sequence
  const [custom, setCustom] = useState<{ blocks: Block[]; clip: number }>({ blocks: [], clip: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clip, setClip] = useState(0); // index into graph.starts
  const [notice, setNotice] = useState('');
  const [hud, setHud] = useState<Hud>({ code: 8, position: 0, msPerStep: 0, realtime: 1 });

  const send = useCallback((c: Command) => worker.current?.postMessage(c), []);

  useEffect(() => {
    loadMeta(BASE).then((m) => {
      setMeta(m);
      const tour = m.symbols.presets.tour;
      setClip(tour.clip);
      setCustom({ blocks: [], clip: tour.clip });
      setBlocks(presetBlocks(tour, m.symbols.symbols));
    }).catch((e) => setError(String(e)));
  }, []);

  // Worker + renderer lifecycle.
  useEffect(() => {
    if (!meta || !host.current) return;
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    let lastHud = 0;
    let hudTimer: number | undefined;
    let pendingHud: Hud | null = null;
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
      // Throttle HUD updates to 10 Hz, but always show the latest frame (e.g.
      // the one posted by a reset) once the throttle window has passed.
      pendingHud = { code: f.code, position: f.position, msPerStep: f.msPerStep, realtime: f.realtime };
      const now = performance.now();
      if (now - lastHud > 100) flushHud();
      else if (hudTimer === undefined) hudTimer = window.setTimeout(flushHud, 100 - (now - lastHud));
    };
    const flushHud = () => {
      hudTimer = undefined;
      lastHud = performance.now();
      if (pendingHud) setHud(pendingHud);
    };
    return () => {
      window.clearTimeout(hudTimer);
      w.terminate();
      scene.current?.dispose();
      scene.current = null;
      worker.current = null;
    };
  }, [meta]);

  // Every change of timeline or start pose goes through a reset, so a run is
  // always one whole sequence from its start pose.
  const reset = useCallback((b: Block[], c: number) => {
    if (!meta) return;
    history.current = emptyHistory();
    scene.current?.clearHistory();
    send({ type: 'reset', start: meta.symbols.graph.starts[c], blocks: b });
  }, [meta, send]);

  useEffect(() => { if (ready) reset(blocks, clip); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { send({ type: 'speed', speed }); }, [speed, send, ready]);
  useEffect(() => { send({ type: 'play', playing }); }, [playing, send, ready]);

  const edit = useCallback((b: Block[]) => {
    setNotice('');
    setBlocks(b);
    setCustom({ blocks: b, clip });
    setPreset('');
    setPlaying(false);
    reset(b, clip);
  }, [reset, clip]);

  const graph = meta?.symbols.graph;
  const allowed = useMemo(
    () => (graph && meta ? allowedNext(graph, clip, names(meta.symbols, blocks)) : new Set<string>()),
    [graph, meta, blocks, clip]);

  const pick = useCallback((code: number) => {
    if (!graph || !meta || !allowed.has(meta.symbols.symbols[code].name)) return;
    edit([...blocks, { code, steps: graph.hold }]);
  }, [graph, meta, allowed, blocks, edit]);

  const restart = useCallback(() => reset(blocks, clip), [reset, blocks, clip]);

  const togglePlay = useCallback(() => {
    if (!playing && hud.position >= blocks.reduce((n, b) => n + b.steps, 0)) restart();
    setPlaying((p) => !p);
  }, [playing, hud.position, blocks, restart]);

  // An example plays from the start pose it was checked from; '' brings back
  // your own sequence (empty until you build one).
  const loadPreset = (key: string) => {
    if (!meta) return;
    const p = meta.symbols.presets[key];
    const b = p ? presetBlocks(p, meta.symbols.symbols) : custom.blocks;
    const c = p ? p.clip : custom.clip;
    setNotice('');
    setPreset(key);
    setBlocks(b);
    setClip(c);
    reset(b, c);
    setPlaying(!!p);
  };

  const chooseClip = (c: number) => {
    if (!meta) return;
    // Each start pose has its own verified tree: keep the longest verified prefix.
    let b = blocks;
    while (!isVerified(meta.symbols.graph, c, names(meta.symbols, b))) b = b.slice(0, -1);
    setNotice(b.length === blocks.length ? ''
      : b.length === 0 ? `Cleared: this sequence was not verified from Clip ${c + 1}.`
      : `Trimmed to ${b.length} symbol${b.length === 1 ? '' : 's'}: the rest was not verified from Clip ${c + 1}.`);
    setPreset('');
    setCustom({ blocks: b, clip: c });
    setBlocks(b);
    setClip(c);
    setPlaying(false);
    reset(b, c);
  };

  // Keyboard: 1-N symbols, space play/pause, R restart.
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
  }, [meta, pick, togglePlay, restart]);

  const symbols = meta?.symbols.symbols ?? [];
  const current = symbols[hud.code];

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
          <p className="help">
            Click symbols (or press 1–{meta?.symbols.palette.length ?? 6}) to build a sequence, then press Play.
            Only symbols verified to work after the current sequence are lit.
          </p>

          {meta && <Palette symbols={symbols} palette={meta.symbols.palette} allowed={allowed} onPick={pick} />}
          {graph && blocks.length > 0 && allowed.size === 0 && (
            <p className="help">
              {blocks.length >= graph.max_blocks
                ? `That's the maximum of ${graph.max_blocks} symbols.`
                : 'No symbol is verified to follow this sequence.'} Press Play, or Undo to branch off.
            </p>
          )}

          {notice && <p className="help notice">{notice}</p>}
          {meta && graph && (
            <>
              <Timeline blocks={blocks} symbols={symbols} position={hud.position}
                maxBlocks={graph.max_blocks} onChange={edit} />
              <div className="row">
                <label htmlFor="preset">Example</label>
                <select id="preset" value={preset} onChange={(e) => loadPreset(e.target.value)}>
                  {Object.entries(meta.symbols.presets).map(([k, p]) => <option key={k} value={k}>{p.title}</option>)}
                  <option value="">Your sequence</option>
                </select>
              </div>
              <div className="row">
                <label htmlFor="start">Start pose</label>
                <select id="start" value={clip} onChange={(e) => chooseClip(Number(e.target.value))}>
                  {graph.starts.map((_, i) => <option key={i} value={i}>Clip {i + 1}</option>)}
                </select>
                <button className="link" onClick={() => chooseClip(Math.floor(Math.random() * graph.starts.length))}>Random</button>
              </div>
            </>
          )}
          <div className="row">
            <label htmlFor="speed">Speed</label>
            <input id="speed" type="range" min={0.25} max={2} step={0.25} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))} />
            <span className="dur">{speed}×</span>
          </div>

          {meta && <Readout history={history} symbols={symbols} palette={meta.symbols.palette} pca={meta.pca} />}

          {graph && (
            <details className="notes">
              <summary>Why only some symbols are lit</summary>
              <p>
                A symbol can fail in two ways: the rat loses control (it flies off, tumbles, or sinks
                to the floor and freezes), or it does a different behavior, most often because it is
                still moving when the switch comes (a rat needs to be nearly still to rear). So only
                sequences tested from this clip are lit. Switches that showed the asked-for behavior in
                fewer than half of the runs we tested are left out, mostly switching out of a walk
                into a rear, turn or stop. Here {graph.chains[clip].length.toLocaleString('en-US')} sequences
                (up to {graph.max_blocks} symbols, {graph.hold / 100} s each) kept control in
                all {graph.runs} simulated runs: the clean physics plus {graph.runs - 1} with tiny nudges
                to the motor commands. It is not a guarantee, and long sequences are riskier: later
                symbols more often get a neighboring behavior
                {graph.held_fails ? <>, and in a replay through this page's own code {heldRate(graph.held_fails)}{' '}
                still lost control{longRate(graph) && <> ({longRate(graph)} ones)</>}.</> : '.'}
              </p>
            </details>
          )}

          <footer className="credits">
            Inspired by the{' '}
            <a href="https://mimic-mjx-web-demo.pages.dev/" target="_blank" rel="noreferrer">MIMIC-MJX web demo</a>.
          </footer>
        </aside>
      </main>
    </div>
  );
}
