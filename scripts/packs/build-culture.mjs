// Builds the "Languages & scripts" packs (group 'culture'):
//   public/data/packs/index-culture.json, languages.json, scripts.json
// Items are sets of today's countries (meta.map = 'countries'); samples are UDHR Article 1 texts.
// Usage: node scripts/packs/build-culture.mjs   (network responses cached in scripts/.cache/packs-culture/)
import fs from 'node:fs';
import { LANGUAGES, SCRIPTS } from './culture-specs.mjs';
import { udhrXml, article1, wikiPage, pageviews, entity } from './culture-net.mjs';
import { blurbOf, pool } from './physical-wiki.mjs';

const OUT = 'public/data/packs';
const COUNTRIES = JSON.parse(fs.readFileSync('src/data/countries.json', 'utf8')).countries;
const NAME = Object.fromEntries(COUNTRIES.map((c) => [c.id, c.name]));
const ATTRIBUTION = 'Sample texts: Universal Declaration of Human Rights, Article 1 (UN OHCHR translations via the UDHR in XML project, eric-muller/udhr). Facts: Wikidata (CC0). Descriptions: Wikipedia (CC BY-SA).';
const RTL = new Set(['Arabic', 'Hebrew', 'Thaana']);
const NO_SPACE = new Set(['Thai', 'Lao', 'Khmer', 'Myanmar', 'Chinese characters', 'Japanese kana', 'Tibetan']);

/** Cut a text to ≤ max characters at a sentence or word boundary, adding "…" when shortened. */
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.match(/^[\s\S]*[.!?។။።।。](?=\s|$)/);
  if (sentence && sentence[0].length > max * 0.55) return sentence[0].trim();
  const sp = cut.lastIndexOf(' ');
  // scripts without spaces between words: cut at a syllable/phrase mark or just the length
  const base = sp > max * 0.6 ? cut.slice(0, sp) : cut.replace(/[\s,;:、，་]*$/, '');
  return base.replace(/[\s,;:、，་]+$/, '') + '…';
}

/**
 * Native (first-language) speakers, so "which has more speakers?" compares like with like.
 * Wikidata P1098 values are qualified as native (Q36870), second-language (Q125421) or total
 * (Q16868672); unqualified values are native for every language here except the NO_RANK ones.
 */
const NATIVE = 'Q36870';
const NO_RANK = new Set(['filipino', 'lingala']); // only total / mostly-L2 figures on Wikidata
function nativeSpeakers(e) {
  const vals = (e?.claims?.P1098 ?? []).map((c) => ({ n: Number(c.v?.amount), rank: c.rank, time: c.time ?? '', part: c.part })).filter((x) => x.n > 0);
  const latest = (xs) => xs.sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred') || b.time.localeCompare(a.time))[0]?.n ?? null;
  return latest(vals.filter((v) => v.part === NATIVE)) ?? latest(vals.filter((v) => !v.part));
}
/** Languages whose UDHR text is (near-)identical to another one here — no "which language?" question. */
const NO_SAMPLE = { bosnian: 'Croatian', montenegrin: 'Croatian', dari: 'Persian' };
/** Typos in the source texts. */
const TEXT_FIXES = {
  hun: [['Minden. emberi', 'Minden emberi']],
  tha: [['เกียรติศักด[เกียรติศักดิ์]', 'เกียรติศักดิ์']], // source shows a typo with its correction in brackets
};
const tidy = (t, f) => { for (const [a, b] of TEXT_FIXES[f] ?? []) t = t.replace(a, b); return t.replace(/\s+([,.;:!?])/g, '$1'); };

