/**
 * Content packs: everything beyond the 197 countries — regions inside countries (US states, Indian
 * states…), physical geography (rivers, seas, mountains, peaks) and historical world maps.
 *
 * Data contract (written by scripts/packs/*.mjs, read by the app):
 *
 *   public/data/packs/index-{regions|physical|history|culture}.json   → PackMeta[]  (one file per group)
 *   public/data/packs/{packId}.json                            → PackData
 *
 * Pack progress is stored separately from the world GeoIQ (see useGame().packs), so packs add XP,
 * streak days and achievements but never distort the country-based GeoIQ score.
 */

export type PackGroup = 'regions' | 'physical' | 'history' | 'culture';

export interface PackMeta {
  id: string; // e.g. "us-states", "rivers", "h1914"
  group: PackGroup;
  title: string; // "US States"
  subtitle: string; // "50 states + DC"
  emoji: string; // "🇺🇸" or "🏞️"
  color: string; // accent hex
  count: number; // number of quizzable items
  /** Which question types make sense for this pack (UI only offers these). */
  modes: PackMode[];
  /** Optional ordering hint within its group (lower first). */
  order?: number;
  /**
   * How items appear on the map. 'own' (default): each item has its own geometry in `topo`.
   * 'countries': items are sets of today's countries (`PackItem.regions`, ISO3) drawn on the standard
   * world map — e.g. a language spoken in several countries. Items may overlap (English & French in
   * Canada): a tap on a country counts for every item that includes it.
   */
  map?: 'own' | 'countries';
}

/**
 * shape    – silhouette → name                (polygon items with `shapes[id]`)
 * find     – "tap X on the map"               (any geometry)
 * name     – highlighted on the map → name    (any geometry)
 * capital  – item → its capital (choices)      (items with `capital`)
 * flag     – flag image → name                 (items with `flag`)
 * arms     – coat of arms image → name         (items with `arms`)
 * higher   – "which is higher/longer/bigger?"  (items with numeric `rank.value`)
 * sample   – a text sample → name               (items with `sample`), e.g. "which language is this?"
 * For map: 'countries' packs, find = "tap a country where it's spoken/used" (any of `regions` is right)
 * and name = all of the item's countries highlighted → name it.
 */
export type PackMode = 'shape' | 'find' | 'name' | 'capital' | 'flag' | 'arms' | 'higher' | 'sample';

export interface PackItem {
  id: string; // unique within the pack, URL-safe (e.g. "US-CA", "nile", "1914-austria-hungary")
  name: string;
  alt?: string[]; // accepted alternative answers / spellings
  kind?: string; // "state", "province", "union territory", "river", "sea", "gulf", "range", "desert", "peak", "empire"…
  capital?: string;
  population?: number;
  area?: number; // km²
  flag?: string; // URL path under /data/packs/img/… (svg/png)
  arms?: string; // URL path under /data/packs/img/…
  /** Numeric attribute for "higher" questions + display, e.g. { label: 'Length', value: 6650, unit: 'km' } */
  rank?: { label: string; value: number; unit: string };
  /** Short label/value facts shown on the reveal card, e.g. [["Countries", "Egypt, Sudan, …"]] */
  facts?: [string, string][];
  blurb?: string; // 1–3 sentences (e.g. Wikipedia summary), shown after answering
  wiki?: string; // Wikipedia article title for "read more"
  /** Difficulty 0 (famous) … 1 (obscure); drives question ordering. */
  difficulty?: number;
  /** map: 'countries' packs — ISO3 codes (as in src/data countries) where this item applies. */
  regions?: string[];
  /** A text sample to identify (Languages: UDHR Article 1; Scripts: a phrase in that script). */
  sample?: { text: string; dir?: 'ltr' | 'rtl'; lang?: string; source?: string };
  /** Telltale features shown after answering, e.g. ["ő and ű (double acute accents)", "words end in -ság/-ség"]. */
  tells?: string[];
}

export interface PackProjection {
  /** d3-geo projection to frame the pack. 'albersUsa' handles Alaska/Hawaii insets. */
  type: 'albersUsa' | 'mercator' | 'conicEqualArea' | 'naturalEarth1' | 'equirectangular' | 'azimuthalEqualArea';
  rotate?: [number, number] | [number, number, number];
  parallels?: [number, number];
  center?: [number, number];
}

export interface PackData {
  meta: PackMeta;
  projection: PackProjection;
  /** TopoJSON with an object named "items"; each geometry's `id` = PackItem.id. Polygons, lines or points.
   *  Omitted for map: 'countries' packs (they use the standard world map). */
  topo?: unknown;
  /** Optional non-interactive context (neighbouring land, world land) — TopoJSON with object "base". */
  base?: unknown;
  items: PackItem[];
  /** Pre-projected silhouettes in a 200×200 box (SVG path d), for 'shape' questions. */
  shapes?: Record<string, string>;
  attribution: string;
}

const GROUPS: PackGroup[] = ['regions', 'physical', 'history', 'culture'];

let indexP: Promise<PackMeta[]> | null = null;
/** All available packs (missing group files are simply skipped). */
export const loadPackIndex = () =>
  (indexP ??= Promise.all(
    GROUPS.map((g) => fetch(`/data/packs/index-${g}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])),
  ).then((lists) => (lists as PackMeta[][]).flat().sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || (a.order ?? 99) - (b.order ?? 99))));

const packCache: Record<string, Promise<PackData | null>> = {};
export const loadPack = (id: string) =>
  (packCache[id] ??= fetch(`/data/packs/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

export const GROUP_META: Record<PackGroup, { title: string; blurb: string; emoji: string }> = {
  regions: { title: 'Regions', blurb: 'States and provinces inside big countries', emoji: '🗺️' },
  physical: { title: 'Physical world', blurb: 'Rivers, seas, mountains and peaks', emoji: '🏔️' },
  history: { title: 'Time machine', blurb: 'The world map as it once was', emoji: '⏳' },
  culture: { title: 'Languages & scripts', blurb: 'Read the signs: which language, which alphabet', emoji: '🗣️' },
};
