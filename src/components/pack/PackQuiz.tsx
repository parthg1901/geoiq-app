import { regionFrame } from '../../lib/path';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import type { PackData, PackMode } from '../../lib/packs';
import { useGame } from '../../lib/store';
import { sfx, buzz } from '../../lib/sound';
import { onBack } from '../../lib/native';
import { checkAchievements } from '../../lib/achievements';
import { toast } from '../Toasts';
import { CountUp, Progress } from '../ui';
import { PackMap, itemCentroids, isCountriesPack, regionsOf } from './PackMap';
import { BY_ID } from '../../data';
import { ItemFacts, ItemSheet, SampleText } from './ItemSheet';
import { PackTypeAnswer } from './PackAnswer';
import { buildSession, modeMeta, sampleWord, type PackQuestion } from './questions';

interface Result { q: PackQuestion; outcome: number }

/** Quiz runner for content packs — same look and feel as the country QuizRunner. */
export function PackQuiz({ pack, mode, typed = false, onExit }: { pack: PackData; mode: PackMode; typed?: boolean; onExit: () => void }) {
  const [round, setRound] = useState(0);
  const qs = useMemo(() => buildSession(pack, mode, useGame.getState().packs[pack.meta.id], 10, typed), [pack, mode, typed, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'ask' | 'reveal' | 'done'>('ask');
  const [results, setResults] = useState<Result[]>([]);
  const [last, setLast] = useState<{ outcome: number; xp: number } | null>(null);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  // Replay the shake animation by toggling the class — remounting would reset the question's state
  // (e.g. the find map's wrong taps and the revealed answer).
  const shakeRef = useRef<HTMLDivElement>(null);
  const shake = () => { const el = shakeRef.current; if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
  const xpTotal = useRef(0);
  const t0 = useRef(performance.now());
  const byId = useMemo(() => Object.fromEntries(pack.items.map((i) => [i.id, i])), [pack]);
  const q = qs[idx];

  useEffect(() => { t0.current = performance.now(); }, [idx]);
  useEffect(() => onBack(onExit), [onExit]);
  // Enter = Continue on the reveal sheet (no autofocus: it would scroll the sheet's header out of view)
  const nextRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (phase !== 'reveal') return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); nextRef.current(); } };
    const t = setTimeout(() => window.addEventListener('keydown', h), 150);
    return () => { clearTimeout(t); window.removeEventListener('keydown', h); };
  }, [phase]);

  const restart = () => { setRound((r) => r + 1); setIdx(0); setPhase('ask'); setResults([]); setLast(null); setCombo(0); setBestCombo(0); xpTotal.current = 0; };

  const record = (outcome: number) => {
    const ms = performance.now() - t0.current;
    const res = useGame.getState().packAnswer({ pack: pack.meta.id, item: q.id, mode: q.mode, outcome, ms, combo });
    xpTotal.current += res.xp;
    if (outcome >= 0.6) {
      const c = combo + 1; setCombo(c); setBestCombo((b) => Math.max(b, c)); sfx.right(c); buzz(12);
      if (c % 10 === 0) confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
    } else { setCombo(0); sfx.wrong(); buzz([30, 40, 30]); shake(); }
    if (res.levelUp) setTimeout(() => { sfx.level(); toast({ icon: '⬆️', title: 'Level up!' }); }, 400);
    setResults((r) => [...r, { q, outcome }]);
    setLast({ outcome, xp: res.xp });
    setPhase('reveal');
  };

  const next = () => {
    if (idx + 1 >= qs.length) {
      setPhase('done');
      const right = results.filter((r) => r.outcome >= 0.6).length;
      useGame.getState().packUpdate(pack.meta.id, (p) => ({ ...p, plays: p.plays + 1, best: { ...p.best, [mode]: Math.max(p.best[mode] ?? 0, right) } }));
      useGame.getState().bump('packRounds');
      if (right === results.length && results.length >= 5) { sfx.win(); confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 } }); }
      for (const a of checkAchievements({ perfect: right === results.length, combo: bestCombo, total: results.length, mode: 'pack' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
      return;
    }
    setIdx((i) => i + 1); setPhase('ask'); setLast(null);
  };

  nextRef.current = next;

  if (!qs.length) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div><div className="display text-xl font-bold">No questions of this type in this pack.</div><button className="btn btn-ghost mt-4" onClick={onExit}>Back</button></div>
      </div>
    );
  }
  if (phase === 'done') return <Summary pack={pack} results={results} xp={xpTotal.current} bestCombo={bestCombo} onExit={onExit} onAgain={restart} title={modeMeta(pack, mode).title} />;

  return (
    <div className="min-h-dvh flex flex-col relative">
      <div className="mx-auto w-full max-w-2xl px-4 pt-3 flex items-center gap-3">
        <button aria-label="Quit" onClick={onExit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
        <div className="flex-1"><Progress value={(idx + (phase === 'reveal' ? 1 : 0)) / qs.length} color={pack.meta.color} h={12} /></div>
        <span className="mono text-sm text-mist w-12 text-right">{idx + 1}/{qs.length}</span>
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 h-8 flex items-center justify-between">
        <span className="text-xs uppercase tracking-[.18em] text-mist font-semibold">{pack.meta.title} · {modeMeta(pack, mode).title}</span>
        {combo >= 2 && <span className="display font-extrabold text-amber"><span className="flame">🔥</span> {combo} combo</span>}
      </div>
      <div ref={shakeRef} className="flex-1 flex flex-col">
        <Ask key={idx + q.id} pack={pack} q={q} locked={phase !== 'ask'} onAnswer={record} byId={byId} />
      </div>
      <AnimatePresence>
        {phase === 'reveal' && last && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-40">
            <div className="mx-auto max-w-2xl rounded-t-3xl border-t-4 bg-deep px-5 pt-4 max-h-[70dvh] overflow-y-auto shadow-[0_-20px_60px_rgba(0,0,0,.5)]"
              style={{ borderColor: last.outcome >= 0.6 ? 'var(--color-mint)' : 'var(--color-rose)', paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`display text-lg font-extrabold ${last.outcome >= 0.95 ? 'text-mint' : last.outcome >= 0.6 ? 'text-amber' : 'text-rose'}`}>
                  {last.outcome >= 0.95 ? 'Correct!' : last.outcome >= 0.6 ? 'Got it!' : 'Not quite'}
                </span>
                <span className="chip !text-amber !border-amber/40">+{last.xp} XP</span>
              </div>
              {q.mode === 'higher' && q.pair ? (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {q.pair.map((id) => (
                    <div key={id} className={`rounded-xl px-3 py-2 border ${id === q.id ? 'border-mint bg-mint/10' : 'border-line bg-white/5'}`}>
                      <div className="font-bold break-words">{byId[id].name}</div>
                      <div className="mono text-sm">{byId[id].rank!.value.toLocaleString()} {byId[id].rank!.unit}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {q.mode !== 'find' && q.mode !== 'name' && (
                <div className="relative h-32 mb-3 rounded-2xl overflow-hidden border border-line bg-ink">
                  <PackMap pack={pack} interactive={false} highlight={q.id} fills={{ [q.id]: pack.meta.color }} focus={[q.id]} className="absolute inset-0" />
                </div>
              )}
              <ItemFacts pack={pack} it={byId[q.id]} hideSample={q.mode === 'sample'} />
              <button className={`btn w-full mt-3 ${last.outcome >= 0.6 ? 'btn-mint' : 'btn-primary'}`} onClick={next}>
                {idx + 1 >= qs.length ? 'See results' : 'Continue'} →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Ask({ pack, q, locked, onAnswer, byId }: { pack: PackData; q: PackQuestion; locked: boolean; onAnswer: (o: number) => void; byId: Record<string, PackData['items'][number]> }) {
  const it = byId[q.id];
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const [narrow] = useState(() => window.innerWidth < 700);
  const pick = (id: string | null) => { if (locked || picked) return; setPicked(id ?? '__none'); onAnswer(id === q.id ? 1 : 0); };
  const choiceLabel = (id: string) => (q.mode === 'capital' ? byId[id].capital ?? byId[id].name : byId[id].name);

  const answer = q.choices ? (
    <Choices ids={q.choices} answer={q.id} picked={picked} onPick={pick} label={choiceLabel} disabled={locked} />
  ) : q.typed ? (
    <div>
      <PackTypeAnswer items={pack.items} onSubmit={(id) => pick(id)} disabled={locked} />
      {picked && picked !== q.id && <div className="mt-2 text-rose text-sm">It was <b>{it.name}</b>.</div>}
    </div>
  ) : null;

  const kicker = (t: string) => <div className="text-center text-mist text-sm uppercase tracking-[.16em] font-semibold my-3">{t}</div>;

  if (q.mode === 'find' && isCountriesPack(pack)) return <FindCountries pack={pack} q={q} locked={locked} onAnswer={onAnswer} byId={byId} />;

  if (q.mode === 'find') {
    const maxTries = 3;
    const onPick = (id: string) => {
      if (locked || picked) return;
      if (id === q.id) { setPicked(id); onAnswer([1, 0.55, 0.25][wrong.length]); return; }
      const w = [...wrong, id]; setWrong(w); sfx.wrong(); buzz(20);
      if (w.length >= maxTries) { setPicked(id); onAnswer(0); }
    };
    const fills: Record<string, string> = {};
    for (const w of wrong) fills[w] = 'var(--color-rose)';
    if (picked) fills[q.id] = wrong.length >= maxTries ? 'var(--color-amber)' : 'var(--color-mint)';
    const labels = Object.fromEntries(wrong.map((w) => [w, byId[w]?.name ?? '']));
    if (picked) labels[q.id] = it.name;
    // On phones a whole-world map is too small to tap a river or strait: frame the wider region
    // around the answer (it plus its ~10 nearest items) instead.
    const worldScale = pack.projection.type === 'naturalEarth1' || pack.projection.type === 'equirectangular';
    const frame = worldScale && narrow ? neighbourhood(pack, q.id, 10) : null;
    return (
      <div className="flex-1 flex flex-col mx-auto w-full max-w-5xl px-2 sm:px-4 pb-4">
        <div className="text-center my-2">
          <div className="text-mist text-xs uppercase tracking-[.18em] font-semibold">Tap on the map</div>
          <div className="display text-3xl font-extrabold break-words">{it.name}</div>
          <div className="text-sm text-mist mt-1">{it.kind ? `${it.kind} · ` : ''}{maxTries - wrong.length} {maxTries - wrong.length === 1 ? 'try' : 'tries'} left · {frame ? 'zoomed to its region · ' : ''}pinch to zoom</div>
        </div>
        <div className="relative flex-1 min-h-[55dvh] rounded-3xl overflow-hidden border border-line">
          <PackMap pack={pack} onPick={onPick} fills={fills} labels={labels} highlight={picked ? q.id : null} pulse={picked ? [q.id] : []} focus={picked ? [q.id] : frame} className="absolute inset-0" />
        </div>
      </div>
    );
  }

  if (q.mode === 'name') {
    return (
      <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
        <div className="relative flex-1 min-h-[38dvh] rounded-3xl overflow-hidden border border-line">
          <PackMap pack={pack} interactive fills={{ [q.id]: picked ? (picked === q.id ? 'var(--color-mint)' : 'var(--color-rose)') : 'var(--color-amber)' }}
            highlight={q.id} pulse={[q.id]} focus={neighbourhood(pack, q.id)} className="absolute inset-0" />
        </div>
        {kicker(isCountriesPack(pack) ? `Which ${sampleWord(pack)} is ${sampleWord(pack) === 'script' ? 'used' : 'official'} in the countries lit up?` : `Name the highlighted ${it.kind ?? 'place'}`)}
        <div className="pt-1">{answer}</div>
      </div>
    );
  }

  if (q.mode === 'higher' && q.pair) {
    const label = it.rank!.label.toLowerCase();
    return (
      <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
        {kicker(/speaker|user|people/.test(label) ? `Which has more ${label}?` : `Which has the greater ${label}?`)}
        <div className="grid grid-cols-2 gap-3 flex-1 max-h-[60dvh]">
          {q.pair.map((id) => {
            const st = !picked ? 'idle' : id === q.id ? 'right' : id === picked ? 'wrong' : 'dim';
            return (
              <button key={id} disabled={locked} onClick={() => { sfx.tap(); pick(id); }}
                className={`card !rounded-3xl p-3 flex flex-col text-left border-2 transition-colors ${st === 'right' ? '!border-mint' : st === 'wrong' ? '!border-rose shake' : 'hover:!border-amber/60'}`}>
                <div className="relative flex-1 min-h-40 rounded-2xl overflow-hidden bg-ink">
                  <PackMap pack={pack} interactive={false} highlight={id} fills={{ [id]: pack.meta.color }} focus={[id]} className="absolute inset-0" />
                </div>
                <div className="display font-bold text-lg mt-2 break-words">{byId[id].name}</div>
                {byId[id].kind && <div className="text-sm text-mist capitalize">{byId[id].kind}</div>}
                {picked && <div className="mono font-bold mt-1">{byId[id].rank!.value.toLocaleString()} {byId[id].rank!.unit}</div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (q.mode === 'sample') {
    return (
      <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
        <div className="flex-1 flex flex-col justify-center min-h-[30dvh] py-2">
          {kicker(`Which ${sampleWord(pack)} is this?`)}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <SampleText it={it} big hideSource className="kb-media !bg-panel2/70" />
          </motion.div>
        </div>
        <div className="pt-3">{answer}</div>
      </div>
    );
  }

  // shape / capital / flag / arms
  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-2xl px-4 pb-6">
      <div className="flex-1 flex flex-col items-center justify-center min-h-[34dvh] py-2">
        {q.mode === 'shape' && <>{kicker(`Which ${it.kind ?? 'region'} is this?`)}
          <motion.svg viewBox="0 0 200 200" width="min(62vw, 280px, 36dvh)" height="min(62vw, 280px, 36dvh)" initial={{ scale: 0.6, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 160, damping: 16 }} style={{ overflow: 'visible', filter: `drop-shadow(0 0 10px color-mix(in srgb, ${pack.meta.color} 70%, transparent))` }}>
            <path d={pack.shapes![q.id]} fillRule="evenodd" stroke="rgba(255,255,255,.35)" strokeWidth={0.6}
              style={{ fill: picked ? (picked === q.id ? 'var(--color-mint)' : 'var(--color-rose)') : pack.meta.color, transition: 'fill .3s' }} />
          </motion.svg></>}
        {(q.mode === 'flag' || q.mode === 'arms') && <>{kicker(q.mode === 'flag' ? 'Whose flag is this?' : 'Whose coat of arms is this?')}
          <motion.img src={q.mode === 'flag' ? it.flag : it.arms} alt="" initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }}
            className={q.mode === 'flag' ? 'w-[min(78vw,320px,54dvh)] max-h-[36dvh] object-contain rounded-xl shadow-[0_20px_60px_rgba(0,0,0,.6)]' : 'h-[min(40vh,260px)] w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,.6)]'} /></>}
        {q.mode === 'capital' && <>{kicker('What is the capital of')}
          {it.flag && <img src={it.flag} alt="" className="h-12 w-auto rounded mb-2" />}
          <div className="display text-4xl font-extrabold text-center break-words">{it.name}</div></>}
      </div>
      <div className="pt-3">{answer}</div>
    </div>
  );
}

/**
 * Countries-packs: "tap a country where it's official". Any of the item's countries is right; up to
 * three tries with decreasing credit; afterwards every country it covers lights up.
 */
function FindCountries({ pack, q, locked, onAnswer, byId }: { pack: PackData; q: PackQuestion; locked: boolean; onAnswer: (o: number) => void; byId: Record<string, PackData['items'][number]> }) {
  const it = byId[q.id];
  const regions = regionsOf(it);
  const maxTries = 3;
  const [wrong, setWrong] = useState<string[]>([]);
  const [hit, setHit] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const onPick = (c: string) => {
    if (locked || done || wrong.includes(c)) return;
    if (regions.includes(c)) { setHit(c); setDone(true); onAnswer([1, 0.55, 0.25][wrong.length]); return; }
    const w = [...wrong, c]; setWrong(w); sfx.wrong(); buzz(20);
    if (w.length >= maxTries) { setDone(true); onAnswer(0); }
  };
  const countryFills: Record<string, string> = {};
  if (done) for (const c of regions) countryFills[c] = hit ? 'var(--color-mint)' : 'var(--color-amber)';
  for (const w of wrong) countryFills[w] = 'var(--color-rose)';
  if (hit) countryFills[hit] = 'var(--color-mint)';
  const countryLabels = Object.fromEntries(wrong.map((w) => [w, BY_ID[w]?.name ?? '']));
  if (hit) countryLabels[hit] = BY_ID[hit]?.name ?? '';
  const script = sampleWord(pack) === 'script';
  // Like the country quiz: on phones, if every country it covers is on one continent, frame that
  // continent (with a hint) instead of a tiny whole-world map.
  const [narrow] = useState(() => window.innerWidth < 700);
  const continents = [...new Set(regions.map((c) => BY_ID[c]?.region).filter(Boolean))];
  const continent = narrow && continents.length === 1 ? continents[0] : null;
  const frame = done ? null : continent ? regionFrame(continent) : null;
  return (
    <div className="flex-1 flex flex-col mx-auto w-full max-w-5xl px-2 sm:px-4 pb-4">
      <div className="text-center my-2">
        <div className="text-mist text-xs uppercase tracking-[.18em] font-semibold">{script ? 'Tap a country that uses' : "Tap a country where it's official"}</div>
        <div className="display text-3xl font-extrabold break-words">{it.name}</div>
        <div className="text-sm text-mist mt-1">
          {regions.length > 1 ? `Any of ${regions.length} countries counts · ` : ''}{maxTries - wrong.length} {maxTries - wrong.length === 1 ? 'try' : 'tries'} left · {continent ? `somewhere in ${continent} · ` : ''}pinch to zoom
        </div>
      </div>
      <div className="relative flex-1 min-h-[55dvh] rounded-3xl overflow-hidden border border-line">
        <PackMap pack={pack} onPickCountry={onPick} countryFills={countryFills} countryLabels={countryLabels}
          focus={done ? [q.id] : null} countryFocus={frame} pulse={done ? [q.id] : []} className="absolute inset-0" />
      </div>
    </div>
  );
}

/** The item plus a few nearest items, for framing "name it" questions with context. */
function neighbourhood(pack: PackData, id: string, n = 4) {
  if (isCountriesPack(pack)) return [id]; // its own countries already frame it
  const c = itemCentroids(pack);
  const me = c[id];
  if (!me) return [id];
  const near = Object.entries(c).filter(([k]) => k !== id)
    .sort((a, b) => Math.hypot(a[1][0] - me[0], a[1][1] - me[1]) - Math.hypot(b[1][0] - me[0], b[1][1] - me[1]))
    .slice(0, n).map(([k]) => k);
  return [id, ...near];
}

function Choices({ ids, answer, picked, onPick, label, disabled }: { ids: string[]; answer: string; picked: string | null; onPick: (id: string) => void; label: (id: string) => string; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {ids.map((id, i) => {
        const st = !picked ? 'idle' : id === answer ? 'right' : id === picked ? 'wrong' : 'dim';
        const cls = { idle: 'bg-panel2/80 border-line hover:border-sky/60', right: 'bg-mint/20 border-mint text-mint', wrong: 'bg-rose/20 border-rose text-rose shake', dim: 'bg-panel/50 border-line/50 opacity-50' }[st];
        return (
          <motion.button key={id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: st === 'dim' ? 0.5 : 1, y: 0 }} transition={{ delay: picked ? 0 : i * 0.04 }}
            disabled={!!picked || disabled} onClick={() => { sfx.tap(); onPick(id); }}
            className={`relative border-2 rounded-2xl text-left px-4 py-3.5 min-h-14 transition-colors ${cls}`}>
            <span className="display font-semibold text-[1.05rem] leading-tight break-words">{label(id)}</span>
            {st === 'right' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xl">✓</span>}
          </motion.button>
        );
      })}
    </div>
  );
}

function Summary({ pack, results, xp, bestCombo, onExit, onAgain, title }: { pack: PackData; results: Result[]; xp: number; bestCombo: number; onExit: () => void; onAgain: () => void; title: string }) {
  const right = results.filter((r) => r.outcome >= 0.6).length;
  const acc = results.length ? right / results.length : 0;
  const misses = results.filter((r) => r.outcome < 0.6);
  const [open, setOpen] = useState<string | null>(null);
  const byId = Object.fromEntries(pack.items.map((i) => [i.id, i]));
  return (
    <div className="relative mx-auto max-w-2xl px-4 py-6 min-h-dvh flex flex-col">
      <div className="text-center mt-4">
        <div className="text-mist uppercase tracking-[.2em] text-xs font-bold">{pack.meta.title} · {title}</div>
        <div className="display text-6xl font-extrabold mt-2"><CountUp to={Math.round(acc * 100)} />%</div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[['Correct', `${right}/${results.length}`, ''], ['XP earned', `+${xp}`, 'text-amber'], ['Best combo', `${bestCombo}🔥`, 'text-coral']].map(([k, v, c]) => (
          <div key={k} className="card p-3 text-center"><div className={`display text-2xl font-extrabold ${c}`}>{v}</div><div className="text-xs uppercase tracking-wider text-mist font-semibold mt-1">{k}</div></div>
        ))}
      </div>
      {misses.length > 0 && (
        <div className="mt-6">
          <div className="display font-bold mb-2">Review your misses <span className="text-sm font-normal text-mist">— tap to learn more</span></div>
          <div className="grid grid-cols-2 gap-2">
            {misses.map((m, i) => (
              <button key={i} onClick={() => setOpen(m.q.id)} className="card !rounded-2xl p-3 text-left hover:border-amber/60">
                <div className="font-bold leading-tight break-words">{byId[m.q.id].name}</div>
                <div className="text-sm text-mist capitalize">{byId[m.q.id].capital ? `★ ${byId[m.q.id].capital}` : byId[m.q.id].kind}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && <ItemSheet pack={pack} id={open} onClose={() => setOpen(null)} />}
      <div className="mt-auto pt-8 grid grid-cols-2 gap-3">
        <button className="btn btn-ghost" onClick={onExit}>Back to pack</button>
        <button className="btn btn-primary" onClick={onAgain}>Play again</button>
      </div>
    </div>
  );
}
