// Fetches external data (population, Wikipedia extracts, pageviews, images) and caches it.
import fs from 'node:fs';
import path from 'node:path';
import countries from 'world-countries';

const CACHE = path.resolve('scripts/.cache');
const UA = { 'User-Agent': 'GeoIQ-build/1.0 (educational geography app; parth.eng1210@gmail.com)' };
const sel = countries.filter((x) => x.unMember || ['VAT', 'PSE', 'UNK', 'TWN'].includes(x.cca3));

const WIKI = {
  GEO: 'Georgia (country)', IRL: 'Republic of Ireland', COG: 'Republic of the Congo',
  COD: 'Democratic Republic of the Congo', FSM: 'Federated States of Micronesia', PSE: 'State of Palestine',
  CIV: 'Ivory Coast', TUR: 'Turkey', CZE: 'Czech Republic', GMB: 'The Gambia', BHS: 'The Bahamas',
  STP: 'São Tomé and Príncipe', TLS: 'East Timor', VAT: 'Vatican City', TWN: 'Taiwan', UNK: 'Kosovo',
  USA: 'United States', GBR: 'United Kingdom', KOR: 'South Korea', PRK: 'North Korea', MKD: 'North Macedonia',
  SWZ: 'Eswatini', CPV: 'Cape Verde', JOR: 'Jordan', GIN: 'Guinea', CHN: 'China', MMR: 'Myanmar',
};
const title = (c) => WIKI[c.cca3] || c.name.common;

async function cached(key, fn) {
  const f = path.join(CACHE, key.replace(/[^a-z0-9_-]/gi, '_') + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  return null;
}

const BAD = /(flag|coat[_ ]of[_ ]arms|emblem|logo|locator|location|map|seal|chart|graph|diagram|population|signature|orthographic|projection|banknote|coin|stamp|portrait|president|minister|king_|queen_|prince|official|meeting|summit|election|_with_|icon|symbol|ballot|parliament_seating|climate|köppen|koppen|relief|topographic|satellite|nasa|earth_|globe)/i;

async function images(c) {
  const t = title(c);
  const pages = [t, `Tourism in ${t.replace(/^The /, 'the ')}`, `Geography of ${t.replace(/^The /, 'the ')}`, `Culture of ${t.replace(/^The /, 'the ')}`];
  const files = new Set();
  for (const p of pages) {
    const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=images&imlimit=200&titles=${encodeURIComponent(p)}`);
    const pg = j && Object.values(j.query?.pages || {})[0];
    for (const im of pg?.images || []) if (/\.jpe?g$/i.test(im.title) && !BAD.test(im.title)) files.add(im.title);
  }
  const list = [...files].slice(0, 60);
  const out = [];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=900&titles=${encodeURIComponent(chunk.join('|'))}`);
    for (const pg of Object.values(j?.query?.pages || {})) {
      const ii = pg.imageinfo?.[0];
      if (!ii || ii.width < 600 || ii.height < 350) continue;
      const ratio = ii.width / ii.height;
      if (ratio < 0.9 || ratio > 2.4) continue; // prefer landscape-ish photos
      const md = ii.extmetadata || {};
      const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      out.push({
        url: ii.thumburl, page: ii.descriptionshorturl,
        caption: strip(md.ImageDescription?.value).slice(0, 220),
        artist: strip(md.Artist?.value).slice(0, 80), license: strip(md.LicenseShortName?.value),
        cat: strip(md.Categories?.value).slice(0, 300),
      });
    }
  }
  return out;
}

const pop = await cached('worldbank-pop', async () => {
  const j = await getJSON('https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&mrnev=1&per_page=400');
  return Object.fromEntries(j[1].map((r) => [r.countryiso3code, r.value]));
});

const result = {};
let n = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (n < sel.length) {
    const c = sel[n++];
    const t = title(c);
    const summary = await cached(`sum-${c.cca3}`, () => getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`));
    const views = await cached(`pv-${c.cca3}`, async () => {
      const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent((summary?.titles?.canonical) || t.replace(/ /g, '_'))}/monthly/2025010100/2025123100`);
      return (j?.items || []).reduce((a, b) => a + b.views, 0);
    });
    const imgs = await cached(`img-${c.cca3}`, () => images(c));
    result[c.cca3] = { extract: summary?.extract || '', views, images: imgs };
    console.log(c.cca3, views, imgs.length);
  }
}));
fs.writeFileSync(path.join(CACHE, 'combined.json'), JSON.stringify({ pop, wiki: result }));
