/**
 * Merging two copies of a player's progress (this phone vs the cloud) without losing anything.
 *
 * It is a three-way merge against `base` — the copy both sides last agreed on — so counters that
 * grew on both phones add up (XP earned on each is kept) instead of one side overwriting the other.
 * Without a base (first time two phones with their own progress are joined) totals take the larger side.
 *
 * Rules: stamps/achievements/days/tests are unions; memory cards and ratings keep the side that has
 * practised more; XP, coins and counters combine their changes; the streak follows the most recent play.
 */
import { COUNTRIES } from '../../data';
import { mastery, bumpStreak, type State, type Card, type PackState, type SavedCrossword } from '../store';
import { todayKey } from '../rng';

/** Progress that travels between devices (sound and reminder times stay per phone). */
export const SYNC_KEYS = [
  'name', 'createdAt', 'ratings', 'iqHistory', 'tests', 'cards', 'xp', 'coins', 'days', 'streak', 'dailyGoal', 'spinDay',
  'daily', 'lessons', 'achievements', 'stamps', 'bests', 'counters', 'onboarded', 'packs', 'crossword', 'cwDaily', 'cwPrefs', 'mp', 'social',
] as const;
type SyncKey = (typeof SYNC_KEYS)[number];
export type Snapshot = Pick<State, SyncKey>;
/** mp fields that identify this phone, not the player. */
const MP_LOCAL = ['deviceId', 'lastGame', 'lastResult'] as const;

export function snapshot(s: State): Snapshot {
  const out = {} as Record<string, unknown>;
  for (const k of SYNC_KEYS) out[k] = s[k];
  const mp = { ...s.mp } as Record<string, unknown>;
  for (const k of MP_LOCAL) delete mp[k];
  out.mp = mp;
  return out as Snapshot;
}

/** JSON with object keys sorted, so the same progress always compares equal whatever order keys were added in. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const same = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);
/** Generic three-way pick: if only one side changed since base, take that side; otherwise `tie`. */
function pick<T>(b: T | undefined, l: T, r: T, tie: (l: T, r: T) => T = (l) => l): T {
  if (same(l, r)) return l;
  if (b !== undefined && same(b, l)) return r;
  if (b !== undefined && same(b, r)) return l;
  return tie(l, r);
}
/** Additive counters: keep both sides' changes since base (or the larger total without a base). */
const add = (hasBase: boolean, b: number | undefined, l: number | undefined, r: number | undefined) =>
  hasBase ? (l ?? 0) + (r ?? 0) - (b ?? 0) : Math.max(l ?? 0, r ?? 0);

