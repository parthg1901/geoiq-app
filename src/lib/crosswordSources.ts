/**
 * Crossword word sources: turn countries and content packs into crossword entries with clues.
 * Clues are written from the data (capitals, neighbours, lengths, elevations…) and never contain
 * the answer itself.
 */
import { COUNTRIES, BY_ID, NO_SHAPE, fame, type Country } from '../data';
import { loadPack, type PackData, type PackItem } from './packs';
import { toAnswer, enumeration, type CwEntry, type CwClue } from './crossword';

export interface CwSource {
  key: string;
  title: string;
  emoji: string;
  group: 'World' | 'Physical' | 'Regions' | 'History' | 'Culture';
  /** Pack id when the words come from a content pack. */
  pack?: string;
}

export const CW_SOURCES: CwSource[] = [
  { key: 'countries', title: 'Countries', emoji: '🌍', group: 'World' },
  { key: 'capitals', title: 'Capitals', emoji: '★', group: 'World' },
  { key: 'flags', title: 'Flags', emoji: '⚑', group: 'World' },
  { key: 'shapes', title: 'Shapes', emoji: '◆', group: 'World' },
  { key: 'rivers', title: 'Rivers', emoji: '🏞️', group: 'Physical', pack: 'rivers' },
  { key: 'lakes', title: 'Lakes', emoji: '💧', group: 'Physical', pack: 'lakes' },
  { key: 'seas', title: 'Seas & oceans', emoji: '🌊', group: 'Physical', pack: 'seas' },
  { key: 'landforms', title: 'Mountains & deserts', emoji: '🏜️', group: 'Physical', pack: 'landforms' },
  { key: 'peaks', title: 'Peaks', emoji: '🏔️', group: 'Physical', pack: 'peaks' },
  { key: 'us-states', title: 'US States', emoji: '🇺🇸', group: 'Regions', pack: 'us-states' },
  { key: 'in-states', title: 'Indian States', emoji: '🇮🇳', group: 'Regions', pack: 'in-states' },
  { key: 'ca-provinces', title: 'Canadian Provinces', emoji: '🇨🇦', group: 'Regions', pack: 'ca-provinces' },
  { key: 'au-states', title: 'Australian States', emoji: '🇦🇺', group: 'Regions', pack: 'au-states' },
  { key: 'br-states', title: 'Brazilian States', emoji: '🇧🇷', group: 'Regions', pack: 'br-states' },
  { key: 'mx-states', title: 'Mexican States', emoji: '🇲🇽', group: 'Regions', pack: 'mx-states' },
  { key: 'de-states', title: 'German States', emoji: '🇩🇪', group: 'Regions', pack: 'de-states' },
  { key: 'cn-provinces', title: 'Chinese Provinces', emoji: '🇨🇳', group: 'Regions', pack: 'cn-provinces' },
  { key: 'ru-subjects', title: 'Russian Regions', emoji: '🇷🇺', group: 'Regions', pack: 'ru-subjects' },
  { key: 'h1914', title: '1914 · Eve of WWI', emoji: '⚔️', group: 'History', pack: 'h1914' },
  { key: 'h1945', title: '1945 · WWII ends', emoji: '🕊️', group: 'History', pack: 'h1945' },
  { key: 'h1815', title: '1815 · After Napoleon', emoji: '🎩', group: 'History', pack: 'h1815' },
  { key: 'languages', title: 'Languages', emoji: '🗣️', group: 'Culture', pack: 'languages' },
  { key: 'scripts', title: 'Scripts & alphabets', emoji: '🔤', group: 'Culture', pack: 'scripts' },
];
export const CW_SOURCE_BY_KEY = Object.fromEntries(CW_SOURCES.map((s) => [s.key, s]));
/** What "Random" mixes together. */
export const RANDOM_MIX = ['countries', 'capitals', 'flags', 'rivers', 'lakes', 'seas', 'landforms', 'peaks'];

