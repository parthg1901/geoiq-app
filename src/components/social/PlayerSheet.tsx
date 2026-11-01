/** Tap-anyone profile: opened from rooms, results, chat, challenges, the leaderboard and friends. */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../../lib/store';
import { tierFor } from '../../lib/iq';
import { todayKey, dayDiff } from '../../lib/rng';
import { ACHIEVEMENTS } from '../../lib/achievements';
import { COUNTRIES } from '../../data';
import { onBack } from '../../lib/native';
import { useSocial, closePlayer, getCard, addFriend, removeFriend, respond, ensureProfile, buildCard, weekXp } from '../../lib/social';
import { formatPid, type PlayerCard } from '../../lib/social/protocol';
import { WorldMap } from '../WorldMap';
import { askConfirm } from '../Confirm';
import { toast } from '../Toasts';

/** Wrap a player's name/avatar so tapping opens their profile (plain when they have none). */
export function PlayerLink({ pid, children, className = '' }: { pid?: string; children: React.ReactNode; className?: string }) {
  if (!pid) return <span className={className}>{children}</span>;
  return <button type="button" className={`text-left ${className}`} onClick={(e) => { e.stopPropagation(); useSocial.setState({ open: pid }); }}>{children}</button>;
}

const lastSeen = (d: string | null) => {
  if (!d) return 'not played yet';
  const n = dayDiff(d, todayKey());
  return n <= 0 ? 'played today' : n === 1 ? 'played yesterday' : `last played ${n} days ago`;
};

export default function PlayerSheet() {
  const pid = useSocial((s) => s.open);
  return createPortal(<AnimatePresence>{pid && <Sheet key={pid} pid={pid} />}</AnimatePresence>, document.body);
}

function Sheet({ pid }: { pid: string }) {
  const cached = useSocial((s) => s.cards[pid]);
  const me = useSocial((s) => s.me);
  const social = useGame((s) => s.social);
  const myState = useGame();
  const [card, setCard] = useState<PlayerCard | null>(cached ?? null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => onBack(closePlayer), []);
  useEffect(() => { window.addEventListener('hashchange', closePlayer); return () => window.removeEventListener('hashchange', closePlayer); }, []);
  useEffect(() => {
    getCard(pid, true).then(setCard).catch((e) => { if (!useSocial.getState().cards[pid]) setErr(e.message); });
  }, [pid]);

  const isMe = social?.pid === pid;
  const mine = useMemo(() => (social && !isMe ? buildCard(myState, social.pid) : null), [social, isMe, myState]);
  const friend = !!me?.friends.includes(pid);
  const asked = !!me?.outgoing.includes(pid);
  const theyAsked = !!me?.requests.some((r) => r.pid === pid);

  const doAct = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) toast({ icon: '👥', title: done }); }
    catch (e) { toast({ icon: '⚠️', title: 'Couldn’t do that', body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const add = () => doAct(async () => { await ensureProfile(); await addFriend(pid, 'request'); }, 'Friend request sent');

  const tier = card ? tierFor(card.iq) : null;
  const fills = useMemo(() => Object.fromEntries((card?.stamps ?? []).map((id) => [id, '#ffb547'])), [card]);
  const achs = ACHIEVEMENTS.filter((a) => card?.achievements.includes(a.id));

  const stats: [string, React.ReactNode, React.ReactNode?][] = card ? [
    ['Level', card.level, mine?.level],
    ['IQ', card.iq, mine?.iq],
    ['Streak', <>{card.streak}🔥</>, mine && <>{mine.streak}🔥</>],
    ['Stamps', `${card.stamps.length}/${COUNTRIES.length}`, mine?.stamps.length],
    ['This week', `${weekXp(card).toLocaleString()} XP`, mine && weekXp(mine).toLocaleString()],
    ['Accuracy', `${card.accuracy}%`, mine && `${mine.accuracy}%`],
    ['Duel rating', card.duel.rating, mine?.duel.rating],
    ['Duels won', `${card.duel.wins}/${card.duel.matches}`, mine && `${mine.duel.wins}/${mine.duel.matches}`],
  ] : [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-ink/80 flex items-end sm:items-center justify-center" onClick={closePlayer}>
      <motion.div initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="card w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-b-none sm:rounded-b-[26px] p-5" style={{ paddingBottom: 'max(var(--sab), 20px)' }} onClick={(e) => e.stopPropagation()}>
        {!card ? (
          <div className="py-10 text-center text-mist">{err || 'Loading profile…'}</div>
        ) : (<>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl grid place-items-center text-3xl border-2 shrink-0" style={{ borderColor: tier!.color, background: tier!.color + '22' }}>{tier!.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="display text-2xl font-extrabold leading-tight break-words">{card.name}{isMe && <span className="text-mist text-base"> (you)</span>}</div>
              <div className="text-sm" style={{ color: tier!.color }}>{tier!.name} · IQ <b className="mono">{card.iq}</b></div>
              <div className="text-xs text-mist mt-0.5">{lastSeen(card.lastActive)} · since {card.since}</div>
            </div>
            <button aria-label="Close" className="text-mist text-2xl self-start -mt-1" onClick={closePlayer}>×</button>
          </div>

          <div className="grid grid-cols-4 gap-2 mt-4">
            {stats.map(([k, v, you]) => (
              <div key={k} className="rounded-xl bg-white/5 border border-line/60 px-1 py-2 text-center">
                <div className="display font-extrabold text-sm sm:text-base leading-tight">{v}</div>
                <div className="text-[10px] uppercase tracking-wider text-mist font-semibold mt-0.5 leading-tight">{k}</div>
                {you != null && <div className="text-[10px] text-mist/80 mono mt-0.5">you {you}</div>}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl overflow-hidden border border-line/60 aspect-[1.92]">
            <WorldMap fills={fills} defaultFill="#24365f" interactive={false} detail="110" showTiny={false} />
          </div>
          <div className="text-xs text-mist mt-1.5">Passport · {card.stamps.length} {card.stamps.length === 1 ? 'country' : 'countries'} stamped</div>

          {achs.length > 0 && (<>
            <div className="display font-bold mt-4">Achievements <span className="text-mist text-sm font-normal">{achs.length}/{ACHIEVEMENTS.length}</span></div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {achs.map((a) => <span key={a.id} title={`${a.name} — ${a.desc}`} className="w-10 h-10 rounded-xl bg-white/5 border border-amber/30 grid place-items-center text-xl">{a.icon}</span>)}
            </div>
          </>)}

          <div className="text-xs text-mist mt-4 mono">Friend code {formatPid(card.pid)}</div>
          {!isMe && (
            <div className="mt-3">
              {friend ? (
                <div className="flex items-center gap-3">
                  <span className="chip !text-mint !border-mint/50">✓ Friends</span>
                  <button className="text-sm text-mist underline ml-auto" disabled={busy}
                    onClick={() => void askConfirm(`Remove ${card.name} from your friends?`, { confirm: 'Remove' }).then((ok) => { if (ok) void doAct(() => removeFriend(pid), 'Friend removed'); })}>Remove friend</button>
                </div>
              ) : theyAsked ? (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary" disabled={busy} onClick={() => doAct(() => respond(pid, true), `You and ${card.name} are friends`)}>Accept request</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => doAct(() => respond(pid, false))}>Decline</button>
                </div>
              ) : asked ? (
                <div className="chip">⏳ Friend request sent</div>
              ) : (
                <button className="btn btn-primary w-full" disabled={busy} onClick={add}>{busy ? '…' : '➕ Add friend'}</button>
              )}
            </div>
          )}
        </>)}
      </motion.div>
    </motion.div>
  );
}
