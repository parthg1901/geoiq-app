// Dev helper: renders each history pack to /tmp/hist-preview/{id}.html (map + silhouettes) for visual QA.
import fs from 'node:fs';
import { geoNaturalEarth1, geoPath, geoCentroid, geoArea } from 'd3-geo';
import * as topojson from 'topojson-client';
fs.mkdirSync('/tmp/hist-preview', { recursive: true });
const ids = JSON.parse(fs.readFileSync('public/data/packs/index-history.json', 'utf8')).map((m) => m.id);
for (const id of ids) {
  const p = JSON.parse(fs.readFileSync(`public/data/packs/${id}.json`, 'utf8'));
  const W = 1600, H = 820;
  const proj = geoNaturalEarth1().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'Sphere' });
  const path = geoPath(proj);
  const base = topojson.feature(p.base, p.base.objects.base);
  const items = topojson.feature(p.topo, p.topo.objects.items).features;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#0b1530"><path d="${path(base)}" fill="#2a3550"/>`;
  items.forEach((f, i) => { svg += `<path d="${path(f)}" fill="hsl(${(i * 47) % 360},55%,${45 + (i % 3) * 8}%)" stroke="#0b1530" stroke-width=".6"/>`; });
  for (const f of items) {
    const it = p.items.find((x) => x.id === f.id);
    if (!it || it.area < 150000) continue;
    const c = proj(geoCentroid(f));
    if (c) svg += `<text x="${c[0]}" y="${c[1]}" font-size="10" fill="#fff" text-anchor="middle" font-family="sans-serif" stroke="#000" stroke-width="2" paint-order="stroke">${it.name}</text>`;
  }
  svg += '</svg>';
  const shapes = Object.entries(p.shapes).map(([sid, d]) => `<div style="display:inline-block;width:110px;text-align:center;color:#ccc;font:10px sans-serif"><svg viewBox="0 0 200 200" width="90" height="90"><path d="${d}" fill="#ffb547"/></svg><br>${p.items.find((x) => x.id === sid)?.name}</div>`).join('');
  fs.writeFileSync(`/tmp/hist-preview/${id}.html`, `<html><body style="margin:0;background:#111"><h3 style="color:#fff;font-family:sans-serif;margin:6px">${p.meta.title} — ${p.items.length} items</h3>${svg}<div>${shapes}</div></body></html>`);
}
console.log('ok', ids.join(','));
