import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10, type GeoPermissibleObjects } from 'd3-geo';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { select } from 'd3-selection';
import 'd3-transition';
import { feature } from 'topojson-client';
import type { Feature, Geometry } from 'geojson';
import { BY_ID, COUNTRIES, TINY, loadWorld50, loadWorld110 } from '../data';

type F = Feature<Geometry, { n?: string }> & { id: string };
const W = 960, BASE_H = 500;

const cache: Record<string, F[]> = {};
export function useWorld(detail: '50' | '110' = '50') {
  const [f, setF] = useState<F[] | null>(cache[detail] ?? null);
  useEffect(() => {
    if (f) return;
    (detail === '50' ? loadWorld50() : loadWorld110()).then((t) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topo = t as any;
      const fc = feature(topo, topo.objects.countries) as unknown as { features: F[] };
      cache[detail] = fc.features.filter((x) => x.id !== 'ATA' && x.id !== 'X-Antarctica');
      setF(cache[detail]);
    });
  }, [detail, f]);
  return f;
}

export interface MapHandle { zoomTo: (ids: string[] | null, pad?: number) => void }

export interface WorldMapProps {
  fills?: Record<string, string>;
  defaultFill?: string;
  onPick?: (id: string) => void;
  pickable?: (id: string) => boolean;
  highlight?: string | null;
  pulse?: string[];
  focus?: string[] | null; // ids to frame
  interactive?: boolean;
  detail?: '50' | '110';
  className?: string;
  showTiny?: boolean;
  labels?: Record<string, string>;
}

