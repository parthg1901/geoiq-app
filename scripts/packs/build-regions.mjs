// Builds the "regions" content packs (states/provinces inside big countries) from Natural Earth admin-1
// boundaries + Wikidata/Wikipedia/Commons. Output follows the contract in src/lib/packs.ts:
//   public/data/packs/index-regions.json, public/data/packs/{packId}.json, public/data/packs/img/{packId}/*
// Network responses are cached in scripts/.cache/packs-regions/, so re-runs work offline.
import fs from 'node:fs';
import { geoArea, geoCentroid, geoAzimuthalEqualArea, geoPath } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, filter as topoFilter, filterWeight } from 'topojson-simplify';
import * as topojson from 'topojson-client';
import worldCountries from 'world-countries';
import { cachedJSON, cachedBinary, pool, entities } from './regions-net.mjs';

const OUT = 'public/data/packs';
const ATTRIBUTION = 'Boundaries: Natural Earth (public domain). Facts: Wikidata (CC0). Summaries: Wikipedia (CC BY-SA 4.0). Flags & coats of arms: Wikimedia Commons (individual file licenses).';
const IMG_WIDTH = 200;

// ---------------------------------------------------------------- pack definitions
const PACKS = [
  {
    id: 'us-states', adm0: 'USA', order: 1, title: 'US States', subtitle: '50 states + Washington, D.C.', emoji: '🇺🇸', color: '#53b8ff',
    projection: { type: 'albersUsa' }, targetPoints: 9000,
    neighbours: ['CAN', 'MEX', 'CUB', 'BHS'],
    kind: (p) => (p.iso_3166_2 === 'US-DC' ? 'federal district' : 'state'),
    names: { 'US-DC': 'Washington, D.C.' }, alts: { 'US-DC': ['District of Columbia', 'DC', 'Washington DC'] },
    noShape: ['US-DC'], noCapital: ['US-DC'],
  },
  {
    id: 'in-states', adm0: 'IND', order: 2, title: 'Indian States', subtitle: '28 states + 8 union territories', emoji: '🇮🇳', color: '#ffb547',
    projection: { type: 'conicEqualArea', rotate: [-80, 0], parallels: [12, 28] }, targetPoints: 9000,
    neighbours: ['PAK', 'CHN', 'NPL', 'BTN', 'BGD', 'MMR', 'LKA', 'AFG'],
    kind: (p) => (['IN-DL', 'IN-CH', 'IN-PY', 'IN-LD', 'IN-AN', 'IN-DH', 'IN-JK', 'IN-LA'].includes(p.iso_3166_2) ? 'union territory' : 'state'),
    names: { 'IN-AN': 'Andaman and Nicobar Islands', 'IN-DH': 'Dadra and Nagar Haveli and Daman and Diu' },
    alts: { 'IN-DL': ['NCT of Delhi', 'New Delhi'], 'IN-DH': ['DNHDD', 'Daman and Diu', 'Dadra and Nagar Haveli'], 'IN-AN': ['Andaman and Nicobar', 'Andamans'], 'IN-OR': ['Orissa'], 'IN-UT': ['Uttaranchal'], 'IN-PY': ['Pondicherry'] },
    noShape: ['IN-DL', 'IN-CH', 'IN-PY', 'IN-LD', 'IN-DH', 'IN-GA'], noCapital: [],
  },
  {
    id: 'ca-provinces', adm0: 'CAN', order: 3, title: 'Canadian Provinces', subtitle: '10 provinces + 3 territories', emoji: '🇨🇦', color: '#ff5d73',
    projection: { type: 'conicEqualArea', rotate: [96, 0], parallels: [50, 70] }, targetPoints: 12000, minRing: 0.02,
    neighbours: ['USA', 'GRL'],
    kind: (p) => (/territory/i.test(p.type_en || '') ? 'territory' : 'province'),
    names: { 'CA-QC': 'Quebec' }, alts: { 'CA-QC': ['Québec'], 'CA-NL': ['Newfoundland', 'Labrador'], 'CA-PE': ['PEI'], 'CA-NT': ['NWT'] },
    noShape: [], noCapital: [],
  },
  {
    id: 'au-states', adm0: 'AUS', order: 4, title: 'Australian States', subtitle: '6 states + 2 mainland territories', emoji: '🇦🇺', color: '#3ddc97',
    projection: { type: 'conicEqualArea', rotate: [-134, 0], parallels: [-18, -36] }, targetPoints: 7000,
    neighbours: ['PNG', 'IDN', 'NZL', 'TLS'],
    include: (p) => ['AU-WA', 'AU-NT', 'AU-SA', 'AU-QLD', 'AU-NSW', 'AU-VIC', 'AU-TAS', 'AU-ACT'].includes(p.iso_3166_2) && !!p.wikidataid,
    kind: (p) => (/territory/i.test(p.type_en || '') ? 'territory' : 'state'),
    names: {}, alts: { 'AU-ACT': ['ACT', 'Canberra'], 'AU-NSW': ['NSW'], 'AU-NT': ['NT'], 'AU-WA': ['WA'], 'AU-QLD': ['QLD'] },
    noShape: [], noCapital: [],
  },
  {
    id: 'br-states', adm0: 'BRA', order: 5, title: 'Brazilian States', subtitle: '26 states + Federal District', emoji: '🇧🇷', color: '#3ddc97',
    projection: { type: 'azimuthalEqualArea', rotate: [52, 14] }, targetPoints: 8000,
    neighbours: ['ARG', 'BOL', 'PRY', 'URY', 'PER', 'COL', 'VEN', 'GUY', 'SUR', 'ECU', 'CHL'],
    kind: (p) => (p.iso_3166_2 === 'BR-DF' ? 'federal district' : 'state'),
    names: {}, alts: { 'BR-DF': ['Federal District', 'Brasília'] },
    noShape: ['BR-DF'], noCapital: [],
  },
  {
    id: 'mx-states', adm0: 'MEX', order: 6, title: 'Mexican States', subtitle: '31 states + Mexico City', emoji: '🇲🇽', color: '#ff6b5e',
    projection: { type: 'conicEqualArea', rotate: [102, 0], parallels: [17, 29] }, targetPoints: 7000,
    neighbours: ['USA', 'GTM', 'BLZ', 'CUB', 'HND', 'SLV'],
    include: (p) => !!p.wikidataid,
    kind: (p) => (p.iso_3166_2 === 'MX-DIF' ? 'capital city' : 'state'),
    names: { 'MX-DIF': 'Mexico City', 'MX-MEX': 'State of Mexico' },
    alts: { 'MX-DIF': ['Ciudad de México', 'CDMX', 'Distrito Federal'], 'MX-MEX': ['Mexico State', 'Estado de México', 'Edomex'], 'MX-VER': ['Veracruz de Ignacio de la Llave'], 'MX-COA': ['Coahuila de Zaragoza'], 'MX-MIC': ['Michoacán de Ocampo'] },
    noShape: ['MX-DIF'], noCapital: ['MX-DIF'],
  },
  {
    id: 'de-states', adm0: 'DEU', order: 7, title: 'German States', subtitle: '16 Länder', emoji: '🇩🇪', color: '#ffb547',
    projection: { type: 'conicEqualArea', rotate: [-10.5, 0], parallels: [48, 54] }, targetPoints: 5000,
    neighbours: ['DNK', 'POL', 'CZE', 'AUT', 'CHE', 'FRA', 'LUX', 'BEL', 'NLD'],
    useWdLabel: true,
    kind: (p) => (['DE-BE', 'DE-HH', 'DE-HB'].includes(p.iso_3166_2) ? 'city-state' : 'state'),
    names: {}, alts: {},
    noShape: ['DE-BE', 'DE-HH', 'DE-HB'], noCapital: ['DE-BE', 'DE-HH'],
  },
  {
    id: 'cn-provinces', adm0: 'CHN', order: 8, title: 'Chinese Provinces', subtitle: 'Provinces, regions & municipalities', emoji: '🇨🇳', color: '#ff5d73',
    projection: { type: 'conicEqualArea', rotate: [-105, 0], parallels: [25, 47] }, targetPoints: 9000,
    neighbours: ['RUS', 'MNG', 'KAZ', 'KGZ', 'TJK', 'AFG', 'PAK', 'IND', 'NPL', 'BTN', 'MMR', 'LAO', 'VNM', 'PRK', 'KOR', 'JPN', 'TWN', 'PHL'],
    include: (p) => !!p.wikidataid,
    kind: (p) => (p.type_en || 'province').toLowerCase(),
    names: { 'CN-NM': 'Inner Mongolia', 'CN-XZ': 'Tibet' },
    alts: { 'CN-XZ': ['Xizang', 'Tibet Autonomous Region'], 'CN-NM': ['Nei Mongol', 'Inner Mongol'], 'CN-XJ': ['Xinjiang Uyghur'], 'CN-GX': ['Guangxi Zhuang'], 'CN-NX': ['Ningxia Hui'], 'CN-SN': ['Shensi'], 'CN-SX': ['Shansi'], 'CN-GD': ['Canton', 'Kwangtung'] },
    noShape: ['CN-SH', 'CN-TJ', 'CN-BJ'], noCapital: ['CN-SH', 'CN-TJ', 'CN-BJ', 'CN-CQ'],
  },
  {
    id: 'ru-subjects', adm0: 'RUS', order: 9, title: 'Russian Regions', subtitle: 'Federal subjects of Russia', emoji: '🇷🇺', color: '#b48cff',
    projection: { type: 'conicEqualArea', rotate: [-100, 0], parallels: [52, 64] }, targetPoints: 14000, minRing: 0.03,
    neighbours: ['NOR', 'FIN', 'EST', 'LVA', 'LTU', 'BLR', 'UKR', 'GEO', 'AZE', 'KAZ', 'MNG', 'CHN', 'PRK', 'JPN', 'POL', 'SWE'],
    // Natural Earth swaps these two ISO codes; and lists Altai Republic + Altai Krai under the same QID.
    isoFix: { Moskovskaya: 'RU-MOS', Moskva: 'RU-MOW' },
    wdFix: { 'RU-ALT': 'Q5942' },
    include: (p) => p.adm0_a3 === 'RUS' && /^RU-/.test(p.iso_3166_2 || '') && !!p.wikidataid,
    useWdLabel: true,
    kind: (p, label) => {
      if (/Autonomous (Okrug|District)/.test(label)) return 'autonomous okrug';
      if (/Autonomous Oblast/.test(label)) return 'autonomous oblast';
      if (/Oblast/.test(label)) return 'oblast';
      if (/Krai/.test(label)) return 'krai';
      if (/Republic|Sakha|Yakutia|Chechnya|Chuvashia|Udmurtia|Mordovia|Bashkortostan|Tatarstan|Dagestan|Ingushetia|Kalmykia|Buryatia|Tuva|Khakassia|Karelia|Komi|Adygea|North Ossetia|Mari El/.test(label)) return 'republic';
      if (/Moscow$|Saint Petersburg/.test(label)) return 'federal city';
      return (p.type_en || 'region').toLowerCase();
    },
    names: { 'RU-CHU': 'Chukotka Autonomous Okrug', 'RU-NEN': 'Nenets Autonomous Okrug', 'RU-YAN': 'Yamalo-Nenets Autonomous Okrug', 'RU-SA': 'Sakha (Yakutia)' },
    alts: { 'RU-SPE': ['St Petersburg', 'St. Petersburg'], 'RU-MOW': ['Moscow City'], 'RU-SA': ['Yakutia', 'Sakha Republic', 'Sakha'], 'RU-CHU': ['Chukotka'], 'RU-YAN': ['Yamalia', 'Yamal'], 'RU-KHM': ['Yugra', 'Khanty-Mansia'] },
    noShape: ['RU-MOW', 'RU-SPE'], noCapital: ['RU-MOW', 'RU-SPE'],
  },
];

