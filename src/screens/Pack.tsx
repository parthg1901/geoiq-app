import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { loadPack, type PackData, type PackMode } from '../lib/packs';
import { useGame, packMastery, itemMastery } from '../lib/store';
import { go, useRoute } from '../lib/router';
import { sfx } from '../lib/sound';
import { onBack } from '../lib/native';
import { checkAchievements } from '../lib/achievements';
import { toast } from '../components/Toasts';
import { Progress, Ring } from '../components/ui';
import { PackMap, packFeatures } from '../components/pack/PackMap';
import { PackQuiz } from '../components/pack/PackQuiz';
import { ItemFacts, ItemSheet } from '../components/pack/ItemSheet';
import { PackTypeAnswer } from '../components/pack/PackAnswer';
import { MODE_META, eligible, mainKind } from '../components/pack/questions';

export default function Pack({ id }: { id?: string }) {
  const { parts, query } = useRoute();
  const [pack, setPack] = useState<PackData | null | undefined>(undefined);
  useEffect(() => { if (id) loadPack(id).then(setPack); }, [id]);
  if (!id) { go('/packs'); return null; }
  if (pack === undefined) return <div className="min-h-dvh grid place-items-center text-mist display">Unfolding the map…</div>;
  if (!pack) return <div className="min-h-dvh grid place-items-center p-6 text-center"><div><div className="display text-xl">Pack not found.</div><button className="btn btn-ghost mt-4" onClick={() => go('/packs')}>Back</button></div></div>;

  const sub = parts[2];
  const back = () => go('/pack/' + id);
  if (sub === 'play' && parts[3]) return <PackQuiz key={parts[3] + query.get('typed')} pack={pack} mode={parts[3] as PackMode} typed={query.get('typed') === '1'} onExit={back} />;
  if (sub === 'learn') return <Learn pack={pack} onExit={back} />;
  if (sub === 'all') return <NameAll pack={pack} onExit={back} />;
  return <Overview pack={pack} />;
}

/* ------------------------------------------------------------------ */

