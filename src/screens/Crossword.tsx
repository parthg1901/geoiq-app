import { useState } from 'react';
import { motion } from 'framer-motion';
import { useGame, type SavedCrossword } from '../lib/store';
import { generate } from '../lib/crossword';
import { buildEntries, CW_SOURCES, RANDOM_MIX, SIZES, type SizeKey } from '../lib/crosswordSources';
import { rng, hash, todayKey } from '../lib/rng';
import { dailyNumber } from '../lib/daily';
import { go } from '../lib/router';
import { sfx } from '../lib/sound';
import { Page } from '../components/ui';
import { CrosswordPlay, fmtTime } from '../components/crossword/Play';
import { StatusBar } from './Home';

type Slot = 'daily' | 'custom';
const GROUPS = ['World', 'Physical', 'Regions', 'History'] as const;

/** Build a crossword and store it in a slot. Runs after a paint so the "building" animation shows. */
async function build(slot: Slot, sources: string[], size: SizeKey, seed?: number): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 60));
  const S = SIZES[size];
  const random = seed != null ? rng(seed) : Math.random;
  const entries = await buildEntries(sources, random, S.maxEase);
  const cw = generate(entries, { size: S.size, target: S.target, rng: random });
  if (!cw) return false;
  const flat = cw.grid.flat();
  const day = todayKey();
  const saved: SavedCrossword = {
    key: slot === 'daily' ? `daily:${day}` : 'custom',
    title: slot === 'daily' ? `Daily crossword #${dailyNumber(day)}` : `${S.label} · ${sources.length ? sources.map((k) => CW_SOURCES.find((s) => s.key === k)?.title ?? k).slice(0, 3).join(', ') + (sources.length > 3 ? '…' : '') : 'Random mix'}`,
    size, cw,
    fill: flat.map((c) => (c ? ' ' : '#')).join(''),
    revealed: '0'.repeat(flat.length),
    checks: 0, reveals: 0, elapsed: 0, done: false,
  };
  const g = useGame.getState();
  g.set({ crossword: { ...g.crossword, [slot]: saved } });
  return true;
}

export default function CrosswordScreen({ slot }: { slot?: string }) {
  if (slot === 'daily' || slot === 'custom') {
    const saved = useGame.getState().crossword[slot];
    const stale = slot === 'daily' && saved?.key !== `daily:${todayKey()}`;
    if (!saved || stale) { go('/crossword'); return null; }
    return <CrosswordPlay key={saved.key + saved.cw.words.length} slot={slot} onExit={() => go('/crossword')} onNew={() => go('/crossword')} />;
  }
  return <Setup />;
}

