import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { BY_ID } from '../data';
import { useGame } from '../lib/store';
import { rng, hash, todayKey } from '../lib/rng';
import { makeRoute, onShortest, detour, connected, shortestPath, type Route } from '../lib/border';
import { checkAchievements } from '../lib/achievements';
import { sfx, buzz } from '../lib/sound';
import { toast } from '../components/Toasts';
import { TopBar, Progress } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { TypeAnswer } from '../components/Answer';
import { Flag } from '../components/Shape';
import { go } from '../lib/router';

const COL = { start: '#53b8ff', end: '#b48cff', good: '#3ddc97', near: '#ffb547', bad: '#ff5d73' };

type Kind = 'daily' | 'random';

export default function Borderline() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [seed, setSeed] = useState(0);
  const route = useMemo(() => {
    if (!kind) return null;
    return makeRoute(kind === 'daily' ? rng(hash('border:' + todayKey())) : Math.random);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, seed]);

  if (!kind || !route) return <Intro onPick={(k) => { setKind(k); setSeed((s) => s + 1); }} />;
  return <Game key={seed} route={route} kind={kind} onAgain={() => { setKind('random'); setSeed((s) => s + 1); }} />;
}

function Intro({ onPick }: { onPick: (k: Kind) => void }) {
  const dailyDone = useGame((s) => (s.counters['border:' + todayKey()] ?? 0) > 0);
  return (
    <div className="relative z-10 mx-auto max-w-2xl px-4 pb-10 min-h-dvh flex flex-col">
      <TopBar title="Borderline" onClose={() => go('/play')} />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center mt-4">
        <div className="text-6xl">🛤️</div>
        <h1 className="display text-4xl font-extrabold mt-2">Borderline</h1>
        <p className="text-mist mt-2">Walk from one country to another — <b className="text-paper">over land only</b>.</p>
      </motion.div>
      <div className="card p-5 mt-6 space-y-3">
        {[
          ['1', 'You get a start and a destination country.'],
          ['2', 'Type the countries in between. Each one must share land borders to form a chain.'],
          ['3', <>Colours tell you how you’re doing: <b style={{ color: COL.good }}>on a shortest route</b>, <b style={{ color: COL.near }}>small detour</b>, <b style={{ color: COL.bad }}>off course</b>.</>],
          ['4', 'You have the shortest route length + 4 guesses. Hit the exact shortest route for a perfect score.'],
        ].map(([n, t]) => (
          <div key={String(n)} className="flex gap-3"><span className="display font-extrabold text-amber w-5">{n}</span><span className="text-sm leading-snug">{t}</span></div>
        ))}
      </div>
      <div className="mt-auto pt-8 grid gap-3">
        <button className="btn btn-primary text-lg" onClick={() => onPick('daily')}>☀️ Daily route{dailyDone ? ' · replay' : ''}</button>
        <button className="btn btn-ghost text-lg" onClick={() => onPick('random')}>🎲 Random route</button>
      </div>
    </div>
  );
}