const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `${Math.round(n / 1e6).toLocaleString('en')} million` : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString('en')} thousand` : String(n));
const listNames = (ids, max = 6) => {
  const names = ids.map((r) => NAME[r]);
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ');
};
const difficultyOf = (views, all) => {
  // famous → 0, obscure → 1, log-scaled across the pack
  const lv = all.map((v) => Math.log10(Math.max(1000, v)));
  const lo = Math.min(...lv), hi = Math.max(...lv);
  return Math.round((1 - (Math.log10(Math.max(1000, views)) - lo) / (hi - lo || 1)) * 100) / 100;
};

/** Remove the language/script's own English name from a sample (would make the question trivial). */
function leakFree(text, names) {
  let t = text;
  for (const n of names) if (n && n.length > 3) t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '…');
  return t;
}

// ------------------------------------------------------------------ languages
const langData = await pool(LANGUAGES, 4, async (L) => {
  const xml = await udhrXml(L.udhr);
  const a1 = xml ? article1(xml) : null;
  const page = await wikiPage(L.wiki);
  const [views, e] = await Promise.all([page ? pageviews(page.title) : 0, page?.qid ? entity(page.qid) : null]);
  return { L, a1, page, views, e };
});

const missing = [];
const langItems = langData.map(({ L, a1, page, views, e }) => {
  if (!a1 && !NO_SAMPLE[L.id]) missing.push(`sample:${L.id}`);
  if (!page?.extract) missing.push(`blurb:${L.id}`);
  const n = NO_RANK.has(L.id) ? null : nativeSpeakers(e);
  const scriptLabel = L.scripts.join(' / ');
  const facts = [
    ['Official in', listNames(L.regions)],
    ...(n ? [['Native speakers', `about ${fmt(n)}`]] : []),
    ['Script', scriptLabel],
    ['Family', L.family],
    ...(L.note ? [['Note', L.note]] : []),
  ];
  const dir = L.dir ?? (RTL.has(L.scripts[0]) ? 'rtl' : 'ltr');
  return {
    id: L.id,
    name: L.name,
    alt: L.alt,
    kind: 'language',
    regions: L.regions,
    sample: a1 && !NO_SAMPLE[L.id] ? { text: leakFree(clip(tidy(a1, L.udhr), 260), [L.name, ...L.alt.filter((a) => /^[A-Za-z' ]+$/.test(a))]), dir, lang: L.udhr, source: 'UDHR Article 1' } : undefined,
    tells: L.tells,
    facts,
    ...(NO_SAMPLE[L.id] ? { facts: [...facts, ['Written form', `Practically identical to ${NO_SAMPLE[L.id]} on paper`]] } : {}),
    ...(n ? { rank: { label: 'Native speakers', value: n, unit: 'people' } } : {}),
    blurb: page ? blurbOf(page.extract) : undefined,
    wiki: page?.title ?? L.wiki,
    _views: views,
  };
});
const lviews = langItems.map((i) => i._views);
for (const it of langItems) { it.difficulty = difficultyOf(it._views, lviews); delete it._views; }

// ------------------------------------------------------------------ scripts
const scriptData = await pool(SCRIPTS, 4, async (S) => {
  const xml = await udhrXml(S.udhr);
  const a1 = xml ? article1(xml) : null;
  const page = await wikiPage(S.wiki);
  const views = page ? await pageviews(page.title) : 0;
  return { S, a1, page, views };
});
const scriptItems = scriptData.map(({ S, a1, page, views }) => {
  const key = S.key ?? S.name;
  const langs = LANGUAGES.filter((l) => l.scripts.includes(key));
  const regions = [...new Set(langs.flatMap((l) => l.regions))].sort();
  if (!a1) missing.push(`sample:script:${S.id}`);
  if (!page?.extract) missing.push(`blurb:script:${S.id}`);
  const dir = S.dir ?? (RTL.has(key) ? 'rtl' : 'ltr');
  const langNames = langs.map((l) => l.name);
  return {
    id: S.id,
    name: S.name,
    alt: S.alt,
    kind: 'script',
    regions,
    sample: a1 ? { text: clip(tidy(a1, S.udhr), NO_SPACE.has(key) ? 60 : 110), dir, lang: S.udhr, source: `UDHR Article 1 (${S.sampleLang})` } : undefined,
    tells: S.tells,
    facts: [
      ['Used for', langNames.length > 6 ? `${langNames.slice(0, 6).join(', ')} +${langNames.length - 6} more` : langNames.join(', ')],
      ['Official in', `${regions.length} ${regions.length === 1 ? 'country' : 'countries'}`],
      ['Direction', dir === 'rtl' ? 'Right to left' : 'Left to right'],
    ],
    rank: { label: 'Countries', value: regions.length, unit: 'countries' },
    blurb: page ? blurbOf(page.extract) : undefined,
    wiki: page?.title ?? S.wiki,
    _views: views,
  };
});
const sviews = scriptItems.map((i) => i._views);
for (const it of scriptItems) { it.difficulty = difficultyOf(it._views, sviews); delete it._views; }

// ------------------------------------------------------------------ write
const langMeta = {
  id: 'languages', group: 'culture', title: 'Languages',
  subtitle: `${langItems.length} languages from Afrikaans to Zulu`,
  emoji: '🗣️', color: '#ff8f6b', count: langItems.length, modes: ['sample', 'find', 'name', 'higher'], order: 1, map: 'countries',
};
const scriptMeta = {
  id: 'scripts', group: 'culture', title: 'Scripts & alphabets',
  subtitle: `${scriptItems.length} writing systems, from Cyrillic to Hangul`,
  // No 'higher': most scripts are official in just 1–2 countries, so nearly every pair would tie.
  emoji: '🔤', color: '#7ad7c4', count: scriptItems.length, modes: ['sample', 'find', 'name'], order: 2, map: 'countries',
};
const sortItems = (a) => [...a].sort((x, y) => x.name.localeCompare(y.name, 'en'));
fs.writeFileSync(`${OUT}/languages.json`, JSON.stringify({ meta: langMeta, items: sortItems(langItems), attribution: ATTRIBUTION }));
fs.writeFileSync(`${OUT}/scripts.json`, JSON.stringify({ meta: scriptMeta, items: sortItems(scriptItems), attribution: ATTRIBUTION }));
fs.writeFileSync(`${OUT}/index-culture.json`, JSON.stringify([langMeta, scriptMeta], null, 1));

const kb = (f) => Math.round(fs.statSync(`${OUT}/${f}`).size / 1024);
console.log(`languages ${langItems.length} (${kb('languages.json')} KB) · scripts ${scriptItems.length} (${kb('scripts.json')} KB)`);
const cov = (items, f) => `${Math.round((items.filter(f).length / items.length) * 100)}%`;
console.log('languages coverage — sample', cov(langItems, (i) => i.sample), `(no sample by design: ${Object.keys(NO_SAMPLE).join(', ')})`, 'blurb', cov(langItems, (i) => i.blurb), 'speakers', cov(langItems, (i) => i.rank), 'tells≥2', cov(langItems, (i) => i.tells.length >= 2));
console.log('scripts coverage   — sample', cov(scriptItems, (i) => i.sample), 'blurb', cov(scriptItems, (i) => i.blurb), 'tells≥2', cov(scriptItems, (i) => i.tells.length >= 2));
if (missing.length) console.log('missing:', missing.join(', '));