const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Replace the answer inside a clue with a blank. The first name (the answer) is also masked word by
 * word; alternative names are masked only as whole phrases — splitting "Province of Ontario" would
 * blank the word "province" in every clue.
 */
export function maskAnswer(text: string, names: string[]) {
  const STOP = new Set(['the', 'of', 'and', 'river', 'lake', 'sea', 'gulf', 'bay', 'mount', 'mountains', 'ocean', 'strait', 'desert', 'state', 'island', 'islands', 'north', 'south', 'east', 'west', 'great', 'new', 'saint', 'san', 'empire', 'kingdom', 'republic']);
  const parts = new Set<string>();
  names.forEach((n, i) => {
    if (!n) return;
    parts.add(n);
    if (i === 0) for (const w of n.split(/[\s-]+/)) if (w.length > 3 && !STOP.has(w.toLowerCase())) parts.add(w);
  });
  let out = text;
  for (const p of [...parts].sort((a, b) => b.length - a.length)) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\p{L}])${esc}(\\p{L}*)`, 'giu'), '$1___');
  }
  return out.replace(/(___[\s,]*){2,}/g, '___ ');
}

const entry = (id: string, display: string, clue: CwClue, source: string): CwEntry => ({
  id, display, answer: toAnswer(display), enumeration: enumeration(display), clue, source,
});

/* ---------------- countries ---------------- */

function countryClue(c: Country, rng: () => number): CwClue {
  const names = [c.name, c.official, ...c.alt, c.demonym];
  const options: (() => string | null)[] = [
    () => (c.capital ? `Country whose capital is ${c.capital}` : null),
    () => {
      const nb = c.borders.map((b) => BY_ID[b]?.name).filter(Boolean) as string[];
      if (nb.length >= 2) return `${c.subregion} country bordering ${join(nb.slice(0, 2))}`;
      if (nb.length === 1) return `${c.subregion} country whose only land neighbour is ${nb[0]}`;
      return `Island nation in ${c.subregion}`;
    },
    () => (c.currenciesMasked.length ? `${c.subregion} country paying in the ${c.currenciesMasked[0].replace(/▇+/g, '___')}` : null),
    () => (c.languagesMasked.length ? `Country in ${c.region} where people speak ${join(c.languagesMasked.slice(0, 2)).replace(/▇+/g, '___')}` : null),
  ];
  // Try options in random order; skip any whose key information got blanked (e.g. "speak ___").
  for (const o of shuffleWith(options, rng)) {
    const t = o();
    if (!t) continue;
    const m = maskAnswer(t.replace(/▇+/g, '___'), names);
    if (!m.includes('___')) return { text: m };
  }
  return { text: maskAnswer(c.blurb.split(/(?<=\.)\s/)[0].replace(/▇+/g, '___'), names) };
}

function countryEntries(key: string, rng: () => number): CwEntry[] {
  return COUNTRIES.flatMap((c): CwEntry[] => {
    const id = `${key}:${c.id}`;
    switch (key) {
      case 'countries': return [entry(id, c.name, countryClue(c, rng), key)];
      case 'flags': return [entry(id, c.name, { text: 'Whose flag is this?', image: { kind: 'img', src: `/flags/${c.id}.svg` } }, key)];
      case 'shapes': return NO_SHAPE.has(c.id) ? [] : [entry(id, c.name, { text: 'Which country has this outline?', image: { kind: 'shape', id: c.id } }, key)];
      case 'capitals': {
        if (!c.capital || ['VAT', 'MCO', 'SGP'].includes(c.id)) return [];
        // "Capital of Tunisia" would give TUNIS away: use the flag instead when the names overlap.
        const leaks = maskAnswer(`Capital of ${c.name}`, [c.capital]).includes('___');
        const clue: CwClue = leaks || rng() < 0.3
          ? { text: 'Capital of the country with this flag', image: { kind: 'img', src: `/flags/${c.id}.svg` } }
          : { text: `Capital of ${c.name}` };
        return [entry(id, c.capital, clue, key)];
      }
      default: return [];
    }
  });
}

/* ---------------- packs ---------------- */

const rawFact = (it: PackItem, ...labels: string[]) => it.facts?.find(([l]) => labels.includes(l))?.[1] ?? null;
/** Facts with long lists shortened: "Algeria, Chad, Egypt, Morocco…" → "Algeria, Chad and Egypt". */
const fact = (it: PackItem, ...labels: string[]) => {
  const v = rawFact(it, ...labels);
  if (!v || !v.includes(', ')) return v; // "2,700 m" is a number, not a list
  const xs = v.replace(/\s*\+\d+ more$/, '').split(/,\s+/).filter(Boolean);
  return xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and others` : join(xs);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words of the answer, lower-cased (≥4 letters), to keep them out of its own clue. */
