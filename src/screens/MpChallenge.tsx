import { askConfirm } from '../components/Confirm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame } from '../lib/store';
import { go } from '../lib/router';
import { createChallenge, getChallenge, postChallengeResult, MpError } from '../lib/mp/api';
import { buildMpQuestions, topicLabel, type MpQuestion } from '../lib/mp/questions';
import { CHALLENGE_SECONDS, points, raceScore, RACE_DEFAULT_SEC, type Challenge, type ChallengeResult, type ChallengeSpec, type GameKind, type RaceReport, type Topic } from '../lib/mp/protocol';
import { GAME_META, progressText, settingsLabel, fmtClock, type RaceGame } from '../lib/mp/race';
import { GamePicker, RaceSettings, useRacePuzzle, RaceBoard, raceXp } from '../components/mp/race';
import { DATA_VERSION } from '../lib/mp/version';
import { onBack } from '../lib/native';
import { sfx, buzz } from '../lib/sound';
import { checkAchievements } from '../lib/achievements';
import { toast } from '../components/Toasts';
import { TopicPicker, Stepper, MpQuestionView, AnswerLabel, TimerBar, Avatar } from '../components/mp/parts';
import { mpName } from './Multiplayer';

/** Everything needed to rebuild a challenge's questions or puzzle. */
type PlaySpec = Required<Pick<ChallengeSpec, 'game' | 'topic' | 'rounds' | 'seed' | 'sources' | 'size' | 'limitSec'>>;
const specOf = (c: ChallengeSpec): PlaySpec => ({
  game: c.game ?? 'quiz', topic: c.topic, rounds: c.rounds, seed: c.seed,
  sources: c.sources ?? [], size: c.size ?? 'mini', limitSec: c.limitSec ?? RACE_DEFAULT_SEC.crossword,
});
/** Label for a challenge (quiz topic or race game). */
export const challengeLabel = (c: Pick<ChallengeSpec, 'game' | 'topic' | 'sources' | 'size' | 'limitSec'>) =>
  settingsLabel({ game: c.game ?? 'quiz', topic: c.topic, rounds: 0, seconds: 0, sources: c.sources ?? [], size: c.size ?? 'mini', limitSec: c.limitSec ?? 0 });

type View =
  | { k: 'setup' }
  | { k: 'loading' }
  | { k: 'error'; title: string; body: string; retry?: () => void }
  | { k: 'intro'; ch: Challenge }
  | { k: 'play'; spec: PlaySpec; ch?: Challenge }
  | { k: 'saving' }
  | { k: 'results'; ch: Challenge; fresh?: boolean };

const randomSeed = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] & 0x7fffffff;
};

