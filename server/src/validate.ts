/** Input validation shared by live rooms and async challenges (protocol v2). */
import {
  GAMES, LIMITS, RACE_DEFAULT_SEC, DEFAULT_SETTINGS, raceScore,
  type GameKind, type RaceReport, type RoomSettings,
} from '../../src/lib/mp/protocol';

export type RaceGame = Exclude<GameKind, 'quiz'>;
export const isRace = (g: GameKind): g is RaceGame => g !== 'quiz';

const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

export function validTopic(t: unknown): t is string {
  return typeof t === 'string' && !!t && t.length <= 80 && /^[a-z0-9:_-]+$/i.test(t);
}

export function validSources(s: unknown): string[] | null {
  if (s === undefined) return [];
  if (!Array.isArray(s) || s.length > LIMITS.maxSources) return null;
  if (!s.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 32 && /^[a-z0-9-]+$/.test(x))) return null;
  return [...new Set(s as string[])];
}

export function validSize(s: unknown): 'mini' | 'standard' | null {
  if (s === undefined) return DEFAULT_SETTINGS.size;
  return s === 'mini' || s === 'standard' ? s : null;
}

/** Race time limit: in range → as given; otherwise the game's default (hosts switching game keep sane limits). */
export function limitFor(game: GameKind, v: unknown): number {
  if (int(v, LIMITS.minLimitSec, LIMITS.maxLimitSec)) return v;
  return isRace(game) ? RACE_DEFAULT_SEC[game] : DEFAULT_SETTINGS.limitSec;
}

export function validSettings(s: unknown): RoomSettings | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const game = (o.game ?? 'quiz') as GameKind;
  if (!GAMES.includes(game)) return null;
  if (!validTopic(o.topic)) return null;
  if (!int(o.rounds, LIMITS.minRounds, LIMITS.maxRounds)) return null;
  if (!int(o.seconds, LIMITS.minSeconds, LIMITS.maxSeconds)) return null;
  const sources = validSources(o.sources);
  const size = validSize(o.size);
  if (!sources || !size) return null;
  return { game, topic: o.topic, rounds: o.rounds, seconds: o.seconds, sources, size, limitSec: limitFor(game, o.limitSec) };
}

export function validReport(x: unknown): RaceReport | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000;
  if (!n(r.a) || !n(r.b) || !n(r.c) || typeof r.done !== 'boolean') return null;
  return { a: Math.round(r.a as number), b: Math.round(r.b as number), c: Math.round(r.c as number), done: r.done };
}

/**
 * raceScore() plus one guard: a Hot & Cold player who hasn't guessed yet reports b = 0
 * ("closest distance"), which raceScore would read as 0 km away. No guesses → no score.
 */
export function scoreOf(game: RaceGame, r: RaceReport, finishMs: number | null, limitMs: number) {
  if (!r.done && r.a === 0) return 0;
  return raceScore(game, r, finishMs, limitMs);
}