function eachKey<V, O>(l: Record<string, V> | undefined, r: Record<string, V> | undefined, fn: (k: string, l: V | undefined, r: V | undefined) => O | undefined) {
  const out: Record<string, O> = {};
  for (const k of new Set([...Object.keys(l ?? {}), ...Object.keys(r ?? {})])) {
    const v = fn(k, l?.[k], r?.[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
/** Per-key three-way merge of a record; a key present on one side only is kept. */
function mergeRec<V>(b: Record<string, V> | undefined, l: Record<string, V> | undefined, r: Record<string, V> | undefined, tie: (l: V, r: V) => V) {
  return eachKey<V, V>(l, r, (k, lv, rv) => (lv === undefined ? rv : rv === undefined ? lv : pick(b?.[k], lv, rv, tie)));
}
const addRec = (hasBase: boolean, b: Record<string, number> | undefined, l: Record<string, number> | undefined, r: Record<string, number> | undefined) =>
  eachKey<number, number>(l, r, (k, lv, rv) => add(hasBase, b?.[k], lv, rv));
/** Earliest date wins (stamps, achievements: when it was first earned). */
const unionEarliest = (l: Record<string, string> = {}, r: Record<string, string> = {}) =>
  eachKey<string, string>(l, r, (_, a, b) => (a && b ? (a < b ? a : b) : a ?? b));

/** The card that has seen more practice (then the one reviewed more recently). */
const moreCard = (l: Card, r: Card) => (l.seen !== r.seen ? (l.seen > r.seen ? l : r) : l.due >= r.due ? l : r);
const mergeCards = (b: Record<string, Card> | undefined, l: Record<string, Card>, r: Record<string, Card>) => mergeRec(b, l, r, moreCard);

/** Lower is better for times and guess counts. */
const lowerIsBetter = (k: string) => k === 'hotcold' || k.startsWith('cw-');

export function mergeSnapshots(base: Snapshot | null, l: Snapshot, r: Snapshot): Snapshot {
  if (same(l, r)) return l; // identical copies (e.g. both already have each other's changes)
  const B = base ?? undefined;
  const hb = !!base;
  const lead = (l.ratings.all?.n ?? 0) >= (r.ratings.all?.n ?? 0) ? l : r; // the more-practised side

  const ratings = { ...l.ratings };
  for (const k of new Set([...Object.keys(l.ratings), ...Object.keys(r.ratings)]) as Set<keyof State['ratings']>) {
    const lv = l.ratings[k], rv = r.ratings[k];
    ratings[k] = !lv ? rv : !rv ? lv : pick(B?.ratings[k], lv, rv, (a, c) => (a.n >= c.n ? a : c));
  }

  const iqByDay = new Map<string, number>();
  for (const e of [...(lead === l ? r : l).iqHistory, ...lead.iqHistory]) iqByDay.set(e.date, e.iq); // lead side wins per day
  const iqHistory = [...iqByDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, iq]) => ({ date, iq }));

  const testKey = (t: State['tests'][number]) => `${t.date}|${t.iq}|${t.correct}|${t.total}`;
  const tests = [...new Map([...l.tests, ...r.tests].map((t) => [testKey(t), t])).values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const days = eachKey(l.days, r.days, (d, lv, rv) => {
    const bd = B?.days[d];
    return { xp: add(hb, bd?.xp, lv?.xp, rv?.xp), answers: add(hb, bd?.answers, lv?.answers, rv?.answers), right: add(hb, bd?.right, lv?.right, rv?.right) };
  });

  // Streak: follow the side that played most recently; never lose a best or a frozen day.
  const ls = l.streak, rs = r.streak;
  const sLead = (ls.last ?? '') !== (rs.last ?? '') ? ((ls.last ?? '') > (rs.last ?? '') ? ls : rs) : ls.count >= rs.count ? ls : rs;
  let streak = {
    ...sLead,
    best: Math.max(ls.best, rs.best),
    freezes: pick(B?.streak.freezes, ls.freezes, rs.freezes, () => sLead.freezes),
    frozen: [...new Set([...ls.frozen, ...rs.frozen])].sort().slice(-60),
  };
  // XP from both phones today may together reach the streak minimum.
  const today = todayKey();
  if (days[today]) streak = bumpStreak(streak, days[today].xp, today);

  const packs = eachKey<PackState, PackState>(l.packs, r.packs, (id, lp, rp) => {
    if (!lp || !rp) return lp ?? rp;
    const bp = B?.packs[id];
    return {
      cards: mergeCards(bp?.cards, lp.cards, rp.cards),
      best: eachKey<number, number>(lp.best, rp.best, (_, a, c) => Math.max(a ?? 0, c ?? 0)),
      plays: add(hb, bp?.plays, lp.plays, rp.plays),
    };
  });

  const newerCw = (a: SavedCrossword, c: SavedCrossword) => (a.key !== c.key ? (a.key > c.key ? a : c) : a.done !== c.done ? (a.done ? a : c) : a.elapsed >= c.elapsed ? a : c);
  const crossword = {} as State['crossword'];
  for (const slot of ['daily', 'custom'] as const) {
    const a = l.crossword[slot], c = r.crossword[slot];
    const v = !a ? c : !c ? a : pick(B?.crossword[slot], a, c, newerCw);
    if (v) crossword[slot] = v;
  }

  const lm = l.mp, rm = r.mp, bm = B?.mp;
  const mp = {
    ...lm,
    name: pick(bm?.name, lm.name, rm.name),
    rating: hb ? lm.rating + rm.rating - (bm?.rating ?? 1000) : (lm.matches >= rm.matches ? lm : rm).rating,
    matches: add(hb, bm?.matches, lm.matches, rm.matches),
    wins: add(hb, bm?.wins, lm.wins, rm.wins),
    challenges: [...new Map([...rm.challenges, ...lm.challenges].map((c) => [c.code, c])).values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30),
    chatBubbles: pick(bm?.chatBubbles, lm.chatBubbles, rm.chatBubbles),
  };

  const cards = mergeCards(B?.cards, l.cards, r.cards);
  const stamps = unionEarliest(l.stamps, r.stamps);
  // Cards combined from both phones can complete a stamp neither had alone.
  for (const c of COUNTRIES) if (!stamps[c.id] && mastery(cards, c.id) >= 0.75) stamps[c.id] = today;

  return {
    name: pick(B?.name, l.name, r.name, (a, c) => a || c),
    createdAt: l.createdAt < r.createdAt ? l.createdAt : r.createdAt,
    ratings, iqHistory, tests, cards,
    xp: add(hb, B?.xp, l.xp, r.xp),
    coins: Math.max(0, add(hb, B?.coins, l.coins, r.coins)),
    days, streak,
    dailyGoal: pick(B?.dailyGoal, l.dailyGoal, r.dailyGoal),
    spinDay: (l.spinDay ?? '') >= (r.spinDay ?? '') ? l.spinDay : r.spinDay,
    daily: mergeRec(B?.daily, l.daily, r.daily, (a, c) => (a.score >= c.score ? a : c)),
    lessons: eachKey<number, number>(l.lessons, r.lessons, (_, a, c) => Math.max(a ?? 0, c ?? 0)),
    achievements: unionEarliest(l.achievements, r.achievements),
    stamps,
    bests: eachKey<number, number>(l.bests, r.bests, (k, a, c) => (a == null ? c : c == null ? a : lowerIsBetter(k) ? Math.min(a, c) : Math.max(a, c))),
    counters: addRec(hb, B?.counters, l.counters, r.counters),
    onboarded: l.onboarded || r.onboarded,
    packs, crossword,
    cwDaily: mergeRec(B?.cwDaily, l.cwDaily, r.cwDaily, (a, c) => (a.time <= c.time ? a : c)),
    cwPrefs: pick(B?.cwPrefs, l.cwPrefs, r.cwPrefs),
    mp,
    // One player identity across phones; if two phones each made one, keep the same one on both.
    social: pick(B?.social ?? undefined, l.social ?? null, r.social ?? null, (a, c) => (!a ? c : !c ? a : a.pid < c.pid ? a : c)),
  };
}
