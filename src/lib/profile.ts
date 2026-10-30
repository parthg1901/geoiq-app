import statsRaw from '../data/stats.json';
import { COUNTRIES, BY_ID, type Country } from '../data';

export interface Profile {
  intro: string;
  sections: Record<string, string>;
  facts: {
    gov: string[]; hos: string[]; hog: string[]; anthem: string | null; drive: string | null;
    gdp: { v: number; year: string } | null; hdi: { v: number; year: string } | null;
    life: { v: number; year: string } | null; gini: { v: number; year: string } | null;
    highest: { name: string; el: number | null } | null; lowest: { name: string; el: number | null } | null;
    timezones: string[]; members: string[];
  };
}

const cache: Record<string, Promise<Profile | null>> = {};
export const loadProfile = (id: string) =>
  (cache[id] ??= fetch(`/data/profiles/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

const STATS = statsRaw as Record<string, { gdp: number | null; hdi: number | null; life: number | null }>;

export type Metric = 'population' | 'area' | 'density' | 'gdp' | 'gdpPc' | 'hdi' | 'life';
export const METRIC_LABEL: Record<Metric, string> = {
  population: 'Population', area: 'Area', density: 'Population density', gdp: 'Economy (GDP)', gdpPc: 'GDP per person', hdi: 'Human development', life: 'Life expectancy',
};

export function metric(c: Country, m: Metric): number | null {
  const s = STATS[c.id];
  switch (m) {
    case 'population': return c.population;
    case 'area': return c.area;
    case 'density': return c.population && c.area ? c.population / c.area : null;
    case 'gdp': return s?.gdp ?? null;
    case 'gdpPc': return s?.gdp && c.population ? s.gdp / c.population : null;
    case 'hdi': return s?.hdi ?? null;
    case 'life': return s?.life ?? null;
  }
}

const rankCache: Partial<Record<Metric, Record<string, { rank: number; of: number }>>> = {};
/** World rank (1 = highest) among countries that have this metric. */
export function rank(id: string, m: Metric) {
  if (!rankCache[m]) {
    const list = COUNTRIES.map((c) => ({ id: c.id, v: metric(c, m) })).filter((x) => x.v != null).sort((a, b) => b.v! - a.v!);
    rankCache[m] = Object.fromEntries(list.map((x, i) => [x.id, { rank: i + 1, of: list.length }]));
  }
  return rankCache[m]![id] ?? null;
}

export const money = (n: number) =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)} trillion` : n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} billion` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)} million` : `$${Math.round(n).toLocaleString()}`;
export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

/** Auto-generated "did you know" lines from the numbers. */
export function trivia(c: Country, p: Profile | null): string[] {
  const out: string[] = [];
  const r = (m: Metric) => rank(c.id, m);
  const pop = r('population'), area = r('area'), dens = r('density');
  if (area && area.rank <= 15) out.push(`It's the ${ordinal(area.rank)} largest country on Earth by area.`);
  if (area && area.rank > area.of - 15) out.push(`It's one of the smallest countries in the world — ${ordinal(area.of - area.rank + 1)} smallest by area.`);
  if (pop && pop.rank <= 15) out.push(`It has the ${ordinal(pop.rank)} biggest population in the world.`);
  if (dens && dens.rank <= 15) out.push(`It's one of the most densely populated countries (${ordinal(dens.rank)} in the world).`);
  if (dens && dens.rank > dens.of - 15) out.push(`It's one of the emptiest countries on Earth — ${ordinal(dens.of - dens.rank + 1)} lowest population density.`);
  if (c.landlocked) out.push(`It's landlocked — no coastline at all.`);
  if (c.borders.length >= 7) out.push(`It shares land borders with ${c.borders.length} countries.`);
  if (!c.borders.length) out.push(`It has no land borders — every neighbour is across the water.`);
  if (c.languages.length >= 3) out.push(`It recognises ${c.languages.length} languages, including ${BY_ID[c.id].languages.slice(0, 3).join(', ')}.`);
  if (p?.facts.drive === 'left') out.push('Traffic drives on the left — a great GeoGuessr clue.');
  if (p?.facts.timezones.length && p.facts.timezones.length >= 3) out.push(`It spans ${p.facts.timezones.length} time zones.`);
  if (p?.facts.highest?.el && p.facts.highest.el > 4500) out.push(`Its highest point, ${p.facts.highest.name}, rises to ${p.facts.highest.el.toLocaleString()} m.`);
  if (p?.facts.lowest?.el != null && p.facts.lowest.el < -20) out.push(`Its lowest point, ${p.facts.lowest.name}, sits ${Math.abs(p.facts.lowest.el)} m below sea level.`);
  const lp = r('life'); if (lp && lp.rank <= 10) out.push(`People here have one of the world's longest life expectancies (${ordinal(lp.rank)}).`);
  const gp = r('gdpPc'); if (gp && gp.rank <= 10) out.push(`It's among the richest countries per person (${ordinal(gp.rank)} by GDP per capita).`);
  return out;
}
