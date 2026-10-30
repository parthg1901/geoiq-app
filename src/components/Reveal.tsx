import { useState } from 'react';
import { CountryProfile } from './CountryProfile';
import { motion } from 'framer-motion';
import { BY_ID, fmtPop } from '../data';
import { Flag, Shape } from './Shape';
import { Globe, zoomFor } from './Globe';

/** Bottom sheet shown after each answer: the "learn" moment. */
export function Reveal({ id, correct, partial, xp, iqDelta, stamp, onNext, nextLabel = 'Continue', extra }: {
  id: string; correct: boolean; partial?: boolean; xp: number; iqDelta: number; stamp?: boolean; onNext: () => void; nextLabel?: string; extra?: React.ReactNode;
}) {
  const c = BY_ID[id];
  const [about, setAbout] = useState(false);
  const tone = correct ? (partial ? 'amber' : 'mint') : 'rose';
  const color = { mint: 'var(--color-mint)', amber: 'var(--color-amber)', rose: 'var(--color-rose)' }[tone];
  return (
    <motion.div
      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="fixed inset-x-0 bottom-0 z-40 safe-bottom"
    >
      <div className="mx-auto max-w-2xl rounded-t-3xl border-t-4 bg-deep px-5 pt-4 pb-3 shadow-[0_-20px_60px_rgba(0,0,0,.5)]" style={{ borderColor: color }}>
        <div className="flex items-start gap-4">
          <div className="shrink-0 relative">
            <Globe size={112} zoom={zoomFor(id)} focus={id} spin={false} fills={{ [id]: color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="display text-lg font-extrabold" style={{ color }}>
                {correct ? (partial ? 'Got it!' : pickOne(['Nailed it!', 'Correct!', 'Sharp eye!', 'Brilliant!'])) : 'Not quite'}
              </span>
              {xp > 0 && <span className="chip !text-amber !border-amber/40">+{xp} XP</span>}
              {iqDelta !== 0 && <span className={`chip mono ${iqDelta > 0 ? '!text-mint' : '!text-rose'}`}>GeoIQ {iqDelta > 0 ? '+' : ''}{iqDelta}</span>}
              {stamp && <span className="chip !bg-violet/20 !border-violet text-violet">🛂 New passport stamp!</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Flag id={id} className="h-6 w-9 !rounded" />
              <span className="display text-2xl font-bold leading-tight break-words min-w-0">{c.name}</span>
            </div>
            <div className="text-sm text-mist mt-1 flex flex-wrap gap-x-3">
              <span>★ {c.capital || '—'}</span><span>{c.subregion}</span><span>👥 {fmtPop(c.population)}</span>
            </div>
          </div>
          <div className="hidden sm:block shrink-0 opacity-80"><Shape id={id} size={84} color={color} glow={false} /></div>
        </div>
        {extra}
        <div className="flex gap-2 mt-3">
          <button className="btn btn-ghost shrink-0 !px-4" onClick={() => setAbout(true)}>📖 About</button>
          <button autoFocus className={`btn flex-1 ${correct ? 'btn-mint' : 'btn-primary'}`} onClick={onNext}>{nextLabel} →</button>
        </div>
        {about && <CountryProfile id={id} onClose={() => setAbout(false)} />}
      </div>
    </motion.div>
  );
}

const pickOne = (a: string[]) => a[Math.floor(Math.random() * a.length)];
