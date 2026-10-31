import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { BY_ID } from '../data';
import { useGame } from '../lib/store';
import { rng, hash, todayKey } from '../lib/rng';
import { borderDistance, bearing, centre, heat, heatLabel, mysteryCountry } from '../lib/border';
import { checkAchievements } from '../lib/achievements';
import { sfx, buzz } from '../lib/sound';
import { toast } from '../components/Toasts';
import { TopBar } from '../components/ui';
import { Globe } from '../components/Globe';
import { useWorld } from '../components/WorldMap';
import { TypeAnswer } from '../components/Answer';
import { Flag, Shape } from '../components/Shape';
import { go } from '../lib/router';
import type { RaceReport } from '../lib/mp/protocol';

type Kind = 'daily' | 'random';
interface Guess { id: string; km: number; dir: number }

function mystery(kind: Kind) {
  return mysteryCountry(kind === 'daily' ? rng(hash('hotcold:' + todayKey())) : Math.random);
}

export default function HotCold() {
  const dailyDone = useGame((s) => (s.counters['hotcold:' + todayKey()] ?? 0) > 0);
  const [kind, setKind] = useState<Kind>(dailyDone ? 'random' : 'daily');
  const [round, setRound] = useState(0);
  const target = useMemo(() => mystery(kind), [kind, round]);
  return <Game key={kind + round} target={target} kind={kind} dailyDone={dailyDone}
    onMode={(k) => { setKind(k); setRound((r) => r + 1); }} />;
}

/** Race mode (multiplayer): no XP/achievements/give-up; progress goes to `onReport` instead. */
export interface HotColdRace { onReport: (r: RaceReport) => void; locked?: boolean }

/** Hot & Cold in multiplayer race mode — same mystery country for everyone. */
export function HotColdRaceGame({ target, race }: { target: string; race: HotColdRace }) {
  return <Game target={target} kind="random" dailyDone={false} onMode={() => {}} race={race} />;
}

