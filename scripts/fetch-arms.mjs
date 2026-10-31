// Fetches coats of arms (or the state emblem/seal where a country has no arms) from Wikidata/Commons.
// Output: raw PNGs in scripts/.cache/arms/png + src/data/arms.json; then run scripts/compress-arms.sh
// to write the small WebP files the app ships (public/arms/{ID}.webp).
import fs from 'node:fs';
import path from 'node:path';
import countries from 'world-countries';

const CACHE = path.resolve('scripts/.cache/arms');
const UA = { 'User-Agent': 'GeoIQ-build/1.0 (educational; parth.eng1210@gmail.com)' };
const sel = countries.filter((x) => x.unMember || ['VAT', 'PSE', 'UNK', 'TWN'].includes(x.cca3));
const ISO = new Set(sel.map((c) => c.cca3));

async function getJSON(url, headers = {}) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers } });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 2000)); }
  }
  return null;
}
async function cached(key, fn) {
  const f = path.join(CACHE, key + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  if (v != null) fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
const sparql = (q) => getJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { Accept: 'application/sparql-results+json' });
const fileName = (u) => decodeURIComponent(u.split('/').pop());

// P94 = coat of arms image, P237 = coat of arms (item) → its P18 image, P158 = seal image
const q = `SELECT ?iso ?c ?arms ?armsItemImg ?seal WHERE {
  { ?c wdt:P298 ?iso } UNION { VALUES (?c ?iso) { (wd:Q1246 "UNK") } }
  OPTIONAL { ?c wdt:P94 ?arms }
  OPTIONAL { ?c wdt:P237 ?ai . ?ai wdt:P18 ?armsItemImg }
  OPTIONAL { ?c wdt:P158 ?seal }
}`;
const j = await cached('wikidata', () => sparql(q));
const pick = {};
for (const b of j.results.bindings) {
  const iso = b.iso.value;
  if (!ISO.has(iso)) continue;
  const p = (pick[iso] ??= {});
  if (b.arms) p.arms ??= b.arms.value;
  if (b.armsItemImg) p.item ??= b.armsItemImg.value;
  if (b.seal) p.seal ??= b.seal.value;
}

// Countries whose "arms" is really a state emblem/seal (wording in the quiz)
const EMBLEM = new Set(['CHN', 'IND', 'ISR', 'PRK', 'VNM', 'LAO', 'TUR', 'IRN', 'SAU', 'IDN', 'BGD', 'PAK', 'AFG', 'KAZ', 'UZB', 'TKM', 'TJK', 'KGZ', 'AZE', 'MNG', 'LKA', 'NPL', 'BTN', 'MMR', 'THA', 'KHM', 'BRN', 'KOR', 'TWN', 'LBY', 'DZA', 'IRQ', 'SYR', 'YEM', 'OMN', 'ARE', 'QAT', 'KWT', 'PSE', 'SDN', 'ERI', 'ETH', 'DJI', 'BLR', 'MDV', 'TLS', 'ITA', 'FRA', 'MOZ', 'AGO']);
const SEAL_ONLY = new Set(['JPN', 'PLW', 'FSM', 'MHL', 'MRT']);

const out = {};
let total = 0;
const ids = Object.keys(pick).sort();
for (const id of ids) {
  const p = pick[id];
  const src = p.arms || p.item || p.seal;
  if (!src) continue;
  const fname = fileName(src);
  const info = await cached(`ii-${id}`, async () => {
    const r = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=300&titles=${encodeURIComponent('File:' + fname)}`);
    const pg = r && Object.values(r.query?.pages || {})[0];
    return pg?.imageinfo?.[0] ?? null;
  });
  if (!info?.thumburl) { console.log('no thumb', id, fname); continue; }
  fs.mkdirSync(path.join(CACHE, 'png'), { recursive: true });
  const dest = path.join(CACHE, 'png', `${id}.png`);
  if (!fs.existsSync(dest)) {
    const r = await fetch(info.thumburl, { headers: UA });
    if (!r.ok) { console.log('dl fail', id, r.status); continue; }
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    await new Promise((s) => setTimeout(s, 150));
  }
  total += fs.statSync(dest).size;
  const md = info.extmetadata || {};
  const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  out[id] = {
    kind: SEAL_ONLY.has(id) || (!p.arms && !p.item && p.seal) ? 'seal' : EMBLEM.has(id) ? 'emblem' : 'arms',
    file: `/arms/${id}.webp`,
    credit: [strip(md.Artist?.value).slice(0, 60), strip(md.LicenseShortName?.value)].filter(Boolean).join(' · '),
    page: info.descriptionurl,
  };
}
fs.writeFileSync('src/data/arms.json', JSON.stringify(out, null, 0));
console.log('coverage', Object.keys(out).length, '/', sel.length, 'raw KB', Math.round(total / 1024));
console.log('missing', sel.map((c) => c.cca3).filter((c) => !out[c]).join(' '));
