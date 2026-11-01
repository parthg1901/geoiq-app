import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { freshRatings, update, updateLadder, geoIQ, itemFor, type Format, type Ratings, type Skill } from './geoiq';
import { todayKey, dayDiff, addDays } from './rng';
import { COUNTRIES, BY_ID, NO_SHAPE, NO_CAPITAL_Q } from '../data';
import type { Crossword } from './crossword';

export const CORE: Skill[] = ['shape', 'flag', 'map', 'capital'];
const INTERVAL_DAYS = [0, 1, 3, 7, 16, 40];

export interface Card { box: number; due: number; seen: number; right: number }
export interface DayLog { xp: number; answers: number; right: number }
export interface TestResult { date: string; iq: number; skills: Partial<Record<Skill, number>>; correct: number; total: number }
/** dOffset: extra item difficulty for harder question types sharing a skill (e.g. coats of arms vs flags). */
export interface AnswerInput {
  id: string; skill: Skill; format: Format; outcome: number; ms?: number; combo?: number; practice?: boolean; dOffset?: number;
  /** Clue Ladder: which clue it was solved on (0 = never) out of how many were shown — rated per clue. */
  ladder?: { solvedAt: number; shown: number };
  /** Whether this answer should train the country's memory card (false for e.g. coats of arms). */
  srs?: boolean;
}
export interface AnswerResult { xp: number; iqBefore: number; iqAfter: number; stamp: boolean; levelUp: boolean }
/** Progress in one content pack (regions / physical / history). Separate from the country GeoIQ. */
/** An in-progress (or just finished) crossword. Flat strings are row-major over the grid. */
export interface SavedCrossword {
  key: string; // 'daily:2026-10-31' or 'custom'
  title: string;
  size: string; // mini | standard | big
  cw: Crossword;
  fill: string; // typed letters, ' ' for empty, '#' for blocks
  revealed: string; // '1' where a letter was revealed
  checks: number;
  reveals: number;
  elapsed: number; // seconds
  done: boolean;
}
export interface PackState { cards: Record<string, Card>; best: Record<string, number>; plays: number }
export interface PackAnswerInput { pack: string; item: string; mode: string; outcome: number; ms?: number; combo?: number }

interface State {
  name: string;
  createdAt: string;
  ratings: Ratings;
  iqHistory: { date: string; iq: number }[];
  tests: TestResult[];
  cards: Record<string, Card>;
  xp: number;
  coins: number;
  days: Record<string, DayLog>;
  streak: { count: number; best: number; last: string | null; freezes: number; frozen: string[] };
  dailyGoal: number;
  spinDay: string | null;
  daily: Record<string, { score: number; grid: string; time: number }>;
  lessons: Record<string, number>;
  achievements: Record<string, string>;
  stamps: Record<string, string>;
  bests: Record<string, number>;
  counters: Record<string, number>;
  sound: boolean;
  reminder: { on: boolean; hour: number; minute: number };
  onboarded: boolean;
  packs: Record<string, PackState>;
  crossword: { daily?: SavedCrossword; custom?: SavedCrossword };
  cwDaily: Record<string, { time: number; reveals: number }>;
  cwPrefs: { sources: string[]; size: string };
  mp: MpState;
  mpUpdate: (p: Partial<MpState>) => void;
  /** Record a finished live game once (keyed by room+seed): duel rating, win count and XP. Repeat calls return the stored outcome. */
  mpFinish: (g: MpGameResult) => MpGameOutcome | null;
  // actions
  packAnswer: (a: PackAnswerInput) => { xp: number; levelUp: boolean };
  packUpdate: (pack: string, fn: (p: PackState) => PackState) => void;
  answer: (a: AnswerInput) => AnswerResult;
  /** bonus: rewards (e.g. the daily spin) add to total XP but don't count as today's practice. */
  addXP: (n: number, coins?: number, opts?: { bonus?: boolean }) => void;
  checkStreak: () => { lost: number; froze: number };
  set: (p: Partial<State>) => void;
  bump: (key: string, n?: number) => void;
  best: (key: string, v: number, lowerIsBetter?: boolean) => boolean;
  unlock: (id: string) => boolean;
  reset: () => void;
}

