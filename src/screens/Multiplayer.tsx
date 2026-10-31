import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGame } from '../lib/store';
import { go } from '../lib/router';
import { createRoom, getRoom, normalizeChallengeCode, MpError } from '../lib/mp/api';
import { cleanName } from '../lib/mp/protocol';
import { topicLabel } from '../lib/mp/questions';
import { GAME_META, type RaceGame } from '../lib/mp/race';
import { Page, SectionTitle } from '../components/ui';
import { StatusBar } from './Home';

/** Your multiplayer display name (falls back to your profile name). */
export const mpName = () => { const s = useGame.getState(); return cleanName(s.mp.name || s.name || 'Explorer'); };

export default function Multiplayer() {
  const mp = useGame((s) => s.mp);
  const profileName = useGame((s) => s.name);
  const mpUpdate = useGame((s) => s.mpUpdate);
  const [name, setName] = useState(mp.name || profileName || '');
  const [code, setCode] = useState('');
  const [chCode, setChCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const saveName = () => mpUpdate({ name: cleanName(name) });

  const create = async () => {
    saveName(); setErr(null); setBusy('create');
    try { const r = await createRoom(); go(`/mp/room/${r.code}`); }
    catch (e) { setErr(e instanceof MpError ? e.message : 'Could not create a room.'); }
    finally { setBusy(null); }
  };
  const join = async () => {
    const c = code.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length !== 4) { setErr('Room codes are 4 letters.'); return; }
    saveName(); setErr(null); setBusy('join');
    try { await getRoom(c); go(`/mp/room/${c}`); }
    catch (e) { setErr(e instanceof MpError ? (e.kind === 'notfound' ? `No room called ${c} — check the code with your host.` : e.message) : 'Could not join.'); }
    finally { setBusy(null); }
  };
  const openChallenge = () => {
    const c = normalizeChallengeCode(chCode);
    if (c.length < 8) { setErr('Challenge codes look like GEO-7K2P.'); return; }
    saveName(); go(`/mp/challenge/${c}`);
  };

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">Multiplayer</h1>
      <p className="text-mist">Play friends live with a room code, or send a challenge they can play any time.</p>

      <div className="card mt-4 p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-xs uppercase tracking-wider text-mist font-bold" htmlFor="mp-name">Your name</label>
          <input id="mp-name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={saveName}
            placeholder="Explorer" className="w-full bg-transparent outline-none display text-xl font-bold mt-0.5 border-b-2 border-line focus:border-amber" />
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs uppercase tracking-wider text-mist font-bold">Duel rating</div>
          <div className="display text-2xl font-extrabold text-amber mono">{mp.rating}</div>
          <div className="text-xs text-mist">{mp.wins}W · {mp.matches} games</div>
        </div>
      </div>

      {err && <div className="mt-3 rounded-2xl border border-rose/50 bg-rose/10 text-rose px-4 py-3 text-sm">{err}</div>}

      <SectionTitle>⚡ Live room</SectionTitle>
      <div className="card p-4">
        <p className="text-sm text-mist">Up to 8 players: a quiz where everyone gets the same question at once, or a race — crossword, Hot & Cold or Borderline.</p>
        <button className="btn btn-primary w-full mt-3 text-lg" disabled={!!busy} onClick={create}>{busy === 'create' ? 'Creating…' : '➕ Create a room'}</button>
        <div className="flex gap-2 mt-3">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="CODE" autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
            aria-label="Room code"
            className="flex-1 min-w-0 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3 text-2xl display font-extrabold tracking-[.35em] text-center placeholder:text-mist/60 placeholder:tracking-[.2em]" />
          <button className="btn btn-ghost px-5" disabled={!!busy || code.length !== 4} onClick={join}>{busy === 'join' ? '…' : 'Join'}</button>
        </div>
      </div>

      <SectionTitle>🎯 Challenges</SectionTitle>
      <div className="card p-4">
        <p className="text-sm text-mist">Play a round, get a code like GEO-7K2P, send it to a friend. They play the exact same questions whenever they like.</p>
        <button className="btn btn-primary w-full mt-3" onClick={() => { saveName(); go('/mp/challenge/new'); }}>➕ Create a challenge</button>
        <div className="flex gap-2 mt-3">
          <input value={chCode} onChange={(e) => setChCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && openChallenge()}
            placeholder="GEO-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label="Challenge code"
            className="flex-1 min-w-0 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3 text-xl display font-extrabold tracking-[.2em] text-center placeholder:text-mist/60" />
          <button className="btn btn-ghost px-5" disabled={chCode.replace(/[^A-Z0-9]/gi, '').length < 4} onClick={openChallenge}>Play</button>
        </div>
      </div>

      {mp.challenges.length > 0 && (
        <>
          <SectionTitle>My challenges</SectionTitle>
          <div className="space-y-2">
            {[...mp.challenges].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((c, i) => (
              <motion.button key={c.code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                onClick={() => go(`/mp/challenge/${c.code}`)} className="card !rounded-2xl w-full p-3 flex items-center gap-3 text-left hover:border-amber/60">
                <span className="mono display font-extrabold text-amber">{c.code}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-snug break-words">{c.topic.startsWith('race:') ? `${GAME_META[c.topic.slice(5) as RaceGame]?.emoji ?? ''} ${GAME_META[c.topic.slice(5) as RaceGame]?.title ?? c.topic}` : topicLabel(c.topic)}</div>
                  <div className="text-xs text-mist">{c.role === 'creator' ? 'You created' : 'You played'} · {new Date(c.createdAt).toLocaleDateString()}</div>
                </div>
                <span className="text-mist">Results →</span>
              </motion.button>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
