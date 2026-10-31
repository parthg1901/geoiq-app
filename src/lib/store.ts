import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { freshRatings, update, geoIQ, itemFor, type Format, type Ratings, type Skill } from './geoiq';
import { todayKey, dayDiff, addDays } from './rng';
import { COUNTRIES } from '../data';

export const CORE: Skill[] = ['shape', 'flag', 'map', 'capital'];
const INTERVAL_DAYS = [0, 1, 3, 7, 16, 40];

export interface Card { box: number; due: number; seen: number; right: number }
export interface DayLog { xp: number; answers: number; right: number }
export interface TestResult { date: string; iq: number; skills: Partial<Record<Skill, number>>; correct: number; total: number }
/** dOffset: extra item difficulty for harder question types sharing a skill (e.g. coats of arms vs flags). */
export interface AnswerInput { id: string; skill: Skill; format: Format; outcome: number; ms?: number; combo?: number; practice?: boolean; dOffset?: number }
export interface AnswerResult { xp: number; iqBefore: number; iqAfter: number; stamp: boolean; levelUp: boolean }
/** Progress in one content pack (regions / physical / history). Separate from the country GeoIQ. */
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
  // actions
  packAnswer: (a: PackAnswerInput) => { xp: number; levelUp: boolean };
  packUpdate: (pack: string, fn: (p: PackState) => PackState) => void;
  answer: (a: AnswerInput) => AnswerResult;
  addXP: (n: number, coins?: number) => void;
  checkStreak: () => { lost: number; froze: number };
  set: (p: Partial<State>) => void;
  bump: (key: string, n?: number) => void;
  best: (key: string, v: number, lowerIsBetter?: boolean) => boolean;
  unlock: (id: string) => boolean;
  reset: () => void;
}

export const levelFor = (xp: number) => {
  // Level n needs 60·n^1.5 cumulative-ish XP; returns level and progress within it.
  let lvl = 1, need = 80, acc = 0;
  while (xp >= acc + need) { acc += need; lvl++; need = Math.round(80 * Math.pow(lvl, 1.35)); }
  return { level: lvl, into: xp - acc, need };
};

export function mastery(cards: Record<string, Card>, id: string) {
  return CORE.reduce((a, s) => a + Math.min(4, cards[`${id}:${s}`]?.box ?? 0) / 4, 0) / CORE.length;
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
});

export const emptyPack = (): PackState => ({ cards: {}, best: {}, plays: 0 });

/** Next Leitner card after an answer (shared by countries and packs). */
function nextCard(c: Card | undefined, ok: boolean): Card {
  const cur = c ?? { box: 0, due: 0, seen: 0, right: 0 };
  const box = ok ? Math.min(5, cur.box + 1) : Math.max(0, Math.min(1, cur.box - 2));
  return { box, due: Date.now() + INTERVAL_DAYS[box] * 86400000 - 3600000, seen: cur.seen + 1, right: cur.right + (ok ? 1 : 0) };
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
      addXP: (n, coins = 0) => {
        const day = todayKey();
        set((s) => {
          const d = s.days[day] ?? { xp: 0, answers: 0, right: 0 };
          const nd = { ...d, xp: d.xp + n };
          return { xp: s.xp + n, coins: s.coins + coins, days: { ...s.days, [day]: nd }, streak: bumpStreak(s.streak, nd.xp, day) };
        });
      },
      checkStreak: () => {
        const s = get().streak;
        const today = todayKey();
        if (!s.last) return { lost: 0, froze: 0 };
        const gap = dayDiff(s.last, today);
        if (gap <= 1) return { lost: 0, froze: 0 };
        const missed = gap - 1;
        if (missed <= s.freezes) {
          const frozen = Array.from({ length: missed }, (_, i) => addDays(s.last!, i + 1));
          // Freezes bridge the gap: pretend "last" was yesterday.
          set({ streak: { ...s, freezes: s.freezes - missed, last: addDays(today, -1), frozen: [...s.frozen, ...frozen] } });
          return { lost: 0, froze: missed };
        }
        const lost = s.count;
        set({ streak: { ...s, count: 0 } });
        return { lost, froze: 0 };
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
        const ratings: Ratings = {
          ...s.ratings,
          [a.skill]: update(s.ratings[a.skill], item.d, a.format, a.outcome, kScale),
          all: update(s.ratings.all, item.d, a.format, a.outcome, kScale * 0.8),
        };
        const after = geoIQ(ratings).iq;
        // SRS (only for core skills; hint/photo feed the capital/shape-ish memory lightly)
        const key = `${a.id}:${a.skill}`;
        const cards = { ...s.cards };
        if (CORE.includes(a.skill)) cards[key] = nextCard(cards[key], a.outcome >= 0.6);
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
    { name: 'geoiq-v1', version: 1 },
  ),
);

function bumpStreak(st: State['streak'], dayXp: number, day: string): State['streak'] {
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