/** Multiplayer identity and duel record (separate from GeoIQ). */
export interface MpChallengeRef { code: string; topic: string; createdAt: number; role: 'creator' | 'player' }
export interface MpGameOutcome { key: string; delta: number; won: boolean; xp: number }
export interface MpState { deviceId: string; name: string; rating: number; matches: number; wins: number; challenges: MpChallengeRef[]; lastGame: string | null; lastResult?: MpGameOutcome; /** room chat pop-ups while playing (default on) */ chatBubbles?: boolean }
/** `xp`: base XP for this game when it isn't 8 per correct answer (race games). */
export interface MpGameResult { key: string; you: string; players: { id: string; score: number; rating: number; correct: number }[]; xp?: number }

const newDeviceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Multi-player Elo: every pair of players is a mini-match decided by final score (ties = draw),
 * with K = 32 / (n − 1) so a big room doesn't swing ratings more than a 1v1.
 */
export function eloDelta(players: MpGameResult['players'], you: string): number {
  const me = players.find((p) => p.id === you);
  if (!me || players.length < 2) return 0;
  const k = 32 / (players.length - 1);
  let d = 0;
  for (const o of players) {
    if (o.id === you) continue;
    const s = me.score > o.score ? 1 : me.score === o.score ? 0.5 : 0;
    const e = 1 / (1 + 10 ** ((o.rating - me.rating) / 400));
    d += k * (s - e);
  }
  return Math.round(d);
}

export const levelFor = (xp: number) => {
  // Level 1→2 needs 80 XP; level n→n+1 needs 80·n^1.35. Returns level and progress within it.
  let lvl = 1, need = 80, acc = 0;
  while (xp >= acc + need) { acc += need; lvl++; need = Math.round(80 * Math.pow(lvl, 1.35)); }
  return { level: lvl, into: xp - acc, need };
};

/**
 * The core skills a country can actually be asked about. Microstates have no shape question and
 * city-states no capital question, so their stamp is earned on the skills they do have.
 */
export function stampSkills(id: string): Skill[] {
  return CORE.filter((s) => (s !== 'shape' || !NO_SHAPE.has(id)) && (s !== 'capital' || (!!BY_ID[id]?.capital && !NO_CAPITAL_Q.has(id))));
}

/** 0..1 memory strength over the country's available core skills (each skill counts up to box 4). */
export function mastery(cards: Record<string, Card>, id: string) {
  const skills = stampSkills(id);
  return skills.reduce((a, s) => a + Math.min(4, cards[`${id}:${s}`]?.box ?? 0) / 4, 0) / Math.max(1, skills.length);
}

const initial = () => ({
  name: '',
  createdAt: todayKey(),
  ratings: freshRatings(),
  iqHistory: [] as { date: string; iq: number }[],
  tests: [] as TestResult[],
  cards: {} as Record<string, Card>,
  xp: 0,
  coins: 50,
  days: {} as Record<string, DayLog>,
  streak: { count: 0, best: 0, last: null as string | null, freezes: 1, frozen: [] as string[] },
  dailyGoal: 60,
  spinDay: null as string | null,
  daily: {} as Record<string, { score: number; grid: string; time: number }>,
  lessons: {} as Record<string, number>,
  achievements: {} as Record<string, string>,
  stamps: {} as Record<string, string>,
  bests: {} as Record<string, number>,
  counters: {} as Record<string, number>,
  sound: true,
  reminder: { on: false, hour: 19, minute: 0 },
  onboarded: false,
  packs: {} as Record<string, PackState>,
  crossword: {} as { daily?: SavedCrossword; custom?: SavedCrossword },
  cwDaily: {} as Record<string, { time: number; reveals: number }>,
  cwPrefs: { sources: [] as string[], size: 'standard' },
  mp: { deviceId: newDeviceId(), name: '', rating: 1000, matches: 0, wins: 0, challenges: [] as MpChallengeRef[], lastGame: null as string | null },
});

