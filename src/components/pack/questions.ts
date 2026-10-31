import type { PackData, PackItem, PackMode } from '../../lib/packs';
import type { PackState } from '../../lib/store';
import { packMastery } from '../../lib/store';
import { shuffle } from '../../lib/rng';
import { itemCentroids, packFeatures } from './PackMap';

export interface PackQuestion {
  mode: PackMode;
  id: string; // answer item
  choices?: string[]; // item ids
  pair?: [string, string]; // for 'higher'
  typed?: boolean;
}

export const MODE_META: Record<PackMode, { title: string; emoji: string; desc: string }> = {
  shape: { title: 'Shapes', emoji: '◆', desc: 'Name it from its silhouette' },
  find: { title: 'Find on map', emoji: '⌖', desc: 'Tap it on the map' },
  name: { title: 'Name it', emoji: '🔦', desc: 'Name the highlighted one' },
  capital: { title: 'Capitals', emoji: '★', desc: 'Match capitals' },
  flag: { title: 'Flags', emoji: '⚑', desc: 'Whose flag is this?' },
  arms: { title: 'Coat of arms', emoji: '🛡️', desc: 'Whose coat of arms?' },
  higher: { title: 'Higher or lower', emoji: '⇅', desc: 'Pick the bigger one' },
};

/** Whether an item can be asked in a given mode. */
export function eligible(pack: PackData, it: PackItem, mode: PackMode, geomIds: Set<string>) {
  switch (mode) {
    case 'shape': return !!pack.shapes?.[it.id];
    case 'capital': return !!it.capital;
    case 'flag': return !!it.flag;
    case 'arms': return !!it.arms;
    case 'higher': return !!it.rank && it.rank.value > 0;
    default: return geomIds.has(it.id);
  }
}

const cent = itemCentroids;

/** Distractors: mostly geographic neighbours (genuinely confusable), plus a same-kind wildcard. */
export function distractors(pack: PackData, id: string, n: number, pool: PackItem[], r: () => number = Math.random): string[] {
  const c = cent(pack);
  const me = c[id];
  const kind = pack.items.find((x) => x.id === id)?.kind;
  const others = pool.filter((x) => x.id !== id);
  const near = me
    ? [...others].filter((x) => c[x.id]).sort((a, b) => dist(c[a.id], me) - dist(c[b.id], me)).slice(0, Math.max(6, n * 2))
    : [];
  const sameKind = shuffle(others.filter((x) => x.kind === kind), r);
  const out: string[] = [];
  for (const x of [...shuffle(near, r).slice(0, n - 1), ...sameKind, ...shuffle(others, r)]) {
    if (out.length >= n) break;
    if (!out.includes(x.id)) out.push(x.id);
  }
  return out;
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 1.2);

/** Build a session: due cards first, then items near your level in this pack, shuffled. */
export function buildSession(pack: PackData, mode: PackMode, ps: PackState | undefined, n = 10, typed = false): PackQuestion[] {
  const geomIds = new Set(packFeatures(pack).items.map((f) => f.id));
  const pool = pack.items.filter((it) => eligible(pack, it, mode, geomIds));
  if (!pool.length) return [];
  const level = 0.2 + packMastery(ps, pack.items.map((i) => i.id)) * 0.8; // target difficulty
  const now = Date.now();
  const scored = pool.map((it) => {
    const card = ps?.cards[`${it.id}:${mode}`];
    const due = card && card.due <= now ? 1.2 : 0;
    const fresh = card ? 0 : 0.3;
    const fit = -Math.abs((it.difficulty ?? 0.5) - level) * 2;
    return { it, s: fit + due + fresh + Math.random() * 1.1 };
  }).sort((a, b) => b.s - a.s);
  const chosen = scored.slice(0, Math.min(n, pool.length)).map((x) => x.it);
  return shuffle(chosen).map((it): PackQuestion => {
    if (mode === 'higher') {
      const label = it.rank!.label;
      const rivals = pool.filter((x) => x.id !== it.id && x.rank?.label === label && Math.abs(x.rank.value - it.rank!.value) / Math.max(x.rank.value, it.rank!.value) > 0.04);
      const near = rivals.sort((a, b) => Math.abs(a.rank!.value - it.rank!.value) - Math.abs(b.rank!.value - it.rank!.value)).slice(0, 6);
      const other = shuffle(near)[0] ?? rivals[0];
      if (!other) return { mode: 'name', id: it.id, choices: shuffle([it.id, ...distractors(pack, it.id, 3, pool)]) };
      const winner = it.rank!.value >= other.rank!.value ? it.id : other.id;
      return { mode, id: winner, pair: shuffle([it.id, other.id]) as [string, string] };
    }
    if (mode === 'find') return { mode, id: it.id };
    if (typed && mode !== 'capital') return { mode, id: it.id, typed: true };
    return { mode, id: it.id, choices: shuffle([it.id, ...distractors(pack, it.id, 3, pool)]) };
  });
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^the /, '').replace(/[^a-z0-9]/g, '');
/** Match free text against item names + alternatives (forgiving: case, accents, punctuation, "the"). */
export function matchItem(items: PackItem[], q: string): PackItem | null {
  const k = norm(q);
  if (!k) return null;
  return items.find((it) => [it.name, ...(it.alt ?? [])].some((n) => norm(n) === k)) ?? null;
}
export function searchItems(items: PackItem[], q: string, limit = 5): PackItem[] {
  const k = norm(q);
  if (!k) return [];
  const scored: { it: PackItem; s: number }[] = [];
  for (const it of items) {
    let best = Infinity;
    for (const n of [it.name, ...(it.alt ?? [])]) { const i = norm(n).indexOf(k); if (i >= 0) best = Math.min(best, (i === 0 ? 0 : 10) + n.length / 100); }
    if (best < Infinity) scored.push({ it, s: best });
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.it);
}

/** The most common item kind in a pack ("state", "river"…), for generic copy. */
export function mainKind(pack: PackData): string {
  const n: Record<string, number> = {};
  for (const it of pack.items) if (it.kind) n[it.kind] = (n[it.kind] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'place';
}
