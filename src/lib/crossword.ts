/**
 * Crossword generator. Takes candidate entries (answer + clue) and builds a classic American-style
 * crossword where every word crosses at least one other and no letters touch accidentally.
 *
 * Greedy construction: the longest word goes in the middle, then each next word is placed where it
 * crosses existing letters (preferring more crossings and a compact layout). Many shuffled attempts
 * are made and the best grid wins (most words, most crossings, least wasted space).
 */

export type Dir = 'across' | 'down';

export interface CwClue {
  text: string;
  /** Optional picture clue: a flag/arms image URL, or a country/pack silhouette. */
  image?: { kind: 'img'; src: string } | { kind: 'shape'; id: string; pack?: string };
}

export interface CwEntry {
  id: string; // unique per source item, e.g. "country:FRA", "rivers:nile"
  answer: string; // A–Z only
  display: string; // "United Kingdom"
  enumeration: string; // "(6,7)"
  clue: CwClue;
  source: string; // source key, for labels/colours
}

export interface PlacedWord extends CwEntry {
  num: number;
  dir: Dir;
  row: number;
  col: number;
}

export interface Crossword {
  w: number;
  h: number;
  /** Solution letter per cell, null = black square. */
  grid: (string | null)[][];
  /** Clue number shown in a cell's corner. */
  nums: (number | null)[][];
  words: PlacedWord[];
}

/** "Côte d'Ivoire" → "COTEDIVOIRE" */
export const toAnswer = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z]/g, '').toUpperCase();

/** "United Kingdom" → "(6,7)", "Guinea-Bissau" → "(6-6)", "Nile" → "(4)" */
export function enumeration(display: string) {
  const words = display.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const parts = words
    .map((w) => w.split('-').map((p) => p.replace(/[^A-Za-z]/g, '').length).filter((n) => n > 0).join('-'))
    .filter(Boolean);
  return `(${parts.join(',')})`;
}

interface Opts { size: number; target: number; rng: () => number; attempts?: number }

interface Layout { cells: Map<string, string>; dirs: Map<string, Set<Dir>>; placed: { e: CwEntry; dir: Dir; row: number; col: number }[]; crossings: number }

const key = (r: number, c: number) => `${r},${c}`;

function fits(L: Layout, word: string, row: number, col: number, dir: Dir, size: number): number {
  const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
  const endR = row + dr * (word.length - 1), endC = col + dc * (word.length - 1);
  if (row < 0 || col < 0 || endR >= size || endC >= size) return -1;
  // the cells just before and after the word must be empty
  if (L.cells.has(key(row - dr, col - dc)) || L.cells.has(key(endR + dr, endC + dc))) return -1;
  let crossings = 0;
  for (let k = 0; k < word.length; k++) {
    const r = row + dr * k, c = col + dc * k;
    const existing = L.cells.get(key(r, c));
    if (existing) {
      if (existing !== word[k]) return -1;
      if (L.dirs.get(key(r, c))?.has(dir)) return -1; // would overlap a word running the same way
      crossings++;
    } else {
      // a new letter may not touch another letter side-on (that would form an unintended word)
      if (dir === 'across' && (L.cells.has(key(r - 1, c)) || L.cells.has(key(r + 1, c)))) return -1;
      if (dir === 'down' && (L.cells.has(key(r, c - 1)) || L.cells.has(key(r, c + 1)))) return -1;
    }
  }
  return crossings;
}

function put(L: Layout, e: CwEntry, row: number, col: number, dir: Dir, crossings: number) {
  const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
  for (let k = 0; k < e.answer.length; k++) {
    const kk = key(row + dr * k, col + dc * k);
    L.cells.set(kk, e.answer[k]);
    if (!L.dirs.has(kk)) L.dirs.set(kk, new Set());
    L.dirs.get(kk)!.add(dir);
  }
  L.placed.push({ e, dir, row, col });
  L.crossings += crossings;
}