export const emptyPack = (): PackState => ({ cards: {}, best: {}, plays: 0 });

/**
 * Next Leitner card after an answer (shared by countries and packs).
 * A right answer only moves a card up a box once it's due — repeating it minutes later proves
 * nothing about long-term memory (and would let stamps be farmed). A miss always knocks it back.
 */
export function nextCard(c: Card | undefined, ok: boolean, now = Date.now()): Card {
  const cur = c ?? { box: 0, due: 0, seen: 0, right: 0 };
  if (ok && cur.due > now) return { ...cur, seen: cur.seen + 1, right: cur.right + 1 };
  const box = ok ? Math.min(5, cur.box + 1) : Math.max(0, Math.min(1, cur.box - 2));
  return { box, due: now + INTERVAL_DAYS[box] * 86400000 - 3600000, seen: cur.seen + 1, right: cur.right + (ok ? 1 : 0) };
}

/** 0..1: average memory strength of a pack's items across the modes you've played. */
export function packMastery(ps: PackState | undefined, itemIds: string[]): number {
  if (!ps || !itemIds.length) return 0;
  const byItem: Record<string, number[]> = {};
  for (const [k, c] of Object.entries(ps.cards)) {
    const id = k.slice(0, k.lastIndexOf(':'));
    (byItem[id] ??= []).push(Math.min(4, c.box) / 4);
  }
  return itemIds.reduce((a, id) => a + (byItem[id] ? Math.max(...byItem[id]) : 0), 0) / itemIds.length;
}
export function itemMastery(ps: PackState | undefined, id: string): number {
  if (!ps) return 0;
  let m = 0;
  for (const [k, c] of Object.entries(ps.cards)) if (k.slice(0, k.lastIndexOf(':')) === id) m = Math.max(m, Math.min(4, c.box) / 4);
  return m;
}

export const STREAK_MIN_XP = 20;

