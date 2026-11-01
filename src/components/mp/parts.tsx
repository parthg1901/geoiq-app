/** Shared multiplayer UI pieces: topic picker, steppers, question renderer, scoreboard, podium. */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { loadTopics, topicLabel, answerName, type MpQuestion, type TopicMeta } from '../../lib/mp/questions';
import { loadPack, type PackData } from '../../lib/packs';
import { QuestionView } from '../QuizRunner';
import { Ask } from '../pack/PackQuiz';
import { Flag } from '../Shape';
import { onBack } from '../../lib/native';
import { BY_ID } from '../../data';
import type { Player, RoundAnswer, Topic } from '../../lib/mp/protocol';
import { serverNow } from '../../lib/mp/room';
import { PlayerLink } from '../social/PlayerSheet';

/* ---------------- topic picker ---------------- */

export function TopicPicker({ value, onChange, disabled }: { value: Topic; onChange: (t: Topic) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [, rerender] = useState(0);
  useEffect(() => { loadTopics().then((t) => { setTopics(t); rerender((x) => x + 1); }); }, []);
  useEffect(() => (open ? onBack(() => setOpen(false)) : undefined), [open]);
  const groups = useMemo(() => {
    const g: Record<string, TopicMeta[]> = {};
    for (const t of topics) (g[t.group] ??= []).push(t);
    return Object.entries(g);
  }, [topics]);
  return (
    <>
      <button disabled={disabled} onClick={() => setOpen(true)}
        className="w-full rounded-2xl border-2 border-line bg-ink/60 px-4 py-3 text-left flex items-center gap-3 hover:border-amber/60 disabled:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-mist font-bold">Topic</div>
          <div className="display font-bold leading-snug break-words">{topicLabel(value)}</div>
        </div>
        {!disabled && <span className="text-amber font-bold shrink-0">Change</span>}
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[60] bg-ink/90 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-deep border-t-4 border-amber/70 px-5 pt-3"
            style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}>
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/15 mb-3" />
            <div className="display text-xl font-extrabold mb-2">Pick a topic</div>
            {!topics.length && <div className="text-mist py-6">Loading topics…</div>}
            {groups.map(([g, ts]) => (
              <div key={g} className="mt-3">
                <div className="text-xs uppercase tracking-wider text-mist font-bold mb-1.5">{g}</div>
                <div className="grid gap-1.5">
                  {ts.map((t) => (
                    <button key={t.topic} onClick={() => { onChange(t.topic); setOpen(false); }}
                      className={`rounded-xl px-3 py-2.5 text-left border flex items-center gap-2.5 ${t.topic === value ? 'border-amber bg-amber/15 text-amber' : 'border-line/60 bg-white/5 hover:border-sky/60'}`}>
                      <span className="w-6 text-center shrink-0">{t.emoji}</span>
                      <span className="font-semibold leading-snug">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        </div>, document.body)}
    </>
  );
}

export function Stepper({ label, value, min, max, step = 1, unit = '', onChange, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line/60 bg-white/5 px-3 py-2">
      <div className="text-xs uppercase tracking-wider text-mist font-bold">{label}</div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <button aria-label={`Fewer ${label}`} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))}
          className="w-9 h-9 rounded-full bg-white/5 border border-line text-lg disabled:opacity-30">−</button>
        <span className="display text-xl font-extrabold mono">{value}{unit}</span>
        <button aria-label={`More ${label}`} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))}
          className="w-9 h-9 rounded-full bg-white/5 border border-line text-lg disabled:opacity-30">+</button>
      </div>
    </div>
  );
}

/* ---------------- questions ---------------- */

/** Pack data for a pack question (cached by loadPack). */
export function usePackFor(q: MpQuestion | undefined) {
  const [pack, setPack] = useState<PackData | null>(null);
  const id = q?.kind === 'pack' ? q.pack : null;
  useEffect(() => { let live = true; if (id) loadPack(id).then((p) => live && setPack(p)); return () => { live = false; }; }, [id]);
  return q?.kind === 'pack' && pack?.meta.id === id ? pack : null;
}

/** Renders a multiplayer question with the app's normal question UI. */
export function MpQuestionView({ q, locked, onAnswer }: { q: MpQuestion; locked: boolean; onAnswer: (outcome: number) => void }) {
  const pack = usePackFor(q);
  const byId = useMemo(() => Object.fromEntries(pack?.items.map((it) => [it.id, it]) ?? []), [pack]);
  if (q.kind === 'world') return <QuestionView q={q.q} locked={locked} onAnswer={(o) => onAnswer(o)} regionFocus={null} rush={false} />;
  if (!pack) return <div className="flex-1 grid place-items-center text-mist">Loading…</div>;
  return <Ask pack={pack} q={q.q} locked={locked} onAnswer={onAnswer} byId={byId} />;
}

