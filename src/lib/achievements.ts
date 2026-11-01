import { useGame, mastery, levelFor } from './store';
import { iqScore } from './iq';
import { COUNTRIES, REGIONS } from '../data';

export interface Achievement { id: string; name: string; desc: string; icon: string; test: (s: ReturnType<typeof useGame.getState>, ctx: Ctx) => boolean }
export interface Ctx { perfect?: boolean; combo?: number; mode?: string; score?: number; total?: number }

/** Rough pack mastery from stored cards alone (best box per item over items seen, scaled by plays). */
function packAvg(p: { cards: Record<string, { box: number }> }) {
  const best: Record<string, number> = {};
  for (const [k, c] of Object.entries(p.cards)) { const id = k.slice(0, k.lastIndexOf(':')); best[id] = Math.max(best[id] ?? 0, Math.min(4, c.box) / 4); }
  const v = Object.values(best);
  return v.length >= 8 ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

const regionDone = (s: ReturnType<typeof useGame.getState>, r: string, th = 0.75) =>
  COUNTRIES.filter((c) => c.region === r).every((c) => mastery(s.cards, c.id) >= th);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', name: 'First Steps', desc: 'Answer your first question', icon: '👣', test: (s) => s.xp > 0 },
  { id: 'combo10', name: 'On Fire', desc: '10-answer combo', icon: '🔥', test: (_, c) => (c.combo ?? 0) >= 10 },
  { id: 'combo25', name: 'Unstoppable', desc: '25-answer combo', icon: '☄️', test: (_, c) => (c.combo ?? 0) >= 25 },
  { id: 'perfect', name: 'Flawless', desc: 'Perfect session (10+ questions)', icon: '💎', test: (_, c) => !!c.perfect && (c.total ?? 0) >= 10 },
  { id: 'streak3', name: 'Habit Forming', desc: '3-day streak', icon: '📅', test: (s) => s.streak.count >= 3 },
  { id: 'streak7', name: 'Week Warrior', desc: '7-day streak', icon: '🗓️', test: (s) => s.streak.count >= 7 },
  { id: 'streak30', name: 'Globetrotter', desc: '30-day streak', icon: '✈️', test: (s) => s.streak.count >= 30 },
  { id: 'stamps10', name: 'Frequent Flyer', desc: 'Collect 10 passport stamps', icon: '🛂', test: (s) => Object.keys(s.stamps).length >= 10 },
  { id: 'stamps50', name: 'Diplomat', desc: 'Collect 50 passport stamps', icon: '🎖️', test: (s) => Object.keys(s.stamps).length >= 50 },
  { id: 'stamps197', name: 'Citizen of Earth', desc: 'Stamp every country', icon: '🌍', test: (s) => Object.keys(s.stamps).length >= COUNTRIES.length },
  ...REGIONS.map((r) => ({ id: `region-${r}`, name: `${r} Master`, desc: `Master every country in ${r}`, icon: { Europe: '🏰', Asia: '🏯', Africa: '🦁', Americas: '🗽', Oceania: '🏝️' }[r]!, test: (s: ReturnType<typeof useGame.getState>) => regionDone(s, r) })),
  { id: 'iq115', name: 'Navigator', desc: 'Reach IQ 116', icon: '⚓', test: (s) => !iqScore(s.ratings).provisional && iqScore(s.ratings).iq >= 116 },
  { id: 'iq130', name: 'Cartographer', desc: 'Reach IQ 130', icon: '🗺️', test: (s) => !iqScore(s.ratings).provisional && iqScore(s.ratings).iq >= 130 },
  { id: 'iq145', name: 'Atlas', desc: 'Reach IQ 145', icon: '🌐', test: (s) => !iqScore(s.ratings).provisional && iqScore(s.ratings).iq >= 145 },
  { id: 'test', name: 'Measured', desc: 'Take the IQ Test', icon: '🧠', test: (s) => s.tests.length > 0 },
  { id: 'daily7', name: 'Daily Devotee', desc: 'Finish 7 Daily Challenges', icon: '☀️', test: (s) => Object.keys(s.daily).length >= 7 },
  { id: 'rush20', name: 'Speed Demon', desc: '20+ in a Shape Rush', icon: '⚡', test: (s) => (s.bests['rush'] ?? 0) >= 20 },
  { id: 'cw-first', name: 'Cruciverbalist', desc: 'Finish a crossword', icon: '🧩', test: (s) => (s.counters['cwDone'] ?? 0) > 0 },
  { id: 'mp-first', name: 'Game Night', desc: 'Finish a live multiplayer game', icon: '🎮', test: (s) => (s.counters['mpGames'] ?? 0) > 0 },
  { id: 'mp-win', name: 'Champion', desc: 'Win a live game against at least one other player', icon: '🏆', test: (s) => (s.counters['mpWins'] ?? 0) > 0 },
  { id: 'mp-challenge', name: 'Challenge Accepted', desc: 'Complete a challenge someone else made', icon: '🎯', test: (s) => (s.counters['mpChallengeDone'] ?? 0) > 0 },
  { id: 'cw-clean', name: 'Clean Sheet', desc: 'Finish a Standard or Big crossword without reveals', icon: '✒️', test: (s) => (s.counters['cwClean'] ?? 0) > 0 },
  { id: 'border', name: 'Border Runner', desc: 'Solve a Borderline route perfectly', icon: '🛤️', test: (s) => (s.counters['borderPerfect'] ?? 0) > 0 },
  { id: 'hotcold', name: 'Heat Seeker', desc: 'Find the mystery country in ≤ 4 guesses', icon: '🌡️', test: (s) => (s.bests['hotcold'] ?? 99) <= 4 },
  { id: 'lvl10', name: 'Seasoned', desc: 'Reach level 10', icon: '⭐', test: (s) => levelFor(s.xp).level >= 10 },
  { id: 'photo25', name: 'Street Smart', desc: '25 correct Street Eye answers', icon: '📸', test: (s) => (s.counters['photoRight'] ?? 0) >= 25 },
  { id: 'pack1', name: 'Explorer at Large', desc: 'Finish your first pack round', icon: '🧭', test: (s) => (s.counters['packRounds'] ?? 0) >= 1 },
  { id: 'nameall', name: 'Total Recall', desc: 'Name every item in a pack', icon: '🧠', test: (s) => (s.counters['nameAll'] ?? 0) >= 1 },
  { id: 'packs3', name: 'Specialist', desc: 'Master 3 packs to 50%', icon: '🎓', test: (s) => Object.values(s.packs ?? {}).filter((p) => packAvg(p) >= 0.5).length >= 3 },
  { id: 'rivers', name: 'River Runner', desc: 'Name every river in the Rivers pack', icon: '🏞️', test: (s) => (s.packs?.['rivers']?.best.allTime ?? null) != null },
  { id: 'twist', name: 'Twisted', desc: 'Name 10 rotated shapes', icon: '🌀', test: (s) => (s.counters['twistRight'] ?? 0) >= 10 },
];

/** Returns achievements newly unlocked by the current state. */
export function checkAchievements(ctx: Ctx = {}): Achievement[] {
  const s = useGame.getState();
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) if (!s.achievements[a.id] && a.test(s, ctx) && s.unlock(a.id)) out.push(a);
  return out;
}
