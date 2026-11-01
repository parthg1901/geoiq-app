import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame } from '../lib/store';
import { todayKey, addDays } from '../lib/rng';
import { dailyQuestions, dailyNumber, gridFor, DAILY_VARIANTS } from '../lib/daily';
import { checkAchievements } from '../lib/achievements';
import { QuizRunner, type QuizResult } from '../components/QuizRunner';
import { toast } from '../components/Toasts';
import { Page, TopBar, CountUp } from '../components/ui';
import { Flag } from '../components/Shape';
import { BY_ID } from '../data';
import { go } from '../lib/router';
import { sfx } from '../lib/sound';

const LABEL: Record<string, string> = { shape: 'Shape', flag: 'Flag', photo: 'Street Eye', capital: 'Capital', 'map-find': 'Map' };

function useCountdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const next = new Date(); next.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((next.getTime() - now) / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Daily() {
  const day = todayKey();
  const saved = useGame((s) => s.daily[day]);
  const [phase, setPhase] = useState<'intro' | 'play' | 'result'>(saved ? 'result' : 'intro');
  const [results, setResults] = useState<QuizResult[] | null>(null);
  const questions = useMemo(() => dailyQuestions(day), [day]);
  const t0 = useRef(0);

  const onDone = (res: QuizResult[]) => {
    const time = Math.round((performance.now() - t0.current) / 1000);
    const outcomes = questions.map((q) => res.find((r) => r.q === q)?.outcome ?? 0);
    // Matches the emoji grid: 🟩 and 🟨 (e.g. found on the second map try) both count as solved.
    const score = outcomes.filter((o) => o >= 0.5).length;
    const grid = gridFor(outcomes);
    const s = useGame.getState();
    s.set({ daily: { ...s.daily, [day]: { score, grid, time } } });
    s.addXP(5 * score, 10);
    for (const a of checkAchievements({ total: 5, score })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
    if (score >= 4) { sfx.win(); confetti({ particleCount: 140, spread: 90, origin: { y: 0.35 } }); }
    setResults(res);
    setPhase('result');
  };

  if (phase === 'play') {
    return <QuizRunner title={`Daily #${dailyNumber(day)}`} questions={questions} hideSummary onDone={onDone} />;
  }
  if (phase === 'result') return <Result results={results} />;
  return <Intro onStart={() => { t0.current = performance.now(); setPhase('play'); }} />;
}

function Intro({ onStart }: { onStart: () => void }) {
  const cd = useCountdown();
  return (
    <Page>
      <TopBar title="Daily Challenge" onClose={() => go('/')} />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-6 mt-2 text-center relative overflow-hidden">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(83,184,255,.3) 0%, transparent 68%)' }} />
        <div className="relative text-6xl">☀️</div>
        <div className="relative display text-4xl font-extrabold mt-2">Daily #{dailyNumber()}</div>
        <p className="relative text-mist mt-2">Five questions of rising difficulty. Everyone on Earth gets the same five today. One shot — no retries.</p>
        <div className="relative flex justify-center gap-2 mt-5">
          {DAILY_VARIANTS.map((v, i) => (
            <motion.div key={v} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 + i * 0.08, type: 'spring' }}
              className="w-14 rounded-xl bg-white/5 border border-line py-2">
              <div className="mono text-xs text-mist">{i + 1}</div>
              <div className="text-xs font-bold uppercase tracking-wide mt-0.5">{LABEL[v]}</div>
            </motion.div>
          ))}
        </div>
        <button className="relative btn btn-primary w-full mt-6 text-lg" onClick={onStart}>Start Daily →</button>
        <div className="relative text-sm text-mist mt-3">Next daily in <span className="mono text-paper">{cd}</span></div>
      </motion.div>
      <History />
    </Page>
  );
}

function Result({ results }: { results: QuizResult[] | null }) {
  const day = todayKey();
  const r = useGame((s) => s.daily[day]);
  const cd = useCountdown();
  const [copied, setCopied] = useState(false);
  if (!r) return null;
  const text = `Geonaut Daily #${dailyNumber(day)} ${r.grid} ${r.score}/5 ⏱ ${r.time}s`;
  const share = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) await navigator.share({ text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* cancelled */ }
  };
  const verdict = ['Rough day. Tomorrow’s yours.', 'A start!', 'Not bad.', 'Solid!', 'Excellent!', 'Perfect! 🌍'][r.score];
  return (
    <Page>
      <TopBar title="Daily Challenge" onClose={() => go('/')} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card p-6 mt-2 text-center">
        <div className="text-xs uppercase tracking-[.2em] text-mist font-bold">Daily #{dailyNumber(day)}</div>
        <div className="display text-6xl font-extrabold mt-2"><CountUp to={r.score} />/5</div>
        <div className="display font-bold text-lg text-amber mt-1">{verdict}</div>
        <div className="flex justify-center gap-1.5 text-4xl mt-4">
          {[...r.grid].map((g, i) => (
            <motion.span key={i} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 0.3 + i * 0.15 }}>{g}</motion.span>
          ))}
        </div>
        <div className="mono text-mist mt-3">⏱ {r.time}s</div>
        <button className="btn btn-primary w-full mt-5" onClick={share}>{copied ? 'Copied! ✓' : 'Share result'}</button>
        <div className="text-sm text-mist mt-3">Next daily in <span className="mono text-paper">{cd}</span></div>
      </motion.div>

      {results && (
        <div className="mt-5 space-y-2">
          <div className="display font-bold">Today’s answers</div>
          {results.map((x, i) => (
            <div key={i} className="card !rounded-2xl p-3 flex items-center gap-3">
              <span className="text-xl">{gridFor([x.outcome])}</span>
              <Flag id={x.q.id} className="w-9 h-6 !rounded-sm" />
              <div className="flex-1 min-w-0">
                <div className="font-bold leading-tight break-words">{BY_ID[x.q.id].name}</div>
                <div className="text-sm text-mist">{LABEL[x.q.variant] ?? x.q.variant}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <History />
      <button className="btn btn-ghost w-full mt-6" onClick={() => go('/')}>Back home</button>
    </Page>
  );
}

function History() {
  const daily = useGame((s) => s.daily);
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="card p-4 mt-5">
      <div className="display font-bold mb-3">Last 7 days</div>
      <div className="space-y-1.5">
        {days.map((d) => {
          const r = daily[d];
          return (
            <div key={d} className="flex items-center gap-3 text-sm">
              <span className="mono text-mist w-24">#{dailyNumber(d)} · {new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="tracking-wider flex-1">{r ? r.grid : <span className="text-mist/90">⬛⬛⬛⬛⬛</span>}</span>
              <span className="mono w-8 text-right">{r ? `${r.score}/5` : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
