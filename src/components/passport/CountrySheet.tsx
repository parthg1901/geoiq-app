import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { BY_ID, fmtPop, fmtArea } from '../../data';
import { useGame, mastery, CORE } from '../../lib/store';
import { SKILL_LABEL } from '../../lib/geoiq';
import { makeQuestion, eligible, type Variant } from '../../lib/questions';
import { go } from '../../lib/router';
import { onBack } from '../../lib/native';
import { shuffle } from '../../lib/rng';
import { Flag, Shape } from '../Shape';
import { QuizRunner } from '../QuizRunner';
import { toast } from '../Toasts';
import { Stamp } from './Stamp';

const PRACTICE: Variant[] = ['shape', 'flag', 'map-find', 'capital'];

export function CountrySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const c = BY_ID[id];
  const cards = useGame((s) => s.cards);
  const stamped = useGame((s) => s.stamps[id]);
  const [practice, setPractice] = useState<ReturnType<typeof makeQuestion>[] | null>(null);
  useEffect(() => onBack(() => (practice ? setPractice(null) : onClose())), [practice, onClose]);
  const m = mastery(cards, id);

  if (practice) {
    return createPortal(
      <div className="fixed inset-0 z-50 atlas-bg overflow-y-auto safe-top">
        <QuizRunner
          title="Country drill"
          questions={practice}
          practice
          hideSummary
          onQuit={() => setPractice(null)}
          onDone={(r) => {
            const right = r.filter((x) => x.outcome >= 0.6).length;
            toast({ icon: right === r.length ? '🎯' : '📚', title: `${right}/${r.length} on ${c.name}`, body: right === r.length ? 'Memory strengthened.' : 'Keep at it — it will come back.' });
            setPractice(null);
          }}
        />
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-ink/85 flex items-end sm:items-center justify-center" onClick={onClose}>
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-deep border-t-4 border-amber/70 px-5 pt-3 pb-6 safe-bottom"
      >
        <div className="mx-auto w-12 h-1.5 rounded-full bg-white/15 mb-3" />
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <Shape id={id} size={110} color={stamped ? 'var(--color-amber)' : 'var(--color-sky)'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><Flag id={id} className="w-10 h-7 !rounded" /></div>
            <div className="display text-2xl font-extrabold mt-1 leading-tight">{c.name}</div>
            <div className="text-sm text-mist">{c.subregion}</div>
            <div className="text-sm mt-1 flex flex-wrap gap-x-3"><span>★ {c.capital || '—'}</span><span>👥 {fmtPop(c.population)}</span><span>{fmtArea(c.area)}</span></div>
          </div>
          {stamped && <div className="shrink-0 -mr-1 -mt-1"><Stamp id={id} date={stamped} size={72} /></div>}
        </div>
        <p className="text-sm text-mist mt-3 leading-relaxed">{c.fact}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="display font-bold">Memory</div>
          <div className="mono text-sm text-mist">{Math.round(m * 100)}% mastered</div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-2">
          {CORE.map((sk) => {
            const box = cards[`${id}:${sk}`]?.box ?? 0;
            const seen = cards[`${id}:${sk}`]?.seen ?? 0;
            return (
              <div key={sk} className="card !rounded-2xl p-2 text-center">
                <div className="text-xs uppercase tracking-wider text-mist font-bold">{SKILL_LABEL[sk]}</div>
                <div className="flex justify-center gap-0.5 mt-1.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className="w-2.5 h-4 rounded-sm" style={{ background: i < box ? (box >= 3 ? 'var(--color-amber)' : 'var(--color-sky)') : 'rgba(255,255,255,.08)' }} />
                  ))}
                </div>
                <div className="text-xs text-mist mt-1">{seen ? `${seen} seen` : 'new'}</div>
              </div>
            );
          })}
        </div>
        <div className="text-sm text-mist mt-2 leading-snug">Reach 3+ bars on all four skills to earn this country's passport stamp.</div>

        <button className="btn btn-ghost w-full mt-5" onClick={() => { onClose(); go('/country/' + id); }}>📖 Full country profile</button>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => setPractice(shuffle(PRACTICE.filter((v) => eligible(c, v)).map((v) => makeQuestion(id, v))))}>Practice {c.name.length > 12 ? 'it' : c.name}</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
