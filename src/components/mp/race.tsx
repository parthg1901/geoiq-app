/** Race-game UI shared by live rooms and async challenges. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { buildRace, GAME_META, progressText, fmtClock, type RaceGame, type RacePuzzle, type RacePuzzleSpec } from '../../lib/mp/race';
import { CW_SOURCES, SIZES } from '../../lib/crosswordSources';
import { GAMES, LIMITS, RACE_DEFAULT_SEC, type GameKind, type Player, type RaceProgress, type RaceReport, type RoomSettings } from '../../lib/mp/protocol';
import { CrosswordPlay } from '../crossword/Play';
import { HotColdRaceGame } from '../../screens/HotCold';
import { BorderlineRaceGame } from '../../screens/Borderline';
import { Stepper, Avatar, TimerBar } from './parts';
import { sfx } from '../../lib/sound';
import { PlayerLink } from '../social/PlayerSheet';

/* ---------------- settings ---------------- */

export function GamePicker({ value, onChange, disabled }: { value: GameKind; onChange: (g: GameKind) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {GAMES.map((g) => {
        const m = GAME_META[g];
        const on = g === value;
        return (
          <button key={g} disabled={disabled && !on} onClick={() => { if (!disabled && !on) { sfx.tap(); onChange(g); } }}
            className={`rounded-2xl border-2 px-3 py-2.5 text-left transition-colors ${on ? 'border-amber bg-amber/15' : 'border-line/70 bg-white/5 hover:border-sky/60'} ${disabled && !on ? 'opacity-40' : ''}`}>
            <div className="display font-bold leading-tight">{m.emoji} {m.short}</div>
            <div className="text-xs text-mist leading-snug mt-0.5">{m.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Settings a game switch should apply (keeps the quiz topic; resets the race time limit). */
export const settingsForGame = (s: RoomSettings, game: GameKind): RoomSettings =>
  ({ ...s, game, limitSec: game === 'quiz' ? s.limitSec : RACE_DEFAULT_SEC[game] });

const GROUPS = ['World', 'Physical', 'Regions', 'History'] as const;

/** Crossword sources + size, and the time limit for any race. */
export function RaceSettings({ s, onChange, disabled }: { s: Pick<RoomSettings, 'game' | 'sources' | 'size' | 'limitSec'>; onChange: (p: Partial<RoomSettings>) => void; disabled?: boolean }) {
  const toggle = (k: string) => {
    if (disabled) return;
    const has = s.sources.includes(k);
    if (!has && s.sources.length >= LIMITS.maxSources) return;
    onChange({ sources: has ? s.sources.filter((x) => x !== k) : [...s.sources, k] });
  };
  return (
    <div className="space-y-2">
      {s.game === 'crossword' && (
        <div className="rounded-2xl border border-line/60 bg-white/5 p-3">
          <div className="text-xs uppercase tracking-wider text-mist font-bold">Crossword topics <span className="normal-case font-normal">· none = random mix</span></div>
          {GROUPS.map((g) => (
            <div key={g} className="flex flex-wrap gap-1.5 mt-2">
              {CW_SOURCES.filter((x) => x.group === g).map((x) => {
                const on = s.sources.includes(x.key);
                return (
                  <button key={x.key} disabled={disabled} onClick={() => toggle(x.key)}
                    className={`chip !text-sm !py-1 !px-2.5 ${on ? '!bg-amber/20 !border-amber text-amber' : ''} ${disabled && !on ? 'opacity-50' : ''}`}>
                    {x.emoji} {x.title}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 mt-3">
            {(['mini', 'standard'] as const).map((z) => (
              <button key={z} disabled={disabled} onClick={() => onChange({ size: z })}
                className={`rounded-xl border-2 py-2 display font-bold ${s.size === z ? 'border-amber bg-amber/15 text-amber' : 'border-line/60 bg-white/5'} ${disabled && s.size !== z ? 'opacity-50' : ''}`}>
                {SIZES[z].label} <span className="text-xs text-mist font-normal">{SIZES[z].size}×{SIZES[z].size}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Stepper label="Time limit (minutes)" value={Math.round(s.limitSec / 60)} min={Math.ceil(LIMITS.minLimitSec / 60)} max={Math.floor(LIMITS.maxLimitSec / 60)}
        onChange={(m) => onChange({ limitSec: m * 60 })} disabled={disabled} />
    </div>
  );
}

/* ---------------- puzzle ---------------- */

/** The race puzzle for (settings, seed), built locally and identically on every device. */
export function useRacePuzzle(spec: RacePuzzleSpec, seed: number) {
  const key = `${spec.game}|${spec.size}|${spec.sources.join(',')}|${seed}`;
  const [p, setP] = useState<{ key: string; puzzle: RacePuzzle | null } | null>(null);
  useEffect(() => {
    let live = true;
    buildRace(spec, seed).then((puzzle) => live && setP({ key, puzzle }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return p?.key === key ? { ready: true, puzzle: p.puzzle } : { ready: false, puzzle: null };
}

/**
 * Throttled reporter: forwards progress at most every 300 ms, but a finished report goes out
 * immediately. Always delivers the latest report.
 */
export function useThrottledReport(send: (r: RaceReport) => void) {
  const last = useRef(0);
  const pending = useRef<RaceReport | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((r: RaceReport) => {
    pending.current = r;
    const flush = () => {
      timer.current = null;
      if (!pending.current) return;
      last.current = Date.now();
      sendRef.current(pending.current);
      pending.current = null;
    };
    const wait = 300 - (Date.now() - last.current);
    if (r.done || wait <= 0) { if (timer.current) { clearTimeout(timer.current); timer.current = null; } flush(); }
    else if (!timer.current) timer.current = setTimeout(flush, wait);
  }, []);
}

/** Renders the right game for a puzzle in race mode. */
export function RaceBoard({ puzzle, title, onReport, onExit, locked, header }: {
  puzzle: RacePuzzle; title: string; onReport: (r: RaceReport) => void; onExit: () => void; locked?: boolean; header: React.ReactNode;
}) {
  if (puzzle.game === 'crossword') {
    return <CrosswordPlay race={{ cw: puzzle.cw, title, onReport, header, locked }} onExit={onExit} />;
  }
  return (
    <div className="min-h-dvh flex flex-col mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2 px-4 pt-3">
        <button aria-label="Leave" onClick={onExit} className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 border border-line">✕</button>
        <div className="flex-1 min-w-0 display font-bold leading-tight">{title}</div>
      </div>
      <div className="px-4">{header}</div>
      <div className="mt-2">
        {puzzle.game === 'hotcold'
          ? <HotColdRaceGame target={puzzle.target} race={{ onReport, locked }} />
          : <BorderlineRaceGame route={puzzle.route} race={{ onReport, locked }} />}
      </div>
    </div>
  );
}

/* ---------------- live progress ---------------- */

/** Countdown + compact live standings, shown above the race board. */
export function RaceStrip({ game, left, totalMs, players, progress, you }: {
  game: RaceGame; left: number; totalMs: number; players: Pick<Player, 'id' | 'name' | 'connected' | 'pid'>[]; progress: Record<string, RaceProgress | RaceReport>; you: string;
}) {
  const score = (id: string) => (progress[id] && 'score' in progress[id] ? (progress[id] as RaceProgress).score : 0);
  const sorted = [...players].sort((a, b) => score(b.id) - score(a.id) || a.name.localeCompare(b.name));
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div className="flex-1"><TimerBar left={left} total={totalMs} /></div>
        <span className={`mono text-sm font-bold w-12 text-right ${left < 30000 ? 'text-rose' : 'text-mist'}`}>{fmtClock(left)}</span>
      </div>
      {sorted.length > 0 && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto scrollbar-none pb-0.5">
          {sorted.map((p) => {
            const pr = progress[p.id];
            return (
              <motion.div key={p.id} className={`shrink-0 rounded-xl border px-2 py-1 flex items-center gap-1.5 ${p.id === you ? 'border-amber/70 bg-amber/10' : 'border-line/60 bg-white/5'} ${pr?.done ? '!border-mint/60' : ''}`}>
                <PlayerLink pid={p.pid} className="flex items-center gap-1.5">
                  <Avatar p={p} size={20} dim={!p.connected} />
                  <span className="text-xs font-bold whitespace-nowrap">{p.id === you ? 'You' : p.name}</span>
                </PlayerLink>
                <span className={`text-xs whitespace-nowrap ${pr?.done ? 'text-mint' : 'text-mist'}`}>{progressText(game, pr)}</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** XP for a finished race: more for solving it. */
export const raceXp = (r: RaceReport | undefined) => (!r ? 0 : r.done ? 40 : r.a > 0 ? 15 : 0);
