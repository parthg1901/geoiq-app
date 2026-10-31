/**
 * Deterministic race puzzles: (game, seed, settings) → the identical puzzle on every device running
 * the same app version. Only the seeded rng is used — never Math.random.
 */
import { rng as seeded } from '../rng';
import { makeRoute, mysteryCountry, type Route } from '../border';
import { generate, type Crossword } from '../crossword';
import { buildEntries, SIZES, CW_SOURCE_BY_KEY } from '../crosswordSources';
import { topicLabel } from './questions';
import type { GameKind, RaceProgress, RaceReport, RoomSettings } from './protocol';

export type RaceGame = Exclude<GameKind, 'quiz'>;
export type RacePuzzle =
  | { game: 'crossword'; cw: Crossword }
  | { game: 'hotcold'; target: string }
  | { game: 'borderline'; route: Route };

export const GAME_META: Record<GameKind, { emoji: string; title: string; short: string; desc: string }> = {
  quiz: { emoji: '🎯', title: 'Quiz', short: 'Quiz', desc: 'Timed questions — faster right answers score more' },
  crossword: { emoji: '🧩', title: 'Crossword race', short: 'Crossword', desc: 'Same grid for everyone — first to finish wins' },
  hotcold: { emoji: '🌡️', title: 'Hot & Cold race', short: 'Hot & Cold', desc: 'Same mystery country — fewest guesses wins' },
  borderline: { emoji: '🛤️', title: 'Borderline race', short: 'Borderline', desc: 'Same start and end — shortest route wins' },
};

/** Settings fields that define a race puzzle (so every client derives the same one). */
export type RacePuzzleSpec = Pick<RoomSettings, 'game' | 'sources' | 'size'>;

/** Build the race puzzle for a seed. Crosswords can fail (too few words fit) → null. */
export async function buildRace(spec: RacePuzzleSpec, seed: number): Promise<RacePuzzle | null> {
  const r = seeded(seed);
  switch (spec.game) {
    case 'hotcold':
      return { game: 'hotcold', target: mysteryCountry(r) };
    case 'borderline':
      return { game: 'borderline', route: makeRoute(r) };
    case 'crossword': {
      const S = SIZES[spec.size] ?? SIZES.mini;
      const entries = await buildEntries(spec.sources ?? [], r, S.maxEase);
      const cw = generate(entries, { size: S.size, target: S.target, rng: r });
      return cw ? { game: 'crossword', cw } : null;
    }
    default:
      return null;
  }
}

/** "Countries, Rivers" / "Random mix" for crossword sources. */
export const sourcesLabel = (sources: string[]) =>
  sources.length ? sources.map((k) => CW_SOURCE_BY_KEY[k]?.title ?? k).join(', ') : 'Random mix';

/** One-line description of a game's settings, e.g. for the countdown screen. */
export function settingsLabel(s: RoomSettings) {
  if (s.game === 'quiz') return topicLabel(s.topic);
  const m = GAME_META[s.game];
  const extra = s.game === 'crossword' ? ` · ${SIZES[s.size]?.label ?? s.size} · ${sourcesLabel(s.sources)}` : '';
  return `${m.emoji} ${m.title}${extra}`;
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Compact progress text for the live race leaderboard and results. */
export function progressText(game: RaceGame, p: RaceProgress | RaceReport | undefined): string {
  if (!p) return 'Starting…';
  const fin = 'finishMs' in p && p.done && p.finishMs != null ? ` · ${fmtClock(p.finishMs)}` : '';
  switch (game) {
    case 'crossword':
      return p.done ? `✓ solved${fin}` : `${p.a}/${p.b || '?'} words`;
    case 'hotcold':
      if (p.done) return `✓ found in ${p.a}${fin}`;
      return p.a ? `${p.a} ${p.a === 1 ? 'guess' : 'guesses'} · ${p.b <= 1 ? 'touching!' : `${p.b.toLocaleString()} km`}` : 'No guesses yet';
    case 'borderline':
      if (p.done) return `✓ ${p.a} ${p.a === 1 ? 'guess' : 'guesses'}${fin}`;
      return `${Math.min(p.b, p.c)}/${p.c} placed · ${p.a} ${p.a === 1 ? 'guess' : 'guesses'}`;
  }
}