export const useGame = create<State>()(
  persist(
    (set, get) => ({
      ...initial(),
      set: (p) => set(p),
      reset: () => set(initial()),
      mpUpdate: (p) => set((s) => ({ mp: { ...s.mp, ...p } })),
      mpFinish: (g) => {
        const s = get();
        if (s.mp.lastGame === g.key) return s.mp.lastResult?.key === g.key ? s.mp.lastResult : null; // already recorded
        const me = g.players.find((p) => p.id === g.you);
        if (!me) return null;
        const top = Math.max(...g.players.map((p) => p.score));
        const won = g.players.length >= 2 && me.score === top && me.score > 0;
        const delta = eloDelta(g.players, g.you);
        const xp = (g.xp ?? me.correct * 8) + (won ? 25 : 0);
        const lastResult = { key: g.key, delta, won, xp };
        set({ mp: { ...s.mp, rating: s.mp.rating + delta, matches: s.mp.matches + 1, wins: s.mp.wins + (won ? 1 : 0), lastGame: g.key, lastResult } });
        if (xp) get().addXP(xp, won ? 10 : 2);
        get().bump('mpGames');
        if (won) get().bump('mpWins');
        return lastResult;
      },
      bump: (key, n = 1) => set((s) => ({ counters: { ...s.counters, [key]: (s.counters[key] ?? 0) + n } })),
      best: (key, v, lower = false) => {
        const cur = get().bests[key];
        const better = cur == null || (lower ? v < cur : v > cur);
        if (better) set((s) => ({ bests: { ...s.bests, [key]: v } }));
        return better;
      },
      unlock: (id) => {
        if (get().achievements[id]) return false;
        set((s) => ({ achievements: { ...s.achievements, [id]: todayKey() } }));
        return true;
      },
      addXP: (n, coins = 0, opts) => {
        const day = todayKey();
        if (opts?.bonus) { set((s) => ({ xp: s.xp + n, coins: s.coins + coins })); return; }
        set((s) => {
          const d = s.days[day] ?? { xp: 0, answers: 0, right: 0 };
          const nd = { ...d, xp: d.xp + n };
          return { xp: s.xp + n, coins: s.coins + coins, days: { ...s.days, [day]: nd }, streak: bumpStreak(s.streak, nd.xp, day) };
        });
      },
      checkStreak: () => {
        const s = get().streak;
        const r = settleGap(s, todayKey());
        if (r.streak !== s) set({ streak: r.streak });
        return { lost: r.lost, froze: r.froze };
      },
      packUpdate: (pack, fn) => set((s) => ({ packs: { ...s.packs, [pack]: fn(s.packs[pack] ?? emptyPack()) } })),
      packAnswer: (a) => {
        const s = get();
        const ps = s.packs[a.pack] ?? emptyPack();
        const ok = a.outcome >= 0.6;
        const key = `${a.item}:${a.mode}`;
        const speed = a.ms != null && ok ? Math.max(0, Math.round((8000 - a.ms) / 1000)) : 0;
        const combo = Math.min(5, Math.floor((a.combo ?? 0) / 3));
        const xp = Math.round(a.outcome * 10) + speed + (ok ? combo * 2 : 0) + 1;
        const day = todayKey();
        const d = s.days[day] ?? { xp: 0, answers: 0, right: 0 };
        const nd = { xp: d.xp + xp, answers: d.answers + 1, right: d.right + (ok ? 1 : 0) };
        const lvlBefore = levelFor(s.xp).level;
        set({
          packs: { ...s.packs, [a.pack]: { ...ps, cards: { ...ps.cards, [key]: nextCard(ps.cards[key], ok) } } },
          xp: s.xp + xp,
          coins: s.coins + (ok ? 1 : 0),
          days: { ...s.days, [day]: nd },
          streak: bumpStreak(s.streak, nd.xp, day),
        });
        return { xp, levelUp: levelFor(s.xp + xp).level > lvlBefore };
      },
      answer: (a) => {
        const s = get();
        const before = geoIQ(s.ratings).iq;
        const item = itemFor(a.id, a.skill, a.dOffset);
        const kScale = a.practice ? 0.6 : 1;
        const rate = (r: Ratings[Skill], k: number) =>
          a.ladder ? updateLadder(r, item.d, a.ladder.solvedAt, a.ladder.shown, k) : update(r, item.d, a.format, a.outcome, k);
        const ratings: Ratings = { ...s.ratings, [a.skill]: rate(s.ratings[a.skill], kScale), all: rate(s.ratings.all, kScale * 0.8) };
        const after = geoIQ(ratings).iq;
        // SRS (only for core skills; hint/photo feed the capital/shape-ish memory lightly)
        const key = `${a.id}:${a.skill}`;
        const cards = { ...s.cards };
        if (CORE.includes(a.skill) && a.srs !== false) cards[key] = nextCard(cards[key], a.outcome >= 0.6);
        const wasStamped = !!s.stamps[a.id];
        const stamp = !wasStamped && mastery(cards, a.id) >= 0.75;
        // XP: base 10 for correct, partial credit, speed and combo bonus
        const speed = a.ms != null && a.outcome >= 0.6 ? Math.max(0, Math.round((8000 - a.ms) / 1000)) : 0;
        const combo = Math.min(5, Math.floor((a.combo ?? 0) / 3));
        const xp = Math.round(a.outcome * 10) + speed + (a.outcome >= 0.6 ? combo * 2 : 0) + 1;
        const day = todayKey();
        const d = s.days[day] ?? { xp: 0, answers: 0, right: 0 };
        const nd = { xp: d.xp + xp, answers: d.answers + 1, right: d.right + (a.outcome >= 0.6 ? 1 : 0) };
        const lvlBefore = levelFor(s.xp).level;
        const iqHistory = s.iqHistory.slice();
        if (iqHistory.length && iqHistory[iqHistory.length - 1].date === day) iqHistory[iqHistory.length - 1] = { date: day, iq: after };
        else iqHistory.push({ date: day, iq: after });
        set({
          ratings, cards, iqHistory,
          xp: s.xp + xp,
          coins: s.coins + (a.outcome >= 0.6 ? 1 : 0) + (stamp ? 10 : 0),
          days: { ...s.days, [day]: nd },
          streak: bumpStreak(s.streak, nd.xp, day),
          stamps: stamp ? { ...s.stamps, [a.id]: day } : s.stamps,
        });
        return { xp, iqBefore: before, iqAfter: after, stamp, levelUp: levelFor(s.xp + xp).level > lvlBefore };
      },
    }),
    {
      name: 'geoiq-v1',
      version: 3,
      migrate: (persisted, version) => {
        const st = persisted as State;
        // v2 → v3: mastery counts only the skills a country can be asked about — award any stamps that
        // were blocked before (e.g. Vatican City and Monaco could never be stamped).
        if (version < 3 && st?.cards) {
          const day = new Date().toISOString().slice(0, 10);
          const stamps = { ...(st.stamps ?? {}) };
          for (const c of COUNTRIES) if (!stamps[c.id] && mastery(st.cards, c.id) >= 0.75) stamps[c.id] = day;
          st.stamps = stamps;
        }
        // v1 → v2: the Clue Ladder used to inflate the Clues rating (partial-credit bug). Pull it back to
        // the overall level with low confidence so the new per-clue scoring recalibrates it quickly.
        if (version < 2 && st?.ratings?.hint && st.ratings.all) {
          const h = st.ratings.hint;
          st.ratings = { ...st.ratings, hint: { theta: Math.min(h.theta, st.ratings.all.theta), n: Math.min(h.n, 8) } };
        }
        return st;
      },
    },
  ),
);

