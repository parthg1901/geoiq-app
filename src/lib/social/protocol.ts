/**
 * Friends & player profiles — shared by the app and the server (server/src/player.ts).
 *
 * Every player who goes social gets a public player id (8 chars, shown as "K7Q2-MX9D"), which is
 * also their friend code, and a secret key kept in their (synced) progress that authorises changes.
 * The public card is a summary of game stats the app publishes; anyone with the id can view it.
 *
 * HTTP API (JSON; `key` = the secret):
 *   POST /api/players {key}                         → {pid}           create a profile
 *   GET  /api/players/:pid                          → PlayerCard      anyone
 *   POST /api/players/:pid/me {key, card?}          → MeView          publish card + read friends/requests
 *   POST /api/players/:pid/board {key}              → {cards}         you + friends' cards
 *   POST /api/players/:pid/add {key, other, via}    → MeView          via 'code' = instant, 'request' = they accept
 *   POST /api/players/:pid/respond {key, other, accept} → MeView
 *   POST /api/players/:pid/remove {key, other}      → MeView
 */
import { cleanName } from '../mp/protocol';

export const PID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
export const PID_LEN = 8;
export const PID_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const SOCIAL_LIMITS = { friends: 200, requests: 50, stamps: 400, achievements: 120 };

export const formatPid = (p: string) => `${p.slice(0, 4)}-${p.slice(4)}`;
/** Friend codes typed by people: any case/spacing, O→0, I/L→1. */
export function normalizePid(input: string): string | null {
  const c = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return PID_RE.test(c) ? c : null;
}

export interface PlayerCard {
  pid: string;
  name: string;
  iq: number;
  level: number;
  xp: number;
  streak: number;
  bestStreak: number;
  /** Last day with practice (YYYY-MM-DD), for "active today". */
  lastActive: string | null;
  stamps: string[]; // ISO3
  achievements: string[];
  duel: { rating: number; matches: number; wins: number };
  /** XP this ISO week (Monday start) — the friends leaderboard's main race. */
  week: { id: string; xp: number };
  answers: number;
  accuracy: number; // 0..100
  since: string; // YYYY-MM-DD
  updatedAt: number; // set by the server
}
export interface FriendRequest { pid: string; name: string; at: number }
export interface MeView { friends: string[]; requests: FriendRequest[]; outgoing: string[] }

/** ISO week id of a local date, e.g. "2026-W44". */
export function weekId(day: string): string {
  const d = new Date(day + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Server-side validation of a published card (also clamps numbers). */
export function validCard(x: unknown, pid: string): PlayerCard | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : lo);
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const strs = (v: unknown, re: RegExp, max: number) => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && re.test(s)))].slice(0, max) : []);
  const duel = (c.duel ?? {}) as Record<string, unknown>;
  const week = (c.week ?? {}) as Record<string, unknown>;
  return {
    pid,
    name: cleanName(typeof c.name === 'string' ? c.name : ''),
    iq: n(c.iq, 40, 200),
    level: n(c.level, 1, 999),
    xp: n(c.xp, 0, 1e9),
    streak: n(c.streak, 0, 1e5),
    bestStreak: n(c.bestStreak, 0, 1e5),
    lastActive: day(c.lastActive),
    stamps: strs(c.stamps, /^[A-Z]{3}$/, SOCIAL_LIMITS.stamps),
    achievements: strs(c.achievements, /^[a-zA-Z0-9_-]{1,32}$/, SOCIAL_LIMITS.achievements),
    duel: { rating: n(duel.rating, 0, 4000), matches: n(duel.matches, 0, 1e7), wins: n(duel.wins, 0, 1e7) },
    week: { id: typeof week.id === 'string' && /^\d{4}-W\d{2}$/.test(week.id) ? week.id : '', xp: n(week.xp, 0, 1e8) },
    answers: n(c.answers, 0, 1e9),
    accuracy: n(c.accuracy, 0, 100),
    since: day(c.since) ?? '2026-01-01',
    updatedAt: Date.now(),
  };
}
