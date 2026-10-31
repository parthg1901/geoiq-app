// Builds the physical geography packs (rivers, seas, landforms, peaks) → public/data/packs/*.json
// Usage: node scripts/packs/build-physical.mjs
import fs from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { quantize, feature as topoFeature } from 'topojson-client';
import { geoArea } from 'd3-geo';
import countries from 'world-countries';
import { RIVERS, SEAS, LANDFORMS, PEAKS } from './physical-specs.mjs';
import {
  wikiPage, pageviews, entity, labels, lengthKm, areaKm2, elevationM, prominenceM, depthM, itemIds, coords, blurbOf, pool,
} from './physical-wiki.mjs';

const NE = 'scripts/.cache/ne';
const OUT = 'public/data/packs';
const read = (f) => JSON.parse(fs.readFileSync(`${NE}/${f}.geojson`, 'utf8'));
const ATTRIBUTION = 'Map data: Natural Earth (public domain). Facts: Wikidata (CC0). Descriptions: Wikipedia (CC BY-SA 4.0).';

// ---------- geometry helpers
function bboxOf(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (a) => { if (typeof a[0] === 'number') { x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]); } else a.forEach(visit); };
  visit(geom.coordinates);
  return [x0, y0, x1, y1];
}
const inside = (b, box) => b[0] >= box[0] && b[1] >= box[1] && b[2] <= box[2] && b[3] <= box[3];
const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** Approximate line length in km (haversine). */
function lineKm(ls) {
  const R = 6371, rad = Math.PI / 180;
  let km = 0;
  for (const l of ls) for (let i = 1; i < l.length; i++) {
    const [a, b] = [l[i - 1], l[i]];
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    km += 2 * R * Math.asin(Math.sqrt(h));
  }
  return km;
}

/** d3-geo wants clockwise exterior rings; GeoJSON from Natural Earth is the other way round, which d3
 *  reads as "the whole globe minus this polygon". Flip any polygon larger than a hemisphere. */
function rewind(polygons) {
  return polygons.map((rings) => (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings));
}

/** Pick NE features by name (+ optional bbox) and merge them into one geometry. */
function merge(features, spec, nameKey, kind) {
  const names = new Set(spec.ne);
  const hits = features.filter((f) => names.has(f.properties[nameKey]) && (!spec.bbox || inside(bboxOf(f.geometry), spec.bbox)));
  if (!hits.length) return null;
  if (kind === 'line') return { geometry: { type: 'MultiLineString', coordinates: hits.flatMap((f) => lines(f.geometry)) }, hits };
  return { geometry: { type: 'MultiPolygon', coordinates: rewind(hits.flatMap((f) => polys(f.geometry))) }, hits };
}

