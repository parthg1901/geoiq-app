import { askConfirm } from '../components/Confirm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame } from '../lib/store';
import { go } from '../lib/router';
import { useRoom } from '../lib/mp/room';
import { buildMpQuestions, type MpQuestion } from '../lib/mp/questions';
import { LIMITS, type RoomState, type Player, type RaceReport } from '../lib/mp/protocol';
import { GAME_META, settingsLabel, progressText, type RaceGame } from '../lib/mp/race';
import { GamePicker, RaceSettings, settingsForGame, useRacePuzzle, useThrottledReport, RaceBoard, RaceStrip, raceXp } from '../components/mp/race';
import { onBack } from '../lib/native';
import { sfx, buzz } from '../lib/sound';
import { checkAchievements } from '../lib/achievements';
import { toast } from '../components/Toasts';
import { TopicPicker, Stepper, MpQuestionView, AnswerLabel, TimerBar, Avatar, Scoreboard, Podium, useServerNow } from '../components/mp/parts';
import { mpName } from './Multiplayer';

export default function MpRoom({ code }: { code?: string }) {
  const room = useRoom();
  const deviceId = useGame((s) => s.mp.deviceId);
  const rating = useGame((s) => s.mp.rating);

  useEffect(() => {
    if (!code) return;
    useRoom.getState().connect(code, { deviceId, name: mpName(), rating });
    return () => useRoom.getState().leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const leave = () => { useRoom.getState().leave(); go('/mp'); };
  const st = room.state;
  const inGame = st && (st.phase === 'countdown' || st.phase === 'question' || st.phase === 'reveal' || st.phase === 'race');
  useEffect(() => onBack(() => { if (!inGame) leave(); else void askConfirm('Leave the game?', { confirm: 'Leave' }).then((ok) => ok && leave()); }), [inGame]);

  if (!code) { go('/mp'); return null; }
  if (room.error && room.status === 'closed') return <ErrorScreen code={room.error.code} message={room.error.message} />;
  if (!st || !room.you) {
    return (
      <Shell onClose={leave}>
        <div className="flex-1 grid place-items-center text-center">
          <div>
            <div className="text-5xl animate-bounce">🌍</div>
            <div className="display text-xl font-bold mt-3">{room.status === 'reconnecting' ? 'Reconnecting…' : `Joining room ${code}…`}</div>
            <div className="text-mist text-sm mt-1">Connecting to the game server</div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <>
      {room.status === 'reconnecting' && (
        <div className="fixed left-0 right-0 z-[65] flex justify-center pointer-events-none" style={{ top: 'calc(var(--sat) + 0.5rem)' }}>
          <div className="chip !bg-ink !border-amber text-amber !text-sm !py-1.5 !px-3 shadow-lg">📡 Reconnecting…</div>
        </div>
      )}
      {st.phase === 'lobby' && <Lobby st={st} you={room.you} onLeave={leave} />}
      {st.phase === 'countdown' && <Countdown st={st} />}
      {(st.phase === 'question' || st.phase === 'reveal') && <Game st={st} you={room.you} onLeave={leave} />}
      {st.phase === 'race' && <Race st={st} you={room.you} onLeave={leave} />}
      {st.phase === 'end' && <End st={st} you={room.you} onLeave={leave} />}
    </>
  );
}

/* ---------------- frame ---------------- */

function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title?: React.ReactNode }) {
  return (
    <div className="min-h-dvh mx-auto max-w-2xl px-4 flex flex-col">
      <div className="flex items-center gap-3 py-3">
        <button aria-label="Leave" onClick={onClose} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
        <div className="flex-1 min-w-0 display font-bold text-lg leading-tight">{title}</div>
      </div>
      {children}
    </div>
  );
}

function ErrorScreen({ code, message }: { code: string; message: string }) {
  const copy: Record<string, [string, string, string]> = {
    notfound: ['🔎', 'Room not found', 'This room doesn’t exist any more — check the code with your host.'],
    full: ['🚪', 'Room is full', `Rooms hold up to ${LIMITS.maxPlayers} players.`],
    version: ['⬆️', 'Update GeoIQ to play in this room', message || 'Everyone in a room needs the same version of GeoIQ.'],
    kicked: ['👋', 'You were removed', 'The host removed you from this room.'],
    started: ['⏱️', 'Game already started', 'Wait for this game to finish, then ask the host for the next one.'],
  };
  const [e, t, d] = copy[code] ?? ['⚠️', 'Something went wrong', message];
  return (
    <Shell onClose={() => go('/mp')}>
      <div className="flex-1 grid place-items-center text-center px-4">
        <div>
          <div className="text-6xl">{e}</div>
          <div className="display text-2xl font-extrabold mt-3">{t}</div>
          <p className="text-mist mt-2 leading-relaxed">{d}</p>
          <button className="btn btn-primary mt-6" onClick={() => go('/mp')}>Back to Multiplayer</button>
        </div>
      </div>
    </Shell>
  );
}

/* ---------------- lobby ---------------- */

function Lobby({ st, you, onLeave }: { st: RoomState; you: string; onLeave: () => void }) {
  const send = useRoom((s) => s.send);
  const host = st.hostId === you;
  const set = (p: Partial<RoomState['settings']>) => send({ t: 'settings', settings: { ...st.settings, ...p } });
  const connected = st.players.filter((p) => p.connected);
  const share = async () => {
    const text = `Join my GeoIQ room ${st.code} — open GeoIQ → Multiplayer → Join and enter ${st.code} 🌍`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast({ icon: '📋', title: 'Invite copied', body: 'Paste it to your friends.' }); }
    } catch { /* cancelled */ }
  };
  return (
    <Shell onClose={onLeave} title="Room lobby">
      <div className="card p-5 text-center">
        <div className="text-xs uppercase tracking-[.2em] text-mist font-bold">Room code</div>
        <div className="display text-6xl font-extrabold tracking-[.25em] text-amber mt-1 select-all">{st.code}</div>
        <button className="btn btn-ghost mt-3" onClick={share}>📤 Invite friends</button>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="display font-bold">Players</div>
          <div className="text-sm text-mist">{connected.length}/{LIMITS.maxPlayers}</div>
        </div>
        <div className="space-y-1.5">
          {st.players.map((p) => (
            <div key={p.id} className={`rounded-2xl px-3 py-2.5 flex items-center gap-3 border ${p.id === you ? 'border-amber/60 bg-amber/10' : 'border-line/60 bg-white/5'}`}>
              <Avatar p={p} size={34} dim={!p.connected} />
              <div className="min-w-0 flex-1">
                <div className="font-bold leading-tight break-words">{p.name}{p.id === you ? ' (you)' : ''} {p.id === st.hostId && <span title="Host">👑</span>}</div>
                <div className="text-xs text-mist">{p.connected ? 'Ready' : 'Reconnecting…'} · rating {p.rating}</div>
              </div>
              <span className={`w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-mint' : 'bg-white/20'}`} />
              {host && p.id !== you && (
                <button aria-label={`Remove ${p.name}`} onClick={() => void askConfirm(`Remove ${p.name} from the room?`, { confirm: 'Remove' }).then((ok) => ok && send({ t: 'kick', playerId: p.id }))}
                  className="w-8 h-8 rounded-full grid place-items-center text-mist hover:text-rose border border-line/60">✕</button>
              )}
            </div>
          ))}
        </div>
        {connected.length < 2 && <div className="text-sm text-mist mt-2">Waiting for friends to join… you can also start solo to try it out.</div>}
      </div>

      <div className="mt-5 space-y-2">
        <div className="display font-bold">Game settings {host ? '' : <span className="text-sm text-mist font-normal">(the host picks)</span>}</div>
        <GamePicker value={st.settings.game ?? 'quiz'} onChange={(game) => send({ t: 'settings', settings: settingsForGame(st.settings, game) })} disabled={!host} />
        {(st.settings.game ?? 'quiz') === 'quiz' ? (
          <>
            <TopicPicker value={st.settings.topic} onChange={(topic) => set({ topic })} disabled={!host} />
            <div className="grid grid-cols-2 gap-2">
              <Stepper label="Questions" value={st.settings.rounds} min={LIMITS.minRounds} max={LIMITS.maxRounds} onChange={(rounds) => set({ rounds })} disabled={!host} />
              <Stepper label="Seconds each" value={st.settings.seconds} min={LIMITS.minSeconds} max={LIMITS.maxSeconds} step={1} unit="s" onChange={(seconds) => set({ seconds })} disabled={!host} />
            </div>
          </>
        ) : (
          <RaceSettings s={st.settings} onChange={set} disabled={!host} />
        )}
      </div>

      <div className="mt-auto pt-6 pb-4">
        {host ? (
          <button className="btn btn-primary w-full text-lg" onClick={() => { sfx.tap(); send({ t: 'start' }); }}>▶ Start game</button>
        ) : (
          <div className="text-center text-mist py-3">Waiting for the host to start…</div>
        )}
      </div>
    </Shell>
  );
}

