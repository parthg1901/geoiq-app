import { COUNTRIES, fame, type Country } from '../data';
import { rng, hash, todayKey, shuffle } from './rng';
import { makeQuestion, eligible, type Question, type Variant } from './questions';

export const DAILY_VARIANTS: Variant[] = ['shape', 'flag', 'photo', 'capital', 'map-find'];

/** Today's five questions — identical for every player (seeded by date). */
export function dailyQuestions(day = todayKey()): Question[] {
  const r = rng(hash('daily:' + day));
  const used = new Set<string>();
  return DAILY_VARIANTS.map((v, i) => {
    // ramp difficulty: Q1 famous → Q5 obscure-ish
    const band = [0.75, 0.55, 0.45, 0.3, 0.15][i];
    const pool = COUNTRIES.filter((c) => eligible(c, v) && !used.has(c.id) && fame(c) >= band && fame(c) <= band + 0.4);
    const c = shuffle(pool, r)[0];
    used.add(c.id);
    const q = makeQuestion(c.id, v, { choices: 4, r });
    q.photo = Math.floor(r() * 100);
    return q;
  });
}

export function countryOfDay(day = todayKey()): Country {
  const r = rng(hash('cotd:' + day));
  const pool = COUNTRIES.filter((c) => fame(c) > 0.2);
  return pool[Math.floor(r() * pool.length)];
}

export const gridFor = (outcomes: number[]) => outcomes.map((o) => (o >= 0.95 ? '🟩' : o >= 0.5 ? '🟨' : '🟥')).join('');
export const dailyNumber = (day = todayKey()) => Math.round((Date.parse(day + 'T12:00:00') - Date.parse('2026-01-01T12:00:00')) / 86400000) + 1;
