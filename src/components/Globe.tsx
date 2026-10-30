import { useEffect, useRef } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoInterpolate, geoCentroid } from 'd3-geo';
import { useWorld } from './WorldMap';
import { BY_ID } from '../data';

/**
 * Canvas orthographic globe. Auto-rotates, can be dragged, and flies to `focus`.
 * `fills` colours countries (id → css colour).
 */
/** Zoom level that keeps a country visible on a small globe. */
export const zoomFor = (id: string) => { const a = BY_ID[id]?.area ?? 1e6; return a < 3e4 ? 2.6 : a < 3e5 ? 2 : a < 2e6 ? 1.5 : 1.15; };

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
  }, [focus, world]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !world) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const proj = geoOrthographic().fitExtent([[6, 6], [size - 6, size - 6]], { type: 'Sphere' }).clipAngle(90);
    proj.scale(proj.scale() * zoom);
    const path = geoPath(proj, ctx);
    const grat = geoGraticule10();
    let raf = 0;
    const draw = (now: number) => {
      const st = state.current;
      const { fills, markers, spin } = props.current;
      if (st.fly) {
        const t = Math.min(1, (now - st.fly.t0) / 1400);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // great-circle interpolation of the view centre
        const ip = geoInterpolate([-st.fly.from[0], -st.fly.from[1]], [-st.fly.to[0], -st.fly.to[1]]);
        const [lng, lat] = ip(e);
        rot.current = [-lng, -lat, 0];
        if (t >= 1) st.fly = null;
      } else if (spin && !st.drag && now - st.idle > 1500) {
        rot.current = [rot.current[0] + 0.12, rot.current[1] * 0.995 - 15 * 0.005, 0];
      }
      proj.rotate(rot.current);
      ctx.clearRect(0, 0, size, size);
      // atmosphere
      const r = proj.scale();
      const g = ctx.createRadialGradient(size / 2 - r * 0.3, size / 2 - r * 0.35, r * 0.1, size / 2, size / 2, r * 1.05);
      g.addColorStop(0, '#173470'); g.addColorStop(1, '#071330');
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); path(grat); ctx.strokeStyle = 'rgba(142,163,204,.10)'; ctx.lineWidth = 0.6; ctx.stroke();
      for (const f of world) {
        ctx.beginPath(); path(f);
        ctx.fillStyle = fills[f.id] ? resolve(fills[f.id]) : BY_ID[f.id] ? '#34528c' : '#2a3f6a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(7,13,28,.75)'; ctx.lineWidth = 0.5; ctx.stroke();
      }
      for (const m of markers) {
        const p = proj([m.lng, m.lat]);
        if (!p || !isFront(m, rot.current)) continue;
        const pulse = 4 + Math.sin(now / 250) * 2;
        ctx.beginPath(); ctx.arc(p[0], p[1], pulse + 4, 0, 7); ctx.fillStyle = m.color + '44'; ctx.fill();
        ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fillStyle = m.color; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(83,184,255,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [world, size, zoom]);

  const onDown = (e: React.PointerEvent) => { state.current.drag = true; state.current.last = [e.clientX, e.clientY]; state.current.fly = null; (e.target as Element).setPointerCapture(e.pointerId); };
  const onMove = (e: React.PointerEvent) => {
    const st = state.current; if (!st.drag) return;
    const dx = e.clientX - st.last[0], dy = e.clientY - st.last[1];
    st.last = [e.clientX, e.clientY];
    rot.current = [rot.current[0] + dx * 0.4, Math.max(-80, Math.min(80, rot.current[1] - dy * 0.4)), 0];
  };
  const onUp = () => { state.current.drag = false; state.current.idle = performance.now(); };

  return (
    <canvas ref={ref} style={{ width: size, height: size, borderRadius: zoom > 1 ? '50%' : undefined, boxShadow: zoom > 1 ? '0 0 0 2px rgba(83,184,255,.45), 0 0 30px rgba(83,184,255,.2)' : undefined }} className={`touch-none cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  );
}

function isFront(m: { lat: number; lng: number }, r: [number, number, number]) {
  const toRad = Math.PI / 180;
  const lat0 = -r[1] * toRad, lng0 = -r[0] * toRad, lat = m.lat * toRad, lng = m.lng * toRad;
  return Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(lng - lng0) > 0;
}
