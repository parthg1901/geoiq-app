import { useEffect, useRef } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoCentroid, geoDistance } from 'd3-geo';
import { useWorld } from './WorldMap';
import { BY_ID } from '../data';

/**
 * Canvas orthographic globe. Auto-rotates, can be dragged, and flies to `focus`.
 * `fills` colours countries (id → css colour).
 */
/** Zoom level that keeps a country visible on a small globe. */
export const zoomFor = (id: string) => { const a = BY_ID[id]?.area ?? 1e6; return a < 3e4 ? 2.6 : a < 3e5 ? 2 : a < 2e6 ? 1.5 : 1.15; };

type WorldF = NonNullable<ReturnType<typeof useWorld>>[number];
/** Per-feature centroid + angular radius, so far-side countries can be skipped without projecting them. */
const caps = new WeakMap<WorldF, { c: [number, number]; r: number }>();
function capOf(f: WorldF) {
  let v = caps.get(f);
  if (!v) {
    const c = geoCentroid(f) as [number, number];
    let r = 0;
    const visit = (a: unknown): void => {
      if (Array.isArray(a) && typeof a[0] === 'number') r = Math.max(r, geoDistance(c, a as [number, number]));
      else if (Array.isArray(a)) a.forEach(visit);
    };
    visit((f.geometry as { coordinates?: unknown }).coordinates);
    caps.set(f, (v = { c, r }));
  }
  return v;
}

const varCache: Record<string, string> = {};
/** Canvas can't read CSS variables — resolve `var(--x)` to its computed value. */
function resolve(c: string) {
  if (!c.startsWith('var(')) return c;
  return (varCache[c] ??= getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1).trim()).trim() || '#ffb547');
}

