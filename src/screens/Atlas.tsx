import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { COUNTRIES, REGIONS, fmtPop, searchCountries } from '../data';
import { useGame, mastery } from '../lib/store';
import { go } from '../lib/router';
import { countryOfDay } from '../lib/daily';
import { Page } from '../components/ui';
import { Flag } from '../components/Shape';
import { StatusBar } from './Home';

type Sort = 'name' | 'population' | 'area';

export default function Atlas() {
  const cards = useGame((s) => s.cards);
  const stamps = useGame((s) => s.stamps);
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const cotd = countryOfDay();

  const list = useMemo(() => {
    let l = q.trim() ? searchCountries(q, 200) : COUNTRIES.slice();
    if (region) l = l.filter((c) => c.region === region);
    if (!q.trim()) l.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'population' ? (b.population ?? 0) - (a.population ?? 0) : b.area - a.area));
    return l;
  }, [q, region, sort]);

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">World Atlas</h1>
      <p className="text-mist">Every country's full profile — facts, people, economy, culture, food and photos.</p>

      <button onClick={() => go('/country/' + cotd.id)} className="card w-full mt-4 p-4 flex items-center gap-4 text-left ring-2 ring-amber/50">
        <Flag id={cotd.id} className="w-16 aspect-[3/2] !rounded-md shrink-0" />
        <div className="flex-1"><div className="text-sm font-bold uppercase tracking-wider text-amber">Country of the day</div><div className="display text-xl font-bold">{cotd.name}</div></div>
        <span className="text-amber text-xl">→</span>
      </button>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 197 countries…"
        className="w-full mt-4 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3 text-lg display placeholder:text-mist/80" />
      <div className="flex gap-2 overflow-x-auto scrollbar-none mt-3">
        {['', ...REGIONS].map((r) => (
          <button key={r} onClick={() => setRegion(r)} className={`chip !py-1.5 !px-3 !text-sm whitespace-nowrap ${region === r ? '!bg-amber !text-ink !border-amber' : ''}`}>{r || '🌍 All'}</button>
        ))}
      </div>
      {!q.trim() && (
        <div className="flex gap-2 mt-2 text-sm items-center">
          <span className="text-mist">Sort:</span>
          {(['name', 'population', 'area'] as Sort[]).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`chip !text-sm ${sort === s ? '!border-sky text-sky' : ''}`}>{s === 'name' ? 'A–Z' : s === 'population' ? 'Population' : 'Size'}</button>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
        {list.map((c, i) => {
          const m = mastery(cards, c.id);
          return (
            <motion.button key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }}
              onClick={() => go('/country/' + c.id)} className="card !rounded-2xl p-3 flex items-center gap-3 text-left hover:border-amber/60 transition-colors">
              <Flag id={c.id} className="w-12 aspect-[3/2] !rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold leading-tight">{c.name} {stamps[c.id] && <span title="Stamped">🛂</span>}</div>
                <div className="text-sm text-mist">★ {c.capital || '—'} · {fmtPop(c.population)}</div>
              </div>
              <div className="w-10 h-1.5 rounded-full shrink-0" style={{ background: `linear-gradient(90deg, var(--color-amber) ${m * 100}%, rgba(255,255,255,.1) ${m * 100}%)` }} title={`${Math.round(m * 100)}% mastered`} />
            </motion.button>
          );
        })}
      </div>
      {!list.length && <div className="text-mist text-center mt-8">No country matches “{q}”.</div>}
    </Page>
  );
}
