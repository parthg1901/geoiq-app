/**
 * GeoIQ multiplayer protocol — shared by the app (src/lib/mp/*) and the server (server/src/*).
 *
 * Questions are never sent over the wire. Every client builds the identical question list from
 * (topic, seed, rounds) with the deterministic generator in src/lib/mp/questions.ts, using the data
 * bundled in the app. The server only runs the clock, collects outcomes and keeps score — so rooms
 * require players on the same data version (see `dataVersion`).
 *
 * Trust model: friends-and-family. Clients report whether they were right; the server measures time
 * itself (server receive time − round start), so speed points can't be faked by a modified client.
 */

export const MP_PROTOCOL = 2;

/** Server base URL (overridable for local testing with VITE_MP_URL). */
export const MP_DEFAULT_URL = 'https://play.geoiq.workers.dev';

/**
 * What the questions are about. World modes reuse the country quiz variants; packs use the content
 * packs. Examples: "world:shape", "world:flag", "world:mix", "pack:us-states:shape", "pack:rivers:find".
 */
export type Topic = string;

/**
 * quiz       – rounds of timed questions on `topic` (the original mode)
 * crossword  – race to solve the same crossword (built from `sources` + `size`); no check/reveal
 * hotcold    – race to find the same mystery country by distance clues
 * borderline – race to connect the same start/end countries over land borders
 * Race games are one long 'race' phase limited to `limitSec`; puzzles come from `seed` on every device.
 */
export type GameKind = 'quiz' | 'crossword' | 'hotcold' | 'borderline';
export const GAMES: GameKind[] = ['quiz', 'crossword', 'hotcold', 'borderline'];

export interface RoomSettings {
  game: GameKind;
  topic: Topic; // quiz
  rounds: number; // quiz: 5–20
  seconds: number; // quiz: per question, 8–30
  sources: string[]; // crossword: CW_SOURCES keys (empty = random mix)
  size: 'mini' | 'standard'; // crossword
  limitSec: number; // race games: time limit
}
export const DEFAULT_SETTINGS: RoomSettings = { game: 'quiz', topic: 'world:mix', rounds: 10, seconds: 15, sources: [], size: 'mini', limitSec: 300 };
/** Sensible default time limit per race game (seconds). */
export const RACE_DEFAULT_SEC: Record<Exclude<GameKind, 'quiz'>, number> = { crossword: 420, hotcold: 240, borderline: 180 };
export const LIMITS = {
  minPlayers: 1, maxPlayers: 8, minRounds: 5, maxRounds: 20, minSeconds: 8, maxSeconds: 30,
  minLimitSec: 60, maxLimitSec: 1200, maxSources: 12,
};

/** Phase timing (ms). */
export const TIMING = { countdown: 3000, reveal: 4500 };

/** Room codes: 4 letters, no ambiguous ones (no I, O). */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Challenge codes look like "GEO-7K2P" (letters + digits, no 0/O/1/I). */
export const CHALLENGE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Points for one answer: up to 1000, half for being right, half for speed. */
export function points(outcome: number, ms: number, seconds: number) {
  if (outcome <= 0) return 0;
  const speed = Math.max(0, 1 - ms / (seconds * 1000));
  return Math.round(outcome * (500 + 500 * speed));
}

export interface Player {
  id: string; // stable per device (deviceId), so reconnects keep the seat
  name: string;
  score: number;
  connected: boolean;
  correct: number;
  /** Duel rating the player reported (display only). */
  rating: number;
}

export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'race' | 'end';

export interface RoundAnswer { outcome: number; ms: number; points: number }

/**
 * Live race progress reported by a player (the server adds timing and score).
 *   crossword:  a = words solved, b = total words,                          c = 0
 *   hotcold:    a = guesses so far, b = closest distance so far in km (0 = found), c = 0
 *   borderline: a = guesses so far, b = countries placed on a shortest route, c = countries the shortest route needs
 */
export interface RaceReport { a: number; b: number; c: number; done: boolean }
export interface RaceProgress extends RaceReport { finishMs: number | null; score: number }

/**
 * Race score (higher is better). Finishing always beats not finishing; among finishers, the game's
 * main measure wins and speed breaks near-ties. `finishMs`/`limitMs` are measured by the server
 * (live rooms) or the client (async challenges).
 */
