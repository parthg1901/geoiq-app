import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
  geoPath, geoArea, geoAlbersUsa, geoMercator, geoConicEqualArea, geoNaturalEarth1, geoEquirectangular, geoAzimuthalEqualArea,
  type GeoProjection, type GeoPermissibleObjects,
} from 'd3-geo';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { PackData, PackProjection } from '../../lib/packs';

type F = Feature<Geometry> & { id: string };
const W = 960, BASE_H = 600;

/**
 * d3-geo expects clockwise exterior rings (spherical winding); GeoJSON/RFC 7946 data is often
 * counter-clockwise, which d3 reads as "the whole globe minus this shape". Fix any such polygon.
 */
/** Drop stray (0,0) "Null Island" points — always a data artefact, never real land or rivers. */
const notNull = (p: number[]) => Math.abs(p[0]) > 0.01 || Math.abs(p[1]) > 0.01;

function rewind<T extends Feature<Geometry>>(f: T): T {
  const g = f.geometry;
  if (g && g.type === 'LineString') return { ...f, geometry: { ...g, coordinates: g.coordinates.filter(notNull) } };
  if (g && g.type === 'MultiLineString') return { ...f, geometry: { ...g, coordinates: g.coordinates.map((l) => l.filter(notNull)) } };
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return f;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((rings) => rings.map((r) => r.filter(notNull)).filter((r) => r.length >= 4));
  const fixed = polys.filter((rings) => rings.length).map((rings) => {
    const one = { type: 'Polygon', coordinates: rings } as Geometry;
    return geoArea(one) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings;
  });
  if (!fixed.length) return { ...f, geometry: null as unknown as Geometry };
  return { ...f, geometry: g.type === 'Polygon' ? { type: 'Polygon', coordinates: fixed[0] } : { type: 'MultiPolygon', coordinates: fixed } };
}

const featCache = new WeakMap<object, { items: F[]; base: F[] }>();
/** Decode a pack's TopoJSON once (cached per pack object). */
export function packFeatures(pack: PackData) {
  let v = featCache.get(pack);
  if (!v) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = pack.topo as any;
    const items = t?.objects?.items ? ((feature(t, t.objects.items) as unknown as FeatureCollection).features as F[]).map(rewind) : [];
    for (const f of items) f.id = String(f.id ?? (f.properties as { id?: string } | null)?.id ?? '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = pack.base as any;
    const baseObj = b?.objects?.base ?? (b?.objects ? Object.values(b.objects)[0] : null);
    const base = baseObj ? ((feature(b, baseObj) as unknown as FeatureCollection).features as F[]).map(rewind) : [];
    v = { items, base };
    featCache.set(pack, v);
  }
  return v;
}

export function makeProjection(p: PackProjection): GeoProjection {
  let proj: GeoProjection;
  switch (p.type) {
    case 'albersUsa': return geoAlbersUsa() as unknown as GeoProjection;
    case 'mercator': proj = geoMercator(); break;
    case 'conicEqualArea': proj = geoConicEqualArea(); if (p.parallels) proj = (proj as ReturnType<typeof geoConicEqualArea>).parallels(p.parallels); break;
    case 'equirectangular': proj = geoEquirectangular(); break;
    case 'azimuthalEqualArea': proj = geoAzimuthalEqualArea(); break;
    default: proj = geoNaturalEarth1();
  }
  if (p.rotate) proj = proj.rotate(p.rotate as [number, number]);
  if (p.center) proj = proj.center(p.center);
  return proj;
}

const isLine = (g: Geometry | null) => !!g && (g.type === 'LineString' || g.type === 'MultiLineString');
/** First coordinate of a Point/MultiPoint geometry. */
const pointCoord = (g: Geometry): [number, number] => {
  const c = (g as unknown as { type: string; coordinates: number[] | number[][] }).coordinates;
  return (g.type === 'MultiPoint' ? (c as number[][])[0] : (c as number[])) as [number, number];
};
const isPoint = (g: Geometry | null) => !!g && (g.type === 'Point' || g.type === 'MultiPoint');

