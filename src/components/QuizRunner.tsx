import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { BY_ID, ARMS, ARMS_WORD, loadPhotos, type Photo } from '../data';
import { useGame, type AnswerResult } from '../lib/store';
import { VARIANT_SKILL, hintsFor, type Question } from '../lib/questions';
import { geoIQ, tierFor } from '../lib/geoiq';
import { sfx, buzz } from '../lib/sound';
import { checkAchievements } from '../lib/achievements';
import { toast } from './Toasts';
import { ChoiceGrid, TypeAnswer, ArmsImage } from './Answer';
import { Flag, Shape } from './Shape';
import { WorldMap } from './WorldMap';
import { Reveal } from './Reveal';
import { CountryProfile } from './CountryProfile';
import { CountUp, Progress } from './ui';
import { go } from '../lib/router';
import { regionFrame } from '../lib/path';

export interface QuizResult { q: Question; outcome: number; ms: number; given?: string | null }

export interface QuizConfig {
  title: string;
  questions: Question[];
  rush?: number; // seconds for a time-attack session (auto-advance, no reveal sheet)
  practice?: boolean;
  modeKey?: string;
  regionFocus?: string[] | null; // ids to frame on map questions
  onDone?: (results: QuizResult[]) => void;
  onAgain?: () => void;
  hideSummary?: boolean;
  /** extend rush sessions with more questions on demand */
  more?: () => Question[];
  /** override the reveal button label / progress display (e.g. for one-question-at-a-time runners) */
  nextLabel?: string;
  progress?: { index: number; total: number };
  /** called when the player quits via ✕ (default: finish if answered, else back to /play) */
  onQuit?: () => void;
}

function usePhotos(id: string) {
  const [p, setP] = useState<Photo[] | null>(null);
  useEffect(() => { let live = true; loadPhotos(id).then((x) => live && setP(x)); return () => { live = false; }; }, [id]);
  return p;
}

