// Cached Wikipedia / Wikidata lookups for the physical packs.
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve('scripts/.cache/packs-physical');
fs.mkdirSync(CACHE, { recursive: true });
const UA = { 'User-Agent': 'GeoIQ-build/1.0 (+https://github.com/parthg1901/geoiq-app)' };

async function getJSON(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  return null;
}
async function cached(key, fn) {
  const f = path.join(CACHE, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  if (v != null) fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

/** Wikipedia page → { title, qid, extract } (follows redirects). */
export const wikiPage = (title) => cached(`page-${title}`, async () => {
  const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops|extracts&exintro=1&explaintext=1&exsentences=3&ppprop=wikibase_item&titles=${encodeURIComponent(title)}`);
  const p = j && Object.values(j.query?.pages || {})[0];
  if (!p || p.missing != null) return null;
  return { title: p.title, qid: p.pageprops?.wikibase_item ?? null, extract: p.extract ?? '' };
});

export const pageviews = (title) => cached(`pv-${title}`, async () => {
  const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/2025010100/2025123100`);
  return (j?.items || []).reduce((a, b) => a + b.views, 0);
});

export const entity = (qid) => cached(`wd-${qid}`, async () => {
  const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const e = j?.entities?.[qid] ?? Object.values(j?.entities || {})[0];
  if (!e) return null;
  // keep only what we use, to keep the cache small
  const keep = ['P17', 'P403', 'P885', 'P2043', 'P2046', 'P2044', 'P625', 'P4552', 'P2660', 'P4511', 'P610', 'P30', 'P31'];
  const claims = {};
  for (const k of keep) if (e.claims?.[k]) claims[k] = e.claims[k].filter((c) => c.rank !== 'deprecated').map((c) => ({ rank: c.rank, v: c.mainsnak?.datavalue?.value }));
  return { label: e.labels?.en?.value, aliases: (e.aliases?.en || []).map((a) => a.value), claims };
});

/** Batch labels for QIDs. */
export async function labels(qids) {
  const out = {};
  const need = [...new Set(qids)].filter(Boolean);
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const j = await cached(`labels-${chunk.join(',').slice(0, 180)}-${chunk.length}`, () => getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${chunk.join('|')}`));
    for (const [id, e] of Object.entries(j?.entities || {})) out[id] = e.labels?.en?.value;
  }
  return out;
}

const UNIT = {
  Q828224: 1, Q253276: 1.609344, Q11573: 0.001, // km, mile, metre → km
};
const AREA_UNIT = { Q712226: 1, Q232291: 2.58999, Q35852: 0.01, Q25343: 1e-6 }; // km², sq mi, ha, m² → km²
const ELEV_UNIT = { Q11573: 1, Q3710: 0.3048 }; // m, ft → m
const unitOf = (v) => v?.unit?.split('/').pop();

/** Best numeric value of a quantity claim converted with a unit table (preferred rank first, then largest). */
export function quantity(claims, prop, table) {
  const list = (claims?.[prop] || []).filter((c) => c.v?.amount != null && table[unitOf(c.v)] != null);
  if (!list.length) return null;
  const pref = list.filter((c) => c.rank === 'preferred');
  const pool = pref.length ? pref : list;
  const vals = pool.map((c) => Number(c.v.amount) * table[unitOf(c.v)]);
  return Math.max(...vals);
}
export const lengthKm = (c) => quantity(c, 'P2043', UNIT);
export const areaKm2 = (c) => quantity(c, 'P2046', AREA_UNIT);
export const elevationM = (c) => quantity(c, 'P2044', ELEV_UNIT);
export const prominenceM = (c) => quantity(c, 'P2660', ELEV_UNIT);
export const depthM = (c) => quantity(c, 'P4511', ELEV_UNIT);
export const itemIds = (claims, prop) => (claims?.[prop] || []).map((c) => c.v?.id).filter(Boolean);
export function coords(claims) {
  const c = (claims?.P625 || [])[0]?.v;
  return c ? [c.longitude, c.latitude] : null;
}

/** First 1–2 sentences of an extract, max ~260 chars (pronunciations and parentheticals removed). */
export function blurbOf(extract) {
  let s = (extract || '').replace(/\s+/g, ' ');
  // strip (possibly nested) parentheses and square brackets
  for (let i = 0; i < 4; i++) s = s.replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^[\]]*\]/g, '');
  s = s.replace(/\s+([,.;])/g, '$1').trim();
  // sentence ends: a period after 2+ lowercase letters (not decimals, initials or "U.S."), then a capital
  const sentences = s.split(/(?<=[a-z\u00e0-\u00ff)'’"]{2}[.!?])\s+(?=[A-Z\u00c0-\u00de])/);
  let out = sentences[0] ?? '';
  if (sentences[1] && (out + ' ' + sentences[1]).length < 280) out += ' ' + sentences[1];
  return out.trim();
}

/** Run async fn over items with limited concurrency. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
