import { BY_ID, COUNTRIES, NO_SHAPE, NO_CAPITAL_Q, ALL_NAMES, fmtPop, fmtArea, fame, type Country, ARMS } from '../data';
import { difficulty, type Skill, type Format } from './iq';
import { shuffle, pick } from './rng';
import type { Card } from './store';

export type Variant =
  | 'shape' | 'shape-twist' // name the silhouette (twist = rotated)
  | 'flag' | 'flag-rev' // name the flag / pick the flag
  | 'arms' // name the coat of arms / national emblem / seal
  | 'capital' | 'capital-rev' // name the capital / which country has this capital
  | 'map-find' | 'map-name' // click it on the map / name the highlighted country
  | 'hint'; // clue ladder

export const VARIANT_SKILL: Record<Variant, Skill> = {
  shape: 'shape', 'shape-twist': 'shape', flag: 'flag', 'flag-rev': 'flag', arms: 'flag', capital: 'capital', 'capital-rev': 'capital',
  'map-find': 'map', 'map-name': 'map', hint: 'hint',
};

export interface Question {
  variant: Variant;
  id: string; // the answer country
  choices?: string[]; // country ids (or for capital, still country ids — rendered as capitals)
  format: Format;
  rotate?: number;
}

/** Pool filter so every variant only asks fair questions. */
export function eligible(c: Country, v: Variant) {
  if (v.startsWith('shape')) return !NO_SHAPE.has(c.id);
  if (v === 'arms') return !!ARMS[c.id];
  if (v.startsWith('capital')) return !!c.capital && !NO_CAPITAL_Q.has(c.id);
  return true;
}

/** Distractors: same subregion first, then region, then anything — so choices are actually tricky. */
export function distractors(id: string, n: number, v: Variant, r = Math.random): string[] {
  const c = BY_ID[id];
  const pool = COUNTRIES.filter((x) => x.id !== id && eligible(x, v));
  const sub = shuffle(pool.filter((x) => x.subregion === c.subregion), r);
  const reg = shuffle(pool.filter((x) => x.region === c.region && x.subregion !== c.subregion), r);
  const rest = shuffle(pool.filter((x) => x.region !== c.region), r);
  const near = shuffle(c.borders.map((b) => BY_ID[b]).filter((x) => x && eligible(x, v)), r);
  const out: string[] = [];
  for (const x of [...near.slice(0, 1), ...sub, ...reg, ...rest]) {
    if (out.length >= n) break;
    if (!out.includes(x.id)) out.push(x.id);
  }
  return out;
}

export function makeQuestion(id: string, v: Variant, opts: { choices?: 4 | 6 | 0; r?: () => number } = {}): Question {
  const r = opts.r ?? Math.random;
  const nChoices = opts.choices ?? 4;
  const typedOk = v === 'shape' || v === 'shape-twist' || v === 'flag' || v === 'arms' || v === 'capital-rev' || v === 'map-name';
  const q: Question = { variant: v, id, format: 'choice4' };
  if (v === 'map-find') q.format = 'map';
  else if (v === 'hint') q.format = 'partial';
  else if (nChoices === 0 && typedOk) q.format = 'typed';
  else {
    q.format = nChoices === 6 ? 'choice6' : 'choice4';
    q.choices = shuffle([id, ...distractors(id, nChoices === 6 ? 5 : 3, v, r)], r);
  }
  if (v === 'shape-twist') q.rotate = Math.round(60 + r() * 240);
  return q;
}

export interface PoolOpts { region?: string | null; theta?: number; cards?: Record<string, Card>; ids?: string[]; exclude?: Set<string> }

/** Adaptive item picker: mixes due reviews, items near your level, and a few stretch questions. */
export function pickIds(v: Variant, n: number, o: PoolOpts = {}, r = Math.random): string[] {
  const skill = VARIANT_SKILL[v];
  let pool = (o.ids ? o.ids.map((i) => BY_ID[i]) : COUNTRIES).filter((c) => eligible(c, v) && (!o.region || c.region === o.region) && !o.exclude?.has(c.id));
  if (!pool.length) pool = COUNTRIES.filter((c) => eligible(c, v));
  const theta = o.theta ?? 1000;
  const scored = pool.map((c) => {
    const d = difficulty(c, skill);
    const card = o.cards?.[`${c.id}:${skill}`];
    const due = card && card.due <= Date.now() ? 1 : 0;
    // Target items you'd get ~65% right; due cards get a boost.
    const fit = -Math.abs(d - (theta - 60)) / 120;
    return { id: c.id, s: fit + due * 0.9 + r() * 1.3 };
  });
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.id);
}

export function sessionQuestions(variants: Variant[], n: number, o: PoolOpts & { choices?: 4 | 6 | 0 } = {}): Question[] {
  const out: Question[] = [];
  const used = new Set<string>(o.exclude ?? []);
  for (let i = 0; i < n; i++) {
    const v = variants[i % variants.length];
    const [id] = pickIds(v, 1, { ...o, exclude: used });
    if (!id) break;
    used.add(id);
    out.push(makeQuestion(id, v, { choices: o.choices }));
  }
  return shuffle(out);
}

/** The clue ladder: hardest first. */
export function hintsFor(c: Country): { label: string; text: string }[] {
  const hints: { label: string; text: string }[] = [];
  const popRank = [...COUNTRIES].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).findIndex((x) => x.id === c.id) + 1;
  const areaRank = [...COUNTRIES].sort((a, b) => b.area - a.area).findIndex((x) => x.id === c.id) + 1;
  hints.push({ label: 'Vital stats', text: `Population ≈ ${fmtPop(c.population)} (#${popRank} in the world). Area ${fmtArea(c.area)} (#${areaRank} by size).${c.landlocked ? ' Landlocked.' : ''}` });
  const lang = c.languagesMasked.slice(0, 3).join(', ');
  hints.push({ label: 'Money & tongue', text: `People here pay in ${c.currenciesMasked.join(' / ') || '—'} and speak ${lang || '—'}.` });
  const nb = c.borders.length;
  hints.push({ label: 'Neighbourhood', text: `Located in ${c.subregion}. ${nb === 0 ? 'It has no land borders at all.' : `It shares land borders with ${nb} ${nb === 1 ? 'country' : 'countries'}.`}` });
  if (nb) hints.push({ label: 'Neighbours', text: `Borders: ${shuffle(c.borders).map((b) => ALL_NAMES[b] ?? b).join(', ')}.` });
  else hints.push({ label: 'Web & phone', text: `Internet domain ${c.tld || '—'}, dialing code ${c.calling || '—'}.` });
  hints.push({ label: 'Capital', text: `The capital is ${c.capital}.` });
  return hints;
}

export const NOTE = (c: Country) => c.blurb;

/** Pick a fame-weighted random country (used for daily/featured content). */
export const famousPick = (r = Math.random, min = 0.35) => pick(COUNTRIES.filter((c) => fame(c) >= min), r);