function Setup() {
  const prefs = useGame((s) => s.cwPrefs);
  const saved = useGame((s) => s.crossword);
  const cwDaily = useGame((s) => s.cwDaily);
  const [sources, setSources] = useState<string[]>(prefs.sources);
  const [size, setSize] = useState<SizeKey>((prefs.size as SizeKey) in SIZES ? (prefs.size as SizeKey) : 'standard');
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = todayKey();
  const dailyDone = cwDaily[day];
  const dailyInProgress = saved.daily?.key === `daily:${day}` && !saved.daily.done;
  const customInProgress = saved.custom && !saved.custom.done;

  const toggle = (k: string) => { sfx.tap(); setSources((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])); };

  const startDaily = async () => {
    if (dailyInProgress || dailyDone) { go('/crossword/daily'); return; }
    setBusy('daily'); setError(null);
    const ok = await build('daily', RANDOM_MIX, 'standard', hash('cw:' + day));
    setBusy(null);
    if (ok) go('/crossword/daily'); else setError('Today’s crossword couldn’t be built. Try again in a moment.');
  };
  const create = async () => {
    useGame.getState().set({ cwPrefs: { sources, size } });
    setBusy('custom'); setError(null);
    const ok = await build('custom', sources, size);
    setBusy(null);
    if (ok) go('/crossword/custom');
    else setError('Not enough words fit together for that selection. Add another source or pick a smaller size.');
  };

  return (
    <Page>
      <StatusBar />
      <h1 className="display text-3xl font-extrabold mt-3">Crosswords</h1>
      <p className="text-mist">Fresh grids built from countries, capitals, rivers, lakes, peaks, states and history — with clues written from the facts.</p>

      {/* Daily */}
      <button onClick={startDaily} disabled={!!busy} className="card w-full mt-5 p-4 flex items-center gap-4 text-left ring-2 ring-sky/50">
        <div className="w-14 h-14 rounded-2xl bg-sky/15 grid place-items-center text-3xl shrink-0">🧩</div>
        <div className="flex-1 min-w-0">
          <div className="display font-bold text-lg">Daily crossword #{dailyNumber(day)}</div>
          <div className="text-sm text-mist">
            {dailyDone ? `✓ Solved in ${fmtTime(dailyDone.time)}${dailyDone.reveals ? ` · ${dailyDone.reveals} reveals` : ' · no help 🧠'}` : dailyInProgress ? 'In progress — tap to continue' : 'Standard size · random mix · the same grid for everyone'}
          </div>
        </div>
        <span className="btn btn-primary !px-4 !py-2 text-sm shrink-0">{dailyDone ? 'View' : dailyInProgress ? 'Continue' : 'Play'}</span>
      </button>

      {customInProgress && (
        <button onClick={() => go('/crossword/custom')} className="card w-full mt-3 p-4 flex items-center gap-4 text-left">
          <div className="text-2xl">⏯️</div>
          <div className="flex-1 min-w-0"><div className="display font-bold">Continue your crossword</div><div className="text-sm text-mist">{saved.custom!.title} · {fmtTime(saved.custom!.elapsed)}</div></div>
          <span className="text-amber text-xl">→</span>
        </button>
      )}

      {/* Build your own */}
      <h2 className="display text-xl font-extrabold mt-8">Build your own</h2>
      <p className="text-sm text-mist mt-1">Pick one or more topics — or none for a random mix.</p>
      <button onClick={() => { sfx.tap(); setSources([]); }} className={`chip !text-sm !py-1.5 !px-3 mt-3 ${sources.length === 0 ? '!bg-amber !text-ink !border-amber' : ''}`}>🎲 Random mix</button>
      {GROUPS.map((g) => (
        <div key={g} className="mt-4">
          <div className="text-xs uppercase tracking-wider font-bold text-mist mb-2">{g}</div>
          <div className="flex flex-wrap gap-2">
            {CW_SOURCES.filter((s) => s.group === g).map((s) => {
              const on = sources.includes(s.key);
              return (
                <button key={s.key} onClick={() => toggle(s.key)} className={`chip !text-sm !py-1.5 !px-3 ${on ? '!bg-amber !text-ink !border-amber' : ''}`}>
                  {s.emoji} {s.title}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="text-xs uppercase tracking-wider font-bold text-mist mt-6 mb-2">Size</div>
      <div className="p-1 rounded-2xl bg-white/5 border border-line grid grid-cols-3 relative">
        {(Object.keys(SIZES) as SizeKey[]).map((k) => (
          <button key={k} onClick={() => { sfx.tap(); setSize(k); }} className={`relative py-2.5 rounded-xl display font-bold text-sm ${size === k ? 'text-ink' : 'text-mist'}`}>
            {size === k && <motion.span layoutId="cw-size" className="absolute inset-0 rounded-xl bg-amber" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            <span className="relative">{SIZES[k].label} <span className="mono text-xs opacity-80">{SIZES[k].size}×{SIZES[k].size}</span></span>
          </button>
        ))}
      </div>
      <div className="text-sm text-mist mt-2">
        {size === 'mini' ? 'Quick, well-known answers.' : size === 'standard' ? 'A balanced puzzle for a coffee break.' : 'Long sit-down puzzle, obscure answers included.'}
      </div>

      {error && <div className="mt-4 text-rose text-sm">{error}</div>}
      <button className="btn btn-primary w-full mt-5 text-lg" disabled={!!busy} onClick={create}>Create crossword</button>

      {busy && (
        <div className="fixed inset-0 z-50 bg-ink/90 grid place-items-center">
          <div className="text-center">
            <div className="grid grid-cols-4 gap-1.5 w-28 mx-auto">
              {Array.from({ length: 16 }, (_, i) => (
                <motion.div key={i} className="aspect-square rounded-md bg-paper"
                  animate={{ opacity: [0.15, 1, 0.15], scale: [0.85, 1, 0.85] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: ((i * 7) % 16) * 0.06 }} />
              ))}
            </div>
            <div className="display text-xl font-bold mt-5">Building your crossword…</div>
            <div className="text-sm text-mist mt-1">Fitting the words together</div>
          </div>
        </div>
      )}
    </Page>
  );
}
