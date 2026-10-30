import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { COUNTRIES, REGIONS, fame } from '../data';
import { useGame, mastery, levelFor } from '../lib/store';
import { sfx } from '../lib/sound';
import { go } from '../lib/router';
import { Page, Progress, Ring } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { Stamp, REGION_INK } from '../components/passport/Stamp';
import { CountrySheet } from '../components/passport/CountrySheet';
import { StatusBar } from './Home';
import { Shape } from '../components/Shape';

const SEEN_KEY = 'geoiq-seen-stamps';
const readSeen = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
};

const masteryColor = (m: number, stamped: boolean) =>
  stamped ? '#ffb547' : m <= 0 ? undefined : `rgba(83,184,255,${0.25 + m * 0.65})`;

export default function Passport() {
  const { name, xp, stamps, cards } = useGame();
  const [tab, setTab] = useState<'stamps' | 'map'>('stamps');
  const [open, setOpen] = useState<string | null>(null);
  const [region, setRegion] = useState<string>('');
  // Stamps not yet seen animate in with a "thunk" the first time.
  const [fresh] = useState(() => { const seen = readSeen(); return new Set(Object.keys(stamps).filter((id) => !seen.has(id))); });
  useEffect(() => {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.keys(stamps)));
    if (fresh.size && tab === 'stamps') {
      const h = setTimeout(() => sfx.stamp(), 350);
      return () => clearTimeout(h);
    }
  }, [stamps, fresh, tab]);

  const total = COUNTRIES.length;
  const count = Object.keys(stamps).length;
  const lvl = levelFor(xp).level;
  const m = useMemo(() => Object.fromEntries(COUNTRIES.map((c) => [c.id, mastery(cards, c.id)])), [cards]);
  const byRegion = useMemo(() => REGIONS.map((r) => {
    const list = COUNTRIES.filter((c) => c.region === r).sort((a, b) => Number(!!stamps[b.id]) - Number(!!stamps[a.id]) || fame(b) - fame(a));
    const got = list.filter((c) => stamps[c.id]).length;
    const avg = list.reduce((a, c) => a + m[c.id], 0) / list.length;
    return { r, list, got, avg };
  }), [stamps, m]);

  const fills = useMemo(() => {
    const f: Record<string, string> = {};
    for (const c of COUNTRIES) { const col = masteryColor(m[c.id], !!stamps[c.id]); if (col) f[c.id] = col; }
    return f;
  }, [m, stamps]);

  let freshIdx = 0;

  return (
    <Page>
      <StatusBar />

      {/* Cover */}
      <motion.div initial={{ opacity: 0, rotateX: -20, y: 20 }} animate={{ opacity: 1, rotateX: 0, y: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}
        className="relative mt-2 rounded-[26px] overflow-hidden p-5 border border-amber/30 shadow-[0_30px_60px_-30px_rgba(0,0,0,.8)]"
        style={{ background: 'linear-gradient(135deg,#1d2d5c 0%,#14204a 55%,#0f1838 100%)' }}>
        <div className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 9px)' }} />
        <div className="absolute -right-10 -bottom-12 opacity-20"><Stamp id="BRA" size={180} /></div>
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 rounded-full border-2 border-amber/80 grid place-items-center text-2xl sm:text-3xl bg-ink/40">🌐</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[.14em] text-amber/90 font-bold leading-snug">Passport · Geo Republic</div>
            <div className="display text-xl sm:text-2xl font-extrabold break-words leading-tight">{name || 'Explorer'}</div>
            <div className="mono text-xs text-mist">LV {lvl} · NO. {String(count).padStart(3, '0')}-{total}</div>
          </div>
          <Ring value={count / total} size={62} color="var(--color-amber)">
            <div className="text-center leading-none"><div className="display font-extrabold text-lg">{count}</div><div className="text-xs text-mist">/{total}</div></div>
          </Ring>
        </div>
        <div className="relative mono text-xs text-mist/90 mt-4 tracking-widest truncate">P&lt;GEO{(name || 'EXPLORER').toUpperCase().replace(/[^A-Z]/g, '')}&lt;&lt;{'<'.repeat(30)}</div>
      </motion.div>

      <button onClick={() => go('/atlas')} className="card w-full mt-3 p-4 flex items-center gap-3 text-left hover:border-sky/60">
        <span className="text-2xl">📖</span>
        <div className="flex-1"><div className="display font-bold">World Atlas</div><div className="text-sm text-mist">Full profiles of all 197 countries</div></div>
        <span className="text-sky text-xl">→</span>
      </button>

      {/* Tabs */}
      <div className="mt-4 p-1 rounded-2xl bg-white/5 border border-line grid grid-cols-2 relative">
        {(['stamps', 'map'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`relative py-2.5 rounded-xl display font-bold text-sm ${tab === t ? 'text-ink' : 'text-mist'}`}>
            {tab === t && <motion.span layoutId="pp-tab" className="absolute inset-0 rounded-xl bg-amber" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            <span className="relative">{t === 'stamps' ? '🛂 Stamps' : '🗺️ Conquest map'}</span>
          </button>
        ))}
      </div>

      {tab === 'stamps' ? (
        <>
          <div className="flex gap-2 overflow-x-auto scrollbar-none mt-4">
            {['', ...REGIONS].map((r) => (
              <button key={r} onClick={() => setRegion(r)} className={`chip !py-1.5 !px-3 !text-sm whitespace-nowrap ${region === r ? '!bg-amber !text-ink !border-amber' : ''}`}>{r || 'All'}</button>
            ))}
          </div>
          {count === 0 && (
            <div className="card p-4 mt-4 text-sm text-mist">
              Your passport is empty. Master a country's <b className="text-paper">shape, flag, location and capital</b> to earn its stamp.
              <button className="btn btn-primary w-full mt-3 !py-2.5" onClick={() => go('/learn')}>Start the Atlas Path</button>
            </div>
          )}
          {byRegion.filter((g) => !region || g.r === region).map((g) => (
            <section key={g.r} className="mt-6">
              <div className="flex items-end justify-between mb-2">
                <h2 className="display text-xl font-extrabold" style={{ color: REGION_INK[g.r] }}>{g.r}</h2>
                <span className="mono text-sm text-mist">{g.got}/{g.list.length}</span>
              </div>
              <div className="rounded-3xl p-3 border border-line/60 grid grid-cols-3 sm:grid-cols-4 gap-x-2 gap-y-3"
                style={{ background: 'linear-gradient(180deg,rgba(238,242,255,.035),rgba(238,242,255,.015))', backgroundImage: 'radial-gradient(rgba(142,163,204,.08) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
                {g.list.map((c) => {
                  const date = stamps[c.id];
                  const isFresh = date && fresh.has(c.id);
                  const delay = isFresh ? 0.3 + 0.25 * freshIdx++ : 0;
                  return (
                    <button key={c.id} onClick={() => setOpen(c.id)} className="flex flex-col items-center gap-1 group">
                      {date ? (
                        <motion.div
                          initial={isFresh ? { scale: 1.7, rotate: -18, opacity: 0 } : false}
                          animate={{ scale: 1, rotate: 0, opacity: 1 }}
                          transition={isFresh ? { delay, type: 'spring', stiffness: 500, damping: 14 } : undefined}
                          onAnimationStart={() => { if (isFresh && delay > 0.4) setTimeout(() => sfx.stamp(), delay * 1000); }}
                          className="group-hover:scale-105 transition-transform"
                        >
                          <Stamp id={c.id} date={date} size={92} />
                        </motion.div>
                      ) : (
                        <div className="w-[92px] h-[92px] grid place-items-center opacity-80 group-hover:opacity-100 transition-opacity">
                          <Ring value={m[c.id]} size={68} stroke={4} color="var(--color-sky)">
                            <div className="relative w-12 h-12 rounded-full border border-dashed border-mist/30 grid place-items-center">
                              <span className="absolute inset-0 grid place-items-center opacity-25"><Shape id={c.id} size={34} glow={false} color="#8ea3cc" /></span>
                              {m[c.id] > 0 && <span className="relative text-xs mono font-bold text-paper">{Math.round(m[c.id] * 100)}%</span>}
                            </div>
                          </Ring>
                        </div>
                      )}
                      <span className={`text-xs leading-tight text-center break-words max-w-full ${date ? 'text-paper font-semibold' : 'text-mist/90'}`}>{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : (
        <>
          <div className="card mt-4 p-2 overflow-hidden">
            <div className="aspect-[1.92] rounded-2xl overflow-hidden">
              <WorldMap fills={fills} defaultFill="#24365f" onPick={(id) => setOpen(id)} />
            </div>
            <div className="flex flex-wrap gap-3 px-2 py-2 text-xs text-mist">
              <Legend c="#24365f" t="Unexplored" />
              <Legend c="rgba(83,184,255,.4)" t="Learning" />
              <Legend c="rgba(83,184,255,.9)" t="Almost there" />
              <Legend c="#ffb547" t="Stamped" />
            </div>
          </div>
          <div className="card mt-4 p-4 space-y-3">
            <div className="display font-bold">Territory by region</div>
            {byRegion.map((g) => (
              <div key={g.r}>
                <div className="flex justify-between text-sm"><span className="font-semibold">{g.r}</span><span className="mono text-mist">{Math.round(g.avg * 100)}% · 🛂 {g.got}/{g.list.length}</span></div>
                <Progress value={g.avg} color={REGION_INK[g.r]} className="mt-1.5" h={8} />
              </div>
            ))}
          </div>
          <div className="text-sm text-mist text-center mt-3">Tap any country to see your memory of it.</div>
        </>
      )}

      <AnimatePresence>{open && <CountrySheet id={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </Page>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-white/20" style={{ background: c }} />{t}</span>;
}
