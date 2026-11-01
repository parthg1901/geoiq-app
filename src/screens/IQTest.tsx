import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame, type TestResult } from '../lib/store';
import { difficulty, pCorrect, ladderSurprise, toIQ, fromIQ, tierFor, percentile, SKILL_LABEL, SKILL_ICON, type Skill } from '../lib/iq';
import { makeQuestion, eligible, type Question, type Variant } from '../lib/questions';
import { shuffle, todayKey } from '../lib/rng';
import { go } from '../lib/router';
import { COUNTRIES } from '../data';
import { QuizRunner, type QuizResult } from '../components/QuizRunner';
import { CountUp, Progress } from '../components/ui';
import { sfx } from '../lib/sound';

const TEST_SKILLS: Skill[] = ['shape', 'flag', 'map', 'capital', 'hint'];
const PER_SKILL = 4;
const TOTAL = TEST_SKILLS.length * PER_SKILL;

function variantFor(skill: Skill): Variant {
  switch (skill) {
    case 'shape': return 'shape';
    case 'flag': return Math.random() < 0.7 ? 'flag' : 'flag-rev';
    case 'map': return 'map-find';
    case 'capital': return Math.random() < 0.6 ? 'capital' : 'capital-rev';
    case 'hint': return 'hint';
  }
}

/** Skill order: 4 rounds, each a shuffled pass over all six skills. */
const makeOrder = () => Array.from({ length: PER_SKILL }, () => shuffle(TEST_SKILLS)).flat();