function attempt(pool: CwEntry[], { size, target, rng }: Opts): Layout {
  const L: Layout = { cells: new Map(), dirs: new Map(), placed: [], crossings: 0 };
  const first = pool[0];
  put(L, first, Math.floor(size / 2), Math.floor((size - first.answer.length) / 2), 'across', 0);
  const mid = (size - 1) / 2;
  // Several passes: a word that didn't fit early often fits once more letters are on the grid.
  const left = pool.slice(1);
  for (let pass = 0; pass < 3 && L.placed.length < target; pass++) {
   const before = L.placed.length;
   for (const e of left) {
    if (L.placed.length >= target) break;
    if (L.placed.some((p) => p.e === e)) continue;
    let best: { row: number; col: number; dir: Dir; score: number; x: number } | null = null;
    for (const [kk, ch] of L.cells) {
      const [r, c] = kk.split(',').map(Number);
      for (let i = 0; i < e.answer.length; i++) {
        if (e.answer[i] !== ch) continue;
        for (const dir of ['across', 'down'] as Dir[]) {
          const row = dir === 'down' ? r - i : r, col = dir === 'across' ? c - i : c;
          const x = fits(L, e.answer, row, col, dir, size);
          if (x <= 0) continue;
          // prefer more crossings, then positions near the centre, with a little randomness
          const cr = row + (dir === 'down' ? e.answer.length / 2 : 0), cc = col + (dir === 'across' ? e.answer.length / 2 : 0);
          const score = x * 10 - (Math.abs(cr - mid) + Math.abs(cc - mid)) * 0.6 + rng() * 2;
          if (!best || score > best.score) best = { row, col, dir, score, x };
        }
      }
    }
    if (best) put(L, e, best.row, best.col, best.dir, best.x);
   }
   if (L.placed.length === before) break;
  }
  return L;
}

/** Build the best crossword we can from the candidates. Returns null if too few words fit. */
export function generate(candidates: CwEntry[], opts: Opts): Crossword | null {
  const { size, rng } = opts;
  const usable = dedupe(candidates.filter((e) => e.answer.length >= 3 && e.answer.length <= size));
  if (usable.length < 4) return null;
  let best: Layout | null = null, bestScore = -Infinity;
  for (let a = 0; a < (opts.attempts ?? 50); a++) {
    // Long words first gives a strong spine; jitter so attempts differ.
    const pool = shuffle(usable, rng).slice(0, Math.max(opts.target * 6, 60))
      .map((e) => ({ e, k: e.answer.length + rng() * 4 }))
      .sort((x, y) => y.k - x.k).map((x) => x.e);
    const L = attempt(pool, opts);
    const { w, h } = bbox(L);
    const score = L.placed.length * 12 + L.crossings * 4 - w * h * 0.15;
    if (score > bestScore) { bestScore = score; best = L; }
  }
  if (!best || best.placed.length < Math.min(4, opts.target)) return null;
  return finalize(best);
}

function bbox(L: Layout) {
  let r0 = Infinity, c0 = Infinity, r1 = -Infinity, c1 = -Infinity;
  for (const kk of L.cells.keys()) {
    const [r, c] = kk.split(',').map(Number);
    r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c);
  }
  return { r0, c0, w: c1 - c0 + 1, h: r1 - r0 + 1 };
}

function finalize(L: Layout): Crossword {
  const { r0, c0, w, h } = bbox(L);
  const grid: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  for (const [kk, ch] of L.cells) {
    const [r, c] = kk.split(',').map(Number);
    grid[r - r0][c - c0] = ch;
  }
  // Number word starts in reading order (a cell starting both an across and a down shares one number).
  const starts = new Map<string, number>();
  const sorted = [...L.placed].sort((a, b) => a.row - b.row || a.col - b.col);
  let n = 0;
  for (const p of sorted) {
    const kk = key(p.row - r0, p.col - c0);
    if (!starts.has(kk)) starts.set(kk, ++n);
  }
  const nums: (number | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  for (const [kk, num] of starts) { const [r, c] = kk.split(',').map(Number); nums[r][c] = num; }
  const words: PlacedWord[] = L.placed
    .map((p) => ({ ...p.e, dir: p.dir, row: p.row - r0, col: p.col - c0, num: starts.get(key(p.row - r0, p.col - c0))! }))
    .sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));
  return { w, h, grid, nums, words };
}

function dedupe(es: CwEntry[]) {
  const seen = new Set<string>();
  return es.filter((e) => (seen.has(e.answer) ? false : (seen.add(e.answer), true)));
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** Cells (row, col) of a placed word. */
export const wordCells = (w: { row: number; col: number; dir: Dir; answer: string }) =>
  Array.from({ length: w.answer.length }, (_, k) => [w.row + (w.dir === 'down' ? k : 0), w.col + (w.dir === 'across' ? k : 0)] as [number, number]);