// ---------------------------------------------------------------- helpers
const stripDiacritics = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const yearOf = (t) => (t ? Number((t.match(/^[+-]?(\d{1,4})/) || [])[1]) || null : null);

/** Best claim: preferred rank, else the one with the latest point-in-time / start, else first; skip ended ones. */
function bestClaim(claims) {
  if (!claims?.length) return null;
  const live = claims.filter((c) => c.mainsnak?.datavalue && c.rank !== 'deprecated' && !c.qualifiers?.P582);
  const list = live.length ? live : claims.filter((c) => c.mainsnak?.datavalue);
  const pref = list.filter((c) => c.rank === 'preferred');
  const cand = pref.length ? pref : list;
  const when = (c) => c.qualifiers?.P585?.[0]?.datavalue?.value?.time || c.qualifiers?.P580?.[0]?.datavalue?.value?.time || '';
  return [...cand].sort((a, b) => when(b).localeCompare(when(a)))[0] ?? null;
}
const claimValue = (e, p) => bestClaim(e?.claims?.[p])?.mainsnak?.datavalue?.value ?? null;
const SQMI = 'http://www.wikidata.org/entity/Q232291';
function areaKm2(e) {
  const v = claimValue(e, 'P2046');
  if (!v) return null;
  const n = Number(v.amount);
  if (v.unit === SQMI) return Math.round(n * 2.58999);
  if (v.unit?.endsWith('/Q712226') || v.unit?.endsWith('/Q25343')) return Math.round(v.unit.endsWith('Q25343') ? n / 1e6 : n);
  return Math.round(n);
}

