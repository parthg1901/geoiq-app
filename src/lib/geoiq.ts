/**
 * GeoIQ rating engine.
 *
 * Every question is an item with a difficulty `d` on an Elo-like scale. The player has an ability
 * `θ` per skill plus a global θ. We use a 3-parameter-logistic (IRT) model so that multiple-choice
 * guessing is accounted for:  P(correct) = g + (1-g) / (1 + e^{-(θ-d)/S}).
 * GeoIQ maps θ onto an IQ-style scale: 100 = average explorer, 15 points = one standard deviation.
 */
import { BY_ID, NO_SHAPE, fame, type Country } from '../data';

export type Skill = 'shape' | 'flag' | 'capital' | 'map' | 'hint' | 'photo';
export const SKILLS: Skill[] = ['shape', 'flag', 'map', 'capital', 'hint', 'photo'];
export const SKILL_LABEL: Record<Skill, string> = {
  shape: 'Shapes', flag: 'Flags', capital: 'Capitals', map: 'Map', hint: 'Clues', photo: 'Street Eye',
};
export const SKILL_ICON: Record<Skill, string> = { shape: '◆', flag: '⚑', capital: '★', map: '⌖', hint: '?', photo: '◉' };

const S = 110; // logistic scale
const BASE = 1000; // θ of an "average" explorer
const SD = 160; // θ points per 15 GeoIQ points

/** Prior difficulty of a (country, skill) item. */
export function difficulty(c: Country, skill: Skill): number {
  const f = fame(c);
  let d = 1380 - f * 620; // famous ≈ 760, obscure ≈ 1380
  const small = c.area < 30000 ? 1 : 0;
  const micro = c.area < 2000 ? 1 : 0;
  switch (skill) {
    case 'flag': d -= 20; break;
    case 'shape': d += 30 + small * 60 + (NO_SHAPE.has(c.id) ? 150 : 0); break;
    case 'map': d += 20 + small * 70 + micro * 60; break;
    case 'capital': d += 50; break;
    case 'hint': d += 10; break;
    case 'photo': d += 90; break;
  }
  return Math.round(d);
}

export type Format = 'choice4' | 'choice6' | 'typed' | 'map' | 'partial';
export const guessFloor = (f: Format) => (f === 'choice4' ? 0.25 : f === 'choice6' ? 1 / 6 : 0);

export function pCorrect(theta: number, d: number, format: Format) {
  const g = guessFloor(format);
  return g + (1 - g) / (1 + Math.exp(-(theta - d) / S));
}

export interface Rating { theta: number; n: number }
export const freshRating = (): Rating => ({ theta: BASE, n: 0 });

/** Update a rating after an outcome in [0,1]. K shrinks as we get more confident. */
export function update(r: Rating, d: number, format: Format, outcome: number, kScale = 1): Rating {
  const p = pCorrect(r.theta, d, format);
  const k = (10 + 60 / Math.sqrt(1 + r.n / 4)) * kScale;
  // Information weighting: a guessed multiple-choice right answer says less than a typed one.
  const g = guessFloor(format);
  const delta = outcome >= p ? (outcome - p) * (1 - g) : outcome - p;
  return { theta: r.theta + k * delta * 1.5, n: r.n + 1 };
}

export const toIQ = (theta: number) => Math.round(100 + (15 * (theta - BASE)) / SD);
export const fromIQ = (iq: number) => BASE + ((iq - 100) * SD) / 15;

/** Normal CDF → percentile of explorers below this GeoIQ. */
export function percentile(iq: number) {
  const z = (iq - 100) / 15;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const dd = 0.3989423 * Math.exp((-z * z) / 2);
  const p = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.round((z > 0 ? 1 - p : p) * 1000) / 10;
}

export interface Tier { name: string; min: number; color: string; emoji: string; blurb: string }
export const TIERS: Tier[] = [
  { name: 'Tourist', min: 0, color: '#8aa0c8', emoji: '🧳', blurb: 'You know the world is round. Probably.' },
  { name: 'Backpacker', min: 88, color: '#5ed3a8', emoji: '🎒', blurb: 'The big players are locked in.' },
  { name: 'Explorer', min: 102, color: '#53b8ff', emoji: '🧭', blurb: 'Most continents feel familiar.' },
  { name: 'Navigator', min: 116, color: '#b48cff', emoji: '⚓', blurb: 'Shapes and flags come fast.' },
  { name: 'Cartographer', min: 130, color: '#ffb547', emoji: '🗺️', blurb: 'You could draw the Balkans from memory.' },
  { name: 'Atlas', min: 145, color: '#ff6b8b', emoji: '🌐', blurb: 'Shorts-level. Every border, every flag.' },
];
export const tierFor = (iq: number) => [...TIERS].reverse().find((t) => iq >= t.min) ?? TIERS[0];

export type Ratings = Record<Skill | 'all', Rating>;
export const freshRatings = (): Ratings =>
  ({ all: freshRating(), shape: freshRating(), flag: freshRating(), capital: freshRating(), map: freshRating(), hint: freshRating(), photo: freshRating() });

/** Composite GeoIQ: global θ, blended toward skill θs that have data. */
export function geoIQ(r: Ratings) {
  const used = SKILLS.filter((s) => r[s].n > 0);
  const total = SKILLS.reduce((a, s) => a + r[s].n, 0);
  if (!used.length) return { iq: 100, provisional: true, answered: 0 };
  // Skills you never practised count as "average" so cherry-picking one mode can't inflate the score.
  const w = SKILLS.map((s) => Math.min(1, r[s].n / 20) + 0.15);
  const avg = SKILLS.reduce((a, s, i) => a + w[i] * (r[s].n ? r[s].theta : BASE - 40), 0) / w.reduce((a, b) => a + b, 0);
  const theta = 0.5 * avg + 0.5 * r.all.theta;
  return { iq: toIQ(theta), provisional: total < 30, answered: total };
}

export function itemFor(id: string, skill: Skill) {
  return { id, skill, d: difficulty(BY_ID[id], skill) };
}
