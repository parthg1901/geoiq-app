// Fetches rich per-country profile data: Wikidata facts + Wikipedia section summaries. Cached in scripts/.cache.
import fs from 'node:fs';
import path from 'node:path';
import countries from 'world-countries';

const CACHE = path.resolve('scripts/.cache');
const UA = { 'User-Agent': 'Geonaut-build/1.0 (+https://github.com/parthg1901/geonaut)' };
const sel = countries.filter((x) => x.unMember || ['VAT', 'PSE', 'UNK', 'TWN'].includes(x.cca3));
const ISO = new Set(sel.map((c) => (c.cca3 === 'UNK' ? 'XKX' : c.cca3)));
const WIKI = {
  GEO: 'Georgia (country)', IRL: 'Republic of Ireland', COG: 'Republic of the Congo', COD: 'Democratic Republic of the Congo',
  FSM: 'Federated States of Micronesia', PSE: 'State of Palestine', CIV: 'Ivory Coast', TUR: 'Turkey', CZE: 'Czech Republic',
  GMB: 'The Gambia', BHS: 'The Bahamas', STP: 'São Tomé and Príncipe', TLS: 'East Timor', VAT: 'Vatican City', TWN: 'Taiwan',
  UNK: 'Kosovo', USA: 'United States', GBR: 'United Kingdom', KOR: 'South Korea', PRK: 'North Korea', MKD: 'North Macedonia',
  SWZ: 'Eswatini', CPV: 'Cape Verde', JOR: 'Jordan', GIN: 'Guinea', CHN: 'China', MMR: 'Myanmar',
};
const title = (c) => WIKI[c.cca3] || c.name.common;

async function cached(key, fn) {
  const f = path.join(CACHE, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  if (v != null) fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
async function getJSON(url, opts = {}) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 2000)); }
  }
  return null;
}
const sparql = (q) => getJSON('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });

// --- Wikidata quantities (latest value by point-in-time qualifier)
const QUANT = { gdp: 'P2131', gdpPc: 'P2132', hdi: 'P1081', life: 'P2250', gini: 'P1125', ppp: 'P4010' };
// --- Wikidata items (labels)
const ITEMS = { gov: 'P122', hos: 'P35', hog: 'P6', anthem: 'P85', drive: 'P1622', member: 'P463', highest: 'P610', lowest: 'P1589', tz: 'P421', religion: 'P3075', largest: 'P1376' };

const wd = {};
const put = (iso, k, v) => { if (!ISO.has(iso)) return; const id = iso === 'XKX' ? 'UNK' : iso; (wd[id] ??= {})[k] ??= []; wd[id][k].push(v); };

for (const [k, p] of Object.entries(QUANT)) {
  const j = await cached(`wd-${k}`, () => sparql(`SELECT ?iso ?v ?t WHERE { ?c wdt:P298 ?iso; p:${p} ?st. ?st ps:${p} ?v. OPTIONAL { ?st pq:P585 ?t } }`));
  for (const b of j?.results?.bindings || []) put(b.iso.value, k, { v: Number(b.v.value), t: b.t?.value || '' });
  console.log('wd', k, j?.results?.bindings?.length);
}
for (const [k, p] of Object.entries(ITEMS)) {
  const q = k === 'largest'
    ? `SELECT ?iso ?vLabel WHERE { ?c wdt:P298 ?iso. ?v wdt:P1376 ?c; wdt:P31/wdt:P279* wd:Q515. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 1`
    : k === 'highest' || k === 'lowest'
      ? `SELECT ?iso ?vLabel ?el WHERE { ?c wdt:P298 ?iso; wdt:${p} ?v. OPTIONAL { ?v wdt:P2044 ?el } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`
      : `SELECT ?iso ?vLabel WHERE { ?c wdt:P298 ?iso; wdt:${p} ?v. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  if (k === 'largest') continue; // not reliable via Wikidata; skipped
  const j = await cached(`wd-${k}`, () => sparql(q));
  for (const b of j?.results?.bindings || []) put(b.iso.value, k, b.el ? { name: b.vLabel?.value, el: Number(b.el.value) } : b.vLabel?.value);
  console.log('wd', k, j?.results?.bindings?.length);
}
// Inception (independence/founding) + motto text
{
  const j = await cached('wd-inception', () => sparql(`SELECT ?iso ?v WHERE { ?c wdt:P298 ?iso; wdt:P571 ?v. }`));
  for (const b of j?.results?.bindings || []) put(b.iso.value, 'inception', b.v.value);
  const m = await cached('wd-motto', () => sparql(`SELECT ?iso ?v WHERE { ?c wdt:P298 ?iso; wdt:P1451 ?v. FILTER(LANG(?v) = "en" || LANG(?v) = "") }`));
  for (const b of m?.results?.bindings || []) put(b.iso.value, 'motto', b.v.value);
  const m2 = await cached('wd-motto-any', () => sparql(`SELECT ?iso ?v WHERE { ?c wdt:P298 ?iso; wdt:P1451 ?v. }`));
  for (const b of m2?.results?.bindings || []) put(b.iso.value, 'mottoAny', b.v.value);
}

// --- Wikipedia: full intro + chosen sections from plaintext article
const SECTIONS = ['Etymology', 'History', 'Geography', 'Climate', 'Biodiversity', 'Government and politics', 'Politics', 'Economy', 'Tourism', 'Demographics', 'Religion', 'Languages', 'Culture', 'Cuisine', 'Sport', 'Sports', 'Music', 'Architecture'];
function parseArticle(text) {
  const parts = text.split(/\n(?===+ [^=]+ ==+)/);
  const intro = parts[0].trim();
  const sec = {};
  for (const p of parts.slice(1)) {
    const m = p.match(/^(==+) ([^=]+?) ==+\n([\s\S]*)$/);
    if (!m) continue;
    const name = m[2].trim();
    const body = m[3].split(/\n(?===+ )/)[0].trim(); // text before first subsection
    const firstSub = m[3].match(/\n===+ [^=]+ ===+\n([\s\S]*?)(\n==|$)/);
    const txt = (body || firstSub?.[1] || '').trim();
    if (!txt) continue;
    if (m[1].length === 2 || !sec[name]) sec[name] = txt;
  }
  return { intro, sec };
}
const trimParas = (t, max) => {
  const paras = t.split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 40);
  let out = '';
  for (const p of paras) { if ((out + p).length > max && out) break; out += (out ? '\n\n' : '') + p; }
  return out.length > max * 1.6 ? out.slice(0, max * 1.4).replace(/[^.]*$/, '') : out;
};

const profiles = {};
let n = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (n < sel.length) {
    const c = sel[n++];
    const art = await cached(`art-${c.cca3}`, async () => {
      const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts&explaintext=1&exsectionformat=wiki&titles=${encodeURIComponent(title(c))}`);
      const pg = j && Object.values(j.query?.pages || {})[0];
      return pg?.extract ? parseArticle(pg.extract) : null;
    });
    const sections = {};
    if (art) {
      for (const s of SECTIONS) {
        const t = art.sec[s];
        if (!t) continue;
        const key = s === 'Politics' ? 'Government and politics' : s === 'Sports' ? 'Sport' : s;
        if (!sections[key]) sections[key] = trimParas(t, 900);
      }
    }
    profiles[c.cca3] = { intro: art ? trimParas(art.intro, 2600) : '', sections };
    console.log(c.cca3, art ? Object.keys(sections).length : 'NO ARTICLE');
  }
}));

fs.writeFileSync(path.join(CACHE, 'profiles-combined.json'), JSON.stringify({ wd, profiles }));