// Polygons whose ring winding makes d3 think they cover the whole globe get reversed.
function rewind(geom) {
  const fix = (poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly);
  if (geom.type === 'Polygon') return { ...geom, coordinates: fix(geom.coordinates) };
  if (geom.type === 'MultiPolygon') return { ...geom, coordinates: geom.coordinates.map(fix) };
  return geom;
}

const pointCount = (t) => t.arcs.reduce((a, arc) => a + arc.length, 0);
/** Simplify a topology to roughly `target` points (binary search on Visvalingam weight), drop tiny rings, quantize. */
function shrink(topo, target, minRing = 0) {
  let t = topo;
  if (minRing) t = topoFilter(t, filterWeight(t, minRing));
  const pre = presimplify(t);
  let lo = 1e-9, hi = 10, best = pre;
  if (pointCount(pre) > target) {
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      const s = simplify(structuredClone(pre), mid); // structuredClone keeps the Infinity endpoint weights (JSON would null them)
      const n = pointCount(s);
      best = s;
      if (Math.abs(n - target) / target < 0.05) break;
      if (n > target) lo = mid; else hi = mid;
    }
  }
  // filter() can leave unreferenced arcs empty; quantize() needs at least one point per arc.
  best.arcs = best.arcs.map((a) => (a && a.length ? a.map((p) => [p[0], p[1]]) : [[0, 0], [0, 0]]));
  return topojson.quantize(best, 3e4);
}