function Overview({ pack }: { pack: PackData }) {
  const ps = useGame((s) => s.packs[pack.meta.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const { meta } = pack;
  const ids = pack.items.map((i) => i.id);
  const m = packMastery(ps, ids);
  const geomIds = useMemo(() => new Set(packFeatures(pack).items.map((f) => f.id)), [pack]);
  const fills = useMemo(() => {
    const f: Record<string, string> = {};
    for (const it of pack.items) {
      const x = itemMastery(ps, it.id);
      if (x >= 0.75) f[it.id] = meta.color;
      else if (x > 0) f[it.id] = `color-mix(in srgb, ${meta.color} ${Math.round(25 + x * 50)}%, #22355f)`;
    }
    return f;
  }, [pack, ps, meta.color]);
  const sorted = useMemo(() => [...pack.items].sort((a, b) => a.name.localeCompare(b.name)), [pack]);
  const best = ps?.best ?? {};
  const modeCount = (mode: PackMode) => pack.items.filter((it) => eligible(pack, it, mode, geomIds)).length;
  const t = typed ? '?typed=1' : '';

  return (
    <div className="relative mx-auto max-w-3xl px-4 pb-28">
      <div className="sticky top-[var(--sat)] z-20 -mx-4 px-4 py-3 bg-ink flex items-center gap-3 border-b border-line/40">
        <button aria-label="Back" onClick={() => go('/packs')} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">←</button>
        <span className="text-2xl">{meta.emoji}</span>
        <div className="display font-bold text-lg flex-1 leading-tight">{meta.title}</div>
        <Ring value={m} size={44} stroke={5} color={meta.color}><span className="mono text-xs font-bold">{Math.round(m * 100)}%</span></Ring>
      </div>

      <div className="text-mist mt-3">{meta.subtitle}</div>
      <div className="card mt-3 overflow-hidden">
        <div className="relative h-[46dvh] min-h-72">
          <PackMap pack={pack} fills={fills} onPick={setOpen} className="absolute inset-0" />
        </div>
        <div className="px-4 py-3 text-sm text-mist flex flex-wrap gap-x-4 gap-y-1">
          <span>Tap any {mainKind(pack)} for its facts</span>
          <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: meta.color }} />mastered</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-6 mb-3">
        <h2 className="display text-xl font-extrabold">Play</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <span>Type answers</span>
          <button onClick={() => setTyped(!typed)} className={`w-12 h-7 rounded-full p-1 transition-colors ${typed ? 'bg-mint' : 'bg-white/10'}`} aria-label="Toggle typed answers">
            <motion.span layout className="block w-5 h-5 rounded-full bg-white" style={{ marginLeft: typed ? 20 : 0 }} />
          </button>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ModeCard emoji="📖" title="Learn" desc="Flashcards, easiest first" color={meta.color} onClick={() => go(`/pack/${meta.id}/learn`)} />
        {meta.modes.filter((md) => modeCount(md) >= 2).map((md) => (
          <ModeCard key={md} emoji={MODE_META[md].emoji} title={MODE_META[md].title} desc={MODE_META[md].desc} color={meta.color}
            extra={best[md] != null ? `Best ${best[md]}/10` : undefined} onClick={() => go(`/pack/${meta.id}/play/${md}${t}`)} />
        ))}
        {geomIds.size >= 5 && (
          <ModeCard emoji="⏱️" title="Name them all" desc={`All ${geomIds.size}, against the clock`} color={meta.color}
            extra={best.allTime != null ? `Best ${fmtTime(best.allTime)}` : undefined} onClick={() => go(`/pack/${meta.id}/all`)} />
        )}
      </div>

      <h2 className="display text-xl font-extrabold mt-8 mb-3">All {pack.items.length}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map((it) => {
          const x = itemMastery(ps, it.id);
          return (
            <button key={it.id} onClick={() => setOpen(it.id)} className="card !rounded-2xl px-3 py-2.5 flex items-center gap-3 text-left hover:border-amber/60">
              {it.flag ? <img src={it.flag} alt="" loading="lazy" className="w-10 h-7 object-contain rounded-sm shrink-0" /> : <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: x >= 0.75 ? meta.color : x > 0 ? meta.color + '88' : 'rgba(255,255,255,.15)' }} />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold leading-tight break-words">{it.name}</div>
                <div className="text-sm text-mist">{it.capital ? `★ ${it.capital}` : it.rank ? `${it.rank.value.toLocaleString()} ${it.rank.unit}` : it.kind}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-mist mt-8 leading-relaxed">{pack.attribution}</p>
      {open && <ItemSheet pack={pack} id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ModeCard({ emoji, title, desc, color, onClick, extra }: { emoji: string; title: string; desc: string; color: string; onClick: () => void; extra?: string }) {
  return (
    <button onClick={onClick} className="card p-4 text-left hover:border-amber/60 transition-colors group">
      <div className="w-11 h-11 rounded-xl grid place-items-center text-xl font-bold transition-transform group-hover:scale-110" style={{ background: color + '22', color, border: `2px solid ${color}66` }}>{emoji}</div>
      <div className="display font-bold mt-2 leading-tight">{title}</div>
      <div className="text-sm text-mist leading-snug">{desc}</div>
      {extra && <div className="text-sm text-amber mt-1">🏆 {extra}</div>}
    </button>
  );
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/* ------------------------------------------------------------------ */

/** Flashcards: the next 8 items you haven't mastered, easiest first. */
function Learn({ pack, onExit }: { pack: PackData; onExit: () => void }) {
  const ps = useGame.getState().packs[pack.meta.id];
  const deck = useMemo(() => {
    const byDiff = [...pack.items].sort((a, b) => (a.difficulty ?? 0.5) - (b.difficulty ?? 0.5));
    const todo = byDiff.filter((it) => itemMastery(ps, it.id) < 0.75);
    return (todo.length ? todo : byDiff).slice(0, 8);
  }, [pack, ps]);
  const [i, setI] = useState(0);
  useEffect(() => onBack(onExit), [onExit]);
  const it = deck[i];
  const done = i >= deck.length;
  return (
    <div className="min-h-dvh mx-auto max-w-2xl px-4 py-3 flex flex-col">
      <div className="flex items-center gap-3">
        <button aria-label="Close" onClick={onExit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
        <div className="flex-1"><Progress value={i / deck.length} color={pack.meta.color} h={12} /></div>
        <span className="mono text-sm text-mist">{Math.min(i + 1, deck.length)}/{deck.length}</span>
      </div>
      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div key={it.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="card mt-4 overflow-hidden flex-1 flex flex-col">
            <div className="relative h-[38dvh] min-h-56 bg-ink">
              <PackMap pack={pack} interactive={false} highlight={it.id} fills={{ [it.id]: pack.meta.color }} focus={[it.id]} labels={{ [it.id]: it.name }} className="absolute inset-0" />
            </div>
            <div className="p-5 flex-1">
              {pack.shapes?.[it.id] && <svg viewBox="0 0 200 200" width={72} height={72} className="float-right ml-3"><path d={pack.shapes[it.id]} fill={pack.meta.color} /></svg>}
              <ItemFacts pack={pack} it={it} />
            </div>
          </motion.div>
        ) : (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="text-6xl">🎓</div>
            <div className="display text-3xl font-extrabold mt-3">Nice — {deck.length} learned</div>
            <p className="text-mist mt-2">Lock them in with a quick round.</p>
            <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-sm">
              {pack.meta.modes.filter((m) => m !== 'higher').slice(0, 4).map((m) => (
                <button key={m} className="btn btn-ghost" onClick={() => go(`/pack/${pack.meta.id}/play/${m}`)}>{MODE_META[m].emoji} {MODE_META[m].title}</button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!done && (
        <div className="grid grid-cols-[auto_1fr] gap-3 py-4 safe-bottom">
          <button className="btn btn-ghost w-14" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous">←</button>
          <button className="btn btn-primary text-lg" onClick={() => { sfx.tap(); setI(i + 1); }}>{i + 1 < deck.length ? 'Next →' : 'Finish 🎯'}</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Sporcle-style recall: type every item; each correct one lights up on the map. */
function NameAll({ pack, onExit }: { pack: PackData; onExit: () => void }) {
  const geomIds = useMemo(() => new Set(packFeatures(pack).items.map((f) => f.id)), [pack]);
  const items = useMemo(() => pack.items.filter((it) => geomIds.has(it.id)), [pack, geomIds]);
  const [found, setFound] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [over, setOver] = useState<'won' | 'gaveup' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const start = useRef(performance.now());
  const best = useGame((s) => s.packs[pack.meta.id]?.best.allTime);
  useEffect(() => onBack(onExit), [onExit]);
  useEffect(() => {
    if (over) return;
    const h = setInterval(() => setElapsed((performance.now() - start.current) / 1000), 250);
    return () => clearInterval(h);
  }, [over]);

  const finish = (kind: 'won' | 'gaveup', n: number) => {
    const secs = (performance.now() - start.current) / 1000;
    setElapsed(secs); setOver(kind);
    const g = useGame.getState();
    g.addXP(Math.round(n * 2) + (kind === 'won' ? 25 : 0), kind === 'won' ? 10 : 0);
    g.packUpdate(pack.meta.id, (p) => ({
      ...p, plays: p.plays + 1,
      best: { ...p.best, allFound: Math.max(p.best.allFound ?? 0, n), ...(kind === 'won' && (p.best.allTime == null || secs < p.best.allTime) ? { allTime: Math.round(secs) } : {}) },
    }));
    if (kind === 'won') { g.bump('nameAll'); sfx.win(); confetti({ particleCount: 180, spread: 100, origin: { y: 0.4 } }); }
    for (const a of checkAchievements({ mode: 'pack' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
  };

  const submit = (id: string | null) => {
    if (over || !id) return;
    if (found.includes(id)) { setMsg('Already got that one'); setTimeout(() => setMsg(null), 1200); return; }
    const nf = [...found, id];
    setFound(nf); setLast(id); sfx.right(nf.length % 8);
    if (nf.length === items.length) finish('won', nf.length);
  };

  const fills: Record<string, string> = {};
  for (const f of found) fills[f] = 'var(--color-mint)';
  if (over === 'gaveup') for (const it of items) if (!found.includes(it.id)) fills[it.id] = 'var(--color-rose)';
  const missed = over ? items.filter((it) => !found.includes(it.id)) : [];

  return (
    <div className="min-h-dvh mx-auto max-w-3xl px-3 py-3 flex flex-col">
      <div className="flex items-center gap-3">
        <button aria-label="Close" onClick={onExit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
        <div className="flex-1"><Progress value={found.length / items.length} color="var(--color-mint)" h={12} /></div>
        <span className="mono font-bold">{found.length}/{items.length}</span>
        <span className="mono text-mist w-14 text-right">{fmtTime(elapsed)}</span>
      </div>
      <div className="text-center my-2">
        <div className="display text-xl font-extrabold">Name them all: {pack.meta.title}</div>
        {best != null && <div className="text-sm text-amber">🏆 Best time {fmtTime(best)}</div>}
      </div>
      <div className="relative flex-1 min-h-[45dvh] rounded-3xl overflow-hidden border border-line">
        <PackMap pack={pack} fills={fills} highlight={last} labels={last && !over ? { [last]: pack.items.find((x) => x.id === last)?.name ?? '' } : undefined} className="absolute inset-0" />
      </div>
      {!over ? (
        <div className="pt-3 space-y-2">
          <PackTypeAnswer items={items} keepOpen onSubmit={(id) => submit(id)} placeholder="Start typing names…" />
          {msg && <div className="text-sm text-amber">{msg}</div>}
          <button className="btn btn-ghost w-full !py-2.5 text-sm" onClick={() => finish('gaveup', found.length)}>Give up & show the rest</button>
        </div>
      ) : (
        <div className="pt-4">
          <div className="display text-2xl font-extrabold text-center">{over === 'won' ? `All ${items.length} in ${fmtTime(elapsed)}! 🎉` : `${found.length} of ${items.length} named`}</div>
          {missed.length > 0 && (
            <div className="mt-3">
              <div className="text-sm text-mist mb-2">You missed:</div>
              <div className="flex flex-wrap gap-2">{missed.map((it) => <span key={it.id} className="chip !text-sm !text-rose !border-rose/40">{it.name}</span>)}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <button className="btn btn-ghost" onClick={onExit}>Back to pack</button>
            <button className="btn btn-primary" onClick={() => { setFound([]); setLast(null); setOver(null); setElapsed(0); start.current = performance.now(); }}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