const answerWords = (name: string) => new Set(name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter((w) => w.length >= 4));
const overlaps = (text: string, words: Set<string>) => text.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && [...words].some((a) => w.startsWith(a) || a.startsWith(w)));
const NEUTRAL: Record<string, string> = { physical: 'feature', regions: 'region', history: 'state', culture: 'language' };
/** "Portugal" vs PORTUGUESE, "Germany" vs GERMAN: names sharing a ≥5-letter start give the answer away. */
const sharesStem = (a: string, b: string) => {
  const x = toAnswer(a), y = toAnswer(b);
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i >= Math.min(5, x.length, y.length);
};
const listNames = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and others` : join(xs));

function packClue(pack: PackData, it: PackItem, rng: () => number, display: string): CwClue {
  const names = [display, it.name, ...(it.alt ?? [])];
  const group = pack.meta.group;
  const aw = answerWords(display);
  const rawKind = (it.kind ?? pack.meta.title.replace(/s$/, '')).split('/')[0].trim(); // "colony / territory" → "colony"
  // "Channel" for ENGLISH CHANNEL or "oblast" for … OBLAST would hand out letters: use a neutral word.
  const kindWord = overlaps(rawKind, aw) ? (pack.meta.id === 'seas' ? 'waterway' : pack.meta.id === 'landforms' ? 'landform' : NEUTRAL[group]) : rawKind;
  const kind = cap(kindWord);
  const where = fact(it, 'Flows through', 'Countries', 'Country', 'Bordering countries');
  let opts: (string | null)[] = [];

  if (group === 'regions') {
    const adj = pack.meta.title.replace(/ (States|Provinces|Regions|Subjects).*$/, ''); // "Indian States" → "Indian"
    const country = overlaps(adj, aw) ? '' : adj; // SOUTH AUSTRALIA mustn't be clued as an "Australian state"
    if (it.flag && rng() < 0.3) return { text: cap(`${country} ${kindWord} with this flag`.trim()), image: { kind: 'img', src: it.flag } };
    if (pack.shapes?.[it.id] && rng() < 0.25) return { text: cap(`${country} ${kindWord} with this outline`.trim()), image: { kind: 'shape', id: it.id, pack: pack.meta.id } };
    opts = [
      it.capital ? cap(`${country} ${kindWord} with the capital ${it.capital}`.trim()) : null,
      // Astrakhan Oblast → capital Astrakhan: masking would blank it, so say so instead
      it.capital && toAnswer(it.capital).startsWith(toAnswer(display).slice(0, 5)) ? cap(`${country} ${kindWord} whose capital shares its name`.trim()) : null,
      it.capital ? cap(`${country} ${kindWord} governed from ${it.capital}`.trim()) : null,
      it.population ? cap(`${country} ${kindWord} of about ${fmt(it.population)} people`.trim()) : null,
      fact(it, 'Established') ? cap(`${country} ${kindWord} established in ${fact(it, 'Established')}`.trim()) : null,
    ];
  } else if (group === 'culture') {
    // Languages & scripts: where it's official (minus countries that share its name) and its telltale features.
    const word = /script/i.test(pack.meta.id) ? 'Writing system' : 'Language';
    const countries = (it.regions ?? []).map((c) => BY_ID[c]).filter(Boolean).sort((a, b) => fame(b) - fame(a));
    const safe = countries.filter((c) => !sharesStem(c.name, display) && !(c.demonym && sharesStem(c.demonym, display))).map((c) => c.name);
    const tell = it.tells?.[0];
    const speakers = it.rank && /speak/i.test(it.rank.label) ? `${fmt(it.rank.value)} ${it.rank.unit}`.trim() : null;
    opts = [
      safe.length ? `${word} ${/script/i.test(pack.meta.id) ? 'used' : 'official'} in ${listNames(safe)}` : null,
      safe.length > 4 ? `${word} official in ${countries.length} countries, including ${listNames(safe.slice(0, 2))}` : null,
      tell ? `${word} you can spot by: ${tell}` : null,
      speakers && safe.length ? `${word} of ${speakers}, official in ${listNames(safe.slice(0, 2))}` : null,
      fact(it, 'Script', 'Family') && safe.length ? `${word} of ${listNames(safe.slice(0, 2))} (${[rawFact(it, 'Family'), rawFact(it, 'Script')].filter(Boolean).join(', ')})` : null,
    ];
    if (it.sample?.text && rng() < 0.15) opts.push(`${word} of this text: “${it.sample.text.split(/\s+/).slice(0, 6).join(' ')}…”`);
  } else if (group === 'history') {
    const year = pack.meta.title.slice(0, 4);
    opts = [
      fact(it, 'Today') ? `In ${year}: ${kindWord} covering today's ${fact(it, 'Today')}` : null,
      fact(it, 'Ruled by') ? `In ${year}: ${kindWord} ruled by ${fact(it, 'Ruled by')}` : null,
    ];
  } else {
    const len = fact(it, 'Length'), elev = fact(it, 'Elevation'), into = fact(it, 'Flows into'), range = fact(it, 'Range');
    const area = fact(it, 'Area'), high = fact(it, 'Highest point'), depth = fact(it, 'Max depth');
    opts = [
      where && into ? `${kind} in ${where} that flows into the ${into.replace(/^the /i, '')}` : null,
      len && where ? `${len} ${kindWord} in ${where}` : null,
      elev && where ? `${elev} ${kindWord} in ${where}` : null,
      elev && range ? `${elev} summit of the ${range}` : null,
      where && area ? `${kind} in ${where}, about ${area}` : null,
      high && where ? `${kind} in ${where} whose highest point is ${high}` : null,
      depth && where ? `${kind} ${pack.meta.id === 'seas' ? 'bordering' : 'in'} ${where}, up to ${depth} deep` : null,
      area && depth && !where ? `${kind} of about ${area}, up to ${depth} deep` : null,
      it.kind === 'strait' && where ? `Strait between ${where}` : null,
    ];
    if (!opts.some(Boolean) && where) opts = [`${kind} in ${where}`];
  }
  // Try the clue ideas in random order; skip any whose key fact got blanked by masking the answer.
  for (const t of shuffleWith(opts.filter(Boolean) as string[], rng)) {
    const m = maskAnswer(t, names);
    if (!m.includes('___')) return { text: m };
  }
  // Fact-only fallbacks: "4,095 m peak in its namesake country" (MOUNT CAMEROON), then "4,095 m peak".
  if (group === 'physical') {
    const measure = fact(it, 'Elevation') ?? fact(it, 'Length');
    const area = fact(it, 'Area');
    const fallbacks = [
      measure && where && overlaps(where, aw) ? `${measure} ${kindWord} in its namesake country` : null,
      where && overlaps(where, aw) ? `${kind} named after a country ${pack.meta.id === 'seas' ? 'on its shores' : 'it lies in'}` : null,
      measure ? `${measure} ${kindWord}` : null,
      area ? `${kind} of about ${area}` : null,
    ];
    for (const t of fallbacks) if (t && !maskAnswer(t, names).includes('___')) return { text: t };
  }
  // Then a short description sentence with at most one blank, else a fact that survives masking.
  const blurb = it.blurb?.split(/(?<=\.)\s/)[0];
  const mb = blurb ? maskAnswer(blurb, names) : '';
  if (mb && mb.length <= 150 && (mb.match(/___/g) ?? []).length <= 1) return { text: mb };
  const area = fact(it, 'Area');
  const prefix = group === 'history' ? `In ${pack.meta.title.slice(0, 4)}: ` : '';
  return { text: `${prefix}${area ? `${kindWord} of about ${area}` : kind}` };
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1e3 ? `${Math.round(n / 1e3)} thousand` : String(n));

