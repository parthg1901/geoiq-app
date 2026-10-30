import { geoDistance, geoCentroid } from 'd3-geo';
import type { Feature, Geometry, Position } from 'geojson';
import { BY_ID, COUNTRIES, fame } from '../data';
import { shuffle } from './rng';

/* ---------------- Borderline: land-border graph ---------------- */

export const ADJ: Record<string, string[]> = Object.fromEntries(
  COUNTRIES.map((c) => [c.id, c.borders.filter((b) => BY_ID[b])]),
);

/** Hop distances from `from` over the land-border graph (optionally restricted to `allowed`). */
export function bfs(from: string, allowed?: Set<string>): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const q = [from];
  while (q.length) {
    const x = q.shift()!;
    for (const y of ADJ[x] ?? []) {
      if (dist[y] != null || (allowed && !allowed.has(y))) continue;
      dist[y] = dist[x] + 1;
      q.push(y);
    }
  }
  return dist;
}

export interface Route { start: string; end: string; hops: number; distS: Record<string, number>; distE: Record<string, number> }

export function makeRoute(r: () => number = Math.random): Route {
  const starts = shuffle(COUNTRIES.filter((c) => ADJ[c.id].length >= 2 && fame(c) >= 0.3), r);
  for (const s of starts) {
    const distS = bfs(s.id);
    const ends = shuffle(Object.entries(distS).filter(([id, d]) => d >= 3 && d <= 6 && fame(BY_ID[id]) >= 0.28), r);
    if (!ends.length) continue;
    const [end, hops] = ends[0];
    return { start: s.id, end, hops, distS, distE: bfs(end) };
  }
  throw new Error('no route');
}

/** Is `id` on at least one shortest start→end path? */
export const onShortest = (rt: Route, id: string) => (rt.distS[id] ?? 99) + (rt.distE[id] ?? 99) === rt.hops;
/** Detour cost compared to the shortest route (0 = optimal). */
export const detour = (rt: Route, id: string) => (rt.distS[id] ?? 99) + (rt.distE[id] ?? 99) - rt.hops;

/** Does the guessed set connect start → end? */
export function connected(rt: Route, guessed: string[]) {
  const allowed = new Set([...guessed, rt.end]);
  return bfs(rt.start, allowed)[rt.end] != null;
}

/** One shortest path, for the reveal. */
export function shortestPath(rt: Route): string[] {
  const path = [rt.start];
  let cur = rt.start;
  while (cur !== rt.end) {
    cur = ADJ[cur].filter((n) => onShortest(rt, n) && rt.distS[n] === rt.distS[cur] + 1).sort((a, b) => fame(BY_ID[b]) - fame(BY_ID[a]))[0];
    if (!cur) break;
    path.push(cur);
  }
  return path;
}

/* ---------------- Hot & Cold: geometry distances ---------------- */

type F = Feature<Geometry> & { id: string };
const sampleCache: Record<string, Position[]> = {};

function samples(f: F | undefined, id: string): Position[] {
  if (sampleCache[id]) return sampleCache[id];
  let pts: Position[] = [];
  if (f) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of polys) pts.push(...p[0]);
    const step = Math.max(1, Math.floor(pts.length / 220));
    pts = pts.filter((_, i) => i % step === 0);
  }
  const c = BY_ID[id];
  if (!pts.length && c) pts = [[c.latlng[1], c.latlng[0]]];
  return (sampleCache[id] = pts);
}

const R = 6371;
/** Approx. shortest distance between two countries' borders in km (0 if neighbours). */
export function borderDistance(a: string, b: string, world: F[]): number {
  if (a === b) return 0;
  if (BY_ID[a]?.borders.includes(b)) return 0;
  const fa = world.find((x) => x.id === a), fb = world.find((x) => x.id === b);
  const pa = samples(fa, a), pb = samples(fb, b);
  let m = Infinity;
  for (const x of pa) for (const y of pb) { const d = geoDistance(x as [number, number], y as [number, number]); if (d < m) m = d; }
  return Math.round(m * R);
}

export function centre(id: string, world: F[]): [number, number] {
  const c = BY_ID[id];
  const f = world.find((x) => x.id === id);
  if (f) {
    const cen = geoCentroid(f);
    if (Math.abs(cen[0] - c.latlng[1]) < 30) return cen;
  }
  return [c.latlng[1], c.latlng[0]];
}

/** Initial compass bearing (deg, 0 = north) from a → b. */
export function bearing(a: [number, number], b: [number, number]) {
  const toR = Math.PI / 180;
  const [l1, p1] = [a[0] * toR, a[1] * toR], [l2, p2] = [b[0] * toR, b[1] * toR];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return (Math.atan2(y, x) / toR + 360) % 360;
}

const STOPS: [number, [number, number, number]][] = [
  [0, [255, 59, 48]], [500, [255, 110, 60]], [1500, [255, 181, 71]], [3000, [255, 225, 150]],
  [5000, [150, 200, 255]], [9000, [83, 140, 255]], [20000, [50, 70, 160]],
];
/** Heat colour: hot red (touching) → cold deep blue (other side of the world). */
export function heat(km: number) {
  for (let i = 1; i < STOPS.length; i++) {
    if (km <= STOPS[i][0]) {
      const [d0, c0] = STOPS[i - 1], [d1, c1] = STOPS[i];
      const t = (km - d0) / (d1 - d0);
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * t));
      return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#324696';
}

export function heatLabel(km: number) {
  if (km === 0) return 'Touching!';
  if (km < 500) return 'Scorching';
  if (km < 1500) return 'Hot';
  if (km < 3000) return 'Warm';
  if (km < 6000) return 'Cool';
  if (km < 10000) return 'Cold';
  return 'Freezing';
}