export interface PackMapHandle { zoomTo: (ids: string[] | null, pad?: number) => void }

export interface PackMapProps {
  pack: PackData;
  fills?: Record<string, string>;
  defaultFill?: string;
  onPick?: (id: string) => void;
  highlight?: string | null;
  pulse?: string[];
  focus?: string[] | null;
  labels?: Record<string, string>;
  interactive?: boolean;
  /** Restrict which items are drawn as interactive (e.g. only the quiz set); others render muted. */
  only?: Set<string> | null;
  className?: string;
}

/** Interactive SVG map for any content pack: polygons fill, rivers stroke, peaks are markers. */
export const PackMap = forwardRef<PackMapHandle, PackMapProps>(function PackMap(
  { pack, fills = {}, defaultFill, onPick, highlight, pulse = [], focus, labels, interactive = true, only, className = '' },
  ref,
) {
  const { items, base } = packFeatures(pack);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [k, setK] = useState(1);
  const kRef = useRef(1), kRaf = useRef(0);
  const [box, setBox] = useState({ H: BASE_H, cw: W });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width < 10 || height < 10) return;
      setBox({ H: Math.round(Math.max(W * 0.45, Math.min(W * 2.2, (W * height) / width))), cw: width });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = box.H;
  const ui = W / box.cw; // viewBox units per CSS px

  const projection = useMemo(() => {
    const proj = makeProjection(pack.projection);
    const fc = { type: 'FeatureCollection', features: items } as FeatureCollection;
    proj.fitExtent([[16, 16], [W - 16, H - 16]], fc);
    return proj;
  }, [pack, items, H]);
  const path = useMemo(() => geoPath(projection).pointRadius(0), [projection]);

  const geo = useMemo(() => items.map((f) => {
    const kind = isPoint(f.geometry) ? 'point' : isLine(f.geometry) ? 'line' : 'poly';
    const d = kind === 'point' ? '' : path(f) || '';
    const c = kind === 'point'
      ? projection(pointCoord(f.geometry)) ?? [NaN, NaN]
      : path.centroid(f);
    const area = kind === 'poly' ? path.area(f) : 0;
    return { id: f.id, f, kind, d, c, area, tiny: kind === 'poly' && area < 120 };
  }), [items, path, projection]);
  // albersUsa's Alaska/Hawaii insets would smear neighbouring land into boxes — draw no context there.
  const baseD = useMemo(() => (pack.projection.type === 'albersUsa' ? '' : base.map((f) => path(f) || '').join('')), [base, path, pack.projection.type]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 30])
      .on('zoom', (e) => {
        gRef.current?.setAttribute('transform', e.transform.toString());
        const nk = e.transform.k;
        if (Math.abs(Math.log(nk / kRef.current)) > 0.18 && !kRaf.current) {
          kRaf.current = requestAnimationFrame(() => { kRaf.current = 0; kRef.current = nk; setK(nk); });
        }
      })
      .on('end', (e) => { kRef.current = e.transform.k; setK(e.transform.k); });
    zRef.current = z;
    if (interactive) select(svg).call(z).on('dblclick.zoom', null);
    return () => { select(svg).on('.zoom', null); };
  }, [interactive]);
  useEffect(() => { zRef.current?.translateExtent([[-W * 0.25, -H * 0.25], [W * 1.25, H * 1.25]]); }, [H]);

  const zoomTo = (ids: string[] | null, pad = 0.15) => {
    const svg = svgRef.current, z = zRef.current;
    if (!svg || !z) return;
    if (!ids || !ids.length) { select(svg).transition().duration(800).call(z.transform, zoomIdentity); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const g = geo.find((x) => x.id === id);
      if (!g) continue;
      let b: [[number, number], [number, number]];
      if (g.kind === 'point') b = [[g.c[0] - 30, g.c[1] - 30], [g.c[0] + 30, g.c[1] + 30]];
      else b = path.bounds(g.f as GeoPermissibleObjects);
      if (!isFinite(b[0][0])) continue;
      x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]); x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
    }
    if (!isFinite(x0)) return;
    const bw = Math.max(x1 - x0, 40), bh = Math.max(y1 - y0, 40);
    const s = Math.min(12, Math.max(1, (1 - pad * 2) / Math.max(bw / W, bh / H)));
    const t = zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    select(svg).transition().duration(900).call(z.transform, t);
  };
  useImperativeHandle(ref, () => ({ zoomTo }));
  const focusKey = focus?.join(',') ?? '';
  useEffect(() => { zoomTo(focus ?? null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, H, geo]);

  // Water packs (seas): items are water, so draw them blue on top of a land-coloured base.
  const water = useMemo(() => pack.items.length > 0 && pack.items.filter((i) => /sea|ocean|gulf|bay|strait|channel|sound|lake/.test(i.kind ?? '')).length > pack.items.length / 2, [pack]);
  const itemDefault = defaultFill ?? (water ? '#1d4a7a' : 'var(--color-land)');
  // History maps: give each polity its own muted tint so empires read as distinct blocks.
  const tint = useMemo(() => {
    if (pack.meta.group !== 'history' || defaultFill) return null;
    const pal = ['#2f4778', '#3b4f6e', '#2c5266', '#4a4670', '#384a5c', '#2b3f6b', '#4b5a7a', '#33556e'];
    const out: Record<string, string> = {};
    pack.items.forEach((it, i) => { let h = 0; for (const ch of it.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; out[it.id] = pal[(h + i) % pal.length]; });
    return out;
  }, [pack, defaultFill]);
  const pulseKey = pulse.join(',');
  const pick = (id: string) => { if (onPick && (!only || only.has(id))) onPick(id); };

  // Main item layer is independent of zoom level k → memoized, so pinch-zoom doesn't re-render it.
  const layer = useMemo(() => geo.map(({ id, kind, d }) => {
    if (kind === 'point') return null;
    const muted = !!only && !only.has(id);
    const fill = fills[id];
    const hl = highlight === id;
    const cls = pulse.includes(id) ? 'glow-pulse' : '';
    if (kind === 'line') {
      return (
        <g key={id} onClick={() => !muted && pick(id)} style={{ cursor: onPick && !muted ? 'pointer' : 'default' }}>
          {onPick && !muted && <path d={d} fill="none" stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
          <path d={d} fill="none" className={cls} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
            style={{ stroke: fill ?? (muted ? 'rgba(83,184,255,.25)' : defaultFill ?? '#5fb3ff'), strokeWidth: hl || fill ? 3.4 : 1.6, transition: 'stroke .25s' }} />
        </g>
      );
    }
    return (
      <path key={id} d={d} onClick={() => !muted && pick(id)} className={cls} vectorEffect="non-scaling-stroke"
        stroke={hl ? '#fff' : water ? 'rgba(120,190,255,.35)' : 'rgba(7,13,28,.85)'} strokeWidth={hl ? 2 : 0.6}
        style={{ fill: fill ?? (muted ? '#1b2a4d' : tint?.[id] ?? itemDefault), cursor: onPick && !muted ? 'pointer' : 'default', transition: 'fill .25s' }} />
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [geo, fills, itemDefault, tint, water, highlight, pulseKey, onPick, only]);

  const r = (4 * ui) / k; // constant ~4px on screen
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`w-full h-full touch-none select-none ${className}`} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#0a1734" />
      <g ref={gRef}>
        {baseD && <path d={baseD} fill={water ? '#2a3a5e' : '#131d38'} stroke="rgba(7,13,28,.9)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />}
        {layer}
        {/* tap targets for tiny polygons and point items (sized in screen pixels) */}
        {geo.map(({ id, kind, c, tiny, area }) => {
          // A tiny polygon only needs a tap circle while it's still small on screen at this zoom.
          if (kind !== 'point' && (!tiny || (area * k * k) / (ui * ui) > 260)) return null;
          if (!isFinite(c[0])) return null;
          const muted = !!only && !only.has(id);
          const fill = fills[id] ?? (muted ? '#2a3f6a' : kind === 'point' ? defaultFill ?? '#ffb547' : itemDefault);
          const hl = highlight === id;
          const s = (ui * 1.1) / k; // constant ~14px marker on screen at any zoom or map size
          return (
            <g key={id} transform={`translate(${c[0]},${c[1]})`} onClick={() => !muted && pick(id)} style={{ cursor: onPick && !muted ? 'pointer' : 'default' }}>
              <circle r={r * 3} fill="transparent" />
              {kind === 'point' ? (
                <PeakPin scale={s * (hl ? 1.3 : 1)} state={muted ? 'muted' : fills[id] ? 'colored' : 'default'} color={fill} hl={hl} pulse={pulse.includes(id)} />
              ) : (
                <circle r={r} className={pulse.includes(id) ? 'glow-pulse' : ''} fillOpacity={0.9} vectorEffect="non-scaling-stroke"
                  style={{ fill, stroke: hl ? '#fff' : fills[id] ?? 'rgba(255,255,255,.55)', strokeWidth: hl ? 2 : 1 }} />
              )}
            </g>
          );
        })}
        {labels && Object.entries(labels).map(([id, text]) => {
          const g = geo.find((x) => x.id === id);
          if (!g || !isFinite(g.c[0])) return null;
          return (
            <text key={id} x={g.c[0]} y={g.c[1] + (g.kind === 'point' ? (14 * ui) / k : 0)} textAnchor="middle" dy="0.35em" fontSize={(12 * ui) / k} fontWeight={700}
              fill="#fff" stroke="#070d1c" strokeWidth={(3 * ui) / k} paintOrder="stroke" style={{ pointerEvents: 'none', fontFamily: 'var(--font-display)' }}>{text}</text>
          );
        })}
      </g>
    </svg>
  );
});

/** Projected centroid of each item in a neutral equirectangular frame — used for "nearby" distractors. */
const centCache = new WeakMap<PackData, Record<string, [number, number]>>();
export function itemCentroids(pack: PackData): Record<string, [number, number]> {
  const hit = centCache.get(pack);
  if (hit) return hit;
  const { items } = packFeatures(pack);
  const p = geoPath();
  const out: Record<string, [number, number]> = {};
  for (const f of items) {
    if (isPoint(f.geometry)) out[f.id] = pointCoord(f.geometry);
    else { const c = p.centroid(f); if (isFinite(c[0])) out[f.id] = c as [number, number]; }
  }
  centCache.set(pack, out);
  return out;
}

/**
 * Map pin for point items (mountain peaks): a round badge with a small snow-capped mountain.
 * Drawn in local units (~1 unit ≈ 1 screen px after `scale`).
 */
function PeakPin({ scale, state, color, hl, pulse }: { scale: number; state: 'default' | 'colored' | 'muted'; color: string; hl: boolean; pulse: boolean }) {
  const badge = state === 'colored' ? color : state === 'muted' ? '#22345c' : '#13234a';
  const ring = hl ? '#fff' : state === 'muted' ? 'rgba(142,163,204,.35)' : state === 'colored' ? 'rgba(255,255,255,.9)' : 'rgba(255,181,71,.85)';
  const rock = state === 'colored' ? '#0b1530' : state === 'muted' ? '#4a5b80' : '#ffb547';
  const snow = state === 'muted' ? '#7d8bab' : '#fff';
  return (
    <g transform={`scale(${scale})`} className={pulse ? 'glow-pulse' : ''}>
      <circle r={9.5} cy={1.2} fill="rgba(0,0,0,.35)" />
      <circle r={8.5} style={{ fill: badge }} stroke={ring} strokeWidth={hl ? 2 : 1.3} />
      <path d="M-5.6,3.6 L-1.6,-3.4 L0.6,0.2 L2.3,-2.2 L5.6,3.6 Z" style={{ fill: rock }} strokeLinejoin="round" />
      <path d="M-1.6,-3.4 L-2.8,-1.3 L-1.7,-1.75 L-0.55,-1.15 Z" fill={snow} />
      <path d="M2.3,-2.2 L1.55,-1.15 L2.35,-1.45 L3.05,-1.1 Z" fill={snow} />
    </g>
  );
}
