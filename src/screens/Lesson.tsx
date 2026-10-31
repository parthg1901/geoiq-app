import { useEffect, useMemo, useState } from 'react';
import { CountryProfile } from '../components/CountryProfile';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame } from '../lib/store';
import { UNIT_BY_ID, UNITS, REGION_META, regionFrame, type Unit } from '../lib/path';
import { makeQuestion, eligible, type Question, type Variant } from '../lib/questions';
import { shuffle } from '../lib/rng';
import { go } from '../lib/router';
import { sfx } from '../lib/sound';
import { BY_ID, ALL_NAMES, ARMS, ARMS_WORD, fmtPop, fmtArea, loadPhotos, type Photo } from '../data';
import { ArmsImage } from '../components/Answer';
import { QuizRunner, type QuizResult } from '../components/QuizRunner';
import { Flag, Shape } from '../components/Shape';
import { Globe, zoomFor } from '../components/Globe';
import { TopBar } from '../components/ui';

// Practice covers everything the cards teach: shape, flag both ways, location, capital both ways, arms.
const VARIANTS: Variant[] = ['shape', 'flag', 'map-find', 'capital', 'arms', 'flag-rev', 'capital-rev'];

export default function Lesson({ id }: { id?: string }) {
  const unit = id ? UNIT_BY_ID[id] : undefined;
  if (!unit) { go('/learn'); return null; }
  // key by unit so "Next unit" starts fresh
  return <LessonFlow key={unit.id} unit={unit} />;
}

function LessonFlow({ unit }: { unit: Unit }) {
  const [phase, setPhase] = useState<'meet' | 'quiz' | 'done'>('meet');
  const [result, setResult] = useState<{ stars: number; acc: number; prev: number; coins: number } | null>(null);
  const meta = REGION_META[unit.region];

  const questions = useMemo(() => {
    // Every country appears twice, each time in a different skill.
    const qs: Question[] = [];
    const order = [...shuffle(unit.ids), ...shuffle(unit.ids)];
    for (let i = 0; i < order.length && qs.length < 12; i++) {
      const c = BY_ID[order[i]];
      const vs = VARIANTS.slice(i % VARIANTS.length).concat(VARIANTS).filter((v) => eligible(c, v));
      const v = vs.find((x) => !qs.some((q) => q.id === c.id && q.variant === x)) ?? 'flag';
      qs.push(makeQuestion(c.id, v, { choices: 4 }));
    }
    return shuffle(qs);
  }, [unit]);

  const onDone = (results: QuizResult[]) => {
    // Quitting early doesn't count as completing the unit.
    if (results.length < questions.length * 0.8) { go('/learn'); return; }
    const acc = results.filter((r) => r.outcome >= 0.6).length / results.length;
    const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
    const s = useGame.getState();
    const prev = s.lessons[unit.id] ?? 0;
    const coins = 5 + Math.max(0, stars - prev) * 10;
    s.set({ lessons: { ...s.lessons, [unit.id]: Math.max(prev, stars) }, coins: s.coins + coins });
    s.addXP(10 * stars);
    setResult({ stars, acc, prev, coins });
    setPhase('done');
  };

  if (phase === 'quiz') {
    return <QuizRunner title={`${unit.region} · ${unit.title}`} questions={questions} practice hideSummary modeKey="lesson" regionFocus={regionFrame(unit.region)} onDone={onDone} />;
  }
  if (phase === 'done' && result) return <Complete unit={unit} {...result} />;

  return <Meet unit={unit} color={meta.color} onStart={() => setPhase('quiz')} />;
}