function Game({ target, kind, dailyDone, onMode, race }: { target: string; kind: Kind; dailyDone: boolean; onMode: (k: Kind) => void; race?: HotColdRace }) {
  const world = useWorld('110');
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [status, setStatus] = useState<'play' | 'won' | 'lost'>('play');
  const [msg, setMsg] = useState<string | null>(null);
  const [xpWon, setXpWon] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const t = BY_ID[target];
  const sorted = [...guesses].sort((a, b) => a.km - b.km);
  const closest = sorted[0];

  const finish = (won: boolean, n: number) => {
    const g = useGame.getState();
    setStatus(won ? 'won' : 'lost');
    setLast(target);
    if (race) { if (won) { sfx.win(); confetti({ particleCount: 90, spread: 80, origin: { y: 0.35 } }); } return; }
    let xp = 5;
    if (won) {
      xp = Math.max(10, 75 - (n - 1) * 5);
      g.best('hotcold', n, true);
      sfx.win();
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.35 }, colors: ['#ff3b30', '#ffb547', '#fff'] });
    }
    if (kind === 'daily') g.bump('hotcold:' + todayKey());
    g.addXP(xp, won ? 10 : 0);
    setXpWon(xp);
    for (const a of checkAchievements({ mode: 'hotcold' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
  };

  const guess = (id: string | null, raw: string) => {
    if (status !== 'play' || !world || race?.locked) return;
    const flash = (m: string) => { setMsg(m); buzz(20); setTimeout(() => setMsg(null), 1800); };
    if (!id) return flash(`“${raw}” isn’t a country we know.`);
    if (guesses.some((g) => g.id === id)) return flash(`Already guessed ${BY_ID[id].name}.`);
    const km = id === target ? 0 : borderDistance(id, target, world);
    const dir = bearing(centre(id, world), centre(target, world));
    const list = [...guesses, { id, km, dir }];
    setGuesses(list);
    setLast(id);
    // RaceReport: a = guesses, b = closest distance in km (0 only when found), done = found
    if (race) race.onReport({ a: list.length, b: id === target ? 0 : Math.max(1, Math.min(...list.map((g) => g.km))), c: 0, done: id === target });
    if (id === target) { finish(true, list.length); return; }
    if (!closest || km < closest.km) { sfx.right(Math.max(0, 8 - Math.floor(km / 1000))); } else sfx.tap();
  };

  const fills: Record<string, string> = {};
  for (const g of guesses) fills[g.id] = heat(g.km);
  if (status !== 'play') fills[target] = status === 'won' ? '#3ddc97' : '#ff5d73';

  return (
    <div className={`relative z-10 mx-auto max-w-2xl px-4 pb-8 flex flex-col ${race ? '' : 'min-h-dvh'}`}>
      {!race && <TopBar title="Hot & Cold" onClose={() => go('/play')} right={<span className="chip mono !text-sm">{guesses.length} 🎯</span>} />}

      {!race && <div className="flex gap-2">
        {(['daily', 'random'] as Kind[]).map((k) => (
          <button key={k} onClick={() => k !== kind && onMode(k)}
            className={`chip !py-1.5 !px-3 !text-sm ${kind === k ? '!bg-amber !text-ink !border-amber' : ''}`}>
            {k === 'daily' ? `☀️ Daily${dailyDone ? ' ✓' : ''}` : '🎲 Random'}
          </button>
        ))}
        <span className="text-sm text-mist self-center ml-auto hidden sm:inline">Guess any country — we’ll tell you how close you are.</span>
      </div>}

      <div className="kb-hide relative mt-3 flex justify-center">
        <div className="absolute inset-0 m-auto w-72 h-72 rounded-full opacity-30 pointer-events-none" style={{ background: `radial-gradient(circle, ${closest ? heat(closest.km) : '#53b8ff'} 0%, transparent 68%)` }} />
        <Globe size={Math.min(320, typeof window !== 'undefined' ? window.innerWidth - 48 : 320)} focus={last} fills={fills} spin={!guesses.length} />
        {closest && status === 'play' && (
          <motion.div key={closest.km} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="absolute top-1 right-0 chip !text-sm !bg-ink/80" style={{ color: heat(closest.km), borderColor: heat(closest.km) }}>
            🌡️ {heatLabel(closest.km)}
          </motion.div>
        )}
      </div>

      {/* Thermometer of the closest guess */}
      <div className="mt-3">
        <div className="h-3 rounded-full overflow-hidden relative" style={{ background: 'linear-gradient(90deg,#ff3b30,#ff6e3c,#ffb547,#ffe196,#96c8ff,#538cff,#324696)' }}>
          {closest && (
            <motion.div className="absolute top-1/2 w-5 h-5 -mt-2.5 -ml-2.5 rounded-full bg-white border-4 border-ink shadow-lg"
              animate={{ left: `${Math.min(100, Math.sqrt(closest.km / 16000) * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 15 }} />
          )}
        </div>
        <div className="flex justify-between text-xs uppercase tracking-wider text-mist font-bold mt-1"><span>Hot</span><span>Cold</span></div>
      </div>

      {status === 'play' && race?.locked ? (
        <div className="card p-4 mt-3 text-center text-mist">⏱️ Time’s up — waiting for results…</div>
      ) : status === 'play' ? (
        <div className="mt-3">
          <AnimatePresence>{msg && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-rose text-sm mb-2">{msg}</motion.div>}</AnimatePresence>
          <TypeAnswer onSubmit={guess} placeholder={world ? 'Guess a country…' : 'Loading world…'} disabled={!world} />
        </div>
      ) : race ? (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card p-5 mt-4 text-center">
          <div className="display text-2xl font-extrabold text-mint">🎯 Found it in {guesses.length}!</div>
          <div className="flex items-center justify-center gap-2 mt-2"><Flag id={target} className="w-9 h-6 !rounded" /><span className="display text-xl font-bold">{t.name}</span></div>
          <div className="text-mist mt-2">Finished! Waiting for the others…</div>
        </motion.div>
      ) : (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card p-5 mt-4">
          <div className="flex items-center gap-4">
            <Shape id={target} size={90} color={status === 'won' ? 'var(--color-mint)' : 'var(--color-rose)'} />
            <div className="min-w-0">
              <div className="display text-xl font-extrabold" style={{ color: status === 'won' ? '#3ddc97' : '#ff5d73' }}>
                {status === 'won' ? `Found it in ${guesses.length}!` : 'The mystery country was…'}
              </div>
              <div className="flex items-center gap-2 mt-1"><Flag id={target} className="w-9 h-6 !rounded" /><span className="display text-2xl font-bold">{t.name}</span></div>
              <div className="text-sm text-amber font-bold mt-1">+{xpWon} XP</div>
            </div>
          </div>
          <p className="text-[15px] leading-relaxed text-paper/85 mt-3">{t.fact}</p>
          <button className="text-sky font-semibold mt-2" onClick={() => go('/country/' + t.id)}>📖 Full profile of {t.name} →</button>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button className="btn btn-ghost" onClick={() => go('/')}>Home</button>
            <button className="btn btn-primary" onClick={() => onMode('random')}>Play again</button>
          </div>
        </motion.div>
      )}

      {/* Guess list, closest first */}
      <div className="mt-4 space-y-1.5">
        <AnimatePresence>
          {sorted.map((g, i) => (
            <motion.div key={g.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2 border ${g.id === last && status === 'play' ? 'ring-2 ring-paper/30' : ''}`}
              style={g.id === target ? { borderColor: '#3ddc97', background: '#3ddc9722' } : { borderColor: heat(g.km) + '88', background: heat(g.km) + '18' }}>
              <span className="mono text-xs text-mist w-5">{i + 1}</span>
              <Flag id={g.id} className="w-8 h-5 !rounded-sm !shadow-none" />
              <span className="display font-bold flex-1 min-w-0 break-words leading-tight">{BY_ID[g.id].name}</span>
              {g.id === target ? <span className="text-mint font-bold">🎯</span> : (
                <>
                  <span className="mono text-sm font-bold" style={{ color: heat(g.km) }}>{g.km === 0 ? 'touching!' : `${g.km.toLocaleString()} km`}</span>
                  {g.km > 0 && <span className="inline-block text-lg" style={{ transform: `rotate(${g.dir}deg)` }} title="direction to target">↑</span>}
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {status === 'play' && !race && guesses.length >= 3 && (
        <button className="btn btn-ghost w-full mt-4 !py-2.5 text-sm" onClick={() => finish(false, guesses.length)}>Give up & reveal</button>
      )}
      {status === 'play' && !guesses.length && (
        <p className="text-center text-sm text-mist mt-4">A mystery country is hiding somewhere on Earth. Every guess shows its distance and direction — red means you’re burning hot.</p>
      )}
    </div>
  );
}
