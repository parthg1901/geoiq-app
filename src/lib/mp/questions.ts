/**
 * Deterministic multiplayer questions: (topic, seed, rounds) → the identical question list on every
 * device running the same app version. Nothing here may use Math.random — every choice comes from
 * the seeded rng, and all data comes from files bundled in the app.
 */
import { COUNTRIES, fame, loadPhotos, type Country } from '../../data';
import { makeQuestion, eligible, type Question, type Variant } from '../questions';
import { rng as seeded, shuffle } from '../rng';
import { loadPack, loadPackIndex, type PackData, type PackItem, type PackMode } from '../packs';
import { eligible as packEligible, distractors as packDistractors, modeMeta, type PackQuestion } from '../../components/pack/questions';
import { mapIds } from '../../components/pack/PackMap';
import type { Topic } from './protocol';

export type MpQuestion =
  | { kind: 'world'; q: Question }
  | { kind: 'pack'; pack: string; q: PackQuestion };

export interface TopicMeta { topic: Topic; label: string; emoji: string; group: string }

/** World quiz topics and the country-quiz variants each one draws from. */
const WORLD: Record<string, { label: string; emoji: string; variants: Variant[] }> = {
  mix: { label: 'Grand Tour (everything)', emoji: '🧭', variants: ['shape', 'flag', 'map-find', 'capital', 'photo', 'flag-rev', 'map-name', 'arms'] },
  shape: { label: 'Country shapes', emoji: '◆', variants: ['shape'] },
  twist: { label: 'Twisted shapes (rotated)', emoji: '🌀', variants: ['shape-twist'] },
  flag: { label: 'Flags', emoji: '⚑', variants: ['flag', 'flag-rev'] },
  capital: { label: 'Capitals', emoji: '★', variants: ['capital', 'capital-rev'] },
  map: { label: 'Map: find it / name it', emoji: '⌖', variants: ['map-find', 'map-name'] },
  arms: { label: 'Coats of arms', emoji: '🛡️', variants: ['arms'] },
  photo: { label: 'Street Eye photos', emoji: '📸', variants: ['photo'] },
};

export const WORLD_TOPICS: TopicMeta[] = Object.entries(WORLD).map(([k, v]) => ({ topic: `world:${k}`, label: v.label, emoji: v.emoji, group: 'World' }));

const GROUP_LABEL: Record<string, string> = { regions: 'Regions', physical: 'Physical world', history: 'Time machine', culture: 'Languages & scripts' };
let packTopicsP: Promise<TopicMeta[]> | null = null;
/** Every pick-able topic: world modes, then each pack × mode. */
export const loadTopics = () =>
  (packTopicsP ??= loadPackIndex().then((index) => [
    ...WORLD_TOPICS,
    ...index.flatMap((m) => m.modes.map((mode) => ({
      topic: `pack:${m.id}:${mode}`,
      label: `${m.title} · ${modeMeta({ meta: m, items: [] } as unknown as PackData, mode).title}`,
      emoji: m.emoji,
      group: GROUP_LABEL[m.group] ?? m.group,
    }))),
  ]));

const labelCache: Record<string, string> = Object.fromEntries(WORLD_TOPICS.map((t) => [t.topic, `${t.emoji} ${t.label}`]));
loadTopics().then((ts) => ts.forEach((t) => (labelCache[t.topic] = `${t.emoji} ${t.label}`))).catch(() => {});
/** Human label for a topic (pack labels fill in once the pack index has loaded). */
export function topicLabel(topic: Topic) {
  if (labelCache[topic]) return labelCache[topic];
  const [, id, mode] = topic.split(':');
  return id ? `${id}${mode ? ` · ${mode}` : ''}` : topic;
}

export function parseTopic(topic: Topic): { kind: 'world'; mode: string } | { kind: 'pack'; pack: string; mode: PackMode } | null {
  const [kind, a, b] = topic.split(':');
  if (kind === 'world' && WORLD[a]) return { kind: 'world', mode: a };
  if (kind === 'pack' && a && b) return { kind: 'pack', pack: a, mode: b as PackMode };
  return null;
}

/* ---------------- world ---------------- */

/**
 * Seeded, fame-spread picker: split the best-known ~75% of countries into one band per round and
 * pick from each band in turn, so a game ramps from famous to tricky without being all obscure.
 */
