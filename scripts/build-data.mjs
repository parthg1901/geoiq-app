// Builds app data files from world-countries, world-atlas and the fetched cache.
import fs from 'node:fs';
import { geoAzimuthalEqualArea, geoPath, geoCentroid, geoArea, geoDistance } from 'd3-geo';
import * as topojson from 'topojson-client';
import countries from 'world-countries';

const { pop, wiki } = JSON.parse(fs.readFileSync('scripts/.cache/combined.json', 'utf8'));
const all = Object.fromEntries(countries.map((c) => [c.cca3, c]));
const sel = countries.filter((x) => x.unMember || ['VAT', 'PSE', 'UNK', 'TWN'].includes(x.cca3));
const POP_FALLBACK = { TWN: 23400000, VAT: 764, UNK: 1586000 };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function maskText(text, c) {
  const words = new Set([c.name.common, c.name.official, ...c.altSpellings.filter((s) => s.length > 3),
    c.demonyms?.eng?.m, c.demonyms?.eng?.f, ...(c.capital || [])].filter(Boolean));
  if (c.cca3 === 'USA') ['America', 'American', 'U.S.'].forEach((w) => words.add(w));
  if (c.cca3 === 'GBR') ['Britain', 'British', 'England', 'English', 'U.K.'].forEach((w) => words.add(w));
  if (c.cca3 === 'NLD') ['Dutch', 'Holland'].forEach((w) => words.add(w));
  if (c.cca3 === 'TUR') ['Turkey', 'Turkish'].forEach((w) => words.add(w));
  if (c.cca3 === 'CZE') ['Czech'].forEach((w) => words.add(w));
  if (c.cca3 === 'CIV') ["Côte d'Ivoire", 'Ivorian'].forEach((w) => words.add(w));
  if (c.cca3 === 'TLS') ['East Timor', 'Timorese', 'Timor'].forEach((w) => words.add(w));
  // Root stem e.g. "Nigeria" -> also "Nigerian"
  const stem = c.name.common.split(' ').pop();
  if (stem.length > 4) words.add(stem.slice(0, -1));
  let out = text;
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${esc(w)}\\w*`, 'gi'), '▇▇▇');
  }
  return out.replace(/\s*\([^)]*\)/g, '').replace(/(▇▇▇[ ,]*){2,}/g, '▇▇▇ ');
}

// ---- country metadata
const meta = sel.map((c) => {
  const w = wiki[c.cca3] || {};
  const population = pop[c.cca3] ?? POP_FALLBACK[c.cca3] ?? null;
  const extract = (w.extract || '').split(/(?<=\.)\s+/).slice(0, 3).join(' ');
  return {
    id: c.cca3, cca2: c.cca2, name: c.name.common, official: c.name.official,
    alt: [...new Set([...c.altSpellings.filter((s) => s.length > 3 && !/^[A-Z]{2,3}$/.test(s)),
      ...(c.cca3 === 'TUR' ? ['Turkey'] : []), ...(c.cca3 === 'CZE' ? ['Czech Republic'] : []),
      ...(c.cca3 === 'CIV' ? ["Cote d'Ivoire", "Côte d'Ivoire"] : []), ...(c.cca3 === 'TLS' ? ['East Timor'] : []),
      ...(c.cca3 === 'COD' ? ['Democratic Republic of the Congo', 'Congo-Kinshasa', 'DRC'] : []),
      ...(c.cca3 === 'COG' ? ['Congo', 'Congo-Brazzaville'] : []), ...(c.cca3 === 'USA' ? ['USA', 'America', 'US'] : []),
      ...(c.cca3 === 'GBR' ? ['UK', 'Britain', 'Great Britain'] : []), ...(c.cca3 === 'ARE' ? ['UAE'] : []),
      ...(c.cca3 === 'MMR' ? ['Burma'] : []), ...(c.cca3 === 'SWZ' ? ['Swaziland'] : []), ...(c.cca3 === 'CPV' ? ['Cabo Verde'] : []),
      ...(c.cca3 === 'MKD' ? ['Macedonia'] : []), ...(c.cca3 === 'VAT' ? ['Vatican', 'Holy See'] : []),
    ])],
    capital: c.capital?.[0] || '', region: c.region, subregion: c.subregion || c.region,
    borders: c.borders || [], area: c.area, landlocked: c.landlocked, latlng: c.latlng,
    languages: Object.values(c.languages || {}), currencies: Object.values(c.currencies || {}).map((x) => x.name),
    tld: c.tld?.[0] || '', calling: (c.idd?.root || '') + (c.idd?.suffixes?.length === 1 ? c.idd.suffixes[0] : ''),
    demonym: c.demonyms?.eng?.m || '', population, views: w.views || 0,
    blurb: maskText(extract, c),
    fact: extract.split(/(?<=\.)\s+/).slice(0, 2).join(' ').replace(/\s*\([^)]*\)/g, ''),
  };
});
// Mask currency/language names that leak the country (e.g. "Japanese yen")
for (const m of meta) {
  const c = all[m.id];
  m.currenciesMasked = m.currencies.map((x) => maskText(x, c));
  m.languagesMasked = m.languages.map((x) => maskText(x, c));
}
const names = Object.fromEntries(countries.map((c) => [c.cca3, c.name.common]));
fs.writeFileSync('src/data/countries.json', JSON.stringify({ countries: meta, names }));

// Drop vertices closer than 0.6px to the previous kept one.
function thin(d) {
  return d.split('M').filter(Boolean).map((ring) => {
    const closed = ring.endsWith('Z');
    const pts = ring.replace('Z', '').split('L').map((q) => q.split(',').map(Number));
    const out = [pts[0]];
    for (const q of pts.slice(1)) {
      const l = out[out.length - 1];
      if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 0.6) out.push(q);
    }
    if (out.length < 3) return '';
    return 'M' + out.map((q) => q.join(',')).join('L') + (closed ? 'Z' : '');
  }).join('');
}

// ---- shapes: projected per-country silhouettes
const shapes = {};
for (const c of sel) {
  const gj = JSON.parse(fs.readFileSync(`node_modules/world-countries/data/${c.cca3.toLowerCase()}.geo.json`, 'utf8'));
  let geom = gj.features[0].geometry;
  if (!geom) {
    const t10 = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-10m.json', 'utf8'));
    const g = t10.objects.countries.geometries.find((x) => x.properties.name === c.name.common);
    geom = topojson.feature(t10, g).geometry;
  }
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const feats = polys.map((p) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: p } }));
  // d3 expects clockwise exterior rings; detect inverted polygons (area > hemisphere)
  for (const f of feats) if (geoArea(f) > 2 * Math.PI) f.geometry.coordinates = f.geometry.coordinates.map((r) => r.slice().reverse());
  const areas = feats.map((f) => geoArea(f));
  const big = areas.indexOf(Math.max(...areas));
  const cen = geoCentroid(feats[big]);
  // grow a cluster from the largest landmass, chaining in polygons within ~350km of it
  const bb = feats.map((f) => { const r = f.geometry.coordinates[0]; let x0 = 999, y0 = 999, x1 = -999, y1 = -999;
    for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; });
  const G = 3; // ~330km chaining gap in degrees
  const near = (a, b, g = areas[a] < areas[big] * 0.004 ? 0.7 : G) => !(bb[a][0] - g > bb[b][2] || bb[b][0] - g > bb[a][2] || bb[a][1] - g > bb[b][3] || bb[b][1] - g > bb[a][3]);
  const inSet = new Set([big]);
  const queue = [big];
  while (queue.length) {
    const j = queue.pop();
    for (let i = 0; i < feats.length; i++) {
      if (!inSet.has(i) && (near(i, j) || areas[i] > areas[big] * 0.3)) { inSet.add(i); queue.push(i); }
    }
  }
  const keep = feats.filter((_, i) => inSet.has(i));
  const fc = { type: 'FeatureCollection', features: keep };
  const center = geoCentroid(fc);
  const proj = geoAzimuthalEqualArea().rotate([-center[0], -center[1]]).fitExtent([[4, 4], [196, 196]], fc);
  const p = geoPath(proj).digits(1);
  // drop sub-pixel islands
  const d = keep.map((f) => (geoPath(proj).area(f) > 0.8 ? p(f) : '')).join('');
  shapes[c.cca3] = thin(d || p(fc));
}
fs.writeFileSync('public/data/shapes.json', JSON.stringify(shapes));

// ---- world map topojson keyed by cca3
const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json', 'utf8'));
const byNum = Object.fromEntries(countries.filter((c) => c.ccn3).map((c) => [c.ccn3, c.cca3]));
for (const g of topo.objects.countries.geometries) {
  const id = byNum[g.id] || (g.properties.name === 'Kosovo' ? 'UNK' : null);
  g.properties = { n: g.properties.name };
  g.id = id || `X-${g.properties.n}`;
}
fs.writeFileSync('public/data/world-50m.json', JSON.stringify(topo));
const t110 = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
for (const g of t110.objects.countries.geometries) {
  g.id = byNum[g.id] || (g.properties.name === 'Kosovo' ? 'UNK' : `X-${g.properties.name}`);
  g.properties = {};
}
fs.writeFileSync('public/data/world-110m.json', JSON.stringify(t110));

// Captions were stored cut at 220 chars: end them on a sentence (or word) boundary instead.
function tidyCaption(t) {
  if (!t || t.length < 215) return t;
  const dot = t.lastIndexOf('. ');
  if (dot > 80) return t.slice(0, dot + 1);
  return t.slice(0, t.lastIndexOf(' ')).replace(/[,;:(\s]+$/, '') + '…';
}

// ---- images
const images = {};
for (const c of sel) {
  images[c.cca3] = (wiki[c.cca3]?.images || []).map((i) => ({
    u: i.url.replace(/\?.*$/, ''), c: tidyCaption(i.caption), a: i.artist, l: i.license, p: i.page,
  }));
}
fs.writeFileSync('public/data/images.json', JSON.stringify(images));

// ---- flags (copy SVGs)
fs.mkdirSync('public/flags', { recursive: true });
for (const c of sel) fs.copyFileSync(`node_modules/world-countries/data/${c.cca3.toLowerCase()}.svg`, `public/flags/${c.cca3}.svg`);
console.log('countries', meta.length, 'shapes', Object.keys(shapes).length);
