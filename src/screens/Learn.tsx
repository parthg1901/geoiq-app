import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGame, mastery, packMastery } from '../lib/store';
import { loadPackIndex, GROUP_META, type PackMeta, type PackGroup } from '../lib/packs';
import { UNITS, REGION_META, unitUnlocked, regionFrame, type Unit } from '../lib/path';
import { COUNTRIES, REGIONS, type Region } from '../data';
import { go } from '../lib/router';
import { WorldMap } from '../components/WorldMap';
import { Flag } from '../components/Shape';
import { Page, Progress } from '../components/ui';
import { StatusBar } from './Home';

const ROW = 172;
// vertical spacing between path nodes
const SWING = 92; // horizontal swing of the winding path

export default function Learn() {
  const lessons = useGame((s) => s.lessons);
  const cards = useGame((s) => s.cards);
  // Open on the region with the most recent progress
  const [region, setRegion] = useState<Region>(() => {
    const done = REGIONS.map((r) => UNITS.filter((u) => u.region === r && lessons[u.id]).length);
    const best = done.indexOf(Math.max(...done));
    return done[best] > 0 ? REGIONS[best] : 'Europe';
  });
  const meta = REGION_META[region];
  const units = UNITS.filter((u) => u.region === region);
  const ids = useMemo(() => COUNTRIES.filter((c) => c.region === region).map((c) => c.id), [region]);
  // Frame the region without far-flung territories / antimeridian-crossers stretching the bounds
  const frame = useMemo(() => regionFrame(region), [region]);
  const fills = useMemo(() => {
    const f: Record<string, string> = {};
    for (const id of ids) {
      const m = mastery(cards, id);
      f[id] = m > 0 ? hexA(meta.color, 0.35 + m * 0.65) : hexA(meta.color, 0.16);
    }
    return f;
  }, [ids, cards, meta.color]);
  const regionMastery = ids.reduce((a, id) => a + mastery(cards, id), 0) / ids.length;
  const doneUnits = units.filter((u) => lessons[u.id]).length;
  const current = units.find((u) => !lessons[u.id] && unitUnlocked(u, lessons));

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">Atlas Path</h1>
      <p className="text-mist">Learn the world region by region — famous countries first, deep cuts later.</p>

      {/* Region tabs */}
      <div className="flex gap-2 overflow-x-auto scrollbar-none mt-4 -mx-4 px-4 pb-1">
        {REGIONS.map((r) => {
          const m = REGION_META[r];
          const a = r === region;
          const n = UNITS.filter((u) => u.region === r);
          const d = n.filter((u) => lessons[u.id]).length;
          return (
            <button key={r} onClick={() => setRegion(r)}
              className="relative shrink-0 rounded-2xl px-3.5 py-2 border-2 transition-colors text-left"
              style={{ borderColor: a ? m.color : 'rgba(83,120,200,.22)', background: a ? m.color + '22' : 'rgba(255,255,255,.04)' }}>
              <div className="display font-bold whitespace-nowrap" style={{ color: a ? m.color : undefined }}>{m.emoji} {r}</div>
              <div className="text-xs text-mist mono">{d}/{n.length} units</div>
            </button>
          );
        })}
      </div>

      {/* Region header with map */}
      <motion.div key={region} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card mt-4 overflow-hidden">
        <div className="h-44 sm:h-56 relative">
          <WorldMap detail="110" interactive={false} focus={frame} fills={fills} defaultFill="#18264a" showTiny={false} />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#121f3d] to-transparent pointer-events-none" />
        </div>
        <div className="px-4 pb-4 -mt-6 relative">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="display text-2xl font-extrabold" style={{ color: meta.color }}>{region}</div>
              <div className="text-sm text-mist">{meta.tagline} · {ids.length} countries</div>
            </div>
            <div className="text-right">
              <div className="display text-3xl font-extrabold mono">{Math.round(regionMastery * 100)}%</div>
              <div className="text-xs uppercase tracking-wider text-mist font-bold">mastered</div>
            </div>
          </div>
          <Progress value={regionMastery} color={meta.color} className="mt-3" h={8} />
          <div className="text-sm text-mist mt-2">{doneUnits}/{units.length} units complete</div>
        </div>
      </motion.div>

      {/* Winding path */}
      <div key={region + '-path'} className="relative mt-6 overflow-x-clip" style={{ height: units.length * ROW + 40 }}>
        <svg className="absolute left-1/2 top-0 -ml-[200px] pointer-events-none overflow-visible" width={400} height={units.length * ROW + 40} viewBox={`-200 0 400 ${units.length * ROW + 40}`}>
          <path d={trail(units.length)} fill="none" stroke="rgba(142,163,204,.18)" strokeWidth={10} strokeLinecap="round" strokeDasharray="2 18" />
          <motion.path d={trail(Math.max(1, doneUnits + (current ? 1 : 0)))} fill="none" stroke={meta.color} strokeOpacity={0.55} strokeWidth={10} strokeLinecap="round" strokeDasharray="2 18"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
        </svg>
        {units.map((u, i) => (
          <PathNode key={u.id} u={u} i={i} stars={lessons[u.id] ?? 0} unlocked={unitUnlocked(u, lessons)} isCurrent={current?.id === u.id} color={meta.color} emoji={meta.emoji} />
        ))}
      </div>
      <div className="text-center text-mist text-sm mt-4">🏁 Finish every unit to conquer {region}</div>
      <MoreToLearn />
    </Page>
  );
}