export default function MpChallenge({ id }: { id?: string }) {
  const isNew = !id || id === 'new';
  const deviceId = useGame((s) => s.mp.deviceId);
  const [view, setView] = useState<View>(isNew ? { k: 'setup' } : { k: 'loading' });
  const [topic, setTopic] = useState<Topic>('world:mix');
  const [rounds, setRounds] = useState(10);
  const [game, setGame] = useState<GameKind>('quiz');
  const [race, setRace] = useState({ sources: [] as string[], size: 'mini' as 'mini' | 'standard', limitSec: RACE_DEFAULT_SEC.crossword });
  useEffect(() => onBack(() => go('/mp')), []);

  const remember = (code: string, t: Topic, role: 'creator' | 'player') => {
    const s = useGame.getState();
    if (!s.mp.challenges.some((c) => c.code === code)) s.mpUpdate({ challenges: [...s.mp.challenges, { code, topic: t, createdAt: Date.now(), role }].slice(-50) });
  };

  const load = useCallback(async (code?: string) => {
    const c = code ?? (isNew ? undefined : id);
    if (!c) return;
    setView({ k: 'loading' });
    try {
      const ch = await getChallenge(c);
      if (ch.results.some((r) => r.deviceId === deviceId)) setView({ k: 'results', ch });
      else if (ch.spec.dataVersion !== DATA_VERSION) setView({ k: 'error', title: 'Update GeoIQ to play this challenge', body: `It was made on GeoIQ ${ch.spec.dataVersion} and you have ${DATA_VERSION}. The questions only match on the same version.` });
      else setView({ k: 'intro', ch });
    } catch (e) {
      const nf = e instanceof MpError && e.kind === 'notfound';
      setView({ k: 'error', title: nf ? 'Challenge not found' : 'Couldn’t load the challenge', body: nf ? `There’s no challenge ${c} — it may have expired (challenges last 30 days).` : (e as Error).message, retry: nf ? undefined : () => load(c) });
    }
  }, [id, isNew, deviceId]);
  useEffect(() => { load(); }, [load]);

  const finished = async (result: ChallengeResult, spec: PlaySpec, ch?: Challenge) => {
    setView({ k: 'saving' });
    const save = async () => {
      try {
        if (ch) {
          const updated = await postChallengeResult(ch.code, result);
          remember(ch.code, labelKey(ch.spec), 'player');
          if (ch.creator.deviceId !== deviceId) useGame.getState().bump('mpChallengeDone');
          for (const a of checkAchievements({ mode: 'mp' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
          setView({ k: 'results', ch: updated, fresh: true });
        } else {
          const body: ChallengeSpec = spec.game === 'quiz'
            ? { topic: spec.topic, rounds: spec.rounds, seed: spec.seed, dataVersion: DATA_VERSION }
            : { ...spec, dataVersion: DATA_VERSION };
          const r = await createChallenge({ spec: body, result });
          remember(r.code, labelKey(spec), 'creator');
          // Point the address at the new code (without remounting) so reloads and Refresh find it.
          history.replaceState(null, '', `#/mp/challenge/${r.code}`);
          setView({ k: 'results', ch: r.challenge, fresh: true });
        }
      } catch (e) {
        setView({ k: 'error', title: 'Couldn’t save your score', body: `${(e as Error).message} Your round is kept — try again.`, retry: save });
      }
    };
    await save();
  };

  return (
    <div className="min-h-dvh mx-auto max-w-2xl px-4 flex flex-col">
      {view.k !== 'play' && (
        <div className="flex items-center gap-3 py-3">
          <button aria-label="Back" onClick={() => go('/mp')} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
          <div className="flex-1 display font-bold text-lg">Challenge{id && !isNew ? ` ${id}` : ''}</div>
        </div>
      )}

      {view.k === 'setup' && (
        <div className="flex-1 flex flex-col">
          <h1 className="display text-3xl font-extrabold">New challenge</h1>
          <p className="text-mist mt-1">Play a round, then send the code to friends. They’ll get exactly the same {game === 'quiz' ? 'questions' : 'puzzle'}.{game === 'quiz' ? ` You have ${CHALLENGE_SECONDS}s per question — faster right answers score more.` : ''}</p>
          <div className="mt-5 space-y-2">
            <GamePicker value={game} onChange={(g) => { setGame(g); if (g !== 'quiz') setRace((r) => ({ ...r, limitSec: RACE_DEFAULT_SEC[g] })); }} />
            {game === 'quiz' ? (
              <>
                <TopicPicker value={topic} onChange={setTopic} />
                <Stepper label="Questions" value={rounds} min={5} max={15} onChange={setRounds} />
              </>
            ) : (
              <RaceSettings s={{ game, ...race }} onChange={(p) => setRace((r) => ({ ...r, ...(p as Partial<typeof race>) }))} />
            )}
          </div>
          <div className="mt-auto pt-6 pb-4">
            <button className="btn btn-primary w-full text-lg" onClick={() => setView({ k: 'play', spec: { game, topic, rounds: game === 'quiz' ? rounds : 5, seed: randomSeed(), ...race } })}>▶ Play my round</button>
          </div>
        </div>
      )}

      {(view.k === 'loading' || view.k === 'saving') && (
        <div className="flex-1 grid place-items-center text-center text-mist">
          <div><div className="text-4xl animate-bounce">🌍</div><div className="mt-2">{view.k === 'saving' ? 'Saving your score…' : 'Loading challenge…'}</div></div>
        </div>
      )}

      {view.k === 'error' && (
        <div className="flex-1 grid place-items-center text-center px-4">
          <div>
            <div className="text-5xl">⚠️</div>
            <div className="display text-2xl font-extrabold mt-3">{view.title}</div>
            <p className="text-mist mt-2 leading-relaxed">{view.body}</p>
            <div className="flex gap-3 justify-center mt-6">
              {view.retry && <button className="btn btn-primary" onClick={view.retry}>Try again</button>}
              <button className="btn btn-ghost" onClick={() => go('/mp')}>Back</button>
            </div>
          </div>
        </div>
      )}

      {view.k === 'intro' && <Intro ch={view.ch} onPlay={() => setView({ k: 'play', spec: specOf(view.ch.spec), ch: view.ch })} />}

      {view.k === 'play' && view.spec.game === 'quiz' && (
        <Play topic={view.spec.topic} rounds={view.spec.rounds} seed={view.spec.seed}
          onQuit={() => (view.ch ? setView({ k: 'intro', ch: view.ch }) : setView({ k: 'setup' }))}
          onDone={(r) => finished(r, view.spec, view.ch)} />
      )}
      {view.k === 'play' && view.spec.game !== 'quiz' && (
        <RacePlay spec={view.spec}
          onQuit={() => (view.ch ? setView({ k: 'intro', ch: view.ch }) : setView({ k: 'setup' }))}
          onDone={(r) => finished(r, view.spec, view.ch)} />
      )}

      {view.k === 'results' && <Results ch={view.ch} fresh={!!view.fresh} you={deviceId} onRefresh={() => load(view.ch.code)} />}
    </div>
  );
}

/* ---------------- intro ---------------- */

function Intro({ ch, onPlay }: { ch: Challenge; onPlay: () => void }) {
  const best = Math.max(0, ...ch.results.map((r) => r.score));
  return (
    <div className="flex-1 flex flex-col">
      <div className="card p-5 text-center">
        <div className="text-5xl">🎯</div>
        <div className="display text-2xl font-extrabold mt-2">{ch.creator.name} challenged you</div>
        <div className="text-mist mt-1">{(ch.spec.game ?? 'quiz') === 'quiz'
          ? `${topicLabel(ch.spec.topic)} · ${ch.spec.rounds} questions · ${CHALLENGE_SECONDS}s each`
          : `${challengeLabel(ch.spec)} · ${Math.round((ch.spec.limitSec ?? 0) / 60)} min`}</div>
        <div className="mt-4 display text-4xl font-extrabold text-amber mono">{best.toLocaleString()}</div>
        <div className="text-xs uppercase tracking-wider text-mist font-bold">score to beat</div>
      </div>
      <p className="text-sm text-mist mt-4 text-center">{ch.results.length} {ch.results.length === 1 ? 'person has' : 'people have'} played. You only get one go — good luck!</p>
      <div className="mt-auto pt-6 pb-4"><button className="btn btn-primary w-full text-lg" onClick={onPlay}>▶ Play</button></div>
    </div>
  );
}

/* ---------------- play ---------------- */

function Play({ topic, rounds, seed, onDone, onQuit }: { topic: Topic; rounds: number; seed: number; onDone: (r: ChallengeResult) => void; onQuit: () => void }) {
  const [qs, setQs] = useState<MpQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now());
  const outcomes = useRef<number[]>([]);
  const times = useRef<number[]>([]);
  const t0 = useRef(Date.now());

  useEffect(() => { let live = true; buildMpQuestions(topic, seed, rounds).then((l) => { if (live) { setQs(l); started.current = t0.current = Date.now(); } }); return () => { live = false; }; }, [topic, seed, rounds]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(h); }, []);

  const total = qs?.length ?? rounds;
  const finish = useCallback(() => {
    const os = outcomes.current, ts = times.current;
    const result: ChallengeResult = {
      deviceId: useGame.getState().mp.deviceId,
      name: mpName(),
      score: os.reduce((a, o, k) => a + points(o, ts[k], CHALLENGE_SECONDS), 0),
      correct: os.filter((o) => o >= 0.6).length,
      total: os.length,
      timeMs: Date.now() - started.current,
      outcomes: os,
      at: Date.now(),
    };
    if (result.correct) useGame.getState().addXP(result.correct * 6);
    onDone(result);
  }, [onDone]);

  const record = useCallback((o: number) => {
    if (picked != null) return;
    outcomes.current[i] = o;
    times.current[i] = Math.min(CHALLENGE_SECONDS * 1000, Date.now() - t0.current);
    setPicked(o);
    if (o >= 0.6) { sfx.right(); buzz(12); } else { sfx.wrong(); buzz([30, 40, 30]); }
    setTimeout(() => {
      if (i + 1 >= total) { finish(); return; }
      setI(i + 1); setPicked(null); t0.current = Date.now();
    }, 1300);
  }, [picked, i, total, finish]);

  const left = Math.max(0, CHALLENGE_SECONDS * 1000 - (now - t0.current));
  useEffect(() => { if (qs && picked == null && left <= 0) record(0); }, [left, qs, picked, record]);

  if (!qs) return <div className="flex-1 grid place-items-center text-mist">Building your questions…</div>;
  if (!qs.length) return <div className="flex-1 grid place-items-center text-mist">This topic has no questions.</div>;
  const q = qs[i];
  return (
    <div className="min-h-dvh flex flex-col -mx-4">
      <div className="mx-auto w-full max-w-2xl px-4 pt-3 flex items-center gap-3">
        <button aria-label="Quit" onClick={() => void askConfirm('Quit this round? Your score won’t be saved.', { confirm: 'Quit' }).then((ok) => ok && onQuit())} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
        <div className="flex-1"><TimerBar left={picked == null ? left : 0} total={CHALLENGE_SECONDS * 1000} /></div>
        <span className="mono text-sm text-mist w-12 text-right">{i + 1}/{total}</span>
      </div>
      <div className="flex-1 flex flex-col">
        <MpQuestionView key={i} q={q} locked={picked != null} onAnswer={record} />
      </div>
      <AnimatePresence>
        {picked != null && (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed left-0 right-0 z-30 flex justify-center pointer-events-none px-4" style={{ bottom: 'calc(var(--sab) + 1rem)' }}>
            <div className={`chip !bg-deep !text-sm !py-2 !px-4 shadow-lg ${picked >= 0.6 ? '!border-mint text-mint' : '!border-rose text-rose'}`}>
              {picked >= 0.6 ? `✓ +${points(picked, times.current[i], CHALLENGE_SECONDS)}` : '✗'} · <AnswerLabel q={q} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- race play ---------------- */

/** Key stored in "My challenges" so the list can label it (quiz topic, or race:<game>). */
const labelKey = (spec: Pick<ChallengeSpec, 'game' | 'topic'>) => (spec.game && spec.game !== 'quiz' ? `race:${spec.game}` : spec.topic);

function RacePlay({ spec, onDone, onQuit }: { spec: PlaySpec; onDone: (r: ChallengeResult) => void; onQuit: () => void }) {
  const game = spec.game as RaceGame;
  const { ready, puzzle } = useRacePuzzle(spec, spec.seed);
  const limitMs = spec.limitSec * 1000;
  const started = useRef<number | null>(null);
  const latest = useRef<RaceReport>({ a: 0, b: game === 'hotcold' ? 20000 : 0, c: 0, done: false });
  const [now, setNow] = useState(Date.now());
  const [ended, setEnded] = useState(false);
  useEffect(() => { if (ready && puzzle && started.current == null) started.current = Date.now(); }, [ready, puzzle]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);
  const elapsed = started.current == null ? 0 : now - started.current;
  const left = Math.max(0, limitMs - elapsed);

  const finish = useCallback(() => {
    if (ended) return;
    setEnded(true);
    const r = latest.current;
    const timeMs = Math.min(limitMs, Date.now() - (started.current ?? Date.now()));
    const result: ChallengeResult = {
      deviceId: useGame.getState().mp.deviceId,
      name: mpName(),
      score: raceScore(game, r, r.done ? timeMs : null, limitMs),
      correct: r.done ? 1 : 0,
      total: 1,
      timeMs: r.done ? timeMs : limitMs,
      outcomes: [],
      report: r,
      at: Date.now(),
    };
    const xp = raceXp(r);
    if (xp) useGame.getState().addXP(xp);
    setTimeout(() => onDone(result), r.done ? 1600 : 400);
  }, [ended, game, limitMs, onDone]);

  const onReport = useCallback((r: RaceReport) => { latest.current = r; if (r.done) finish(); }, [finish]);
  useEffect(() => { if (started.current != null && left <= 0) finish(); }, [left, finish]);
  const quit = () => void askConfirm('Quit this challenge? Your score won’t be saved.', { confirm: 'Quit' }).then((ok) => ok && onQuit());

  if (!ready) return <div className="flex-1 grid place-items-center text-mist">Building the puzzle…</div>;
  if (!puzzle) return <div className="flex-1 grid place-items-center text-mist text-center">This puzzle couldn’t be built — try different topics.</div>;
  const header = (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1"><TimerBar left={left} total={limitMs} /></div>
      <span className={`mono text-sm font-bold w-12 text-right ${left < 30000 ? 'text-rose' : 'text-mist'}`}>{fmtClock(left)}</span>
    </div>
  );
  return (
    <div className="-mx-4">
      <RaceBoard puzzle={puzzle} title={`${GAME_META[game].emoji} ${GAME_META[game].title}`} onReport={onReport} onExit={quit} locked={left <= 0 || ended} header={header} />
    </div>
  );
}

/* ---------------- results ---------------- */

const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
const grid = (os: number[]) => os.map((o) => (o >= 0.95 ? '🟩' : o >= 0.5 ? '🟨' : '🟥')).join('');

function Results({ ch, fresh, you, onRefresh }: { ch: Challenge; fresh: boolean; you: string; onRefresh: () => void }) {
  const sorted = [...ch.results].sort((a, b) => b.score - a.score || a.timeMs - b.timeMs);
  const mine = sorted.findIndex((r) => r.deviceId === you);
  const me = sorted[mine];
  useEffect(() => { if (fresh && mine === 0) { sfx.win(); confetti({ particleCount: 140, spread: 90, origin: { y: 0.35 } }); } }, [fresh, mine]);
  const share = async () => {
    const text = `🎯 GeoIQ challenge: ${challengeLabel(ch.spec)}${me ? ` — I scored ${me.score.toLocaleString()}` : ''}. Beat me! Code ${ch.code} (GeoIQ → Multiplayer → Challenges)`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast({ icon: '📋', title: 'Challenge copied', body: 'Paste it to your friends.' }); }
    } catch { /* cancelled */ }
  };
  return (
    <div className="flex-1 flex flex-col">
      <div className="card p-5 text-center">
        <div className="text-xs uppercase tracking-[.2em] text-mist font-bold">Challenge code</div>
        <div className="display text-4xl font-extrabold tracking-[.12em] text-amber mt-1 select-all">{ch.code}</div>
        <div className="text-mist text-sm mt-1">{challengeLabel(ch.spec)}{(ch.spec.game ?? 'quiz') === 'quiz' ? ` · ${ch.spec.rounds} questions` : ''} · by {ch.creator.name}</div>
        <div className="flex gap-2 justify-center mt-3">
          <button className="btn btn-primary !py-2.5" onClick={share}>📤 Share</button>
          <button className="btn btn-ghost !py-2.5" onClick={onRefresh}>↻ Refresh</button>
        </div>
      </div>
      {me && <div className="text-center display text-xl font-extrabold mt-4">{mine === 0 ? (sorted.length > 1 ? 'You’re in the lead! 🏆' : 'You set the score to beat 🎯') : `You’re ${mine + 1}${['th', 'st', 'nd', 'rd'][mine + 1] ?? 'th'} of ${sorted.length}`}</div>}
      <div className="mt-4 space-y-1.5">
        {sorted.map((r, k) => (
          <motion.div key={r.deviceId} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.04 }}
            className={`rounded-2xl px-3 py-2.5 border ${r.deviceId === you ? 'border-amber/70 bg-amber/10' : 'border-line/60 bg-white/5'}`}>
            <div className="flex items-center gap-3">
              <span className="mono w-6 text-center font-bold text-mist">{k + 1}</span>
              <Avatar p={{ id: r.deviceId, name: r.name }} size={32} />
              <div className="min-w-0 flex-1">
                <div className="font-bold leading-tight break-words">{r.name}{r.deviceId === you ? ' (you)' : ''}</div>
                <div className="text-xs text-mist">{r.report && ch.spec.game && ch.spec.game !== 'quiz'
                  ? progressText(ch.spec.game as RaceGame, { ...r.report, finishMs: r.report.done ? r.timeMs : null, score: r.score })
                  : `${r.correct}/${r.total} right · ${fmtTime(r.timeMs)}`}</div>
              </div>
              <span className="mono display font-extrabold text-lg">{r.score.toLocaleString()}</span>
            </div>
            {r.outcomes.length > 0 && <div className="mt-1.5 text-sm tracking-[.1em] pl-9">{grid(r.outcomes)}</div>}
          </motion.div>
        ))}
      </div>
      {sorted.length === 1 && <p className="text-sm text-mist text-center mt-3">Nobody else has played yet — share the code, then refresh to see their score.</p>}
      <div className="mt-auto pt-6 pb-4"><button className="btn btn-ghost w-full" onClick={() => go('/mp')}>Back to Multiplayer</button></div>
    </div>
  );
}