/** "Brazil" with its flag, for reveal cards. */
export function AnswerLabel({ q }: { q: MpQuestion }) {
  const [name, setName] = useState('');
  useEffect(() => { let live = true; answerName(q).then((n) => live && setName(n)); return () => { live = false; }; }, [q]);
  return (
    <span className="inline-flex items-center gap-2">
      {q.kind === 'world' && BY_ID[q.q.id] && <Flag id={q.q.id} className="w-8 h-5 !rounded-sm" />}
      <span className="display font-extrabold break-words">{name}</span>
    </span>
  );
}

/* ---------------- timing ---------------- */

/** Server-synchronised clock that re-renders every `ms`. */
export function useServerNow(ms = 100) {
  const [t, setT] = useState(serverNow);
  useEffect(() => { const h = setInterval(() => setT(serverNow()), ms); return () => clearInterval(h); }, [ms]);
  return t;
}

export function TimerBar({ left, total }: { left: number; total: number }) {
  const f = Math.max(0, Math.min(1, left / total));
  const col = f < 0.25 ? 'var(--color-rose)' : f < 0.5 ? 'var(--color-amber)' : 'var(--color-mint)';
  return (
    <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
      <div className="h-full rounded-full" style={{ width: `${f * 100}%`, background: col, transition: 'width .1s linear, background .3s' }} />
    </div>
  );
}

/* ---------------- people ---------------- */

const COLORS = ['#ffb547', '#53b8ff', '#3ddc97', '#ff6b5e', '#b48cff', '#ff5d73', '#9fe7ff', '#f2e05c'];
export const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

export function Avatar({ p, size = 36, dim = false, badge }: { p: Pick<Player, 'id' | 'name'>; size?: number; dim?: boolean; badge?: React.ReactNode }) {
  return (
    <span className="relative inline-grid place-items-center rounded-full display font-extrabold text-ink shrink-0"
      style={{ width: size, height: size, background: colorFor(p.id), opacity: dim ? 0.35 : 1, fontSize: size * 0.42 }}>
      {p.name.slice(0, 1).toUpperCase()}
      {badge && <span className="absolute -right-1 -bottom-1 text-xs">{badge}</span>}
    </span>
  );
}

/** Animated leaderboard; shows this round's points when given. */
export function Scoreboard({ players, you, round, detail }: { players: Player[]; you: string | null; round?: Record<string, RoundAnswer>; detail?: (p: Player) => React.ReactNode }) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {sorted.map((p, i) => {
          const pts = round?.[p.id]?.points;
          return (
            <motion.div key={p.id} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`rounded-2xl px-3 py-2.5 flex items-center gap-3 border ${p.id === you ? 'border-amber/70 bg-amber/10' : 'border-line/60 bg-white/5'}`}>
              <span className="mono w-6 text-center font-bold text-mist">{i + 1}</span>
              <PlayerLink pid={p.pid}><Avatar p={p} size={32} dim={!p.connected} /></PlayerLink>
              <div className="min-w-0 flex-1">
                <PlayerLink pid={p.pid} className="font-bold leading-tight break-words block">{p.name}{p.id === you ? ' (you)' : ''}</PlayerLink>
                {detail && <div className="text-xs text-mist">{detail(p)}</div>}
                {!p.connected && <div className="text-xs text-mist">reconnecting…</div>}
              </div>
              {pts != null && (
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className={`chip mono ${pts > 0 ? '!text-mint !border-mint/50' : '!text-rose !border-rose/40'}`}>+{pts}</motion.span>
              )}
              <span className="mono display font-extrabold text-lg w-16 text-right">{p.score.toLocaleString()}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Podium({ players }: { players: Player[] }) {
  const top = [...players].sort((a, b) => b.score - a.score).slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean) as Player[];
  const h = (p: Player) => (p === top[0] ? 120 : p === top[1] ? 88 : 64);
  const medal = (p: Player) => (p === top[0] ? '🥇' : p === top[1] ? '🥈' : '🥉');
  return (
    <div className="flex items-end justify-center gap-3 mt-4">
      {order.map((p, i) => (
        <motion.div key={p.id} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.15, type: 'spring' }}
          className="flex flex-col items-center w-24">
          <div className="text-2xl">{medal(p)}</div>
          <PlayerLink pid={p.pid} className="flex flex-col items-center">
            <Avatar p={p} size={44} />
            <div className="font-bold text-sm mt-1 text-center break-words leading-tight">{p.name}</div>
          </PlayerLink>
          <div className="mono text-sm text-mist">{p.score.toLocaleString()}</div>
          <div className="w-full rounded-t-2xl mt-1.5 border border-line/60" style={{ height: h(p), background: `linear-gradient(180deg, ${colorFor(p.id)}55, ${colorFor(p.id)}11)` }} />
        </motion.div>
      ))}
    </div>
  );
}
