import { COUNTRIES, REGIONS, fame, type Region } from '../data';

export interface Unit { id: string; region: Region; index: number; title: string; ids: string[] }

const NAMES = ['The Icons', 'Big Players', 'Familiar Faces', 'Rising Stars', 'Crossroads', 'Deep Cuts', 'Hidden Gems', 'Off the Map', 'Specialist', 'Expert Zone', 'Legends'];
export const REGION_META: Record<Region, { color: string; emoji: string; tagline: string }> = {
  Europe: { color: '#53b8ff', emoji: '🏰', tagline: 'Dense borders, famous flags' },
  Asia: { color: '#ff6b5e', emoji: '🏯', tagline: 'Giants, islands and the Stans' },
  Africa: { color: '#ffb547', emoji: '🦁', tagline: '54 countries, endless shapes' },
  Americas: { color: '#3ddc97', emoji: '🗽', tagline: 'From Arctic to Patagonia' },
  Oceania: { color: '#b48cff', emoji: '🏝️', tagline: 'Islands across the Pacific' },
};

export const UNITS: Unit[] = REGIONS.flatMap((region) => {
  const list = COUNTRIES.filter((c) => c.region === region).sort((a, b) => fame(b) - fame(a));
  const chunks: string[][] = [];
  for (let i = 0; i < list.length; i += 6) chunks.push(list.slice(i, i + 6).map((c) => c.id));
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 3) chunks[chunks.length - 2].push(...chunks.pop()!);
  return chunks.map((ids, index) => ({ id: `${region.toLowerCase()}-${index + 1}`, region, index, title: NAMES[index] ?? `Unit ${index + 1}`, ids }));
});
export const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));

export function unitUnlocked(u: Unit, lessons: Record<string, number>) {
  if (u.index === 0) return true;
  const prev = UNITS.find((x) => x.region === u.region && x.index === u.index - 1);
  return !!prev && (lessons[prev.id] ?? 0) > 0;
}

export function nextUnit(lessons: Record<string, number>): Unit {
  // The earliest unfinished unit across regions, preferring the region with most progress.
  const open = UNITS.filter((u) => !lessons[u.id] && unitUnlocked(u, lessons));
  const progress = (r: Region) => UNITS.filter((u) => u.region === r && lessons[u.id]).length;
  return open.sort((a, b) => progress(b.region) - progress(a.region) || a.index - b.index)[0] ?? UNITS[0];
}

/** Countries that would blow up a region's bounding box (overseas parts, antimeridian). */
const NO_FRAME = new Set(['RUS', 'FRA', 'FJI', 'KIR', 'USA', 'TUV', 'NZL', 'NLD']);
/** Ids to frame when zooming the map to a region. */
export function regionFrame(region: string) {
  return COUNTRIES.filter((c) => c.region === region && !NO_FRAME.has(c.id) && !(region === 'Oceania' && c.latlng[1] < 0)).map((c) => c.id);
}