/** Crossword answer for a pack item: drop generic words a crossword wouldn't include ("Kaluga Oblast" → "Kaluga"). */
function answerName(packId: string, name: string) {
  let short = name;
  if (packId === 'ru-subjects') short = name.replace(/\s+(Autonomous Okrug|Autonomous Oblast|Oblast|Krai)$/i, '').replace(/^Republic of\s+/i, '');
  // "Lake Superior" → "Superior", "Loch Ness" → "Ness", "Rybinsk Reservoir" → "Rybinsk"
  if (packId === 'lakes') short = name.replace(/^(Lake|Loch)\s+/i, '').replace(/\s+(Lake|Reservoir)$/i, '');
  return toAnswer(short).length >= 3 ? short : name;
}

async function packEntries(key: string, packId: string, rng: () => number): Promise<CwEntry[]> {
  const pack = await loadPack(packId);
  if (!pack) return [];
  return pack.items.map((it) => {
    const display = answerName(packId, it.name);
    return entry(`${key}:${it.id}`, display, packClue(pack, it, rng, display), key);
  });
}

/* ---------------- public ---------------- */

/** Ease 0 (famous) … 1 (obscure) for an entry, used to keep Mini puzzles friendly. */
function easeOf(e: CwEntry, packs: Record<string, PackData | null>): number {
  const [src, id] = e.id.split(':');
  if (['countries', 'flags', 'shapes', 'capitals'].includes(src)) return 1 - fame(BY_ID[id]);
  const p = packs[CW_SOURCE_BY_KEY[src]?.pack ?? ''];
  return p?.items.find((x) => x.id === id)?.difficulty ?? 0.5;
}

