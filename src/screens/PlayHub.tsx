import { useState } from 'react';
import { motion } from 'framer-motion';
import { MODES } from '../lib/modes';
import { go } from '../lib/router';
import { REGIONS } from '../data';
import { useGame } from '../lib/store';
import { Page, SectionTitle } from '../components/ui';
import { StatusBar } from './Home';
import { GROUP_META } from '../lib/packs';

export default function PlayHub() {
  const [region, setRegion] = useState<string>('');
  const [typed, setTyped] = useState(false);
  const bests = useGame((s) => s.bests);
  const q = () => { const p = new URLSearchParams(); if (region) p.set('region', region); if (typed) p.set('typed', '1'); const s = p.toString(); return s ? '?' + s : ''; };

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">Play</h1>
      <p className="text-mist">Every answer sharpens your IQ. Questions adapt to your level.</p>

      <div className="card p-3 mt-4 space-y-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {['', ...REGIONS].map((r) => (
            <button key={r} onClick={() => setRegion(r)} className={`chip !py-1.5 !px-3 !text-sm whitespace-nowrap ${region === r ? '!bg-amber !text-ink !border-amber' : ''}`}>{r || '🌍 World'}</button>
          ))}
        </div>
        <label className="flex items-center justify-between gap-3 text-sm cursor-pointer select-none">
          <span><b className="display">Type answers</b> <span className="text-mist">— no multiple choice, bigger IQ gains</span></span>
          <button onClick={() => setTyped(!typed)} className={`w-12 h-7 rounded-full p-1 transition-colors ${typed ? 'bg-mint' : 'bg-white/10'}`}>
            <motion.span layout className="block w-5 h-5 rounded-full bg-white" style={{ marginLeft: typed ? 20 : 0 }} />
          </button>
        </label>
      </div>

      <SectionTitle>Specials</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Special onClick={() => go('/test')} e="🧠" t="IQ Test" d="24 adaptive questions. Official score." c="#ffb547" />
        <Special onClick={() => go('/daily')} e="☀️" t="Daily Challenge" d="Same 5 for everyone" c="#53b8ff" />
        <Special onClick={() => go('/hotcold')} e="🌡️" t="Hot & Cold" d={`Find the mystery country by distance${bests.hotcold ? ` · best ${bests.hotcold}` : ''}`} c="#ff6b5e" />
        <Special onClick={() => go('/borderline')} e="🛤️" t="Borderline" d="Cross borders from A to B" c="#3ddc97" />
        <Special onClick={() => go('/crossword')} e="🧩" t="Crosswords" d="Daily grid, or build your own from any topic" c="#b48cff" />
        <Special onClick={() => go('/mp')} e="⚔️" t="Multiplayer" d="Live rooms with friends, or send a challenge" c="#ff5d73" />
      </div>

      <SectionTitle sub={<button className="text-sky" onClick={() => go('/packs')}>All packs →</button>}>Explore more</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(['regions', 'physical', 'history', 'culture'] as const).map((g) => (
          <button key={g} onClick={() => go('/packs')} className="card p-4 text-left flex sm:flex-col items-center sm:items-start gap-3 hover:border-amber/60 transition-colors">
            <span className="text-3xl">{GROUP_META[g].emoji}</span>
            <span><span className="display font-bold block">{GROUP_META[g].title}</span><span className="text-sm text-mist">{GROUP_META[g].blurb}</span></span>
          </button>
        ))}
      </div>

      <SectionTitle>Game modes</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-3">
        {MODES.map((m, i) => (
          <motion.button key={m.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            onClick={() => go(`/play/${m.key}${q()}`)}
            className="card p-4 flex items-center gap-4 text-left hover:border-amber/50 transition-colors group">
            <div className="w-14 h-14 shrink-0 rounded-2xl grid place-items-center text-2xl font-bold transition-transform group-hover:scale-110 group-hover:-rotate-6"
              style={{ background: m.color + '22', color: m.color, border: `2px solid ${m.color}66` }}>{m.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="display font-bold text-lg">{m.title}</span>{m.tag && <span className="text-xs uppercase tracking-wider text-mist border border-line rounded px-1.5">{m.tag}</span>}</div>
              <div className="text-sm text-mist">{m.desc}</div>
              {m.rush && bests[m.key] != null && <div className="text-xs text-amber mt-0.5">🏆 Best: {bests[m.key]}</div>}
            </div>
          </motion.button>
        ))}
      </div>
    </Page>
  );
}

function Special({ e, t, d, c, onClick }: { e: string; t: string; d: string; c: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card p-4 text-left relative overflow-hidden group">
      <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full opacity-20 group-hover:opacity-40 transition-opacity" style={{ background: `radial-gradient(circle, ${c} 0%, transparent 68%)` }} />
      <div className="relative text-3xl">{e}</div>
      <div className="relative display font-bold mt-1">{t}</div>
      <div className="relative text-sm text-mist leading-snug">{d}</div>
    </button>
  );
}