// ---------- shared
const fmt = (n) => Math.round(n).toLocaleString('en-US');
// Wikidata "country" claims include historical states (Soviet Union, Austria–Hungary…). Keep present-day
// countries only and use their common English names.
const COUNTRY_NAME = new Map();
for (const c of countries) for (const n of [c.name.common, c.name.official, ...c.altSpellings]) COUNTRY_NAME.set(n.toLowerCase(), c.name.common);
COUNTRY_NAME.set("people's republic of china", 'China');
COUNTRY_NAME.set('czech republic', 'Czechia');
COUNTRY_NAME.set('state of palestine', 'Palestine');
COUNTRY_NAME.set('kingdom of the netherlands', 'Netherlands');
COUNTRY_NAME.set('kingdom of denmark', 'Denmark');
COUNTRY_NAME.set('turkey', 'Türkiye');
const presentCountry = (label) => (label ? COUNTRY_NAME.get(label.toLowerCase()) ?? null : null);
const countryNames = (ids, lab, max = 6) => {
  const names = [...new Set(ids.map((q) => presentCountry(lab[q])).filter(Boolean))];
  if (!names.length) return null;
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ');
};
const countryCount = (ids, lab) => new Set(ids.map((q) => presentCountry(lab[q])).filter(Boolean)).size;
const listNames = (ids, lab, max = 6) => {
  const names = [...new Set(ids.map((q) => lab[q]).filter((l) => l && !/source|headwater|^\s*$/i.test(l)).map((l) => l.trim()))];
  if (!names.length) return null;
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max} more` : names.join(', ');
};
// Only accept Wikidata aliases that clearly refer to the same name (share a ≥4-letter word with it);
// unrelated historical/indigenous aliases ("Big River" for the Colorado) would accept wrong answers.
const fold = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const cleanAliases = (aliases, name) => {
  const words = fold(name).split(/[^a-z]+/).filter((w) => w.length >= 4 && !['river', 'mount', 'mountains', 'desert', 'peninsula', 'ocean', 'gulf', 'strait'].includes(w));
  return aliases.filter((a) => a.length >= 3 && a.length <= 40 && !/[()]|\bR\./.test(a) && /^[\p{Script=Latin}\s'’.\-]+$/u.test(a)
    && fold(a) !== fold(name) && words.some((w) => fold(a).includes(w))).slice(0, 6);
};

async function enrich(specs) {
  return pool(specs, 4, async (s) => {
    const page = await wikiPage(s.wiki);
    if (!page) console.warn('  ! no wiki page', s.wiki);
    const ent = page?.qid ? await entity(page.qid) : null;
    const views = page ? await pageviews(page.title) : 0;
    return { spec: s, page, ent, views };
  });
}

/** Pageview-based difficulty within a pack: most-viewed = 0, least = 1. */
function difficulties(rows) {
  const lv = rows.map((r) => Math.log10(Math.max(r.views, 1000)));
  const lo = Math.min(...lv), hi = Math.max(...lv);
  return lv.map((v) => Math.round((1 - (v - lo) / Math.max(1e-6, hi - lo)) * 100) / 100);
}

function makeTopo(items, geoms, simplifyWeight) {
  const fc = { type: 'FeatureCollection', features: items.map((it) => ({ type: 'Feature', id: it.id, properties: {}, geometry: geoms[it.id] })) };
  let t = topology({ items: fc });
  if (simplifyWeight) {
    t = simplify(presimplify(t), simplifyWeight);
    for (const a of t.arcs) for (const p of a) p.length = 2; // drop simplification weights
  }
  t = quantize(t, 1e5);
  // Simplification can flip a tiny ring (e.g. a narrow strait) inside-out; reverse those rings.
  const flip = (ring) => ring.slice().reverse().map((a) => ~a);
  for (const g of t.objects.items.geometries) {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    if (geoArea(topoFeature(t, g)) <= 2 * Math.PI) continue;
    const fixPoly = (rings) => {
      const f = topoFeature(t, { type: 'Polygon', arcs: rings });
      return geoArea(f) > 2 * Math.PI ? rings.map(flip) : rings;
    };
    g.arcs = g.type === 'Polygon' ? fixPoly(g.arcs) : g.arcs.map(fixPoly);
  }
  return t;
}

let BASE = null;
function base() {
  if (BASE) return BASE;
  const land = read('ne_50m_land');
  // Background only: drop islands under ~400 km² (thousands of tiny rings dominate the file size).
  for (const f of land.features) f.geometry = { type: 'MultiPolygon', coordinates: rewind(polys(f.geometry)).filter((p) => geoArea({ type: 'Polygon', coordinates: p }) > 1e-5) };
  land.features = land.features.filter((f) => f.geometry.coordinates.length);
  let t = topology({ base: land });
  t = simplify(presimplify(t), 0.04); // context only: coarse is fine and keeps every pack small
  for (const a of t.arcs) for (const p of a) p.length = 2;
  BASE = quantize(t, 1e5);
  return BASE;
}

/**
 * Drop aliases that would also match another item in the pack (e.g. "the Balkans" on the Balkan
 * Mountains vs the Balkan Peninsula). Priority: item name > hand-picked alt > Wikidata alias.
 */
function dedupeAliases(items, specs) {
  const key = (x) => fold(x).replace(/^the\s+/, '').trim();
  const specAlt = new Map(specs.map((s) => [s.id, new Set((s.alt || []).map(key))]));
  const best = new Map(); // key -> { id, prio }
  const claim = (k, id, prio) => {
    const cur = best.get(k);
    if (!cur || prio > cur.prio) best.set(k, { id, prio, tie: false });
    else if (prio === cur.prio && cur.id !== id) cur.tie = true;
  };
  for (const it of items) {
    claim(key(it.name), it.id, 3);
    for (const a of it.alt || []) claim(key(a), it.id, specAlt.get(it.id)?.has(key(a)) ? 2 : 1);
  }
  for (const it of items) it.alt = (it.alt || []).filter((a) => { const b = best.get(key(a)); return b && b.id === it.id && !b.tie; });
}

function writePack(meta, items, topo, extra = {}, specs = []) {
  dedupeAliases(items, specs);
  const data = { meta, projection: { type: 'naturalEarth1' }, topo, base: base(), items, attribution: ATTRIBUTION, ...extra };
  const s = JSON.stringify(data);
  fs.writeFileSync(`${OUT}/${meta.id}.json`, s);
  return s.length;
}

const report = [];
const stat = (id, items, bytes) => {
  const n = items.length;
  const pct = (f) => `${Math.round((items.filter(f).length / n) * 100)}%`;
  report.push(`${id.padEnd(10)} items=${n}  rank=${pct((i) => i.rank)}  blurb=${pct((i) => i.blurb)}  facts=${pct((i) => i.facts?.length)}  size=${Math.round(bytes / 1024)}KB`);
};

// ================= RIVERS
async function buildRivers() {
  const ne = read('ne_10m_rivers_lake_centerlines').features;
  const rows = await enrich(RIVERS);
  const geoms = {};
  const kept = [];
  for (const r of rows) {
    const m = merge(ne, r.spec, 'name', 'line');
    if (!m) { console.warn('  ! no NE geometry for river', r.spec.id); continue; }
    geoms[r.spec.id] = m.geometry;
    r.neKm = lineKm(m.geometry.coordinates);
    kept.push(r);
  }
  const lab = await labels(kept.flatMap((r) => [...itemIds(r.ent?.claims, 'P17'), ...itemIds(r.ent?.claims, 'P403'), ...itemIds(r.ent?.claims, 'P885')]));
  const diff = difficulties(kept);
  const items = kept.map((r, i) => {
    const c = r.ent?.claims;
    const len = lengthKm(c);
    const facts = [];
    const countries = countryNames(itemIds(c, 'P17'), lab);
    if (countries) facts.push([countryCount(itemIds(c, 'P17'), lab) > 1 ? 'Flows through' : 'Country', countries]);
    const mouth = listNames(itemIds(c, 'P403'), lab, 2);
    if (mouth) facts.push(['Flows into', mouth]);
    const src = listNames(itemIds(c, 'P885'), lab, 2);
    if (src) facts.push(['Source', src]);
    if (len) facts.unshift(['Length', `${fmt(len)} km`]);
    return {
      id: r.spec.id, name: r.spec.name, alt: [...new Set([...(r.spec.alt || []), ...cleanAliases(r.ent?.aliases || [], r.spec.name)])],
      kind: 'river', rank: len ? { label: 'Length', value: Math.round(len), unit: 'km' } : undefined,
      facts, blurb: blurbOf(r.page?.extract), wiki: r.page?.title, difficulty: diff[i],
    };
  });
  // sanity: NE geometry should cover a reasonable share of the river
  for (const r of kept) {
    const len = lengthKm(r.ent?.claims);
    if (len && r.neKm < len * 0.35) console.warn(`  ~ ${r.spec.id}: NE geometry ${Math.round(r.neKm)} km vs real ${Math.round(len)} km`);
  }
  const meta = { id: 'rivers', group: 'physical', title: 'Great Rivers', subtitle: `${items.length} rivers of the world`, emoji: '🏞️', color: '#53b8ff', count: items.length, modes: ['find', 'name', 'higher'], order: 1 };
  const bytes = writePack(meta, items, makeTopo(items, geoms, 0.0015), {}, RIVERS);
  stat('rivers', items, bytes);
  return meta;
}

// ================= SEAS
const SEA_KIND = { ocean: 'ocean', sea: 'sea', bay: 'bay', gulf: 'gulf', strait: 'strait', channel: 'channel', sound: 'sound', fjord: 'strait', lagoon: 'lagoon' };
async function buildSeas() {
  const ne = read('ne_10m_geography_marine_polys').features;
  const rows = await enrich(SEAS);
  const geoms = {};
  const kept = [];
  for (const r of rows) {
    const m = merge(ne, r.spec, 'name', 'poly');
    if (!m) { console.warn('  ! no NE geometry for sea', r.spec.id); continue; }
    geoms[r.spec.id] = m.geometry;
    r.kind = SEA_KIND[m.hits[0].properties.featurecla] ?? 'sea';
    kept.push(r);
  }
  const lab = await labels(kept.flatMap((r) => itemIds(r.ent?.claims, 'P17')));
  const diff = difficulties(kept);
  const items = kept.map((r, i) => {
    const c = r.ent?.claims;
    let area = areaKm2(c);
    if (area && area < 1000 && r.kind !== 'strait') area = null; // a few Wikidata areas are wrong units (e.g. Gulf of Aqaba "239")
    const depth = depthM(c);
    const facts = [['Type', r.kind.charAt(0).toUpperCase() + r.kind.slice(1)]];
    if (area) facts.push(['Area', `${fmt(area)} km²`]);
    if (depth) facts.push(['Max depth', `${fmt(depth)} m`]);
    const n = countryCount(itemIds(c, 'P17'), lab);
    const borders = countryNames(itemIds(c, 'P17'), lab, 8);
    if (borders && r.kind !== 'ocean') facts.push([n > 1 ? 'Bordering countries' : 'Country', borders]);
    if (r.spec.id === 'caspian-sea') facts.push(['Note', "Technically the world's largest lake"]);
    return {
      id: r.spec.id, name: r.spec.name, alt: [...new Set([...(r.spec.alt || []), ...cleanAliases(r.ent?.aliases || [], r.spec.name)])],
      kind: r.kind, area: area ? Math.round(area) : undefined,
      rank: area ? { label: 'Area', value: Math.round(area), unit: 'km²' } : undefined,
      facts, blurb: blurbOf(r.page?.extract), wiki: r.page?.title, difficulty: diff[i],
    };
  });
  const areaCover = items.filter((i) => i.rank).length / items.length;
  const modes = ['find', 'name', ...(areaCover >= 0.7 ? ['higher'] : [])];
  const meta = { id: 'seas', group: 'physical', title: 'Seas & Oceans', subtitle: 'Oceans, seas, gulfs, bays and straits', emoji: '🌊', color: '#2ec4d6', count: items.length, modes, order: 2 };
  const bytes = writePack(meta, items, makeTopo(items, geoms, 0.02), {}, SEAS);
  stat('seas', items, bytes);
  return meta;
}

// ================= LANDFORMS
async function buildLandforms() {
  const ne = read('ne_10m_geography_regions_polys').features;
  const rows = await enrich(LANDFORMS);
  const geoms = {};
  const kept = [];
  for (const r of rows) {
    const m = merge(ne, r.spec, 'NAME', 'poly');
    if (!m) { console.warn('  ! no NE geometry for landform', r.spec.id); continue; }
    geoms[r.spec.id] = m.geometry;
    kept.push(r);
  }
  const lab = await labels(kept.flatMap((r) => [...itemIds(r.ent?.claims, 'P17'), ...itemIds(r.ent?.claims, 'P610')]));
  const diff = difficulties(kept);
  const items = kept.map((r, i) => {
    const c = r.ent?.claims;
    const facts = [['Type', r.spec.kind.charAt(0).toUpperCase() + r.spec.kind.slice(1)]];
    const n = countryCount(itemIds(c, 'P17'), lab);
    const countries = countryNames(itemIds(c, 'P17'), lab, 7);
    if (countries) facts.push([n > 1 ? 'Countries' : 'Country', countries]);
    const top = listNames(itemIds(c, 'P610'), lab, 1);
    if (top) facts.push(['Highest point', top]);
    const area = areaKm2(c);
    if (area) facts.push(['Area', `${fmt(area)} km²`]);
    return {
      id: r.spec.id, name: r.spec.name, alt: [...new Set([...(r.spec.alt || []), ...cleanAliases(r.ent?.aliases || [], r.spec.name)])],
      kind: r.spec.kind, area: area ? Math.round(area) : undefined,
      facts, blurb: blurbOf(r.page?.extract), wiki: r.page?.title, difficulty: diff[i],
    };
  });
  const meta = { id: 'landforms', group: 'physical', title: 'Mountains & Deserts', subtitle: 'Ranges, deserts, plateaus and peninsulas', emoji: '🏜️', color: '#ffb547', count: items.length, modes: ['find', 'name'], order: 3 };
  const bytes = writePack(meta, items, makeTopo(items, geoms, 0.01), {}, LANDFORMS);
  stat('landforms', items, bytes);
  return meta;
}

// ================= PEAKS
async function buildPeaks() {
  const ne = read('ne_10m_geography_regions_elevation_points').features;
  const rows = await enrich(PEAKS);
  const geoms = {};
  const kept = [];
  for (const r of rows) {
    const pt = coords(r.ent?.claims);
    if (!pt) { console.warn('  ! no coordinates for peak', r.spec.id); continue; }
    geoms[r.spec.id] = { type: 'Point', coordinates: pt };
    kept.push(r);
  }
  const lab = await labels(kept.flatMap((r) => [...itemIds(r.ent?.claims, 'P17'), ...itemIds(r.ent?.claims, 'P4552')]));
  const diff = difficulties(kept);
  const items = kept.map((r, i) => {
    const c = r.ent?.claims;
    let elev = elevationM(c);
    // Cross-check with the nearest Natural Earth peak (within ~6 km)
    const pt = geoms[r.spec.id].coordinates;
    const near = ne.filter((f) => f.properties.elevation > 0 && Math.hypot(f.geometry.coordinates[0] - pt[0], f.geometry.coordinates[1] - pt[1]) < 0.06)
      .sort((a, b) => b.properties.elevation - a.properties.elevation)[0];
    if (!elev && near) elev = near.properties.elevation;
    if (elev && near && Math.abs(near.properties.elevation - elev) > 150) console.warn(`  ~ ${r.spec.id}: Wikidata ${Math.round(elev)} m vs NE ${near.properties.name} ${near.properties.elevation} m`);
    const facts = [];
    if (elev) facts.push(['Elevation', `${fmt(elev)} m`]);
    const countries = countryNames(itemIds(c, 'P17'), lab, 3);
    if (countries) facts.push([countryCount(itemIds(c, 'P17'), lab) > 1 ? 'Countries' : 'Country', countries]);
    const range = listNames(itemIds(c, 'P4552'), lab, 1);
    if (range) facts.push(['Range', range]);
    const prom = prominenceM(c);
    if (prom) facts.push(['Prominence', `${fmt(prom)} m`]);
    return {
      id: r.spec.id, name: r.spec.name, alt: [...new Set([...(r.spec.alt || []), ...cleanAliases(r.ent?.aliases || [], r.spec.name)])],
      kind: 'peak', rank: elev ? { label: 'Elevation', value: Math.round(elev), unit: 'm' } : undefined,
      facts, blurb: blurbOf(r.page?.extract), wiki: r.page?.title, difficulty: diff[i],
    };
  });
  const meta = { id: 'peaks', group: 'physical', title: 'Famous Peaks', subtitle: '8000ers, Seven Summits and iconic volcanoes', emoji: '🏔️', color: '#b48cff', count: items.length, modes: ['find', 'name', 'higher'], order: 4 };
  const bytes = writePack(meta, items, makeTopo(items, geoms, 0), {}, PEAKS);
  stat('peaks', items, bytes);
  return meta;
}

fs.mkdirSync(OUT, { recursive: true });
const metas = [];
for (const [name, fn] of [['rivers', buildRivers], ['seas', buildSeas], ['landforms', buildLandforms], ['peaks', buildPeaks]]) {
  console.log(`building ${name}…`);
  metas.push(await fn());
}
fs.writeFileSync(`${OUT}/index-physical.json`, JSON.stringify(metas, null, 2));
console.log('\n' + report.join('\n'));
