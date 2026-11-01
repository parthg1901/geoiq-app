// Builds the "Time machine" historical map packs: public/data/packs/h{year}.json + index-history.json
// Source borders: aourednik/historical-basemaps (GPL-3.0). Curation lives in history-eras.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { geoArea, geoCentroid, geoDistance, geoAzimuthalEqualArea, geoPath } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import * as topojson from 'topojson-client';
import countries from 'world-countries';
import { ERAS } from './history-eras.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const HIST = path.join(ROOT, 'scripts/.cache/hist');
const WIKI_CACHE = path.join(ROOT, 'scripts/.cache/packs-history');
const OUT = path.join(ROOT, 'public/data/packs');
const UA = { 'User-Agent': 'Geonaut-build/1.0 (+https://github.com/parthg1901/geoiq-app)' };
const R = 6371;
fs.mkdirSync(HIST, { recursive: true });
fs.mkdirSync(WIKI_CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      return r.ok ? await r.json() : null;
    } catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  return null;
}

async function loadEra(year) {
  const f = path.join(HIST, `world_${year}.geojson`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_${year}.geojson`, { headers: UA });
    if (!r.ok) throw new Error(`download ${year}: ${r.status}`);
    fs.writeFileSync(f, await r.text());
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Wikipedia summary (cached); null for missing/disambiguation pages. */
async function summary(title) {
  const f = path.join(WIKI_CACHE, slug(title) + '.json');
  let j;
  if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    j = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    fs.writeFileSync(f, JSON.stringify(j ?? { missing: true }));
  }
  if (!j || j.missing || j.type === 'disambiguation' || !j.extract) return null;
  const sentences = j.extract.replace(/\s*\([^()]*\)/g, '').split(/(?<=[.!?])\s+(?=[A-Z])/);
  let out = '';
  for (const s of sentences) { if (out && (out + ' ' + s).length > 420) break; out += (out ? ' ' : '') + s; }
  return { text: out, title: j.titles?.canonical?.replace(/_/g, ' ') ?? title };
}

/* ---------------- geometry helpers ---------------- */

/** d3 wants clockwise exterior rings; a polygon covering > half the sphere is inverted → reverse it. */
function polygonsOf(geom) {
  if (!geom) return [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((p) => {
    const a = geoArea({ type: 'Polygon', coordinates: p });
    return a > 2 * Math.PI ? p.map((ring) => ring.slice().reverse()) : p;
  });
}

function bboxOf(rings) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of rings[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
/** Planar even-odd point-in-polygon on lon/lat (source data is split at the antimeridian). */
function inRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Merge adjoining pieces into one outline (sources often split a polity into several touching polygons). */
function dissolve(input) {
  // identical duplicates would cancel each other out in the merge
  const seen = new Set();
  const polys = input.filter((p) => { const k = JSON.stringify(p[0]); if (seen.has(k)) return false; seen.add(k); return true; });
  if (polys.length < 2) return polys;
  const t = topology({ p: { type: 'GeometryCollection', geometries: polys.map((c) => ({ type: 'Polygon', coordinates: c })) } }, 1e6);
  const merged = topojson.merge(t, t.objects.p.geometries);
  const out = (merged.type === 'Polygon' ? [merged.coordinates] : merged.coordinates).filter((p) => p.length && p[0].length >= 4);
  // merge output is planar-wound; re-apply spherical winding
  return out.length ? polygonsOf({ type: 'MultiPolygon', coordinates: out }) : polys;
}

/* ---------------- modern-country raster for "Today" ---------------- */
const STEP = 0.5;
const COLS = 360 / STEP, ROWS = 180 / STEP;
function buildModernGrid() {
  const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
  const byNum = Object.fromEntries(countries.filter((c) => c.ccn3).map((c) => [c.ccn3, c.name.common]));
  const fc = topojson.feature(topo, topo.objects.countries);
  const names = [];
  const grid = new Int16Array(COLS * ROWS).fill(-1);
  fc.features.forEach((f) => {
    const name = byNum[f.id] ?? (f.properties.name === 'Kosovo' ? 'Kosovo' : f.properties.name);
    if (!name || name === 'Antarctica') return;
    const idx = names.push(name) - 1;
    for (const p of polygonsOf(f.geometry)) {
      const [x0, y0, x1, y1] = bboxOf(p);
      for (let c = Math.floor((x0 + 180) / STEP); c <= Math.min(COLS - 1, Math.floor((x1 + 180) / STEP)); c++) {
        for (let r = Math.floor((y0 + 90) / STEP); r <= Math.min(ROWS - 1, Math.floor((y1 + 90) / STEP)); r++) {
          const x = -180 + (c + 0.5) * STEP, y = -90 + (r + 0.5) * STEP;
          if (inRings(x, y, p)) grid[r * COLS + c] = idx;
        }
      }
    }
  });
  return { grid, names };
}

function modernOverlap(polys, modern) {
  const tally = new Map();
  let total = 0;
  for (const p of polys) {
    const [x0, y0, x1, y1] = bboxOf(p);
    for (let c = Math.max(0, Math.floor((x0 + 180) / STEP)); c <= Math.min(COLS - 1, Math.floor((x1 + 180) / STEP)); c++) {
      for (let r = Math.max(0, Math.floor((y0 + 90) / STEP)); r <= Math.min(ROWS - 1, Math.floor((y1 + 90) / STEP)); r++) {
        const x = -180 + (c + 0.5) * STEP, y = -90 + (r + 0.5) * STEP;
        if (!inRings(x, y, p)) continue;
        const k = modern.grid[r * COLS + c];
        if (k < 0) continue;
        const w = Math.cos((y * Math.PI) / 180);
        tally.set(k, (tally.get(k) ?? 0) + w);
        total += w;
      }
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).filter(([, w]) => w / total >= 0.04).slice(0, 4).map(([k]) => modern.names[k]);
}

/* ---------------- silhouettes ---------------- */
function thin(d, min = 0.8) {
  return d.split('M').filter(Boolean).map((ring) => {
    const closed = ring.endsWith('Z');
    const pts = ring.replace('Z', '').split('L').map((q) => q.split(',').map(Number));
    const out = [pts[0]];
    for (const q of pts.slice(1)) { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= min) out.push(q); }
    return out.length < 3 ? '' : 'M' + out.map((q) => q.join(',')).join('L') + (closed ? 'Z' : '');
  }).join('');
}
/** Silhouette of the main landmass cluster, or null when the polity is too scattered to recognise. */
function silhouette(polys) {
  const feats = polys.map((p) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: p } }));
  const areas = feats.map((f) => geoArea(f));
  const total = areas.reduce((a, b) => a + b, 0);
  const big = areas.indexOf(Math.max(...areas));
  if (areas[big] / total < 0.6) return null;
  const cen = geoCentroid(feats[big]);
  const keep = feats.filter((f, i) => i === big || (areas[i] > areas[big] * 0.002 && geoDistance(geoCentroid(f), cen) < 0.14));
  const fc = { type: 'FeatureCollection', features: keep };
  const c = geoCentroid(fc);
  const proj = geoAzimuthalEqualArea().rotate([-c[0], -c[1]]).fitExtent([[4, 4], [196, 196]], fc);
  const p = geoPath(proj).digits(1);
  const d = thin(keep.map((f) => (geoPath(proj).area(f) > 1.5 ? p(f) : '')).join(''));
  return d.length > 40 ? d : null;
}

/* ---------------- base land layer (shared by all eras) ---------------- */
function buildBase() {
  const land = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/world-atlas/land-50m.json'), 'utf8'));
  const pre = presimplify(land);
  const s = simplify(pre, 0.05);
  for (const a of s.arcs) for (const pt of a) pt.length = 2;
  const out = topojson.quantize(s, 1e4);
  out.objects = { base: out.objects.land };
  return out;
}

const kindOf = (name, ruler) =>
  /empire|caliphate|raj/i.test(name) ? 'empire'
    : /kingdom|tsardom|emirate|sultanate|khanate|principality|grand duchy|regency|beylik|shogunate/i.test(name) || /^(siam|joseon|tokugawa)/i.test(name) ? 'kingdom'
      : ruler ? (/zone|occupied|administered/i.test(name + ruler) ? 'occupied territory' : 'colony / territory')
        : 'state';

/* ---------------- main ---------------- */
const modern = buildModernGrid();
const base = buildBase();
const index = [];
const report = [];

for (const [order, era] of ERAS.entries()) {
  const src = await loadEra(era.year);
  const byName = new Map();
  for (const f of src.features) {
    const n = f.properties.NAME;
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(f);
  }
  const items = [];
  const features = [];
  const shapes = {};
  const usedIds = new Set();
  let blurbs = 0;

  for (const def of era.items) {
    const parts = def.src.flatMap((n) => byName.get(n) ?? []);
    if (!parts.length) { console.warn(`  [${era.year}] missing source for ${def.name}: ${def.src.join(', ')}`); continue; }
    const polys = dissolve(parts.flatMap((f) => polygonsOf(f.geometry)));
    if (!polys.length) continue;
    let id = `${era.year}-${slug(def.name)}`;
    while (usedIds.has(id)) id += '-2';
    usedIds.add(id);
    const geom = { type: 'MultiPolygon', coordinates: polys };
    const area = Math.round(geoArea({ type: 'Feature', geometry: geom }) * R * R);
    const today = modernOverlap(polys, modern);
    const facts = [];
    if (def.r) facts.push(['Ruled by', def.r]);
    if (today.length && !(today.length === 1 && today[0] === def.name)) facts.push(['Today', today.join(', ')]);
    facts.push(['Area', `${area >= 1e6 ? (area / 1e6).toFixed(1) + ' million' : Math.round(area / 1000).toLocaleString('en-US') + ',000'} km²`]);
    if (def.f) facts.push(...def.f);
    const item = { id, name: def.name, kind: def.k ?? kindOf(def.name, def.r), area, facts, difficulty: def.d ?? 0.5 };
    const alt = [...new Set((def.alt ?? []).concat(def.src).filter((a) => a !== def.name && !/\(|,/.test(a)))];
    if (alt.length) item.alt = alt;
    if (def.a) {
      const s = await summary(def.a);
      if (s) { item.blurb = s.text; item.wiki = s.title; blurbs++; }
      else console.warn(`  [${era.year}] no summary for "${def.a}"`);
    }
    items.push(item);
    features.push({ type: 'Feature', id, properties: {}, geometry: geom });
    // Skip silhouettes whose biggest landmass isn't the polity's heartland (Denmark → Greenland).
    if (area > 90000 && !/Denmark|Greenland/.test(def.name)) {
      const sh = silhouette(polys);
      if (sh) shapes[id] = sh;
    }
  }

  // Keep the most recognisable silhouettes only (easy/medium polities first, then by size).
  const shapeIds = Object.keys(shapes)
    .map((id) => items.find((i) => i.id === id))
    .sort((a, b) => a.difficulty - b.difficulty || b.area - a.area)
    .slice(0, 30)
    .map((i) => i.id);
  const keptShapes = Object.fromEntries(shapeIds.map((id) => [id, shapes[id]]));

  // Topology: simplify + quantize to stay small, but keep small islands/countries visible.
  let topo = topology({ items: { type: "FeatureCollection", features } });
  topo = presimplify(topo);
  let minWeight = 0.004, out;
  for (;;) {
    const s = simplify(structuredClone(topo), minWeight); // structuredClone keeps the Infinity endpoint weights
    if (s.transform === undefined) delete s.transform;
    for (const a of s.arcs) for (const pt of a) pt.length = 2;
    const q = topojson.quantize(s, 2e4);
    const pack = {
      meta: null, projection: { type: 'naturalEarth1' }, topo: q, base, items, shapes: keptShapes,
      attribution: 'Historical borders: aourednik/historical-basemaps (GPL-3.0); approximate, for learning. Wikipedia (CC BY-SA).',
    };
    out = pack;
    if (JSON.stringify(pack).length < 650_000 || minWeight > 0.2) break;
    minWeight *= 1.6;
  }
  const meta = {
    id: `h${era.year}`, group: 'history', title: era.title, subtitle: era.subtitle, emoji: era.emoji, color: era.color,
    count: items.length, modes: ['find', 'name', ...(shapeIds.length >= 15 ? ['shape'] : [])], order: order + 1,
  };
  out.meta = meta;
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT, `h${era.year}.json`), json);
  index.push(meta);
  report.push(`${meta.id}: ${items.length} items, ${shapeIds.length} shapes, blurbs ${blurbs}/${era.items.filter((d) => d.a).length}, ${(json.length / 1024).toFixed(0)} KB`);
}

fs.writeFileSync(path.join(OUT, 'index-history.json'), JSON.stringify(index, null, 2));
console.log(report.join('\n'));
