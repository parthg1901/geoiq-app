import { useState } from 'react';
import { motion } from 'framer-motion';
import type { SavedCrossword } from '../../lib/store';
import { dailyNumber } from '../../lib/daily';
import { BY_ID } from '../../data';
import { CountryProfile } from '../CountryProfile';
import { ClueImage } from './ClueImage';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Country id behind a crossword entry, if it's about a country (so we can open its profile). */
const countryOf = (entryId: string) => {
  const [src, id] = entryId.split(':');
  return ['countries', 'flags', 'shapes', 'capitals'].includes(src) && BY_ID[id] ? id : null;
};

export function CrosswordDone({ saved, reward, onExit, onNew }: {
  saved: SavedCrossword; reward: { xp: number; coins: number; best: boolean } | null; onExit: () => void; onNew: () => void;
}) {
  const [about, setAbout] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isDaily = saved.key.startsWith('daily:');
  const clean = saved.reveals === 0;
  const share = async () => {
    const title = isDaily ? `Geonaut Crossword #${dailyNumber(saved.key.slice(6))}` : `Geonaut ${saved.title}`;
    const text = `${title} ✅ ${fmt(saved.elapsed)} · ${clean ? 'no help 🧠' : `${saved.reveals} reveal${saved.reveals === 1 ? '' : 's'}`}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); }
    } catch {
      try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* ignore */ }
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 min-h-dvh">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center mt-4">
        <div className="text-6xl">🧩</div>
        <h1 className="display text-3xl font-extrabold mt-2">Crossword complete!</h1>
        <div className="text-mist mt-1">{saved.title}</div>
      </motion.div>

      <div className="grid grid-cols-3 gap-3 mt-6">
        {[
          ['Time', fmt(saved.elapsed), reward?.best ? '🏆 Best time' : null],
          ['Words', String(saved.cw.words.length), null],
          ['Help used', clean ? 'None' : `${saved.reveals} reveal${saved.reveals === 1 ? '' : 's'}`, saved.checks ? `${saved.checks} check${saved.checks === 1 ? '' : 's'}` : null],
        ].map(([k, v, sub]) => (
          <div key={k} className="card p-3 text-center">
            <div className="display text-2xl font-extrabold">{v}</div>
            <div className="text-xs uppercase tracking-wider text-mist font-semibold mt-1">{k}</div>
            {sub && <div className="text-xs text-amber mt-0.5">{sub}</div>}
          </div>
        ))}
      </div>
      {reward && <div className="text-center mt-3"><span className="chip !text-amber !border-amber/50">+{reward.xp} XP · +{reward.coins} 🪙</span></div>}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button className="btn btn-ghost" onClick={share}>{copied ? 'Copied!' : '📤 Share'}</button>
        <button className="btn btn-primary" onClick={onNew}>New crossword</button>
      </div>

      <h2 className="display text-xl font-bold mt-8 mb-2">The answers</h2>
      <p className="text-sm text-mist mb-3">Tap a country to read its profile.</p>
      <div className="space-y-1.5">
        {saved.cw.words.map((w, i) => {
          const cid = countryOf(w.id);
          return (
            <button key={i} disabled={!cid} onClick={() => cid && setAbout(cid)}
              className={`w-full text-left card !rounded-2xl px-3 py-2.5 flex gap-3 items-center ${cid ? 'hover:border-amber/60' : 'cursor-default'}`}>
              <span className="mono font-bold text-amber w-10 shrink-0 text-sm">{w.num}{w.dir === 'across' ? 'A' : 'D'}</span>
              {w.clue.image && <ClueImage clue={w.clue} size={36} />}
              <span className="flex-1 min-w-0">
                <span className="display font-bold block">{w.display}{cid && ' →'}</span>
                <span className="text-sm text-mist leading-snug">{w.clue.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button className="btn btn-ghost w-full mt-6" onClick={onExit}>Back to crosswords</button>
      {about && <CountryProfile id={about} onClose={() => setAbout(null)} />}
    </div>
  );
}