// Silhouettes in a 200×200 box (same approach as the country shapes in scripts/build-data.mjs).
function thin(d) {
  return d.split('M').filter(Boolean).map((ring) => {
    const closed = ring.endsWith('Z');
    const pts = ring.replace('Z', '').split('L').map((q) => q.split(',').map(Number));
    const out = [pts[0]];
    for (const q of pts.slice(1)) { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 0.6) out.push(q); }
    if (out.length < 3) return '';
    return 'M' + out.map((q) => q.join(',')).join('L') + (closed ? 'Z' : '');
  }).join('');
}
function shapeFor(geom) {
  let polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  // Regions split by the antimeridian (Chukotka, Aleutians): shift the western-hemisphere part by +360°
  // so the landmass clustering below sees one contiguous shape.
  const lons = polys.flat(2).map((pt) => pt[0]);
  if (lons.some((x) => x > 150) && lons.some((x) => x < -150)) polys = polys.map((p) => p.map((r) => r.map(([x, y]) => [x < 0 ? x + 360 : x, y])));
  const feats = polys.map((p) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: p } }));
  const areas = feats.map((f) => geoArea(f));
  const big = areas.indexOf(Math.max(...areas));
  const bb = feats.map((f) => { let x0 = 999, y0 = 999, x1 = -999, y1 = -999; for (const [x, y] of f.geometry.coordinates[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; });
  const size = Math.max(bb[big][2] - bb[big][0], bb[big][3] - bb[big][1]);
  const G = Math.max(0.4, size * 0.6); // chaining gap scales with the landmass
  const near = (a, b, g = areas[a] < areas[big] * 0.004 ? G * 0.25 : G) => !(bb[a][0] - g > bb[b][2] || bb[b][0] - g > bb[a][2] || bb[a][1] - g > bb[b][3] || bb[b][1] - g > bb[a][3]);
  const inSet = new Set([big]); const queue = [big];
  while (queue.length) { const j = queue.pop(); for (let i = 0; i < feats.length; i++) if (!inSet.has(i) && (near(i, j) || areas[i] > areas[big] * 0.3)) { inSet.add(i); queue.push(i); } }
  const keep = feats.filter((_, i) => inSet.has(i));
  const fc = { type: 'FeatureCollection', features: keep };
  const c = geoCentroid(fc);
  const proj = geoAzimuthalEqualArea().rotate([-c[0], -c[1]]).fitExtent([[4, 4], [196, 196]], fc);
  const p = geoPath(proj).digits(1);
  const d = keep.map((f) => (geoPath(proj).area(f) > 0.8 ? p(f) : '')).join('');
  return thin(d || p(fc));
}

// ---------------------------------------------------------------- data sources
const NE = JSON.parse(fs.readFileSync('scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson', 'utf8'));
const WORLD = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json', 'utf8'));
const iso3ToNum = Object.fromEntries(worldCountries.filter((c) => c.ccn3).map((c) => [c.cca3, c.ccn3]));
iso3ToNum.GRL = '304';

async function pageviews(title) {
  if (!title) return 0;
  const j = await cachedJSON(`pv-${title}`, `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/2025010100/2025123100`);
  return (j?.items || []).reduce((a, b) => a + b.views, 0);
}
async function summary(title) {
  if (!title) return null;
  const j = await cachedJSON(`sum-${title}`, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!j?.extract) return null;
  const sents = j.extract.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/);
  let out = '';
  for (const s of sents) { if (out && (out + ' ' + s).length > 320) break; out = out ? out + ' ' + s : s; if (out.length > 160) break; }
  return out.trim() || null;
}
// Images are downloaded once (cached) and later converted to small WebP files by regions-images.mjs
// (headless-browser canvas), because the build host has no image tooling.
const imageJobs = [];
const imageSources = {};
async function commonsImage(file, dest) {
  if (!file) return null;
  const key = `img-${file}-${IMG_WIDTH}`;
  const buf = await cachedBinary(key, `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${IMG_WIDTH}`);
  if (!buf || buf.length < 100) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpg) return null;
  imageSources[`${dest}.webp`.replace(/^public/, '')] = file; // for the credits list (regions-credits.mjs)
  imageJobs.push({ src: `scripts/.cache/packs-regions/${key.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 180)}.bin`, mime: isPng ? 'image/png' : 'image/jpeg', dest: `${dest}.webp` });
  return `${dest}.webp`;
}

