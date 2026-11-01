import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { loadPackIndex, GROUP_META, type PackGroup, type PackMeta } from '../lib/packs';
import { useGame } from '../lib/store';
import { go } from '../lib/router';
import { Page, Ring } from '../components/ui';
import { StatusBar } from './Home';

/** Mastery % per pack without loading every pack file: share of cards at box ≥ 3, over the item count. */
function quickMastery(cards: Record<string, { box: number }> | undefined, count: number) {
  if (!cards || !count) return 0;
  const best: Record<string, number> = {};
  for (const [k, c] of Object.entries(cards)) { const id = k.slice(0, k.lastIndexOf(':')); best[id] = Math.max(best[id] ?? 0, Math.min(4, c.box) / 4); }
  return Math.min(1, Object.values(best).reduce((a, b) => a + b, 0) / count);
}

export default function Packs() {
  const [packs, setPacks] = useState<PackMeta[] | null>(null);
  const state = useGame((s) => s.packs);
  useEffect(() => { loadPackIndex().then(setPacks); }, []);
  const groups = (['regions', 'physical', 'history', 'culture'] as PackGroup[]).map((g) => ({ g, list: (packs ?? []).filter((p) => p.group === g) })).filter((x) => x.list.length);

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">Explore</h1>
      <p className="text-mist">States and provinces, rivers and peaks, the world map through history, and the world's languages and alphabets. Packs earn XP and keep your streak alive.</p>
      {!packs && <div className="text-mist mt-8 animate-pulse">Loading packs…</div>}
      {packs && !packs.length && <div className="card p-5 mt-6 text-mist">No packs installed yet.</div>}
      {groups.map(({ g, list }, gi) => (
        <section key={g} className="mt-7">
          <div className="flex items-end gap-2 mb-3">
            <span className="text-2xl">{GROUP_META[g].emoji}</span>
            <div><h2 className="display text-xl font-extrabold leading-tight">{GROUP_META[g].title}</h2><div className="text-sm text-mist">{GROUP_META[g].blurb}</div></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {list.map((p, i) => {
              const ps = state[p.id];
              const m = quickMastery(ps?.cards, p.count);
              const fresh = !ps || !ps.plays;
              return (
                <motion.button key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.05 + i * 0.03 }}
                  onClick={() => go('/pack/' + p.id)} className="card p-4 flex items-center gap-4 text-left hover:border-amber/60 transition-colors relative overflow-hidden">
                  <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${p.color}33 0%, transparent 68%)` }} />
                  <div className="w-14 h-14 shrink-0 rounded-2xl grid place-items-center text-3xl relative" style={{ background: p.color + '22', border: `2px solid ${p.color}66` }}>{p.emoji}</div>
                  <div className="flex-1 min-w-0 relative">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="display font-bold text-lg leading-tight">{p.title}</span>
                      {fresh && <span className="text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-coral/20 text-coral">New</span>}
                    </div>
                    <div className="text-sm text-mist">{p.subtitle}</div>
                  </div>
                  <Ring value={m} size={48} stroke={5} color={p.color}><span className="mono text-xs font-bold">{Math.round(m * 100)}%</span></Ring>
                </motion.button>
              );
            })}
          </div>
        </section>
      ))}
    </Page>
  );
}
