// Dev check: renders every region pack (map + base, shapes, flags/arms) into /tmp/regions-check/sheet.html.
import fs from 'node:fs';
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';
const root = process.cwd();
const index = JSON.parse(fs.readFileSync('public/data/packs/index-regions.json', 'utf8'));
let html = '<html><body style="background:#0b1530;color:#cde;font:11px sans-serif;margin:8px">';
for (const meta of index) {
  const d = JSON.parse(fs.readFileSync(`public/data/packs/${meta.id}.json`, 'utf8'));
  const items = topojson.feature(d.topo, d.topo.objects.items);
  const base = d.base ? topojson.feature(d.base, d.base.objects.base) : null;
  const P = d.projection;
  let proj = { albersUsa: d3.geoAlbersUsa, mercator: d3.geoMercator, conicEqualArea: d3.geoConicEqualArea, naturalEarth1: d3.geoNaturalEarth1, equirectangular: d3.geoEquirectangular, azimuthalEqualArea: d3.geoAzimuthalEqualArea }[P.type]();
  if (P.rotate && proj.rotate) proj.rotate(P.rotate);
  if (P.parallels && proj.parallels) proj.parallels(P.parallels);
  proj.fitExtent([[10, 10], [690, 490]], items);
  const path = d3.geoPath(proj);
  const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
  let svg = `<svg width="700" height="500" style="background:#081230"><g>`;
  if (base) svg += `<path d="${path(base) || ''}" fill="#1f2c4d" stroke="#0b1530" stroke-width=".5"/>`;
  items.features.forEach((f, i) => { svg += `<path d="${path(f) || ''}" fill="hsl(${(i * 47) % 360},45%,48%)" stroke="#fff" stroke-width=".4"/>`; });
  items.features.forEach((f) => { const c = path.centroid(f); if (isFinite(c[0])) svg += `<text x="${c[0]}" y="${c[1]}" font-size="8" fill="#fff" text-anchor="middle">${(byId[f.id]?.name || '??' + f.id).slice(0, 14)}</text>`; });
  svg += '</g></svg>';
  const missingGeom = d.items.filter((it) => !items.features.some((f) => f.id === it.id)).map((i) => i.id);
  html += `<h2>${meta.emoji} ${meta.title} — ${d.items.length} items, modes ${meta.modes.join(',')} ${missingGeom.length ? '<b style=color:red>MISSING GEOM ' + missingGeom + '</b>' : ''}</h2>${svg}<div style="display:flex;flex-wrap:wrap">`;
  for (const it of d.items) {
    html += `<div style="width:84px;text-align:center;margin:2px">${d.shapes[it.id] ? `<svg viewBox="0 0 200 200" width="56" height="56"><path d="${d.shapes[it.id]}" fill="#fb4"/></svg>` : '<div style="height:56px;color:#f66">no shape</div>'}<br>${it.name}<br>`;
    if (it.flag) html += `<img src="file://${root}/public${it.flag}" height="22">`;
    if (it.arms) html += `<img src="file://${root}/public${it.arms}" height="26">`;
    html += `</div>`;
  }
  html += '</div>';
}
fs.writeFileSync('/tmp/regions-check/sheet.html', html + '</body></html>');