// ---------------------------------------------------------------- build
const index = [];
const report = [];
// Manual corrections where Wikidata has no / an unusual capital value.
const CAPITAL_FIX = {
  'US-AK': 'Juneau', 'CA-NB': 'Fredericton', 'IN-UT': 'Dehradun',
  'MX-PUE': 'Puebla', 'MX-GRO': 'Chilpancingo', 'MX-CAM': 'Campeche', 'MX-DUR': 'Durango', 'MX-TLA': 'Tlaxcala',
  'MX-MEX': 'Toluca', 'MX-QUE': 'Querétaro', 'MX-OAX': 'Oaxaca City', 'MX-AGU': 'Aguascalientes', 'MX-CHH': 'Chihuahua',
};
for (const P of PACKS) {
  const feats = NE.features
    .filter((f) => f.properties.adm0_a3 === P.adm0 && f.properties.name && (P.include ? P.include(f.properties) : !!f.properties.wikidataid && !/~$/.test(f.properties.iso_3166_2 || '')))
    .map((f) => {
      const p = { ...f.properties };
      if (P.isoFix?.[p.name]) p.iso_3166_2 = P.isoFix[p.name];
      if (P.wdFix?.[p.iso_3166_2]) p.wikidataid = P.wdFix[p.iso_3166_2];
      return { ...f, properties: p, geometry: rewind(f.geometry) };
    });
  const ents = await entities(feats.map((f) => f.properties.wikidataid));

  // Second hop: labels for capitals / official languages referenced by claims.
  const refIds = [];
  for (const f of feats) {
    const e = ents[f.properties.wikidataid];
    const cap = claimValue(e, 'P36'); if (cap?.id) refIds.push(cap.id);
    if (P.id === 'in-states' || P.id === 'ru-subjects') for (const c of e?.claims?.P37 || []) if (c.mainsnak?.datavalue?.value?.id) refIds.push(c.mainsnak.datavalue.value.id);
  }
  const refs = await entities(refIds, 'labels');
  const label = (id) => refs[id]?.labels?.en?.value ?? null;

  fs.rmSync(`${OUT}/img/${P.id}`, { recursive: true, force: true });
  fs.mkdirSync(`${OUT}/img/${P.id}`, { recursive: true });
  const items = await pool(feats, 4, async (f) => {
    const p = f.properties;
    const id = p.iso_3166_2.replace(/[^A-Za-z0-9-]/g, '');
    const e = ents[p.wikidataid];
    const wdLabel = e?.labels?.en?.value;
    const name = P.names[id] ?? (P.useWdLabel && wdLabel ? wdLabel : p.name);
    const kind = P.kind(p, wdLabel || name);
    const wiki = e?.sitelinks?.enwiki?.title ?? null;
    const capId = claimValue(e, 'P36')?.id;
    const capital = P.noCapital.includes(id) ? null : CAPITAL_FIX[id] ?? (capId ? label(capId) : null);
    const pop = claimValue(e, 'P1082');
    const population = pop ? Math.round(Number(pop.amount)) : null;
    const area = areaKm2(e);
    const created = yearOf(claimValue(e, 'P571')?.time);
    const flagFile = claimValue(e, 'P41');
    const armsFile = claimValue(e, 'P94');
    const [flag, arms, blurb, views] = await Promise.all([
      commonsImage(flagFile, `${OUT}/img/${P.id}/${id}-flag`),
      commonsImage(armsFile, `${OUT}/img/${P.id}/${id}-arms`),
      summary(wiki),
      pageviews(wiki),
    ]);
    const langs = (P.id === 'in-states' || P.id === 'ru-subjects') ? [...new Set((e?.claims?.P37 || []).map((c) => label(c.mainsnak?.datavalue?.value?.id)).filter(Boolean))].slice(0, 3) : [];

    // Accepted answers: NE name, NE alt names, Wikidata label/aliases, diacritic-free and suffix-free forms.
    const altSet = new Set([p.name, ...(p.name_alt ? p.name_alt.split('|') : []), wdLabel, ...(e?.aliases?.en || []).map((a) => a.value), ...(P.alts[id] || [])]
      .filter((s) => s && s.length <= 45 && /^[\p{Script=Latin}\d\s.,'’()&-]+$/u.test(s)));
    for (const s of [...altSet, name]) {
      altSet.add(stripDiacritics(s));
      const short = s.replace(/^(Republic of|State of) /, '').replace(/ (Oblast|Krai|Republic|Province|State|Autonomous Okrug|Autonomous Oblast|Territory|Autonomous Region|Municipality|Region)$/, '');
      if (short.length > 2) altSet.add(short);
    }
    return {
      id, name, alt: [...altSet], kind, capital: capital || undefined, population: population || undefined, area: area || undefined,
      flag: flag ? '/' + flag.replace(/^public\//, '') : undefined,
      arms: arms ? '/' + arms.replace(/^public\//, '') : undefined,
      facts: [
        ['Type', kind.charAt(0).toUpperCase() + kind.slice(1)],
        ...(created && created > 1000 && created <= 2026 ? [['Established', String(created)]] : []),
        ...(langs.length ? [[langs.length > 1 ? 'Official languages' : 'Official language', langs.join(', ')]] : []),
      ],
      blurb: blurb || undefined, wiki: wiki || undefined, _views: views, _geom: f.geometry,
    };
  });

  // Alternatives that collide with another item's name/alt are ambiguous → drop them.
  const owners = new Map();
  for (const it of items) for (const a of new Set([it.name, ...it.alt].map(norm))) owners.set(a, (owners.get(a) || 0) + 1);
  for (const it of items) it.alt = [...new Set(it.alt.filter((a) => owners.get(norm(a)) === 1 && a !== it.name))];

  // Difficulty from pageviews (log scale within the pack), population as fallback.
  const lv = items.map((it) => Math.log10(Math.max(1000, it._views || (it.population ? it.population / 20 : 1000))));
  const lo = Math.min(...lv), hi = Math.max(...lv);
  items.forEach((it, i) => { it.difficulty = Math.round((1 - (lv[i] - lo) / Math.max(1e-6, hi - lo)) * 100) / 100; });

  // Geometry: items topology + neighbouring land as context.
  const fc = { type: 'FeatureCollection', features: items.map((it) => ({ type: 'Feature', id: it.id, properties: {}, geometry: it._geom })) };
  const topo = shrink(topology({ items: fc }), P.targetPoints, P.minRing || 0);
  const nums = new Set(P.neighbours.map((c) => iso3ToNum[c]).filter(Boolean));
  const baseFc = { type: 'FeatureCollection', features: topojson.feature(WORLD, WORLD.objects.countries).features.filter((f) => nums.has(f.id)).map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })) };
  const base = shrink(topology({ base: baseFc }), 3000);

  const shapes = {};
  for (const it of items) {
    const km2 = geoArea({ type: 'Feature', geometry: it._geom }) * 6371 * 6371;
    if (P.noShape.includes(it.id) || km2 < 2500) continue;
    shapes[it.id] = shapeFor(it._geom);
  }

  const clean = items.map(({ _views, _geom, ...it }) => Object.fromEntries(Object.entries(it).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pct = (k) => Math.round((clean.filter((it) => it[k]).length / clean.length) * 100);
  const modes = ['shape', 'find', 'name', 'capital'];
  if (pct('flag') >= 70) modes.push('flag');
  if (pct('arms') >= 70) modes.push('arms');
  const meta = { id: P.id, group: 'regions', title: P.title, subtitle: P.subtitle, emoji: P.emoji, color: P.color, count: clean.length, modes, order: P.order };
  const data = { meta, projection: P.projection, topo, base, items: clean, shapes, attribution: ATTRIBUTION };
  const json = JSON.stringify(data);
  fs.writeFileSync(`${OUT}/${P.id}.json`, json);
  index.push(meta);
  report.push({ pack: P.id, items: clean.length, shapes: Object.keys(shapes).length, capital: pct('capital'), flag: pct('flag'), arms: pct('arms'), blurb: pct('blurb'), modes: modes.join(','), kb: Math.round(json.length / 1024) });
}

fs.writeFileSync(`${OUT}/index-regions.json`, JSON.stringify(index.sort((a, b) => a.order - b.order), null, 1));
fs.writeFileSync('scripts/.cache/packs-regions/image-jobs.json', JSON.stringify(imageJobs));
fs.writeFileSync('scripts/.cache/packs-regions/image-sources.json', JSON.stringify(imageSources));
console.table(report);
console.log(`${imageJobs.length} images queued → run: node scripts/packs/regions-images.mjs`);
