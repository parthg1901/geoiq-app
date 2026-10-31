import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame, type SavedCrossword } from '../../lib/store';
import { wordCells, type PlacedWord } from '../../lib/crossword';
import { sfx, buzz } from '../../lib/sound';
import { onBack } from '../../lib/native';
import { checkAchievements } from '../../lib/achievements';
import { toast } from '../Toasts';
import { Keyboard } from './Keyboard';
import { ClueImage } from './ClueImage';
import { CrosswordDone } from './Done';

type Slot = 'daily' | 'custom';
type Dir = 'across' | 'down';
type Scope = 'letter' | 'word' | 'puzzle';

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function CrosswordPlay({ slot, onExit, onNew }: { slot: Slot; onExit: () => void; onNew: () => void }) {
  const saved0 = useGame.getState().crossword[slot]!;
  const { cw } = saved0;
  const W = cw.w, H = cw.h, N = W * H;
  const solution = useMemo(() => cw.grid.flat(), [cw]);

  const [fill, setFill] = useState<string[]>(() => [...saved0.fill]);
  const [revealed, setRevealed] = useState<boolean[]>(() => [...saved0.revealed].map((x) => x === '1'));
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [checks, setChecks] = useState(saved0.checks);
  const [reveals, setReveals] = useState(saved0.reveals);
  const [elapsed, setElapsed] = useState(saved0.elapsed);
  const [done, setDone] = useState(saved0.done);
  const [reward, setReward] = useState<{ xp: number; coins: number; best: boolean } | null>(null);
  const [sheet, setSheet] = useState<'clues' | 'help' | null>(null);

  // word lookups
  const words = cw.words;
  const cellsOf = useMemo(() => words.map((w) => wordCells(w).map(([r, c]) => r * W + c)), [words, W]);
  const cellWord = useMemo(() => {
    const m: { across?: number; down?: number }[] = Array.from({ length: N }, () => ({}));
    words.forEach((w, wi) => cellsOf[wi].forEach((i) => { m[i][w.dir] = wi; }));
    return m;
  }, [words, cellsOf, N]);

  const firstCell = cellsOf[0]?.[0] ?? 0;
  const [sel, setSel] = useState<{ i: number; dir: Dir }>({ i: firstCell, dir: words[0]?.dir ?? 'across' });
  const curWord = cellWord[sel.i]?.[sel.dir] ?? cellWord[sel.i]?.[sel.dir === 'across' ? 'down' : 'across'] ?? 0;
  const curDir: Dir = words[curWord]?.dir ?? sel.dir;
  const wordSet = useMemo(() => new Set(cellsOf[curWord] ?? []), [cellsOf, curWord]);

  /* ---------------- persistence ---------------- */
  const persist = useCallback((patch: Partial<SavedCrossword>) => {
    const g = useGame.getState();
    const cur = g.crossword[slot];
    if (!cur) return;
    g.set({ crossword: { ...g.crossword, [slot]: { ...cur, ...patch } } });
  }, [slot]);
  useEffect(() => { persist({ fill: fill.join(''), revealed: revealed.map((b) => (b ? '1' : '0')).join(''), checks, reveals }); }, [fill, revealed, checks, reveals, persist]);

  /* ---------------- timer (pauses while the app is hidden) ---------------- */
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  useEffect(() => {
    if (done) return;
    const h = setInterval(() => { if (document.visibilityState === 'visible') setElapsed((e) => e + 1); }, 1000);
    const save = setInterval(() => persist({ elapsed: elapsedRef.current }), 5000);
    return () => { clearInterval(h); clearInterval(save); persist({ elapsed: elapsedRef.current }); };
  }, [done, persist]);

  /* ---------------- completion ---------------- */
  const complete = useMemo(() => solution.every((ch, i) => !ch || fill[i] === ch), [solution, fill]);
  useEffect(() => {
    if (!complete || done) return;
    setDone(true);
    const g = useGame.getState();
    const nWords = words.length;
    const xp = 4 * nWords + (reveals === 0 ? 20 : 0);
    const coins = Math.max(5, Math.min(15, 5 + Math.round(nWords / 2)));
    g.addXP(xp, coins);
    g.bump('cwDone');
    if (reveals === 0 && saved0.size !== 'mini') g.bump('cwClean');
    const best = reveals === 0 ? g.best(`cw-${saved0.size}`, elapsedRef.current, true) : false;
    if (slot === 'daily') {
      const date = saved0.key.replace('daily:', '');
      g.set({ cwDaily: { ...g.cwDaily, [date]: { time: elapsedRef.current, reveals } } });
    }
    persist({ done: true, elapsed: elapsedRef.current });
    setReward({ xp, coins, best });
    sfx.win();
    confetti({ particleCount: 160, spread: 100, origin: { y: 0.35 } });
    for (const a of checkAchievements()) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
  }, [complete, done, words.length, reveals, saved0.size, saved0.key, slot, persist]);

  /* ---------------- navigation helpers ---------------- */
  const isEmpty = (i: number, f = fill) => f[i] === ' ';
  const wordDone = (wi: number, f = fill) => cellsOf[wi].every((i) => !isEmpty(i, f));
  const goWord = useCallback((wi: number, f = fill) => {
    const cells = cellsOf[wi];
    setSel({ i: cells.find((i) => f[i] === ' ') ?? cells[0], dir: words[wi].dir });
  }, [cellsOf, words, fill]);
  const nextUnfinished = (from: number, f: string[]) => {
    for (let k = 1; k <= words.length; k++) { const wi = (from + k) % words.length; if (!wordDone(wi, f)) return wi; }
    return -1;
  };

  const select = (i: number) => {
    if (solution[i] == null) return;
    if (i === sel.i) {
      const other: Dir = sel.dir === 'across' ? 'down' : 'across';
      if (cellWord[i][other] != null) setSel({ i, dir: other });
      return;
    }
    setSel({ i, dir: cellWord[i][sel.dir] != null ? sel.dir : sel.dir === 'across' ? 'down' : 'across' });
  };
  const toggleDir = () => { const other: Dir = curDir === 'across' ? 'down' : 'across'; if (cellWord[sel.i][other] != null) setSel({ i: sel.i, dir: other }); };

  const type = (L: string) => {
    if (done) return;
    const i = sel.i;
    const f = [...fill];
    if (!revealed[i]) {
      f[i] = L;
      setFill(f);
      if (wrong.has(i)) { const w = new Set(wrong); w.delete(i); setWrong(w); }
    }
    const cells = cellsOf[curWord];
    const pos = cells.indexOf(i);
    const ahead = cells.slice(pos + 1).find((j) => f[j] === ' ');
    if (ahead != null) { setSel({ i: ahead, dir: curDir }); return; }
    if (wordDone(curWord, f)) {
      const nw = nextUnfinished(curWord, f);
      if (nw >= 0) goWord(nw, f);
      return;
    }
    const behind = cells.find((j) => f[j] === ' ');
    if (behind != null) setSel({ i: behind, dir: curDir });
  };

  const back = () => {
    if (done) return;
    const i = sel.i;
    const cells = cellsOf[curWord];
    const f = [...fill];
    if (f[i] !== ' ' && !revealed[i]) { f[i] = ' '; setFill(f); return; }
    const pos = cells.indexOf(i);
    if (pos > 0) {
      const j = cells[pos - 1];
      if (!revealed[j]) { f[j] = ' '; setFill(f); }
      setSel({ i: j, dir: curDir });
    }
  };

  const step = (dr: number, dc: number) => {
    let r = Math.floor(sel.i / W) + dr, c = (sel.i % W) + dc;
    while (r >= 0 && c >= 0 && r < H && c < W) {
      const j = r * W + c;
      if (solution[j] != null) {
        const dir: Dir = dc !== 0 ? 'across' : 'down';
        setSel({ i: j, dir: cellWord[j][dir] != null ? dir : dir === 'across' ? 'down' : 'across' });
        return;
      }
      r += dr; c += dc;
    }
  };
  const nextClue = (d: number) => goWord((curWord + d + words.length) % words.length);

  /* ---------------- help ---------------- */
  const scopeCells = (s: Scope) => (s === 'letter' ? [sel.i] : s === 'word' ? cellsOf[curWord] : solution.map((ch, i) => (ch ? i : -1)).filter((i) => i >= 0));
  const check = (s: Scope) => {
    const bad = scopeCells(s).filter((i) => fill[i] !== ' ' && fill[i] !== solution[i]);
    setWrong(new Set([...wrong, ...bad]));
    setChecks((c) => c + 1);
    if (bad.length) { sfx.wrong(); buzz(20); } else sfx.right();
    setSheet(null);
  };
  const reveal = (s: Scope) => {
    const cells = scopeCells(s).filter((i) => fill[i] !== solution[i]);
    if (!cells.length) { setSheet(null); return; }
    const f = [...fill], rv = [...revealed];
    for (const i of cells) { f[i] = solution[i]!; rv[i] = true; }
    setFill(f); setRevealed(rv); setReveals((r) => r + 1);
    const w = new Set(wrong); cells.forEach((i) => w.delete(i)); setWrong(w);
    sfx.hint();
    setSheet(null);
  };

  /* ---------------- physical keyboard ---------------- */
  const handlers = useRef({ type, back, step, nextClue, toggleDir });
  handlers.current = { type, back, step, nextClue, toggleDir };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sheet) return;
      const h = handlers.current;
      if (/^[a-z]$/i.test(e.key)) { e.preventDefault(); h.type(e.key.toUpperCase()); }
      else if (e.key === 'Backspace') { e.preventDefault(); h.back(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); h.step(0, -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); h.step(0, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); h.step(-1, 0); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); h.step(1, 0); }
      else if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); h.nextClue(e.shiftKey ? -1 : 1); }
      else if (e.key === ' ') { e.preventDefault(); h.toggleDir(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  // Android back: close sheets first, then leave
  useEffect(() => onBack(() => (sheet ? setSheet(null) : onExit())), [sheet, onExit]);

  /* ---------------- sizing ---------------- */
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // header + clue bar + keyboard ≈ 330px; the grid gets the rest
  const cell = Math.max(18, Math.floor(Math.min((Math.min(vp.w, 640) - 16) / W, (vp.h - 330) / H, 46)));

  if (done) {
    return <CrosswordDone saved={{ ...saved0, done: true, elapsed, reveals, checks }} reward={reward} onExit={onExit} onNew={onNew} />;
  }

  const w = words[curWord];
  return (
    <div className="min-h-dvh flex flex-col mx-auto w-full max-w-3xl select-none">
      {/* header */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button aria-label="Close" onClick={onExit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
        <div className="flex-1 min-w-0">
          <div className="display font-bold leading-tight truncate">{saved0.title.replace('Daily crossword', 'Daily')}</div>
          <div className="text-xs text-mist mono">{fmtTime(elapsed)} · {words.length} words</div>
        </div>
        <button onClick={() => setSheet('clues')} className="chip !text-sm !py-2 !px-3">☰ Clues</button>
        <button onClick={() => setSheet('help')} className="chip !text-sm !py-2 !px-3">💡 Help</button>
      </div>

      {/* grid */}
      <div className="flex-1 grid place-items-center py-2">
        <div className="grid rounded-lg overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,.45)]" style={{ gridTemplateColumns: `repeat(${W}, ${cell}px)`, gridTemplateRows: `repeat(${H}, ${cell}px)` }}>
          {solution.map((ch, i) => {
            if (ch == null) return <div key={i} style={{ background: 'transparent' }} />;
            const n = cw.nums[Math.floor(i / W)][i % W];
            const isSel = i === sel.i, inWord = wordSet.has(i);
            const bad = wrong.has(i);
            return (
              <button key={i} onClick={() => select(i)} aria-label={`cell ${i}`}
                className="relative border border-ink/80 grid place-items-center touch-manipulation"
                style={{ background: isSel ? 'var(--color-amber)' : inWord ? '#2c4a86' : '#eef2ff', width: cell, height: cell }}>
                {n != null && <span className="absolute left-[2px] top-0 mono leading-none font-bold" style={{ fontSize: Math.max(8, cell * 0.3), color: isSel ? '#2a1600' : inWord ? '#d6e2ff' : '#3a4a6b' }}>{n}</span>}
                <span className="display font-extrabold leading-none" style={{ fontSize: cell * 0.56, marginTop: cell * 0.12, color: bad ? 'var(--color-rose)' : isSel ? '#1a0e00' : inWord ? '#fff' : '#0c1630' }}>
                  {fill[i] !== ' ' ? fill[i] : ''}
                </span>
                {revealed[i] && <span className="absolute right-0 top-0 w-0 h-0 border-l-[7px] border-l-transparent border-t-[7px] border-t-violet" />}
                {bad && <span className="absolute inset-x-1 bottom-[2px] h-[2px] bg-rose rounded" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* clue bar */}
      <div className="mx-2 rounded-2xl bg-panel border border-line/70 flex items-stretch">
        <button aria-label="Previous clue" onClick={() => nextClue(-1)} className="px-3 text-xl text-mist">◀</button>
        <div className="flex-1 min-w-0 py-2.5 flex items-center gap-3">
          {w?.clue.image && <ClueImage clue={w.clue} size={52} />}
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider font-bold text-amber">{w?.num} {w?.dir} · <span className="mono normal-case">{w?.enumeration}</span></div>
            <div className="leading-snug text-[15px]">{w?.clue.text}</div>
          </div>
        </div>
        <button aria-label="Next clue" onClick={() => nextClue(1)} className="px-3 text-xl text-mist">▶</button>
      </div>

      <Keyboard onKey={type} onBack={back} onToggle={toggleDir} dir={curDir} />

      <AnimatePresence>
        {sheet && (
          <motion.div className="fixed inset-0 z-50 bg-ink/80 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 280, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-deep border-t-4 border-amber/70 px-5 pt-3"
              style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}>
              <div className="mx-auto w-12 h-1.5 rounded-full bg-white/15 mb-3" />
              {sheet === 'help' ? (
                <HelpMenu onCheck={check} onReveal={reveal} checks={checks} reveals={reveals} />
              ) : (
                <ClueList words={words} cur={curWord} solved={(wi) => cellsOf[wi].every((i) => fill[i] === solution[i])} onPick={(wi) => { goWord(wi); setSheet(null); }} />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HelpMenu({ onCheck, onReveal, checks, reveals }: { onCheck: (s: Scope) => void; onReveal: (s: Scope) => void; checks: number; reveals: number }) {
  const scopes: Scope[] = ['letter', 'word', 'puzzle'];
  return (
    <div>
      <div className="display text-xl font-bold">Need a hand?</div>
      <p className="text-sm text-mist mt-1">Checking marks wrong letters in red. Revealing fills in the answer, and means no "no help" badge or best time for this puzzle.</p>
      <div className="text-xs uppercase tracking-wider font-bold text-mist mt-4 mb-2">Check · used {checks}</div>
      <div className="grid grid-cols-3 gap-2">{scopes.map((s) => <button key={s} onClick={() => onCheck(s)} className="btn btn-ghost !py-2.5 capitalize">{s}</button>)}</div>
      <div className="text-xs uppercase tracking-wider font-bold text-mist mt-4 mb-2">Reveal · used {reveals}</div>
      <div className="grid grid-cols-3 gap-2">{scopes.map((s) => <button key={s} onClick={() => onReveal(s)} className="btn btn-ghost !py-2.5 capitalize !text-violet">{s}</button>)}</div>
    </div>
  );
}

function ClueList({ words, cur, solved, onPick }: { words: PlacedWord[]; cur: number; solved: (wi: number) => boolean; onPick: (wi: number) => void }) {
  return (
    <div className="space-y-4">
      {(['across', 'down'] as const).map((d) => (
        <div key={d}>
          <div className="display text-lg font-bold capitalize mb-1.5">{d}</div>
          <div className="space-y-1">
            {words.map((w, wi) => (w.dir !== d ? null : (
              <button key={wi} onClick={() => onPick(wi)} className={`w-full text-left rounded-xl px-3 py-2 flex gap-3 items-center ${wi === cur ? 'bg-amber/15 border border-amber/50' : 'bg-white/5 border border-transparent'}`}>
                <span className="mono font-bold text-amber w-7 shrink-0">{w.num}</span>
                {w.clue.image && <ClueImage clue={w.clue} size={36} />}
                <span className={`flex-1 leading-snug ${solved(wi) ? 'line-through text-mist' : ''}`}>{w.clue.text} <span className="mono text-mist text-sm">{w.enumeration}</span></span>
              </button>
            )))}
          </div>
        </div>
      ))}
    </div>
  );
}