/**
 * Resolve missed days before `today`: spend streak freezes to bridge the gap if there are enough,
 * otherwise the streak is lost. Shared by the app-start check and by every XP gain, so freezes work
 * even if the app stayed open across midnight.
 */
export function settleGap(st: State['streak'], today: string): { streak: State['streak']; lost: number; froze: number } {
  if (!st.last || st.count === 0) return { streak: st, lost: 0, froze: 0 };
  const missed = dayDiff(st.last, today) - 1;
  if (missed <= 0) return { streak: st, lost: 0, froze: 0 };
  if (missed <= st.freezes) {
    const frozen = Array.from({ length: missed }, (_, i) => addDays(st.last!, i + 1));
    // Freezes bridge the gap: pretend "last" was yesterday.
    return { streak: { ...st, freezes: st.freezes - missed, last: addDays(today, -1), frozen: [...st.frozen, ...frozen].slice(-60) }, lost: 0, froze: missed };
  }
  return { streak: { ...st, count: 0 }, lost: st.count, froze: 0 };
}

export function bumpStreak(st0: State['streak'], dayXp: number, day: string): State['streak'] {
  const st = settleGap(st0, day).streak;
  if (dayXp < STREAK_MIN_XP || st.last === day) return st;
  const cont = st.last && dayDiff(st.last, day) === 1;
  const count = cont ? st.count + 1 : 1;
  // Earn a streak freeze every 7 days (max 3)
  const freezes = count % 7 === 0 ? Math.min(3, st.freezes + 1) : st.freezes;
  return { ...st, count, best: Math.max(st.best, count), last: day, freezes };
}

export const dueCards = (cards: Record<string, Card>) =>
  Object.entries(cards).filter(([, c]) => c.due <= Date.now()).sort((a, b) => a[1].box - b[1].box || a[1].due - b[1].due);

export const TOTAL_COUNTRIES = COUNTRIES.length;