/* -------- Phase 1: meet the countries -------- */
function Meet({ unit, color, onStart }: { unit: Unit; color: string; onStart: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [about, setAbout] = useState<string | null>(null);
  const n = unit.ids.length;
  const c = BY_ID[unit.ids[i]];
  const move = (d: number) => {
    const ni = i + d;
    if (ni < 0) return;
    if (ni >= n) { onStart(); return; }
    setDir(d); setI(ni); sfx.tap();
  };

  return (
    <div className="relative z-10 min-h-dvh mx-auto max-w-2xl px-4 flex flex-col">
      <TopBar onClose={() => go('/learn')} title={<span><span style={{ color }}>{unit.region}</span> · {unit.title}</span>} />
      <div className="flex gap-1.5">
        {unit.ids.map((id, k) => (
          <button key={id} onClick={() => { setDir(k > i ? 1 : -1); setI(k); }} className="flex-1 h-2 rounded-full transition-colors"
            style={{ background: k <= i ? color : 'rgba(255,255,255,.1)', boxShadow: k === i ? `0 0 10px ${color}` : undefined }} aria-label={`Country ${k + 1}`} />
        ))}
      </div>
      <div className="text-center text-xs uppercase tracking-[.2em] text-mist font-bold mt-3">Meet the countries · {i + 1}/{n}</div>

      <div className="flex-1 relative mt-3">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div
            key={c.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 80, rotate: dir * 3 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            exit={{ opacity: 0, x: -dir * 80, rotate: -dir * 3 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.6}
            onDragEnd={(_, info) => { if (info.offset.x < -70) move(1); else if (info.offset.x > 70) move(-1); }}
            className="card p-5 touch-pan-y cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-start gap-3">
              <Flag id={c.id} className="w-14 h-10 !rounded-md shrink-0" />
              <div className="min-w-0">
                <div className="display text-3xl font-extrabold leading-tight">{c.name}</div>
                <div className="text-sm text-mist">{c.subregion}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 items-center">
              <div className="relative grid place-items-center">
                <div className="absolute inset-0 rounded-full opacity-25" style={{ background: `radial-gradient(circle, ${color} 0%, transparent 68%)` }} />
                <Shape id={c.id} size="min(38vw, 190px)" color={color} />
              </div>
              <div className="grid place-items-center">
                <Globe size={Math.min(170, Math.round(window.innerWidth * 0.38))} zoom={zoomFor(c.id)} focus={c.id} spin={false} fills={{ [c.id]: color }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <Fact k="Capital" v={`★ ${c.capital || '—'}`} accent={color} />
              <Fact k="Population" v={fmtPop(c.population)} />
              <Fact k="Area" v={fmtArea(c.area)} />
              <Fact k="Coast" v={c.landlocked ? 'Landlocked' : 'Has a coastline'} />
              <Fact k={c.languages.length > 1 ? 'Languages' : 'Language'} v={c.languages.slice(0, 3).join(', ') || '—'} />
              <Fact k="Currency" v={c.currencies.join(', ') || '—'} />
            </div>

            {ARMS[c.id] && (
              <div className="flex items-center gap-3 mt-3 rounded-2xl bg-white/5 border border-line/60 p-2.5">
                <ArmsImage id={c.id} className="w-14 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase text-mist font-bold">{ARMS_WORD[ARMS[c.id].kind]}</div>
                  <div className="text-sm text-paper/85 leading-snug">Learn it alongside the flag — it appears in Coat of Arms rounds.</div>
                </div>
              </div>
            )}

            <div className="mt-3">
              <div className="text-[11px] uppercase text-mist font-bold mb-1.5">
                {c.borders.length ? `Borders ${c.borders.length} ${c.borders.length === 1 ? 'country' : 'countries'}` : 'No land borders'}
              </div>
              {c.borders.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {c.borders.map((b) => BY_ID[b] ? (
                    <button key={b} onClick={() => setAbout(b)} className="chip !text-sm !py-1 !px-2.5 hover:!border-sky">
                      <Flag id={b} className="w-5 h-3.5 !rounded-sm !shadow-none" />{BY_ID[b].name}
                    </button>
                  ) : <span key={b} className="chip !text-sm !py-1 !px-2.5">{ALL_NAMES[b] ?? b}</span>)}
                </div>
              )}
            </div>

            <p className="text-[15px] leading-relaxed text-paper/85 mt-4">{c.fact}</p>
            <MeetPhoto id={c.id} />
            <button className="text-sky font-semibold mt-3" onClick={() => setAbout(c.id)}>📖 Read the full profile →</button>
          </motion.div>
        </AnimatePresence>
      </div>

      {about && <CountryProfile id={about} onClose={() => setAbout(null)} />}
      <div className="grid grid-cols-[auto_1fr] gap-3 py-5">
        <button className="btn btn-ghost w-14" disabled={i === 0} onClick={() => move(-1)} aria-label="Previous">←</button>
        <button className="btn btn-primary text-lg" onClick={() => move(1)}>{i + 1 < n ? 'Next country →' : 'Start practice 🎯'}</button>
      </div>
    </div>
  );
}

/** Commons captions often trail into camera notes — keep just the description. */
const firstSentence = (t: string) => (t.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t).trim();

/** One real photo from the country — the kind of scene Street Eye asks about. */
function MeetPhoto({ id }: { id: string }) {
  const [p, setP] = useState<Photo | null>(null);
  useEffect(() => { let live = true; setP(null); loadPhotos(id).then((l) => live && setP(l[0] ?? null)); return () => { live = false; }; }, [id]);
  if (!p) return null;
  return (
    <figure className="mt-4">
      <img src={p.u} alt={p.c} loading="lazy" referrerPolicy="no-referrer" className="w-full h-44 object-cover rounded-2xl bg-ink" />
      <figcaption className="text-sm text-mist mt-1.5 leading-snug">📸 {firstSentence(p.c) || 'A scene from here'}</figcaption>
    </figure>
  );
}

function Fact({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-line/60 px-2.5 py-2 min-w-0">
      <div className="text-[11px] uppercase tracking-normal text-mist font-bold break-words">{k}</div>
      <div className="display font-bold leading-tight break-words text-[15px]" style={{ color: accent }}>{v}</div>
    </div>
  );
}

/* -------- Phase 3: completion -------- */
function Complete({ unit, stars, acc, prev, coins }: { unit: Unit; stars: number; acc: number; prev: number; coins: number }) {
  const meta = REGION_META[unit.region];
  const next = UNITS.find((u) => u.region === unit.region && u.index === unit.index + 1);
  useEffect(() => {
    const h = setTimeout(() => {
      sfx.win();
      confetti({ particleCount: 140, spread: 100, origin: { y: 0.35 }, colors: [meta.color, '#ffb547', '#ffffff'] });
    }, 350 + stars * 250);
    return () => clearTimeout(h);
  }, [stars, meta.color]);

  return (
    <div className="relative z-10 min-h-dvh mx-auto max-w-md px-6 py-10 flex flex-col items-center text-center">
      <div className="text-xs uppercase tracking-[.22em] text-mist font-bold mt-6">{unit.region} · Unit {unit.index + 1}</div>
      <div className="display text-4xl font-extrabold mt-1">{unit.title} complete!</div>

      <div className="flex gap-3 mt-10">
        {[1, 2, 3].map((s) => (
          <motion.div key={s} initial={{ scale: 0, rotate: -180, opacity: 0 }}
            animate={{ scale: s <= stars ? 1 : 0.8, rotate: 0, opacity: s <= stars ? 1 : 0.25 }}
            transition={{ delay: 0.3 + s * 0.25, type: 'spring', stiffness: 260, damping: 14 }}
            onAnimationStart={() => s <= stars && setTimeout(() => sfx.right(s * 2), 300 + s * 250)}
            className={`text-6xl ${s === 2 ? '-translate-y-4' : ''} ${s <= stars ? 'drop-shadow-[0_0_20px_rgba(255,181,71,.7)]' : 'grayscale'}`}>⭐</motion.div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 w-full mt-10">
        <div className="card p-3"><div className="display text-3xl font-extrabold">{Math.round(acc * 100)}%</div><div className="text-xs uppercase tracking-wider text-mist font-bold">accuracy</div></div>
        <div className="card p-3"><div className="display text-3xl font-extrabold text-amber">+{coins}🪙</div><div className="text-xs uppercase tracking-wider text-mist font-bold">{stars > prev && prev > 0 ? 'improved!' : 'reward'}</div></div>
      </div>

      <div className="flex gap-1.5 mt-6 flex-wrap justify-center">
        {unit.ids.map((id) => <span key={id} className="chip"><Flag id={id} className="w-5 h-3.5 !rounded-sm !shadow-none" />{BY_ID[id].name}</span>)}
      </div>
      {stars < 3 && <div className="text-sm text-mist mt-4">Score 90%+ for three stars — replay anytime.</div>}

      <div className="mt-auto pt-10 w-full space-y-3">
        {next && <button className="btn btn-primary w-full text-lg" onClick={() => go('/lesson/' + next.id)}>Next: {next.title} →</button>}
        <button className="btn btn-ghost w-full" onClick={() => go('/learn')}>Back to path</button>
      </div>
    </div>
  );
}
