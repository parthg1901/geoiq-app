import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../lib/store';
import { freshRatings, fromIQ, type Ratings } from '../lib/geoiq';
import { go } from '../lib/router';
import { Globe } from '../components/Globe';
import { Shape } from '../components/Shape';

const LEVELS = [
  { label: 'Total beginner', sub: 'I mix up Austria and Australia', iq: 88, e: '🐣' },
  { label: 'Casual', sub: 'I know the big ones', iq: 100, e: '🙂' },
  { label: 'Geography buff', sub: 'Flags & capitals are my thing', iq: 112, e: '🤓' },
  { label: 'Shorts-level', sub: 'Name a country from a coastline', iq: 124, e: '🧠' },
];
const SAMPLE = ['ITA', 'JPN', 'CHL', 'NOR', 'MDG', 'IND', 'GRC', 'NZL'];

export default function Onboarding() {
  const set = useGame((s) => s.set);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [shapeI, setShapeI] = useState(0);

  const finish = (iq: number) => {
    // Seed ratings from the self-assessment (low confidence: n stays 0 so the first answers move it fast).
    const r = freshRatings();
    const theta = fromIQ(iq);
    for (const k of Object.keys(r) as (keyof Ratings)[]) r[k] = { theta, n: 0 };
    set({ ratings: r, name: name.trim() || 'Explorer', onboarded: true });
    go('/');
  };

  return (
    <div className="relative z-10 min-h-dvh mx-auto max-w-md px-6 py-10 flex flex-col">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="0" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex-1 flex flex-col items-center text-center">
            <div className="mt-6"><Globe size={260} /></div>
            <h1 className="display text-5xl font-extrabold mt-6 tracking-tight">Geo<span className="text-amber">IQ</span></h1>
            <p className="text-mist text-lg mt-3">Learn every country by its <b className="text-paper">shape</b>, <b className="text-paper">flag</b>, <b className="text-paper">place</b> and <b className="text-paper">clues</b> — and find out exactly how good you are.</p>
            <button className="btn btn-primary w-full mt-auto text-lg" onClick={() => setStep(1)}>Start exploring</button>
          </motion.div>
        )}
        {step === 1 && (
          <motion.div key="1" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex-1 flex flex-col">
            <h2 className="display text-3xl font-extrabold">How it works</h2>
            <div className="space-y-3 mt-6">
              {[
                ['◆', 'Train', 'Shapes, flags, maps, capitals, photo clues — short adaptive rounds.'],
                ['🧠', 'Remember', 'Spaced repetition brings back what you’re about to forget.'],
                ['📈', 'Measure', 'Every answer updates your GeoIQ — an IQ-style score. 100 is average.'],
                ['🔥', 'Keep it up', 'Streaks, daily challenges, a passport to fill, and a few surprises.'],
              ].map(([e, t, d], i) => (
                <motion.div key={t} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }} className="card p-4 flex gap-4 items-center">
                  <div className="text-2xl w-10 text-center">{e}</div>
                  <div><div className="display font-bold">{t}</div><div className="text-sm text-mist">{d}</div></div>
                </motion.div>
              ))}
            </div>
            <div className="mt-6 flex justify-center" onClick={() => setShapeI((i) => (i + 1) % SAMPLE.length)}>
              <Shape id={SAMPLE[shapeI]} size={120} />
            </div>
            <div className="text-center text-sm text-mist">tap the shape · recognise it?</div>
            <button className="btn btn-primary w-full mt-auto text-lg" onClick={() => setStep(2)}>Next</button>
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="2" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex-1 flex flex-col">
            <h2 className="display text-3xl font-extrabold">What should we call you?</h2>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Explorer name" maxLength={20}
              className="mt-6 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-4 text-xl display" />
            <h3 className="display text-xl font-bold mt-8">Where are you starting from?</h3>
            <p className="text-sm text-mist">Just a starting point — your GeoIQ calibrates itself as you play.</p>
            <div className="space-y-2 mt-4">
              {LEVELS.map((l) => (
                <button key={l.label} onClick={() => finish(l.iq)} className="card w-full p-4 flex items-center gap-4 text-left hover:border-amber transition-colors">
                  <span className="text-2xl">{l.e}</span>
                  <div><div className="display font-bold">{l.label}</div><div className="text-sm text-mist">{l.sub}</div></div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