export function Globe({ size = 320, focus, fills = {}, spin = true, markers = [], className = '', zoom = 1 }: {
  size?: number; zoom?: number; focus?: string | null; fills?: Record<string, string>; spin?: boolean; markers?: { lat: number; lng: number; color: string }[]; className?: string;
}) {
  const world = useWorld('110');
  const ref = useRef<HTMLCanvasElement>(null);
  const rot = useRef<[number, number, number]>([-20, -20, 0]);
  const state = useRef({ drag: false, last: [0, 0], fly: null as null | { from: [number, number]; to: [number, number]; t0: number }, idle: 0 });
  const props = useRef({ fills, markers, spin, focus });
  props.current = { fills, markers, spin, focus };

  useEffect(() => {
    if (!focus) return;
    const c = BY_ID[focus];
    const f = world?.find((x) => x.id === focus);
    const cen = f ? geoCentroid(f) : [c.latlng[1], c.latlng[0]];
    const target: [number, number] = [-(c && Math.abs(cen[0] - c.latlng[1]) > 40 ? c.latlng[1] : cen[0]), -(c && Math.abs(cen[0] - c.latlng[1]) > 40 ? c.latlng[0] : cen[1])];
    state.current.fly = { from: [rot.current[0], rot.current[1]], to: target, t0: performance.now() };
    kick.current();
  }, [focus, world]);

  const kick = useRef<() => void>(() => {});
  // Any visual input change → one redraw (and keep animating only if something is moving).
  useEffect(() => { kick.current(); }, [fills, markers, spin, focus]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !world) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const proj = geoOrthographic().fitExtent([[6, 6], [size - 6, size - 6]], { type: 'Sphere' }).clipAngle(90);
    proj.scale(proj.scale() * zoom);
    // 110m data is already coarse: skip most adaptive resampling, which dominates projection cost.
    proj.precision(2);
    const path = geoPath(proj, ctx);
    const toPath2D = geoPath(proj);
    const grat = geoGraticule10();
    const r = proj.scale();
    const atmo = ctx.createRadialGradient(size / 2 - r * 0.3, size / 2 - r * 0.35, r * 0.1, size / 2, size / 2, r * 1.05);
    atmo.addColorStop(0, '#173470'); atmo.addColorStop(1, '#071330');
    let raf = 0, visible = true, lastDraw = 0, lastTick = performance.now();

    const draw = (now: number) => {
      const { fills, markers } = props.current;
      proj.rotate(rot.current);
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = atmo; ctx.fill();
      ctx.beginPath(); path(grat); ctx.strokeStyle = 'rgba(142,163,204,.10)'; ctx.lineWidth = 0.6; ctx.stroke();
      // Project each country once per frame into a Path2D, then batch fills by colour
      // and stroke every border in a single pass.
      const groups = new Map<string, Path2D>();
      const borders = new Path2D();
      const centre: [number, number] = [-rot.current[0], -rot.current[1]];
      for (const f of world) {
        const cap = capOf(f);
        if (geoDistance(centre, cap.c) - cap.r > Math.PI / 2 + 0.02) continue; // entirely on the far side
        const p2 = new Path2D();
        toPath2D.context(p2 as unknown as CanvasRenderingContext2D)(f);
        const col = fills[f.id] ? resolve(fills[f.id]) : BY_ID[f.id] ? '#34528c' : '#2a3f6a';
        let g = groups.get(col);
        if (!g) groups.set(col, (g = new Path2D()));
        g.addPath(p2);
        borders.addPath(p2);
      }
      for (const [col, g] of groups) { ctx.fillStyle = col; ctx.fill(g); }
      ctx.strokeStyle = 'rgba(7,13,28,.75)'; ctx.lineWidth = 0.5; ctx.stroke(borders);
      for (const m of markers) {
        const p = proj([m.lng, m.lat]);
        if (!p || !isFront(m, rot.current)) continue;
        const pulse = 4 + Math.sin(now / 250) * 2;
        ctx.beginPath(); ctx.arc(p[0], p[1], pulse + 4, 0, 7); ctx.fillStyle = m.color + '44'; ctx.fill();
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fillStyle = m.color; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(83,184,255,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
      lastDraw = now;
    };

    const tick = (now: number) => {
      raf = 0;
      const st = state.current;
      const { spin, markers } = props.current;
      const dt = Math.min(64, now - lastTick); lastTick = now;
      const spinning = spin && !st.drag && now - st.idle > 1500;
      if (st.fly) {
        const t = Math.min(1, (now - st.fly.t0) / 1400);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // great-circle interpolation of the view centre
        const [lng, lat] = geoInterpolate([-st.fly.from[0], -st.fly.from[1]], [-st.fly.to[0], -st.fly.to[1]])(e);
        rot.current = [-lng, -lat, 0];
        if (t >= 1) st.fly = null;
        draw(now);
      } else if (st.drag) {
        draw(now);
      } else if (spinning || markers.length) {
        if (spinning) rot.current = [rot.current[0] + dt * 0.0072, rot.current[1] * 0.995 - 15 * 0.005, 0];
        if (now - lastDraw >= 40) draw(now); // ambient motion at ~25fps is plenty
      } else {
        draw(now);
      }
      const moving = !!st.fly || st.drag || spinning || markers.length > 0 || (spin && now - st.idle <= 1500);
      if (moving && visible && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf && visible && !document.hidden) { lastTick = performance.now(); raf = requestAnimationFrame(tick); } };
    kick.current = start;

    // Stop completely while scrolled off-screen or when the app is in the background.
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); });
    io.observe(cv);
    const onVis = () => start();
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => { cancelAnimationFrame(raf); raf = 0; io.disconnect(); document.removeEventListener('visibilitychange', onVis); kick.current = () => {}; };
  }, [world, size, zoom]);

  const onDown = (e: React.PointerEvent) => { state.current.drag = true; state.current.last = [e.clientX, e.clientY]; state.current.fly = null; (e.target as Element).setPointerCapture(e.pointerId); kick.current(); };
  const onMove = (e: React.PointerEvent) => {
    const st = state.current; if (!st.drag) return;
    const dx = e.clientX - st.last[0], dy = e.clientY - st.last[1];
    st.last = [e.clientX, e.clientY];
    rot.current = [rot.current[0] + dx * 0.4, Math.max(-80, Math.min(80, rot.current[1] - dy * 0.4)), 0];
    kick.current();
  };
  const onUp = () => { state.current.drag = false; state.current.idle = performance.now(); kick.current(); };

  return (
    <canvas ref={ref} style={{ width: size, height: size, willChange: 'transform', borderRadius: zoom > 1 ? '50%' : undefined, boxShadow: zoom > 1 ? '0 0 0 2px rgba(83,184,255,.45), 0 0 30px rgba(83,184,255,.2)' : undefined }} className={`touch-none cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  );
}

function isFront(m: { lat: number; lng: number }, r: [number, number, number]) {
  const toRad = Math.PI / 180;
  const lat0 = -r[1] * toRad, lng0 = -r[0] * toRad, lat = m.lat * toRad, lng = m.lng * toRad;
  return Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(lng - lng0) > 0;
}