export const WorldMap = forwardRef<MapHandle, WorldMapProps>(function WorldMap(
  { fills = {}, defaultFill = 'var(--color-land)', onPick, pickable, highlight, pulse = [], focus, interactive = true, detail = '50', className = '', showTiny = true, labels },
  ref,
) {
  const world = useWorld(detail);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const hRef = useRef(BASE_H);
  const [k, setK] = useState(1);
  const kRef = useRef(1);
  const kRaf = useRef(0);
  const [hover, setHover] = useState<string | null>(null);
  // The viewBox follows the container's aspect ratio so tall phone screens get a tall map, not letterboxing.
  const [box, setBox] = useState({ H: BASE_H, cw: W });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width < 10 || height < 10) return;
      setBox({ H: Math.round(Math.max(BASE_H * 0.8, Math.min(W * 2.2, (W * height) / width))), cw: width });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = box.H;
  hRef.current = H;
  const ui = W / box.cw; // viewBox units per CSS pixel, for readable labels

  const projection = useMemo(() => {
    const h = Math.min(H, BASE_H);
    return geoNaturalEarth1().fitExtent([[8, (H - h) / 2 + 8], [W - 8, (H + h) / 2 - 8]], { type: 'Sphere' });
  }, [H]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(() => world?.map((f) => ({ id: f.id, d: path(f) || '', f })) ?? [], [world, path]);
  const sphere = useMemo(() => path({ type: 'Sphere' }) || '', [path]);
  const grat = useMemo(() => path(geoGraticule10()) || '', [path]);
  const tiny = useMemo(() => COUNTRIES.filter((c) => TINY.has(c.id)).map((c) => {
    const p = projection([c.latlng[1], c.latlng[0]])!;
    const f = paths.find((x) => x.id === c.id);
    // prefer the polygon centroid when we have it
    const cen = f ? path.centroid(f.f) : p;
    // projected polygon area (viewBox units²); 0 when the 50m map has no shape at all (e.g. Tuvalu)
    const area = f ? path.area(f.f as GeoPermissibleObjects) : 0;
    return { id: c.id, area, x: isFinite(cen[0]) ? cen[0] : p[0], y: isFinite(cen[1]) ? cen[1] : p[1] };
  }), [projection, paths, path]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 40])
      .translateExtent([[0, 0], [W, hRef.current]])
      .on('zoom', (e) => {
        gRef.current?.setAttribute('transform', e.transform.toString());
        // Only marker sizes/labels depend on k: re-render when it changes by >20%, at most once per frame.
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

  const zoomTo = (ids: string[] | null, pad = 0.12) => {
    const svg = svgRef.current, z = zRef.current;
    if (!svg || !z) return;
    if (!ids || !ids.length) { select(svg).transition().duration(900).call(z.transform, zoomIdentity); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const f = paths.find((p) => p.id === id);
      let b: [[number, number], [number, number]];
      if (f) b = path.bounds(f.f as GeoPermissibleObjects);
      else { const c = BY_ID[id]; if (!c) continue; const p = projection([c.latlng[1], c.latlng[0]])!; b = [[p[0] - 4, p[1] - 4], [p[0] + 4, p[1] + 4]]; }
      // Far-flung overseas parts (France with French Guiana, USA with Hawaii, Norway with Svalbard…) make
      // the outline's bounds much wider than the country's land area suggests: frame its main location.
      const c = BY_ID[id];
      if (c) {
        const p = projection([c.latlng[1], c.latlng[0]])!;
        const halfDeg = Math.max(1.5, Math.sqrt(c.area) / 111 / 2) * 1.3; // rough half-width in degrees
        const q = projection([c.latlng[1] + halfDeg, c.latlng[0]])!;
        const half = Math.abs(q[0] - p[0]);
        if (b[1][0] - b[0][0] > half * 2 * 3.5) b = [[p[0] - half, p[1] - half * 0.75], [p[0] + half, p[1] + half * 0.75]];
      }
      x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]); x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
    }
    if (!isFinite(x0)) return;
    const bw = Math.max(x1 - x0, 12), bh = Math.max(y1 - y0, 8);
    const s = Math.min(40, Math.max(1, (1 - pad * 2) / Math.max(bw / W, bh / H)));
    const t = zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    select(svg).transition().duration(1100).call(z.transform, t);
  };
  useImperativeHandle(ref, () => ({ zoomTo }));

  useEffect(() => { zRef.current?.translateExtent([[0, 0], [W, H]]); }, [H]);
  const focusKey = focus?.join(',') ?? '';
  useEffect(() => { if (paths.length) zoomTo(focus ?? null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, paths.length, H]);

  const canPick = (id: string) => !!onPick && !!BY_ID[id] && (!pickable || pickable(id));
  const pulseKey = pulse.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const countryLayer = useMemo(() => paths.map(({ id, d }) => {
          const fill = fills[id] ?? (BY_ID[id] ? defaultFill : '#1a2848');
          const pick = canPick(id);
          return (
            <path
              key={id}
              data-id={id}
              d={d}
              stroke={highlight === id ? '#fff' : 'rgba(7,13,28,.9)'}
              strokeWidth={highlight === id ? 2 : 0.5}
              vectorEffect="non-scaling-stroke"
              style={{ fill: hover === id && pick ? '#ffd28a' : fill, cursor: pick ? 'pointer' : 'default', transition: 'fill .25s' }}
              className={pulse.includes(id) ? 'glow-pulse' : ''}
              onPointerEnter={() => pick && setHover(id)}
              onPointerLeave={() => setHover((h) => (h === id ? null : h))}
              onClick={() => pick && onPick!(id)}
            />
          );
        }), [paths, fills, defaultFill, hover, highlight, pulseKey, onPick, pickable]);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`w-full h-full touch-none select-none ${className}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="ocean" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#10224a" />
          <stop offset="100%" stopColor="#081230" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#081230" />
      <g ref={gRef}>
        <path d={sphere} fill="url(#ocean)" stroke="rgba(83,184,255,.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={grat} fill="none" stroke="rgba(142,163,204,.08)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        {countryLayer}
        {/* Tap markers for countries too small to see or tap at this zoom (microstates, small islands). */}
        {showTiny && tiny.map(({ id, x, y, area }) => {
          const pick = canPick(id);
          const coloured = fills[id] !== undefined;
          const marked = coloured || highlight === id || pulse.includes(id);
          // Only where it helps: on tap-to-answer maps, or when the dot carries a colour / highlight.
          if (!pick && !marked) return null;
          // Hide once the real outline is big enough to see and tap (~17×17 px on screen).
          const screenArea = (area * k * k) / (ui * ui);
          if (area > 0 && screenArea > 300) return null;
          // Constant on-screen size at any zoom (radius in px × viewBox units per px ÷ zoom).
          const r = ((marked ? 5 : 4) * ui) / k;
          const hoverOn = hover === id && pick;
          return (
            <g key={id} style={{ cursor: pick ? 'pointer' : 'default' }} onClick={() => pick && onPick!(id)}
              onPointerEnter={() => pick && setHover(id)} onPointerLeave={() => setHover((h) => (h === id ? null : h))}>
              <circle cx={x} cy={y} r={(12 * ui) / k} fill="transparent" />
              <circle cx={x} cy={y} r={r} vectorEffect="non-scaling-stroke" className={pulse.includes(id) ? 'glow-pulse' : ''}
                style={{
                  // subtle ring by default; filled when it shows a colour, a highlight or hover
                  fill: hoverOn ? '#ffd28a' : marked ? (fills[id] ?? 'var(--color-amber)') : 'transparent',
                  stroke: highlight === id ? '#fff' : coloured ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.55)',
                  strokeWidth: highlight === id ? 2 : 1.2,
                }} />
            </g>
          );
        })}
        {labels && Object.entries(labels).map(([id, text]) => {
          const c = BY_ID[id]; if (!c) return null;
          const f = paths.find((p) => p.id === id);
          const p = f && !TINY.has(id) ? path.centroid(f.f) : projection([c.latlng[1], c.latlng[0]])!;
          if (!p || !isFinite(p[0])) return null;
          return (
            <text key={id} x={p[0]} y={p[1]} textAnchor="middle" dy="0.35em" fontSize={(12 * ui) / k} fontWeight={700}
              fill="#fff" stroke="#070d1c" strokeWidth={(3 * ui) / k} paintOrder="stroke" style={{ pointerEvents: 'none', fontFamily: 'var(--font-display)' }}>{text}</text>
          );
        })}
      </g>
    </svg>
  );
});