/**
 * All candidate entries for the chosen sources. `maxEase` drops obscure items (Mini puzzles).
 * Sources are balanced so a mix doesn't drown in one big list.
 */
export async function buildEntries(keys: string[], rng: () => number, maxEase = 1): Promise<CwEntry[]> {
  const sources = keys.length ? keys : RANDOM_MIX;
  // Load every pack first, then draw random numbers in a fixed order, so a seeded puzzle (the daily)
  // comes out identical on every device regardless of which download finishes first.
  const packs: Record<string, PackData | null> = {};
  await Promise.all(sources.map(async (k) => { const id = CW_SOURCE_BY_KEY[k]?.pack; if (id) packs[id] = await loadPack(id); }));
  const lists: CwEntry[][] = [];
  for (const k of sources) {
    const s = CW_SOURCE_BY_KEY[k];
    lists.push(!s ? [] : s.pack ? await packEntries(k, s.pack, rng) : countryEntries(k, rng));
  }
  const per = Math.max(30, Math.ceil(120 / sources.length));
  return lists.flatMap((l) => {
    const ok = l.filter((e) => e.answer.length >= 3 && easeOf(e, packs) <= maxEase + 1e-9 && e.clue.text.length > 0);
    return ok.length > per ? shuffleWith(ok, rng).slice(0, per) : ok;
  });
}

function shuffleWith<T>(a: T[], rng: () => number) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export const SIZES = {
  mini: { label: 'Mini', size: 9, target: 7, maxEase: 0.55 },
  standard: { label: 'Standard', size: 13, target: 13, maxEase: 0.85 },
  big: { label: 'Big', size: 15, target: 18, maxEase: 1 },
} as const;
export type SizeKey = keyof typeof SIZES;