function Game({ route, kind, onAgain }: { route: Route; kind: Kind; onAgain: () => void }) {
  const between = route.hops - 1; // countries strictly between start and end
  const maxGuesses = between + 4;
  const [guesses, setGuesses] = useState<string[]>([]);
  const [status, setStatus] = useState<'play' | 'won' | 'lost'>('play');
  const [msg, setMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [xpWon, setXpWon] = useState(0);
  const best = useMemo(() => shortestPath(route), [route]);
  const s = BY_ID[route.start], e = BY_ID[route.end];

  // Frame: every country on any shortest route + start/end
  const frame = useMemo(() => Object.keys(route.distS).filter((id) => onShortest(route, id)), [route]);

  const colorOf = (id: string) => (onShortest(route, id) ? COL.good : detour(route, id) <= 2 ? COL.near : COL.bad);

  const end = (won: boolean, list: string[]) => {
    const g = useGame.getState();
    setStatus(won ? 'won' : 'lost');
    let xp = 5;
    if (won) {
      const extra = list.length - between;
      xp = extra <= 0 ? 80 : Math.max(20, 60 - extra * 10);
      if (extra <= 0) g.bump('borderPerfect');
      sfx.win(); confetti({ particleCount: 140, spread: 90, origin: { y: 0.4 }, colors: [COL.good, COL.start, COL.end, '#fff'] });
    } else sfx.wrong();
    if (kind === 'daily') g.bump('border:' + todayKey());
    g.addXP(xp, won ? 10 : 0);
    setXpWon(xp);
    for (const a of checkAchievements({ mode: 'borderline' })) toast({ icon: a.icon, title: `Achievement: ${a.name}`, body: a.desc });
  };

  const guess = (id: string | null, raw: string) => {
    if (status !== 'play') return;
    const flash = (m: string) => { setMsg(m); setShake((x) => x + 1); buzz(20); setTimeout(() => setMsg(null), 1800); };
    if (!id) return flash(`Hmm, “${raw}” isn’t a country we know.`);
    if (id === route.start || id === route.end) return flash(`${BY_ID[id].name} is already on the board.`);
    if (guesses.includes(id)) return flash(`You already guessed ${BY_ID[id].name}.`);
    const list = [...guesses, id];
    setGuesses(list);
    if (onShortest(route, id)) {
      sfx.right(list.length);
      // Countries correctly placed on the route count as map practice.
      useGame.getState().answer({ id, skill: 'map', format: 'typed', outcome: 1, practice: true });
    } else if (detour(route, id) <= 2) sfx.hint();
    else { sfx.wrong(); buzz([20, 30, 20]); }
    if (connected(route, list)) end(true, list);
    else if (list.length >= maxGuesses) end(false, list);
  };

  const fills: Record<string, string> = { [route.start]: COL.start, [route.end]: COL.end };
  for (const g of guesses) fills[g] = colorOf(g);
  if (status === 'lost') for (const b of best.slice(1, -1)) if (!fills[b]) fills[b] = 'rgba(61,220,151,.45)';
  const labels: Record<string, string> = { [route.start]: s.name, [route.end]: e.name };
  for (const g of guesses) labels[g] = BY_ID[g].name;
  if (status === 'lost') for (const b of best) labels[b] = BY_ID[b].name;

  return (
    <div className="relative z-10 mx-auto max-w-3xl px-4 pb-8 min-h-dvh flex flex-col">
      <TopBar title={<span>Borderline <span className="text-mist text-sm font-semibold">· {kind === 'daily' ? 'Daily' : 'Random'}</span></span>} onClose={() => go('/play')}
        right={<span className="chip mono !text-sm">{guesses.length}/{maxGuesses}</span>} />

      {/* start → end header */}
      <div className="card p-3 flex items-center gap-2">
        <Endpoint id={route.start} color={COL.start} label="From" />
        <div className="flex-1 flex flex-col items-center min-w-0">
          <div className="flex items-center gap-1">
            {Array.from({ length: between }, (_, i) => (
              <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.08 }}
                className="w-2.5 h-2.5 rounded-full" style={{ background: i < guesses.filter((g) => onShortest(route, g)).length ? COL.good : 'rgba(255,255,255,.15)' }} />
            ))}
          </div>
          <div className="text-sm text-mist mt-1 text-center leading-snug">shortest: {between} {between === 1 ? 'country' : 'countries'} between</div>
        </div>
        <Endpoint id={route.end} color={COL.end} label="To" right />
      </div>

      <div className="relative mt-3 h-[40vh] sm:h-[48vh] rounded-3xl overflow-hidden border border-line bg-deep">
        <WorldMap focus={[route.start, route.end, ...frame]} fills={fills} labels={labels} pulse={[route.start, route.end]} />
      </div>
      <Progress value={guesses.length / maxGuesses} className="mt-3" h={6} color={guesses.length >= maxGuesses - 1 ? 'var(--color-rose)' : 'var(--color-sky)'} />

      <div className="flex flex-wrap gap-1.5 mt-3 min-h-8">
        <AnimatePresence>
          {guesses.map((g) => (
            <motion.span key={g} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="chip !text-sm"
              style={{ borderColor: colorOf(g), color: colorOf(g), background: colorOf(g) + '1a' }}>
              <Flag id={g} className="w-5 h-3.5 !rounded-sm !shadow-none" />{BY_ID[g].name}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {status === 'play' ? (
        <div key={shake} className={`mt-auto pt-3 ${shake ? 'shake' : ''}`}>
          <AnimatePresence>{msg && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-rose text-sm mb-2">{msg}</motion.div>}</AnimatePresence>
          <TypeAnswer onSubmit={guess} placeholder="Next country on the route…" />
          <button className="btn btn-ghost w-full mt-2 !py-2.5 text-sm" onClick={() => end(false, guesses)}>Give up & show route</button>
        </div>
      ) : (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card p-5 mt-4">
          <div className="display text-2xl font-extrabold" style={{ color: status === 'won' ? COL.good : COL.bad }}>
            {status === 'won' ? (guesses.length <= between ? '💎 Perfect route!' : '🎉 Route complete!') : 'Route blocked'}
          </div>
          <div className="text-sm text-mist mt-1">
            {status === 'won' ? `You connected ${s.name} → ${e.name} in ${guesses.length} guesses (shortest possible: ${between}).` : `The border crossing eluded you this time.`}
            <span className="text-amber font-bold"> +{xpWon} XP</span>
          </div>
          <div className="text-xs uppercase tracking-wider text-mist font-bold mt-4 mb-2">A shortest route</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {best.map((id, i) => (
              <motion.span key={id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }} className="flex items-center gap-1.5">
                <span className="chip !text-sm"><Flag id={id} className="w-5 h-3.5 !rounded-sm !shadow-none" />{BY_ID[id].name}</span>
                {i < best.length - 1 && <span className="text-mist">→</span>}
              </motion.span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <button className="btn btn-ghost" onClick={() => go('/')}>Home</button>
            <button className="btn btn-primary" onClick={onAgain}>New route</button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Endpoint({ id, color, label, right }: { id: string; color: string; label: string; right?: boolean }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <Flag id={id} className="w-10 h-7 !rounded shrink-0" style={{ boxShadow: `0 0 0 2px ${color}` }} />
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider font-bold" style={{ color }}>{label}</div>
        <div className="display font-bold leading-tight break-words max-w-[8.5rem] sm:max-w-none">{BY_ID[id].name}</div>
      </div>
    </div>
  );
}