export function QuizRunner(cfg: QuizConfig) {
  const answerFn = useGame((s) => s.answer);
  const bump = useGame((s) => s.bump);
  const [qs, setQs] = useState(cfg.questions);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [phase, setPhase] = useState<'ask' | 'reveal' | 'done'>('ask');
  const [last, setLast] = useState<{ outcome: number; res: AnswerResult } | null>(null);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [shake, setShake] = useState(0);
  const [timeLeft, setTimeLeft] = useState(cfg.rush ?? 0);
  const startIQ = useRef(geoIQ(useGame.getState().ratings).iq);
  const t0 = useRef(performance.now());
  const xpTotal = useRef(0);
  const stamps = useRef<string[]>([]);
  const q = qs[idx];

  // Rush timer
  useEffect(() => {
    if (!cfg.rush || phase === 'done') return;
    const h = setInterval(() => setTimeLeft((t) => {
      if (t <= 0.1) { clearInterval(h); return 0; }
      return t - 0.1;
    }), 100);
    return () => clearInterval(h);
  }, [cfg.rush, phase]);
  useEffect(() => { if (cfg.rush && timeLeft <= 0 && phase !== 'done') finish(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  useEffect(() => { t0.current = performance.now(); }, [idx]);

  const finish = useCallback((nr?: QuizResult[]) => {
    const results_ = nr ?? results;
    setPhase('done');
    const right = results_.filter((r) => r.outcome >= 0.6).length;
    const perfect = results_.length > 0 && right === results_.length;
    if (perfect && results_.length >= 5) { sfx.win(); confetti({ particleCount: 160, spread: 90, origin: { y: 0.4 } }); }
    for (const a of checkAchievements({ perfect, combo: bestCombo, total: results_.length, mode: cfg.modeKey })) {
      toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
    }
    cfg.onDone?.(results_);
  }, [results, bestCombo, cfg]);

  const record = (outcome: number, given?: string | null) => {
    const ms = performance.now() - t0.current;
    const res = answerFn({ id: q.id, skill: VARIANT_SKILL[q.variant], format: q.format, outcome, ms, combo, practice: cfg.practice, dOffset: q.variant === 'arms' ? 90 : 0 });
    xpTotal.current += res.xp;
    const ok = outcome >= 0.6;
    if (ok) {
      const c = combo + 1;
      setCombo(c); setBestCombo((b) => Math.max(b, c));
      sfx.right(c); buzz(12);
      if (c > 0 && c % 10 === 0) confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 }, colors: ['#ffb547', '#ff6b5e', '#3ddc97'] });
      if (q.variant === 'photo') bump('photoRight');
      if (q.variant === 'shape-twist') bump('twistRight');
    } else {
      setCombo(0); sfx.wrong(); buzz([30, 40, 30]); setShake((x) => x + 1);
    }
    if (res.stamp) { stamps.current.push(q.id); setTimeout(() => sfx.stamp(), 300); }
    if (res.levelUp) { setTimeout(() => { sfx.level(); toast({ icon: '⬆️', title: 'Level up!', body: 'New level reached — keep going.' }); }, 400); }
    const nr = [...results, { q, outcome, ms, given }];
    setResults(nr);
    setLast({ outcome, res });
    if (cfg.rush) {
      if (!ok) setTimeLeft((t) => Math.max(0, t - 3));
      setTimeout(() => advance(nr), ok ? 380 : 900);
      setPhase('reveal');
    } else setPhase('reveal');
  };

  const advance = (nr = results) => {
    if (idx + 1 >= qs.length) {
      if (cfg.rush && cfg.more) { setQs((x) => [...x, ...cfg.more!()]); setIdx((i) => i + 1); setPhase('ask'); setLast(null); return; }
      setResults(nr);
      finishRef.current(nr);
      return;
    }
    setIdx((i) => i + 1);
    setPhase('ask');
    setLast(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  if (phase === 'done') {
    if (cfg.hideSummary) return null;
    return <Summary cfg={cfg} results={results} xp={xpTotal.current} bestCombo={bestCombo} startIQ={startIQ.current} stamps={stamps.current} />;
  }

  const pIdx = cfg.progress ? cfg.progress.index : idx;
  const pTotal = cfg.progress ? cfg.progress.total : qs.length;
  const progress = cfg.rush ? timeLeft / cfg.rush : (pIdx + (phase === 'reveal' ? 1 : 0)) / pTotal;

  return (
    <div className="min-h-dvh flex flex-col relative z-10">
      <div className="mx-auto w-full max-w-2xl px-4 pt-3 flex items-center gap-3">
        <button aria-label="Quit" onClick={() => (cfg.onQuit ? cfg.onQuit() : results.length ? finish() : go('/play'))}
          className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
        <div className="flex-1">
          <Progress value={progress} color={cfg.rush ? (timeLeft < 10 ? 'var(--color-rose)' : 'var(--color-sky)') : 'var(--color-amber)'} h={12} />
        </div>
        {cfg.rush ? (
          <span className={`mono font-bold text-lg w-14 text-right ${timeLeft < 10 ? 'text-rose' : ''}`}>{timeLeft.toFixed(1)}</span>
        ) : (
          <span className="mono text-sm text-mist w-12 text-right">{Math.min(pIdx + 1, pTotal)}/{pTotal}</span>
        )}
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 h-8 flex items-center justify-between">
        <span className="text-xs uppercase tracking-[.2em] text-mist/90 font-semibold">{cfg.title}</span>
        <AnimatePresence>
          {combo >= 2 && (
            <motion.span key={combo} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              className="display font-extrabold text-amber flex items-center gap-1"><span className="flame">🔥</span>{combo} combo</motion.span>
          )}
        </AnimatePresence>
        {cfg.rush && <span className="display font-bold text-mint">{results.filter((r) => r.outcome >= 0.6).length} ✓</span>}
      </div>

      <div key={shake} className={`flex-1 flex flex-col ${shake ? 'shake' : ''}`}>
        <QuestionView key={idx + ':' + q.id + q.variant} q={q} locked={phase !== 'ask'} onAnswer={record} regionFocus={cfg.regionFocus} rush={!!cfg.rush} />
      </div>

      <AnimatePresence>
        {phase === 'reveal' && last && !cfg.rush && (
          <Reveal
            id={q.id}
            correct={last.outcome >= 0.6}
            partial={last.outcome >= 0.6 && last.outcome < 0.95}
            xp={last.res.xp}
            iqDelta={last.res.iqAfter - last.res.iqBefore}
            stamp={last.res.stamp}
            onNext={() => advance()}
            nextLabel={cfg.nextLabel ?? (idx + 1 >= qs.length ? 'See results' : 'Continue')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QuestionView({ q, locked, onAnswer, regionFocus, rush }: {
  q: Question; locked: boolean; onAnswer: (outcome: number, given?: string | null) => void; regionFocus?: string[] | null; rush: boolean;
}) {
  const c = BY_ID[q.id];
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string | null) => { setPicked(id ?? '__none'); onAnswer(id === q.id ? 1 : 0, id); };

  const answerArea = (render: 'name' | 'flag' | 'capital' = 'name') =>
    q.choices ? (
      <ChoiceGrid choices={q.choices} answer={q.id} picked={picked} onPick={pick} render={render} disabled={locked} />
    ) : (
      <div>
        <TypeAnswer onSubmit={(id) => pick(id)} disabled={locked} />
        {picked && picked !== q.id && (
          <div className="mt-2 text-rose text-sm">You said {picked === '__none' ? 'something we didn’t recognise' : BY_ID[picked]?.name} — it was <b>{c.name}</b>.</div>
        )}
      </div>
    );

  switch (q.variant) {
    case 'shape':
    case 'shape-twist':
      return (
        <Body answer={answerArea()}>
          <Prompt kicker={q.variant === 'shape-twist' ? 'Rotated! Which country is this?' : 'Which country is this?'}>
            <div className="relative">
              <div className="absolute inset-0 -m-6 rounded-full bg-[radial-gradient(circle,rgba(255,181,71,.18),transparent_65%)]" />
              <Shape id={q.id} size="min(64vw, 300px, 36dvh)" rotate={q.rotate ?? 0}
                color={locked ? (picked === q.id ? 'var(--color-mint)' : 'var(--color-rose)') : 'var(--color-amber)'} />
            </div>
          </Prompt>
        </Body>
      );
    case 'flag':
      return (
        <Body answer={answerArea()}>
          <Prompt kicker="Whose flag is this?">
            <motion.div initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }}>
              <Flag id={q.id} className="w-[min(78vw,340px,54dvh)] aspect-[3/2] !rounded-xl shadow-[0_20px_60px_rgba(0,0,0,.6)]" />
            </motion.div>
          </Prompt>
        </Body>
      );
    case 'arms': {
      const a = ARMS[q.id];
      return (
        <Body answer={answerArea()}>
          <Prompt kicker={`Whose ${ARMS_WORD[a.kind]} is this?`}>
            <ArmsImage id={q.id} className="w-[min(70vw,300px,36dvh)]" />
          </Prompt>
        </Body>
      );
    }
    case 'flag-rev':
      return (
        <Body answer={answerArea('flag')}>
          <Prompt kicker="Pick the flag of">
            <div className="display text-4xl sm:text-5xl font-extrabold text-center">{c.name}</div>
          </Prompt>
        </Body>
      );
    case 'capital':
      return (
        <Body answer={answerArea('capital')}>
          <Prompt kicker="What is the capital of">
            <div className="flex flex-col items-center gap-3">
              <Flag id={q.id} className="h-12 w-18 !rounded" style={{ width: 72 }} />
              <div className="display text-4xl sm:text-5xl font-extrabold text-center">{c.name}</div>
            </div>
          </Prompt>
        </Body>
      );
    case 'capital-rev':
      return (
        <Body answer={answerArea()}>
          <Prompt kicker="This city is a capital. Of which country?">
            <div className="display text-4xl sm:text-5xl font-extrabold text-center text-amber">★ {c.capital}</div>
          </Prompt>
        </Body>
      );
    case 'map-find':
      return <MapFind q={q} locked={locked} onAnswer={onAnswer} regionFocus={regionFocus} rush={rush} />;
    case 'map-name': {
      const focus = [q.id, ...c.borders.filter((b) => BY_ID[b])].slice(0, 6);
      return (
        <Body answer={answerArea()} wideTop={
          <div className="relative flex-1 min-h-[38dvh] w-full rounded-3xl overflow-hidden border border-line bg-deep">
            <WorldMap className="absolute inset-0" focus={focus} fills={{ [q.id]: locked ? (picked === q.id ? 'var(--color-mint)' : 'var(--color-rose)') : 'var(--color-amber)' }}
              pulse={[q.id]} highlight={q.id} />
          </div>
        }>
          <div className="text-center text-mist text-sm uppercase tracking-[.18em] font-semibold my-3">Name the highlighted country</div>
        </Body>
      );
    }
    case 'hint':
      return <HintLadder q={q} locked={locked} onAnswer={onAnswer} />;
    case 'photo':
      return <PhotoQ q={q} locked={locked} onAnswer={onAnswer} answerArea={answerArea} picked={picked} />;
  }
}

function Prompt({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="kb-prompt flex-1 flex flex-col items-center justify-center min-h-[34dvh] py-2">
      <div className="text-mist text-sm uppercase tracking-[.18em] font-semibold mb-3">{kicker}</div>
      {children}
    </div>
  );
}

function Body({ children, answer, wideTop }: { children?: React.ReactNode; answer: React.ReactNode; wideTop?: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
      {wideTop}
      {children}
      <div className="mt-auto pt-3">{answer}</div>
    </div>
  );
}

/* -------- Map: click the country -------- */
function MapFind({ q, locked, onAnswer, regionFocus, rush }: { q: Question; locked: boolean; onAnswer: (o: number, g?: string | null) => void; regionFocus?: string[] | null; rush: boolean }) {
  const c = BY_ID[q.id];
  const [wrong, setWrong] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const maxTries = rush ? 1 : 3;
  const onPick = (id: string) => {
    if (locked || done) return;
    if (id === q.id) { setDone(true); onAnswer([1, 0.55, 0.25][wrong.length]); return; }
    const w = [...wrong, id];
    setWrong(w); sfx.wrong(); buzz(20);
    if (w.length >= maxTries) { setDone(true); onAnswer(0, id); }
  };
  const fills: Record<string, string> = {};
  for (const w of wrong) fills[w] = 'var(--color-rose)';
  if (done) fills[q.id] = wrong.length >= maxTries ? 'var(--color-amber)' : 'var(--color-mint)';
  const labels: Record<string, string> = {};
  for (const w of wrong) labels[w] = BY_ID[w]?.name ?? '';
  // Phones can't resolve small countries on a whole-world view, so frame the continent there.
  const [narrow] = useState(() => window.innerWidth < 700);
  const frame = regionFocus ?? (narrow ? regionFrame(c.region) : null);
  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-5xl px-2 sm:px-4 pb-4">
      <div className="text-center my-2">
        <div className="text-mist text-xs uppercase tracking-[.18em] font-semibold">Tap on the map</div>
        <div className="display text-3xl sm:text-4xl font-extrabold">{c.name}</div>
        {!rush && <div className="text-sm text-mist mt-1">{maxTries - wrong.length} {maxTries - wrong.length === 1 ? 'try' : 'tries'} left · {frame && !regionFocus ? `somewhere in ${c.region} · ` : ''}pinch / scroll to zoom</div>}
      </div>
      <div className="relative flex-1 min-h-[52dvh] rounded-3xl overflow-hidden border border-line bg-deep">
        <WorldMap className="absolute inset-0" onPick={onPick} fills={fills} labels={labels} focus={done ? [q.id] : frame} pulse={done ? [q.id] : []} highlight={done ? q.id : null} />
      </div>
    </div>
  );
}

/* -------- Clue ladder -------- */
function HintLadder({ q, locked, onAnswer }: { q: Question; locked: boolean; onAnswer: (o: number, g?: string | null) => void }) {
  const c = BY_ID[q.id];
  const hints = useMemo(() => hintsFor(c), [c]);
  const stages = hints.length + 1; // last stage: silhouette
  const [shown, setShown] = useState(1);
  const [wrong, setWrong] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const pts = Math.round(((stages - shown + 1) / stages) * 100);
  const next = () => {
    if (shown < stages) { setShown((s) => s + 1); sfx.hint(); }
    else { setOver(true); onAnswer(0); }
  };
  const guess = (id: string | null) => {
    if (locked || over) return;
    if (id === q.id) { setOver(true); onAnswer(Math.max(0.6, (stages - shown + 1) / stages)); return; }
    setWrong((w) => [...w, id ? BY_ID[id]?.name ?? '?' : '?']);
    sfx.wrong();
    next();
  };
  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
      <div className="flex items-center justify-between my-2">
        <div className="text-mist text-sm uppercase tracking-[.18em] font-semibold">Mystery country</div>
        <div className="chip mono !text-amber">worth {pts}%</div>
      </div>
      <div className="space-y-2.5">
        {hints.slice(0, shown).map((h, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -20, rotateX: -40 }} animate={{ opacity: 1, x: 0, rotateX: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="card !rounded-2xl px-4 py-3 flex gap-3">
            <span className="display font-extrabold text-amber w-6 shrink-0">{i + 1}</span>
            <div className="min-w-0"><div className="text-xs uppercase tracking-wider text-mist font-bold">{h.label}</div><div className="leading-snug text-[15px] break-words">{h.text}</div></div>
          </motion.div>
        ))}
        {shown >= stages && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="card !rounded-2xl p-3 flex items-center gap-4">
            <Shape id={q.id} size={110} />
            <div className="text-mist text-sm">Last clue: its silhouette.</div>
          </motion.div>
        )}
      </div>
      {wrong.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{wrong.map((w, i) => <span key={i} className="chip !text-rose line-through">{w}</span>)}</div>}
      <div className="mt-auto pt-4 space-y-2">
        <TypeAnswer onSubmit={(id) => guess(id)} disabled={locked || over} placeholder="Your guess…" />
        {!locked && !over && <button className="btn btn-ghost w-full !py-2.5 text-sm" onClick={next}>{shown < stages ? 'Reveal next clue (−points)' : 'Give up'}</button>}
      </div>
    </div>
  );
}

/* -------- Street Eye: photo -------- */
function PhotoQ({ q, locked, onAnswer, answerArea, picked }: {
  q: Question; locked: boolean; onAnswer: (o: number, g?: string | null) => void; answerArea: (r?: 'name') => React.ReactNode; picked: string | null;
}) {
  const photos = usePhotos(q.id);
  const list = useMemo(() => {
    const l = photos ?? [];
    // deterministic-ish shuffle per question
    return [...l].sort((a, b) => ((a.u.length * 31 + (q.photo ?? 0)) % 7) - ((b.u.length * 31 + (q.photo ?? 0)) % 7));
  }, [photos, q.id, q.photo]);
  const [i, setI] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const p = list[i % Math.max(1, list.length)];
  void onAnswer; void picked;
  return (
    <Body answer={answerArea()}>
      <div className="text-center text-mist text-sm uppercase tracking-[.18em] font-semibold my-2">Where was this photo taken?</div>
      <div className="kb-photo relative w-full aspect-[4/3] sm:aspect-[16/10] rounded-3xl overflow-hidden border border-line bg-deep">
        {!p && <div className="absolute inset-0 grid place-items-center text-mist">Loading photo…</div>}
        {p && (
          <motion.img key={p.u} src={p.u} alt="mystery place" onLoad={() => setLoaded(true)}
            initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: loaded ? 1 : 0 }} transition={{ duration: 6, ease: 'easeOut', opacity: { duration: 0.4 } }}
            className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
        )}
        {p && !loaded && <div className="absolute inset-0 grid place-items-center text-mist animate-pulse">Developing photo…</div>}
        {!locked && list.length > 1 && (
          <div className="absolute right-3 bottom-3">
            <button className="chip !bg-black/60 !text-sm !py-1.5 !px-3" onClick={() => { setLoaded(false); setI((x) => x + 1); sfx.hint(); }}>Another angle ↻</button>
          </div>
        )}
      </div>
      {locked && p && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 px-1">
          <p className="text-[15px] leading-snug text-paper/90 break-words">{p.c || 'Photo'}</p>
          <p className="text-[13px] text-mist mt-0.5 break-words">📷 {p.a || 'Unknown'}{p.l ? ` · ${p.l}` : ''} · Wikimedia Commons</p>
        </motion.div>
      )}
    </Body>
  );
}