/** Region ids suitable for framing a map (drops far-flung territories / antimeridian-crossers). */
const xAt = (i: number) => Math.sin(i * 1.15) * SWING;
function trail(n: number) {
  let d = `M${xAt(0)} ${38}`;
  for (let i = 1; i < n; i++) {
    const y0 = (i - 1) * ROW + 38, y1 = i * ROW + 38;
    d += ` C${xAt(i - 1)} ${y0 + ROW / 2} ${xAt(i)} ${y1 - ROW / 2} ${xAt(i)} ${y1}`;
  }
  return d;
}

function PathNode({ u, i, stars, unlocked, isCurrent, color, emoji }: { u: Unit; i: number; stars: number; unlocked: boolean; isCurrent: boolean; color: string; emoji: string }) {
  const done = stars > 0;
  const x = xAt(i);
  return (
    <motion.div
      className="absolute left-1/2 flex flex-col items-center w-48 -ml-24"
      style={{ top: i * ROW, x }}
      initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06, type: 'spring', stiffness: 220, damping: 18 }}
    >
      {isCurrent && (
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}
          className="absolute -top-10 z-10 display font-extrabold text-xs px-3 py-1 rounded-xl text-ink" style={{ background: color }}>
          START
          <span className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-3 h-3 rotate-45" style={{ background: color }} />
        </motion.div>
      )}
      <button
        disabled={!unlocked}
        onClick={() => go('/lesson/' + u.id)}
        className={`relative w-[76px] h-[76px] rounded-full grid place-items-center text-3xl transition-transform active:translate-y-1 ${isCurrent ? 'glow-pulse' : ''}`}
        style={{
          background: !unlocked ? '#1a2848' : done ? color : `radial-gradient(circle at 35% 30%, ${color}, ${hexA(color, 0.55)})`,
          boxShadow: !unlocked ? '0 6px 0 #0d1730' : `0 6px 0 ${hexA(shade(color), 1)}, 0 0 ${isCurrent ? 30 : 0}px ${hexA(color, 0.5)}`,
          border: '4px solid rgba(255,255,255,.12)',
        }}
        aria-label={`${u.region} unit ${u.index + 1}: ${u.title}`}
      >
        {isCurrent && <span className="absolute -inset-2.5 rounded-full border-4 animate-ping opacity-30" style={{ borderColor: color }} />}
        <span className={unlocked ? '' : 'grayscale opacity-50'}>{!unlocked ? '🔒' : done ? '✓' : i === 0 ? emoji : u.index + 1}</span>
      </button>
      <div className="flex gap-0.5 mt-2 h-4">
        {[1, 2, 3].map((s) => (
          <span key={s} className={`text-sm leading-none ${s <= stars ? '' : 'opacity-20 grayscale'}`}>⭐</span>
        ))}
      </div>
      <div className={`display font-bold text-sm text-center leading-tight ${unlocked ? '' : 'text-mist/90'}`}>{u.title}</div>
      <div className={`flex gap-0.5 mt-1 ${unlocked ? '' : 'opacity-30 grayscale'}`}>
        {u.ids.slice(0, 6).map((id) => <Flag key={id} id={id} className="w-4 h-3 !rounded-[2px] !shadow-none" />)}
      </div>
    </motion.div>
  );
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.62).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** Beyond countries: every Explore pack has its own flashcards — surface them on the Learn tab too. */
function MoreToLearn() {
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const progress = useGame((s) => s.packs);
  useEffect(() => { loadPackIndex().then(setPacks); }, []);
  if (!packs.length) return null;
  const groups = (Object.keys(GROUP_META) as PackGroup[]).filter((g) => packs.some((p) => p.group === g));
  return (
    <section className="mt-10">
      <h2 className="display text-2xl font-extrabold">More to learn</h2>
      <p className="text-mist text-sm mt-1">States and provinces, rivers, seas, mountains and history maps — each pack has flashcards, then quizzes.</p>
      {groups.map((g) => (
        <div key={g} className="mt-5">
          <div className="display font-bold flex items-center gap-2">{GROUP_META[g].emoji} {GROUP_META[g].title}</div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {packs.filter((p) => p.group === g).map((p) => {
              const ps = progress[p.id];
              // Items never played count as 0, so average over the played ones and scale to the pack size.
              const played = ps ? [...new Set(Object.keys(ps.cards).map((k) => k.slice(0, k.lastIndexOf(':'))))] : [];
              const m = played.length ? (packMastery(ps, played) * played.length) / Math.max(played.length, p.count) : 0;
              return (
                <button key={p.id} onClick={() => go(`/pack/${p.id}/learn`)} className="card !rounded-2xl p-3 text-left hover:border-amber/60">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{p.emoji}</span>
                    <span className="display font-bold leading-tight">{p.title}</span>
                  </div>
                  <div className="text-sm text-mist mt-1 leading-snug">{p.subtitle}</div>
                  <div className="h-1.5 rounded-full mt-2" style={{ background: `linear-gradient(90deg, ${p.color} ${m * 100}%, rgba(255,255,255,.1) ${m * 100}%)` }} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