async function worldQuestions(mode: string, seed: number, rounds: number): Promise<MpQuestion[]> {
  const r = seeded(seed);
  const variants = WORLD[mode].variants;
  const byFame = [...COUNTRIES].sort((a, b) => fame(b) - fame(a) || a.id.localeCompare(b.id));
  const pool = byFame.slice(0, Math.max(rounds * 4, Math.round(byFame.length * 0.75)));
  const used = new Set<string>();
  const out: MpQuestion[] = [];
  for (let i = 0; i < rounds; i++) {
    const v = variants[Math.floor(r() * variants.length)];
    const lo = Math.floor((i / rounds) * pool.length), hi = Math.max(lo + 1, Math.floor(((i + 1) / rounds) * pool.length));
    const band = shuffle(pool.slice(lo, hi), r);
    // Prefer the band; fall back to the whole pool if nothing in it fits this variant.
    let pick: Country | undefined;
    for (const c of [...band, ...shuffle(pool, r)]) {
      if (used.has(c.id) || !eligible(c, v)) continue;
      if (v === 'photo' && !(await loadPhotos(c.id)).length) continue;
      pick = c; break;
    }
    if (!pick) continue;
    used.add(pick.id);
    const q = makeQuestion(pick.id, v, { choices: 4, r });
    if (v === 'photo') q.photo = Math.floor(r() * 100);
    out.push({ kind: 'world', q });
  }
  return out;
}

/* ---------------- packs ---------------- */

function packQuestions(pack: PackData, mode: PackMode, seed: number, rounds: number): MpQuestion[] {
  const r = seeded(seed);
  const geomIds = mapIds(pack);
  const pool = pack.items.filter((it) => packEligible(pack, it, mode, geomIds)).sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return [];
  // Same famous→tricky ramp as the world picker, using the pack's difficulty.
  const byDiff = [...pool].sort((a, b) => (a.difficulty ?? 0.5) - (b.difficulty ?? 0.5) || a.id.localeCompare(b.id));
  const n = Math.min(rounds, pool.length);
  const chosen: PackItem[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i / n) * byDiff.length), hi = Math.max(lo + 1, Math.floor(((i + 1) / n) * byDiff.length));
    const it = shuffle(byDiff.slice(lo, hi), r).find((x) => !chosen.includes(x)) ?? byDiff.find((x) => !chosen.includes(x));
    if (it) chosen.push(it);
  }
  const wrap = (q: PackQuestion): MpQuestion => ({ kind: 'pack', pack: pack.meta.id, q });
  const inPairs = new Set(chosen.map((x) => x.id)); // "higher" rivals never repeat an item already in the game
  return chosen.map((it) => {
    if (mode === 'find') return wrap({ mode, id: it.id });
    if (mode === 'higher') {
      const label = it.rank!.label;
      const rivals = pool.filter((x) => !inPairs.has(x.id) && x.rank?.label === label && Math.abs(x.rank.value - it.rank!.value) / Math.max(x.rank.value, it.rank!.value) > 0.04)
        .sort((a, b) => Math.abs(a.rank!.value - it.rank!.value) - Math.abs(b.rank!.value - it.rank!.value) || a.id.localeCompare(b.id))
        .slice(0, 6);
      const other = shuffle(rivals, r)[0];
      if (other) inPairs.add(other.id);
      if (!other) return wrap({ mode: 'name', id: it.id, choices: shuffle([it.id, ...packDistractors(pack, it.id, 3, pool, r)], r) });
      const winner = it.rank!.value >= other.rank!.value ? it.id : other.id;
      return wrap({ mode, id: winner, pair: shuffle([it.id, other.id], r) as [string, string] });
    }
    return wrap({ mode, id: it.id, choices: shuffle([it.id, ...packDistractors(pack, it.id, 3, pool, r)], r) });
  });
}

/* ---------------- public ---------------- */

/** The question list for a game. Same inputs → same questions on every device with this app version. */
export async function buildMpQuestions(topic: Topic, seed: number, rounds: number): Promise<MpQuestion[]> {
  const t = parseTopic(topic);
  if (!t) return [];
  if (t.kind === 'world') return worldQuestions(t.mode, seed, rounds);
  const pack = await loadPack(t.pack);
  return pack ? packQuestions(pack, t.mode, seed, rounds) : [];
}

/** Display name of a question's answer (for reveals). */
export async function answerName(q: MpQuestion): Promise<string> {
  if (q.kind === 'world') return COUNTRIES.find((c) => c.id === q.q.id)?.name ?? q.q.id;
  const pack = await loadPack(q.pack);
  return pack?.items.find((x) => x.id === q.q.id)?.name ?? q.q.id;
}
