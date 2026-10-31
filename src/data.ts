import raw from './data/countries.json';

export interface Country {
  id: string;
  cca2: string;
  name: string;
  official: string;
  alt: string[];
  capital: string;
  region: string;
  subregion: string;
  borders: string[];
  area: number;
  landlocked: boolean;
  latlng: [number, number];
  languages: string[];
  currencies: string[];
  /** currency/language names with the country's name redacted, for clue questions */
  currenciesMasked: string[];
  languagesMasked: string[];
  tld: string;
  calling: string;
  demonym: string;
  population: number | null;
  views: number;
  blurb: string;
  fact: string;
}

export interface Photo { u: string; c: string; a: string; l: string; p: string }

export const COUNTRIES = raw.countries as unknown as Country[];
export const BY_ID: Record<string, Country> = Object.fromEntries(COUNTRIES.map((c) => [c.id, c]));
/** Names for every ISO code incl. territories (used for borders lists). */
export const ALL_NAMES = raw.names as Record<string, string>;
export const REGIONS = ['Europe', 'Asia', 'Africa', 'Americas', 'Oceania'] as const;
export type Region = (typeof REGIONS)[number];

/** Countries whose silhouette is too tiny/scattered to be a fair shape question. */
export const NO_SHAPE = new Set(['VAT', 'MCO', 'NRU', 'TUV', 'MHL', 'KIR', 'FSM', 'MDV', 'PLW', 'TON', 'SYC', 'SMR']);
/** Countries too small to click on the 50m world map — drawn as circles instead. */
export const TINY = new Set(COUNTRIES.filter((c) => c.area < 12000).map((c) => c.id));

/** Fame 0..1 from Wikipedia pageviews (log-scaled). Drives difficulty priors. */
const fameCache: Record<string, number> = {};
export function fame(c: Country): number {
  if (fameCache[c.id] != null) return fameCache[c.id];
  const v = (Math.log10(Math.max(c.views, 3e5)) - 5.8) / (7.15 - 5.8);
  const p = (Math.log10(Math.max(c.population ?? 1e4, 1e4)) - 4.5) / (9.1 - 4.5);
  const a = (Math.log10(Math.max(c.area, 1)) - 2) / (7.2 - 2);
  return (fameCache[c.id] = Math.min(1, Math.max(0, 0.65 * v + 0.2 * p + 0.15 * a)));
}

export const flagUrl = (id: string) => `/flags/${id}.svg`;

let shapesP: Promise<Record<string, string>> | null = null;
export const loadShapes = () => (shapesP ??= fetch('/data/shapes.json').then((r) => r.json()));
const photosP: Record<string, Promise<Photo[]>> = {};
/** Photos for one country (small per-country file, cached). */
export const loadPhotos = (id: string) =>
  (photosP[id] ??= fetch(`/data/photos/${id}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
let worldP: Promise<unknown> | null = null;
export const loadWorld50 = () => (worldP ??= fetch('/data/world-50m.json').then((r) => r.json()));
let world110P: Promise<unknown> | null = null;
export const loadWorld110 = () => (world110P ??= fetch('/data/world-110m.json').then((r) => r.json()));

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const INDEX = COUNTRIES.flatMap((c) => [c.name, ...c.alt].map((n) => ({ key: norm(n), label: n, id: c.id })));

/** Autocomplete search across names and alternate spellings. */
export function searchCountries(q: string, limit = 6): Country[] {
  const k = norm(q);
  if (!k) return [];
  const seen = new Set<string>();
  const scored: { id: string; s: number }[] = [];
  for (const e of INDEX) {
    const i = e.key.indexOf(k);
    if (i < 0 || seen.has(e.id)) continue;
    seen.add(e.id);
    scored.push({ id: e.id, s: (i === 0 ? 0 : 10) + e.key.length / 100 });
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => BY_ID[x.id]);
}

/** Exact-ish match of a typed answer to a country id. */
export function matchCountry(q: string): string | null {
  const k = norm(q);
  return INDEX.find((e) => e.key === k)?.id ?? null;
}

export const fmtPop = (n: number | null) =>
  n == null ? 'unknown' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : `${n}`;
export const fmtArea = (n: number) => `${n >= 1e4 ? Math.round(n / 1e3).toLocaleString() + 'k' : Math.round(n).toLocaleString()} km²`;

import armsRaw from './data/arms.json';
export interface Arms { kind: 'arms' | 'emblem' | 'seal'; file: string; credit: string; page: string }
/** Coat of arms / national emblem / seal for a country (Wikimedia Commons), if we have one. */
export const ARMS = armsRaw as Record<string, Arms>;
export const ARMS_WORD: Record<Arms['kind'], string> = { arms: 'coat of arms', emblem: 'national emblem', seal: 'seal' };