/* ---------------- countdown ---------------- */

function Countdown({ st }: { st: RoomState }) {
  const now = useServerNow(100);
  const n = Math.max(1, Math.ceil((st.phaseEndsAt - now) / 1000));
  const last = useRef(0);
  useEffect(() => { if (n !== last.current) { last.current = n; sfx.tap(); } }, [n]);
  return (
    <div className="min-h-dvh grid place-items-center text-center px-6">
      <div>
        <div className="text-mist uppercase tracking-[.2em] text-sm font-bold px-2 leading-relaxed">{settingsLabel(st.settings)}</div>
        <AnimatePresence mode="popLayout">
          <motion.div key={n} initial={{ scale: 2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
            className="display font-extrabold text-amber mt-4" style={{ fontSize: '9rem', lineHeight: 1 }}>{n}</motion.div>
        </AnimatePresence>
        <div className="text-mist mt-4">{st.settings.game && st.settings.game !== 'quiz'
          ? `${GAME_META[st.settings.game].desc} · ${Math.round(st.settings.limitSec / 60)} min`
          : `${st.settings.rounds} questions · ${st.settings.seconds}s each · faster right answers score more`}</div>
      </div>
    </div>
  );
}

/* ---------------- question + reveal ---------------- */

/** The game's questions, built locally from the room's (topic, seed, rounds). */
function useQuestions(st: RoomState) {
  const key = `${st.settings.topic}|${st.seed}|${st.settings.rounds}`;
  const [qs, setQs] = useState<{ key: string; list: MpQuestion[] } | null>(null);
  useEffect(() => {
    let live = true;
    buildMpQuestions(st.settings.topic, st.seed, st.settings.rounds).then((list) => live && setQs({ key, list }));
    return () => { live = false; };
  }, [key, st.settings.topic, st.seed, st.settings.rounds]);
  return qs?.key === key ? qs.list : null;
}

function Game({ st, you, onLeave }: { st: RoomState; you: string; onLeave: () => void }) {
  const send = useRoom((s) => s.send);
  const qs = useQuestions(st);
  const q = qs?.[st.round];
  const now = useServerNow(100);
  const [mine, setMine] = useState<{ round: number; outcome: number } | null>(null);
  const answeredNow = mine?.round === st.round || st.answered.includes(you);
  const left = Math.max(0, st.phaseEndsAt - now);

  const answer = (outcome: number) => {
    if (st.phase !== 'question' || answeredNow) return;
    setMine({ round: st.round, outcome });
    send({ t: 'answer', round: st.round, outcome });
    if (outcome >= 0.6) { sfx.right(); buzz(12); } else { sfx.wrong(); buzz([30, 40, 30]); }
  };

  // The room may have fewer questions than rounds if a topic ran short; never index past the end.
  const total = qs ? Math.min(qs.length, st.settings.rounds) : st.settings.rounds;
  const mineThis = mine?.round === st.round ? mine : null;
  const myRound = st.answers[you];

  return (
    <div className="min-h-dvh flex flex-col relative">
      <div className="mx-auto w-full max-w-2xl px-4 pt-3 flex items-center gap-3">
        <button aria-label="Leave" onClick={() => void askConfirm('Leave the game?', { confirm: 'Leave' }).then((ok) => ok && onLeave())} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">✕</button>
        <div className="flex-1">
          {st.phase === 'question' ? <TimerBar left={left} total={st.settings.seconds * 1000} /> : <div className="h-3 rounded-full bg-white/10" />}
        </div>
        <span className="mono text-sm text-mist w-12 text-right">{st.round + 1}/{total}</span>
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 py-2 flex items-center gap-1.5 flex-wrap">
        {st.players.filter((p) => p.connected || st.answered.includes(p.id)).map((p) => (
          <Avatar key={p.id} p={p} size={26} dim={!st.answered.includes(p.id)} badge={st.answered.includes(p.id) ? '✓' : undefined} />
        ))}
        <span className="ml-auto text-xs uppercase tracking-[.16em] text-mist font-semibold">{st.phase === 'question' ? `${Math.ceil(left / 1000)}s` : 'Results'}</span>
      </div>

      <div className="flex-1 flex flex-col">
        {q ? <MpQuestionView key={`${st.seed}:${st.round}`} q={q} locked={st.phase !== 'question' || answeredNow} onAnswer={answer} />
          : <div className="flex-1 grid place-items-center text-mist">{qs ? 'Waiting for the next question…' : 'Loading questions…'}</div>}
      </div>

      <AnimatePresence>
        {st.phase === 'question' && answeredNow && (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed left-0 right-0 z-30 flex justify-center pointer-events-none" style={{ bottom: 'calc(var(--sab) + 1rem)' }}>
            <div className="chip !bg-deep !border-sky/60 !text-sm !py-2 !px-4 shadow-lg">
              🔒 Locked in — waiting for others ({st.answered.length}/{st.players.filter((p) => p.connected).length})
            </div>
          </motion.div>
        )}
        {st.phase === 'reveal' && q && (
          <motion.div key={`rev-${st.round}`} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-40">
            <div className="mx-auto max-w-2xl rounded-t-3xl border-t-4 border-amber bg-deep px-5 pt-4 max-h-[75dvh] overflow-y-auto shadow-[0_-20px_60px_rgba(0,0,0,.5)]"
              style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-mist font-bold">Answer</div>
                  <div className="text-xl"><AnswerLabel q={q} /></div>
                </div>
                <span className={`chip !text-sm mono ${myRound?.points ? '!text-mint !border-mint/50' : '!text-rose !border-rose/40'}`}>
                  {myRound ? (myRound.points ? `+${myRound.points}` : 'No points') : mineThis ? 'Scoring…' : 'Too slow!'}
                </span>
              </div>
              <div className="mt-3"><Scoreboard players={st.players} you={you} round={st.answers} /></div>
              <div className="text-center text-sm text-mist mt-3">
                {st.round + 1 >= total ? 'Final results' : 'Next question'} in {Math.max(0, Math.ceil(left / 1000))}s
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- race ---------------- */

function Race({ st, you, onLeave }: { st: RoomState; you: string; onLeave: () => void }) {
  const send = useRoom((s) => s.send);
  const game = st.settings.game as RaceGame;
  const { ready, puzzle } = useRacePuzzle(st.settings, st.seed);
  const now = useServerNow(250);
  const left = Math.max(0, st.phaseEndsAt - now);
  const sendReport = useCallback((report: RaceReport) => send({ t: 'progress', report }), [send]);
  const report = useThrottledReport(sendReport);
  const exit = useCallback(() => void askConfirm('Leave the race?', { confirm: 'Leave' }).then((ok) => ok && onLeave()), [onLeave]);
  const header = <RaceStrip game={game} left={left} totalMs={st.settings.limitSec * 1000} players={st.players.filter((p) => p.connected || st.progress?.[p.id])} progress={st.progress ?? {}} you={you} />;

  // Already finished (e.g. the app reloaded mid-race): don't hand out a fresh board.
  const mine = st.progress?.[you];
  const [finishedEarlier] = useState(() => !!mine?.done);
  if (finishedEarlier && mine) {
    return (
      <div className="min-h-dvh mx-auto w-full max-w-3xl px-4 pt-3">
        <div className="flex items-center gap-2">
          <button aria-label="Leave" onClick={exit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
          <div className="flex-1 display font-bold leading-tight">{GAME_META[game].emoji} {GAME_META[game].title}</div>
        </div>
        {header}
        <div className="card p-5 mt-4 text-center">
          <div className="display text-2xl font-extrabold text-mint">✓ Finished</div>
          <div className="text-mist mt-1">{progressText(game, mine)} — waiting for the others…</div>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="min-h-dvh grid place-items-center text-mist">Building the puzzle…</div>;
  if (!puzzle) {
    return (
      <Shell onClose={onLeave} title={GAME_META[game].title}>
        <div className="flex-1 grid place-items-center text-center px-4 text-mist">This puzzle couldn’t be built on your device. Ask the host to change the topics and start again.</div>
      </Shell>
    );
  }
  return <RaceBoard key={st.seed} puzzle={puzzle} title={`${GAME_META[game].emoji} ${GAME_META[game].title}`} onReport={report} onExit={exit} locked={left <= 0} header={header} />;
}

/* ---------------- end ---------------- */

function End({ st, you, onLeave }: { st: RoomState; you: string; onLeave: () => void }) {
  const send = useRoom((s) => s.send);
  const host = st.hostId === you;
  // Record the game once (rating, XP, counters) — in an effect, never during render.
  const [result, setResult] = useState<ReturnType<ReturnType<typeof useGame.getState>['mpFinish']>>(null);
  useEffect(() => {
    const race = st.settings.game && st.settings.game !== 'quiz';
    setResult(useGame.getState().mpFinish({
      key: `${st.code}:${st.seed}`,
      you,
      players: st.players.map((p: Player) => ({ id: p.id, score: p.score, rating: p.rating, correct: p.correct })),
      xp: race ? raceXp(st.progress?.[you]) : undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.code, st.seed]);
  const sorted = [...st.players].sort((a, b) => b.score - a.score);
  const place = sorted.findIndex((p) => p.id === you) + 1;
  useEffect(() => {
    if (place === 1 && st.players.length > 1) { sfx.win(); confetti({ particleCount: 160, spread: 100, origin: { y: 0.35 } }); }
    else confetti({ particleCount: 60, spread: 70, origin: { y: 0.35 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (result) for (const a of checkAchievements({ mode: 'mp' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
  }, [result]);
  return (
    <Shell onClose={onLeave} title="Final results">
      <div className="text-center">
        <div className="display text-3xl font-extrabold">{place === 1 && st.players.length > 1 ? 'You win! 🏆' : place ? `You came ${ordinal(place)}` : 'Game over'}</div>
        <div className="text-mist text-sm mt-1">{settingsLabel(st.settings)}</div>
      </div>
      <Podium players={st.players} />
      {result && (
        <div className="flex justify-center gap-2 mt-3 flex-wrap">
          <span className={`chip mono !text-sm ${result.delta >= 0 ? '!text-mint !border-mint/50' : '!text-rose !border-rose/40'}`}>Duel rating {result.delta >= 0 ? '+' : ''}{result.delta}</span>
          {result.xp > 0 && <span className="chip !text-amber !border-amber/40 !text-sm">+{result.xp} XP</span>}
        </div>
      )}
      <div className="mt-4"><Scoreboard players={st.players} you={you}
        detail={st.settings.game && st.settings.game !== 'quiz' ? (p) => progressText(st.settings.game as RaceGame, st.progress?.[p.id]) : undefined} /></div>
      <div className="mt-auto pt-6 pb-4 grid grid-cols-2 gap-3">
        <button className="btn btn-ghost" onClick={onLeave}>Leave</button>
        {host ? <button className="btn btn-primary" onClick={() => send({ t: 'lobby' })}>Play again</button>
          : <div className="text-sm text-mist grid place-items-center text-center">Waiting for the host…</div>}
      </div>
    </Shell>
  );
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;