/** Pick the unused item whose difficulty is closest to the current estimate (with a little randomness). */
function nextQuestion(skill: Skill, theta: number, used: Set<string>): Question {
  const v = variantFor(skill);
  const pool = COUNTRIES.filter((c) => !used.has(c.id) && eligible(c, v))
    .map((c) => ({ id: c.id, gap: Math.abs(difficulty(c, skill) - theta) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 5);
  const id = pool[Math.floor(Math.random() * pool.length)].id;
  return makeQuestion(id, v, { choices: 6 });
}

interface Step { q: Question; skill: Skill; d: number; outcome: number; thetaAfter: number; ladder?: { solvedAt: number; shown: number } }

export default function IQTest() {
  const [phase, setPhase] = useState<'intro' | 'run' | 'result'>('intro');
  const startTheta = useRef(useGame.getState().ratings.all.theta);
  const [theta, setTheta] = useState(startTheta.current);
  const order = useMemo(makeOrder, []);
  const used = useRef(new Set<string>());
  const [steps, setSteps] = useState<Step[]>([]);
  const [current, setCurrent] = useState<Question | null>(null);

  const begin = () => {
    startTheta.current = useGame.getState().ratings.all.theta;
    setTheta(startTheta.current);
    const q = nextQuestion(order[0], startTheta.current, used.current);
    used.current.add(q.id);
    setCurrent(q);
    setPhase('run');
  };

  const onDone = (res: QuizResult[]) => {
    const r = res[0];
    if (!r || !current) { go('/iq'); return; } // quit before answering
    const i = steps.length;
    const skill = order[i];
    const d = difficulty(COUNTRIES.find((c) => c.id === current.id)!, skill);
    const step = 220 / (1 + i * 0.35);
    // Clue questions are scored per clue (unbiased); everything else is a single right/wrong trial.
    const surprise = r.ladder ? ladderSurprise(theta, d, r.ladder.solvedAt, r.ladder.shown) : r.outcome - pCorrect(theta, d, current.format);
    const t = theta + step * surprise;
    const ns = [...steps, { q: current, skill, d, outcome: r.outcome, thetaAfter: t, ladder: r.ladder }];
    setSteps(ns);
    setTheta(t);
    if (ns.length >= TOTAL) { setCurrent(null); setPhase('result'); return; }
    const q = nextQuestion(order[ns.length], t, used.current);
    used.current.add(q.id);
    setCurrent(q);
  };

  if (phase === 'intro') return <Intro onStart={begin} />;
  if (phase === 'result') return <Result steps={steps} theta={theta} />;
  return (
    <QuizRunner
      key={steps.length}
      title="IQ Test"
      questions={[current!]}
      progress={{ index: steps.length, total: TOTAL }}
      nextLabel={steps.length + 1 >= TOTAL ? 'See my IQ' : 'Next question'}
      onQuit={() => go('/iq')}
      hideSummary
      modeKey="test"
      onDone={onDone}
    />
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  const tests = useGame((s) => s.tests);
  return (
    <div className="relative z-10 mx-auto max-w-md px-5 py-6 min-h-dvh flex flex-col">
      <button aria-label="Back" onClick={() => go('/iq')} className="w-10 h-10 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
      <motion.div initial={{ scale: 0.6, opacity: 0, rotate: -10 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring' }} className="text-7xl text-center mt-6">🧠</motion.div>
      <h1 className="display text-4xl font-extrabold text-center mt-3">The IQ Test</h1>
      <p className="text-mist text-center mt-2">An adaptive exam: every answer changes the next question, homing in on your true level.</p>
      <div className="grid grid-cols-3 gap-2 mt-6">
        {[['24', 'questions'], ['~6', 'minutes'], ['6', 'skills']].map(([v, k]) => (
          <div key={k} className="card p-3 text-center"><div className="display text-2xl font-extrabold text-amber">{v}</div><div className="text-xs uppercase tracking-wider text-mist font-semibold">{k}</div></div>
        ))}
      </div>
      <div className="card p-4 mt-4 grid grid-cols-2 gap-2">
        {TEST_SKILLS.map((s) => (
          <div key={s} className="flex items-center gap-2 text-sm"><span className="w-7 h-7 rounded-lg bg-amber/15 text-amber grid place-items-center font-bold">{SKILL_ICON[s]}</span>{SKILL_LABEL[s]} ×{PER_SKILL}</div>
        ))}
      </div>
      <ul className="text-sm text-mist mt-4 space-y-1.5">
        <li>• Six choices per question, so lucky guesses barely count.</li>
        <li>• Get one right and the next gets harder. Miss one and it eases off.</li>
        <li>• No time limit, but go with your first instinct.</li>
      </ul>
      {tests.length > 0 && <div className="text-center text-sm text-mist mt-4">Previous best: <b className="mono text-paper">{Math.max(...tests.map((t) => t.iq))}</b> · {tests.length} test{tests.length > 1 ? 's' : ''} taken</div>}
      <button className="btn btn-primary w-full mt-auto text-lg" onClick={onStart}>Begin test</button>
    </div>
  );
}

function Result({ steps, theta }: { steps: Step[]; theta: number }) {
  const iq = toIQ(theta);
  const tier = tierFor(iq);
  const pct = percentile(iq);
  const correct = steps.filter((s) => s.outcome >= 0.6).length;
  const [prev] = useState(() => useGame.getState().tests.slice(-1)[0] as TestResult | undefined);
  const [copied, setCopied] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Per-skill estimate: replay each skill's answers from the test's starting point with its own step size.
  const skills = useMemo(() => {
    const out: Partial<Record<Skill, number>> = {};
    for (const sk of TEST_SKILLS) {
      const mine = steps.filter((s) => s.skill === sk);
      // Anchor on the overall estimate, then adjust by this skill's surprise vs expectation.
      let adj = 0;
      mine.forEach((s, j) => { adj += (160 / (1 + j * 0.5)) * (s.ladder ? ladderSurprise(theta, s.d, s.ladder.solvedAt, s.ladder.shown) : s.outcome - pCorrect(theta, s.d, s.q.format)); });
      out[sk] = toIQ(theta + adj * 0.6);
    }
    return out;
  }, [steps, theta]);

  const saved = useRef(false);
  useEffect(() => {
    if (saved.current) return;
    saved.current = true;
    const g = useGame.getState();
    const result: TestResult = { date: todayKey(), iq, skills, correct, total: steps.length };
    const all = g.ratings.all;
    // The test's answers already updated your ratings one by one. Pull the overall rating toward the
    // test result in proportion to how little else we know: strong for newcomers, gentle for veterans.
    const w = Math.min(0.5, 30 / (30 + all.n));
    g.set({
      tests: [...g.tests, result],
      ratings: { ...g.ratings, all: { theta: (1 - w) * all.theta + w * fromIQ(iq), n: all.n } },
    });
    import('../lib/achievements').then((m) => m.checkAchievements());
    setTimeout(() => {
      sfx.win();
      confetti({ particleCount: 180, spread: 110, origin: { y: 0.35 }, colors: [tier.color, '#ffffff', '#ffb547'] });
    }, 1500);
  }, [iq, skills, correct, steps.length, tier.color]);

  const share = async () => {
    const text = `My geography IQ is ${iq} ${tier.emoji} ${tier.name} — sharper than ${pct}% of explorers. ${correct}/${steps.length} on the adaptive Geonaut IQ Test. Can you beat it? 🌍`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); }
    } catch {
      try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* ignore */ }
    }
  };

  const delta = prev ? iq - prev.iq : 0;

  return (
    <div className="relative z-10 mx-auto max-w-md px-5 py-8 min-h-dvh flex flex-col">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
        <div className="text-xs uppercase tracking-[.25em] text-mist font-bold">Your IQ</div>
        <div className="relative inline-block">
          <div className="absolute inset-0 rounded-full opacity-40" style={{ background: `radial-gradient(circle, ${tier.color} 0%, transparent 68%)` }} />
          <div className="relative display font-extrabold leading-none tracking-tight mt-2" style={{ fontSize: 'clamp(6rem, 34vw, 9rem)', color: tier.color, textShadow: `0 0 60px ${tier.color}88` }}>
            <CountUp from={60} to={iq} duration={1.6} />
          </div>
        </div>
        <div />
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 1.6, type: 'spring', stiffness: 200 }}
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full border-2 display text-xl font-extrabold" style={{ borderColor: tier.color, color: tier.color, background: tier.color + '18' }}>
          {tier.emoji} {tier.name}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9 }}>
          <div className="text-mist mt-3">Sharper than <b className="text-paper">{pct}%</b> of explorers</div>
          <div className="text-sm text-mist mt-1">Margin ±5 — a 24-question test lands within about 5 points of your true level two times in three.</div>
          <div className="text-sm text-mist mt-1">{tier.blurb}</div>
          {prev && (
            <div className={`chip mt-3 mono ${delta > 0 ? '!text-mint !border-mint/50' : delta < 0 ? '!text-rose !border-rose/50' : ''}`}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta)} vs last test ({prev.iq})
            </div>
          )}
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.1 }} className="card p-4 mt-6">
        <div className="flex justify-between items-baseline mb-3">
          <span className="display font-bold">Skill breakdown</span>
          <span className="mono text-sm text-mist">{correct}/{steps.length} correct</span>
        </div>
        <div className="space-y-2.5">
          {TEST_SKILLS.map((sk) => {
            const v = skills[sk] ?? 100;
            const t = tierFor(v);
            const right = steps.filter((s) => s.skill === sk && s.outcome >= 0.6).length;
            return (
              <div key={sk} className="flex items-center gap-3">
                <span className="w-24 text-sm font-semibold flex items-center gap-1.5"><span className="text-amber w-4 text-center">{SKILL_ICON[sk]}</span>{SKILL_LABEL[sk]}</span>
                <div className="flex-1"><Progress value={(v - 60) / 100} color={t.color} h={8} /></div>
                <span className="mono text-sm w-8 text-right" style={{ color: t.color }}>{v}</span>
                <span className="text-xs text-mist w-7 text-right">{right}/{PER_SKILL}</span>
              </div>
            );
          })}
        </div>
        <button className="text-sm text-sky mt-3" onClick={() => setShowDetail(!showDetail)}>{showDetail ? 'Hide' : 'Show'} the difficulty path</button>
        {showDetail && <DifficultyPath steps={steps} />}
      </motion.div>

      <div className="mt-auto pt-6 grid grid-cols-2 gap-3">
        <button className="btn btn-ghost" onClick={share}>{copied ? 'Copied ✓' : '📤 Share'}</button>
        <button className="btn btn-primary" onClick={() => go('/iq')}>See dashboard</button>
      </div>
    </div>
  );
}

/** Tiny sparkline: how the adaptive estimate moved, with right/wrong dots. */
function DifficultyPath({ steps }: { steps: Step[] }) {
  const W = 320, H = 90;
  const vals = steps.map((s) => toIQ(s.thetaAfter));
  const lo = Math.min(...vals) - 5, hi = Math.max(...vals) + 5;
  const x = (i: number) => 8 + (i / Math.max(1, steps.length - 1)) * (W - 16);
  const y = (v: number) => 8 + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" role="img" aria-label="Estimate during the test">
      <polyline points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="rgba(142,163,204,.6)" strokeWidth={1.5} />
      {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3.2} fill={steps[i].outcome >= 0.6 ? '#3ddc97' : '#ff5d73'} />)}
    </svg>
  );
}
