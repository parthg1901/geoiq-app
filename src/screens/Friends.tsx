/** Friends: your friend code, adding friends, requests and the friends-only leaderboard. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '../lib/store';
import { useSocial, ensureProfile, publish, loadBoard, addFriend, respond, openPlayer, weekXp } from '../lib/social';
import { formatPid, normalizePid, type PlayerCard } from '../lib/social/protocol';
import { tierFor } from '../lib/geoiq';
import { COUNTRIES } from '../data';
import { Page, SectionTitle } from '../components/ui';
import { Avatar } from '../components/mp/parts';
import { toast } from '../components/Toasts';
import { StatusBar } from './Home';

const BOARDS: { key: string; label: string; value: (c: PlayerCard) => number; show: (c: PlayerCard) => React.ReactNode; sub?: string }[] = [
  { key: 'week', label: 'This week', value: weekXp, show: (c) => <>{weekXp(c).toLocaleString()} <span className="text-xs text-mist">XP</span></>, sub: 'XP since Monday · resets every week' },
  { key: 'iq', label: 'GeoIQ', value: (c) => c.iq, show: (c) => <>{tierFor(c.iq).emoji} {c.iq}</> },
  { key: 'streak', label: 'Streak', value: (c) => c.streak, show: (c) => <>{c.streak}🔥</> },
  { key: 'stamps', label: 'Stamps', value: (c) => c.stamps.length, show: (c) => <>{c.stamps.length}<span className="text-xs text-mist">/{COUNTRIES.length}</span></> },
  { key: 'duel', label: 'Duels', value: (c) => c.duel.rating, show: (c) => <>{c.duel.rating}</>, sub: 'Multiplayer duel rating' },
];

export default function Friends() {
  const social = useGame((s) => s.social);
  const { me, board } = useSocial();
  const [tab, setTab] = useState('week');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true); setMsg('');
    try { await publish(true); await loadBoard(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!social) return;
    void refresh();
    // Keep requests and the board fresh while the page is open (and when the app comes back).
    const poll = () => { if (document.visibilityState === 'visible') void publish().then(() => loadBoard()).catch(() => {}); };
    const t = setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', poll); };
  }, [social?.pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true); setMsg('');
    try { await ensureProfile(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const add = async () => {
    const pid = normalizePid(code);
    if (!pid) { setMsg('Friend codes have 8 letters and digits, like K7Q2-MX9D.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await addFriend(pid, 'code');
      if (r.friends.includes(pid)) { setCode(''); toast({ icon: '👥', title: 'Friend added', body: 'You’re on each other’s leaderboard now.' }); }
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const share = async () => {
    if (!social) return;
    const text = `Add me on GeoIQ! My friend code: ${formatPid(social.pid)} (Friends → Add by code)`;
    if (navigator.share) await navigator.share({ title: 'GeoIQ friend code', text }).catch(() => {});
    else { await navigator.clipboard.writeText(formatPid(social.pid)).catch(() => {}); toast({ icon: '📋', title: 'Code copied' }); }
  };

  const b = BOARDS.find((x) => x.key === tab)!;
  const ranked = [...(board ?? [])].sort((x, y) => b.value(y) - b.value(x) || x.name.localeCompare(y.name));

  if (!social) {
    return (
      <Page>
        <StatusBar />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-6 mt-2 text-center">
          <div className="text-5xl">👥</div>
          <div className="display text-2xl font-extrabold mt-2">Friends & leaderboard</div>
          <p className="text-mist mt-2 leading-snug">Add friends with a code, race them on a weekly XP leaderboard and peek at each other’s passports.</p>
          <p className="text-sm text-mist mt-3 leading-snug">Your player card shows your name and game stats (level, GeoIQ, streak, stamps, achievements) to friends and people you play with. Nothing else.</p>
          <button className="btn btn-primary w-full mt-5" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create my player card'}</button>
          {msg && <div className="text-sm text-rose mt-3">{msg}</div>}
        </motion.div>
      </Page>
    );
  }

  return (
    <Page>
      <StatusBar />
      <div className="card p-4 mt-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-mist font-semibold">Your friend code</div>
            <div className="mono display text-2xl font-extrabold tracking-wider mt-0.5 select-all">{formatPid(social.pid)}</div>
          </div>
          <button className="btn btn-primary !py-2 !px-4 text-sm" onClick={share}>Share</button>
        </div>
        <div className="flex gap-2 mt-4">
          <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Friend’s code" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="min-w-0 flex-1 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-xl px-3 py-2 mono uppercase text-paper" />
          <button className="btn btn-ghost !py-2 !px-4" disabled={busy || !code.trim()} onClick={add}>{busy ? '…' : 'Add'}</button>
        </div>
        {msg && <div className="text-sm text-rose mt-2">{msg}</div>}
        <button className="text-sm text-mist mt-2 underline" onClick={() => openPlayer(social.pid)}>View my player card</button>
      </div>

      {!!me?.requests.length && (<>
        <SectionTitle sub={me.requests.length}>Friend requests</SectionTitle>
        <div className="space-y-2">
          {me.requests.map((r) => (
            <div key={r.pid} className="card !rounded-2xl p-3 flex items-center gap-3">
              <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => openPlayer(r.pid)}>
                <Avatar p={{ id: r.pid, name: r.name }} size={36} />
                <span className="font-bold break-words">{r.name}</span>
              </button>
              <button className="btn btn-primary !py-1.5 !px-3 text-sm" onClick={() => respond(r.pid, true).then(() => toast({ icon: '👥', title: `You and ${r.name} are friends` })).catch((e) => toast({ icon: '⚠️', title: 'Couldn’t accept', body: e.message }))}>Accept</button>
              <button className="btn btn-ghost !py-1.5 !px-3 text-sm" onClick={() => void respond(r.pid, false).catch(() => {})}>✕</button>
            </div>
          ))}
        </div>
      </>)}

      <SectionTitle sub={<button className="text-sky" disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh'}</button>}>Leaderboard</SectionTitle>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {BOARDS.map((x) => (
          <button key={x.key} onClick={() => setTab(x.key)} className={`chip !text-sm whitespace-nowrap ${tab === x.key ? '!bg-amber !text-ink !border-amber font-bold' : ''}`}>{x.label}</button>
        ))}
      </div>
      {b.sub && <div className="text-xs text-mist mt-2">{b.sub}</div>}
      <div className="space-y-1.5 mt-2">
        {ranked.map((c, i) => {
          const you = c.pid === social.pid;
          return (
            <motion.button layout key={c.pid} onClick={() => openPlayer(c.pid)}
              className={`w-full rounded-2xl px-3 py-2.5 flex items-center gap-3 border text-left ${you ? 'border-amber/70 bg-amber/10' : 'border-line/60 bg-white/5'}`}>
              <span className="mono w-6 text-center font-bold text-mist">{i < 3 && b.value(c) > 0 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              <Avatar p={{ id: c.pid, name: c.name }} size={34} />
              <div className="min-w-0 flex-1">
                <div className="font-bold leading-tight break-words">{c.name}{you ? ' (you)' : ''}</div>
                <div className="text-xs text-mist">Lv {c.level} · {c.streak}🔥</div>
              </div>
              <span className="mono display font-extrabold text-lg whitespace-nowrap">{b.show(c)}</span>
            </motion.button>
          );
        })}
      </div>
      {board && board.length <= 1 && (
        <div className="card p-4 mt-3 text-center text-sm text-mist">
          No friends yet. Share your code, or tap a player in a multiplayer room and send a request.
        </div>
      )}
      {!!me?.outgoing.length && <div className="text-xs text-mist mt-3">⏳ {me.outgoing.length} friend request{me.outgoing.length === 1 ? '' : 's'} waiting for an answer</div>}
    </Page>
  );
}