export function raceScore(game: Exclude<GameKind, 'quiz'>, r: RaceReport, finishMs: number | null, limitMs: number) {
  const speed = finishMs == null ? 0 : Math.max(0, 1 - finishMs / limitMs);
  switch (game) {
    case 'crossword': {
      const solved = r.b > 0 ? Math.min(1, r.a / r.b) : 0;
      return Math.round(solved * 1000 + (r.done ? 1000 + 1000 * speed : 0));
    }
    case 'hotcold':
      if (!r.done && r.a === 0) return 0; // no guesses yet (b = 0 must not read as "0 km away")
      return r.done
        ? Math.round(2000 + Math.max(0, 1000 - (r.a - 1) * 100) + 500 * speed)
        : Math.round(Math.max(0, 1000 - r.b / 20)); // closer unsolved guesses still earn something
    case 'borderline': {
      if (r.done) return Math.round(2000 + Math.max(0, 1000 - Math.max(0, r.a - r.c) * 150) + 500 * speed);
      return Math.round(r.c > 0 ? (Math.min(r.b, r.c) / r.c) * 1000 : 0);
    }
  }
}

export interface RoomState {
  code: string;
  phase: Phase;
  hostId: string;
  settings: RoomSettings;
  seed: number; // question seed for this game (new each game)
  round: number; // 0-based index of the current/last question
  phaseEndsAt: number; // server epoch ms when the current phase ends (0 in lobby/end)
  players: Player[];
  /** Who has answered the current round. Outcomes/points are only included in 'reveal' and 'end'. */
  answered: string[];
  answers: Record<string, RoundAnswer>;
  /** Race games: live progress per player (visible to everyone during the race). */
  progress: Record<string, RaceProgress>;
  serverNow: number;
}

/* ---------------- client → server (WebSocket JSON) ---------------- */
export type C2S =
  | { t: 'hello'; deviceId: string; name: string; rating: number; protocol: number; dataVersion: string }
  | { t: 'settings'; settings: RoomSettings } // host, lobby only
  | { t: 'start' } // host, lobby only
  | { t: 'answer'; round: number; outcome: number } // quiz: outcome 0..1 for the current round
  | { t: 'progress'; report: RaceReport } // race games: latest progress (send on every change; final with done=true)
  | { t: 'lobby' } // host, after 'end': back to the lobby for another game
  | { t: 'kick'; playerId: string } // host
  | { t: 'ping'; c: number };

/* ---------------- server → client ---------------- */
export type ErrorCode = 'notfound' | 'full' | 'version' | 'bad' | 'started' | 'kicked';
export type S2C =
  | { t: 'welcome'; you: string; state: RoomState }
  | { t: 'state'; state: RoomState }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string };

/* ---------------- HTTP API ---------------- */
// POST /api/rooms                         { dataVersion }                → { code }
// GET  /api/rooms/:code                                                  → { code, phase, players: {name}[], settings, dataVersion } | 404
// GET  /api/rooms/:code/ws   (WebSocket upgrade)
// POST /api/challenges                    CreateChallenge                → { code, challenge }
// GET  /api/challenges/:code                                             → Challenge | 404
// POST /api/challenges/:code/results      { result: ChallengeResult }    → Challenge   (one result per deviceId; first one counts)
// GET  /api/health                                                       → { ok: true, protocol }

/** Async challenges support every game; race settings are optional for quiz challenges. */
export interface ChallengeSpec {
  game?: GameKind; // default 'quiz'
  topic: Topic;
  rounds: number;
  seed: number;
  dataVersion: string;
  sources?: string[];
  size?: 'mini' | 'standard';
  limitSec?: number;
}
export interface ChallengeResult {
  deviceId: string;
  name: string;
  score: number; // Σ points(outcome, ms, CHALLENGE_SECONDS)
  correct: number;
  total: number;
  timeMs: number;
  outcomes: number[]; // quiz: per-question outcomes; races: []
  /** Race challenges: the final report (score = raceScore(game, report, timeMs, limitSec·1000)). */
  report?: RaceReport;
  at: number;
}
export const CHALLENGE_SECONDS = 20; // per question, for speed points
export const CHALLENGE_TTL_DAYS = 30;
export interface CreateChallenge { spec: Omit<ChallengeSpec, 'seed'> & { seed?: number }; result: ChallengeResult }
export interface Challenge {
  code: string;
  spec: ChallengeSpec;
  creator: { deviceId: string; name: string };
  createdAt: number;
  expiresAt: number;
  results: ChallengeResult[];
}

/** Basic sanitising shared by both ends. */
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Explorer';