/* ------------------------------------------------------------------ */

function Summary({ cfg, results, xp, bestCombo, startIQ, stamps }: { cfg: QuizConfig; results: QuizResult[]; xp: number; bestCombo: number; startIQ: number; stamps: string[] }) {
  const ratings = useGame((s) => s.ratings);
  const { iq, provisional } = geoIQ(ratings);
  const right = results.filter((r) => r.outcome >= 0.6).length;
  const acc = results.length ? right / results.length : 0;
  const misses = results.filter((r) => r.outcome < 0.6);
  const tier = tierFor(iq);
  const best = useGame((s) => s.best);
  const [about, setAbout] = useState<string | null>(null);
  const [isBest] = useState(() => (cfg.modeKey && cfg.rush ? best(cfg.modeKey, right) : false));
  useEffect(() => { if (acc >= 0.8 && results.length >= 5) confetti({ particleCount: 120, spread: 100, origin: { y: 0.3 } }); }, [acc, results.length]);

  return (
    <div className="relative z-10 mx-auto max-w-2xl px-4 py-6 min-h-dvh flex flex-col">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center mt-4">
        <div className="text-mist uppercase tracking-[.2em] text-xs font-bold">{cfg.title} · complete</div>
        <div className="display text-6xl font-extrabold mt-2">
          {cfg.rush ? <><CountUp to={right} /> <span className="text-2xl text-mist">correct</span></> : <><CountUp to={Math.round(acc * 100)} />%</>}
        </div>
        {isBest && <div className="chip !text-amber !border-amber mt-2">🏆 New personal best!</div>}
      </motion.div>

      <div className="grid grid-cols-3 gap-3 mt-6">
        {[
          { k: 'XP earned', v: <>+<CountUp to={xp} /></>, c: 'text-amber' },
          { k: 'Best combo', v: <>{bestCombo}🔥</>, c: 'text-coral' },
          { k: 'GeoIQ', v: <><CountUp from={startIQ} to={iq} />{iq !== startIQ && <span className={`text-sm ml-1 ${iq > startIQ ? 'text-mint' : 'text-rose'}`}>{iq > startIQ ? '▲' : '▼'}{Math.abs(iq - startIQ)}</span>}</>, c: '' },
        ].map((x, i) => (
          <motion.div key={x.k} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 + i * 0.1 }} className="card p-3 text-center">
            <div className={`display text-2xl font-extrabold ${x.c}`}>{x.v}</div>
            <div className="text-xs uppercase tracking-wider text-mist font-semibold mt-1">{x.k}</div>
          </motion.div>
        ))}
      </div>
      <div className="text-center text-sm text-mist mt-3">{tier.emoji} {tier.name}{provisional ? ' · provisional — keep playing to calibrate' : ''}</div>

      {stamps.length > 0 && (
        <div className="card p-4 mt-5">
          <div className="display font-bold text-violet mb-2">🛂 New passport stamps</div>
          <div className="flex flex-wrap gap-2">{stamps.map((s) => <span key={s} className="chip"><Flag id={s} className="w-5 h-3.5 !rounded-sm" />{BY_ID[s].name}</span>)}</div>
        </div>
      )}

      {misses.length > 0 && (
        <div className="mt-5">
          <div className="display font-bold mb-2">Review your misses <span className="text-sm font-normal text-mist">— tap to learn more</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {misses.map((m, i) => (
              <button key={i} onClick={() => setAbout(m.q.id)} className="card !rounded-2xl p-2.5 flex items-center gap-2.5 text-left hover:border-amber/60">
                {m.q.variant === 'arms' ? <ArmsImage id={m.q.id} small className="w-10" /> : m.q.variant.startsWith('flag') ? <Flag id={m.q.id} className="w-10 h-7 !rounded shrink-0" /> : <Shape id={m.q.id} size={40} glow={false} color="var(--color-rose)" />}
                <div className="min-w-0">
                  <div className="font-bold leading-tight break-words">{BY_ID[m.q.id].name}</div>
                  <div className="text-[13px] text-mist leading-snug break-words">★ {BY_ID[m.q.id].capital}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {about && <CountryProfile id={about} onClose={() => setAbout(null)} />}
      <div className="mt-auto pt-8 grid grid-cols-2 gap-3">
        <button className="btn btn-ghost" onClick={() => go('/')}>Home</button>
        {cfg.onAgain ? <button className="btn btn-primary" onClick={cfg.onAgain}>Play again</button> : <button className="btn btn-primary" onClick={() => go('/play')}>More games</button>}
      </div>
    </div>
  );
}
