import { useGame, mastery, levelFor } from './store';
import { geoIQ } from './geoiq';
import { COUNTRIES, REGIONS } from '../data';

export interface Achievement { id: string; name: string; desc: string; icon: string; test: (s: ReturnType<typeof useGame.getState>, ctx: Ctx) => boolean }
export interface Ctx { perfect?: boolean; combo?: number; mode?: string; score?: number; total?: number }

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
  { id: 'iq115', name: 'Navigator', desc: 'Reach GeoIQ 116', icon: '⚓', test: (s) => !geoIQ(s.ratings).provisional && geoIQ(s.ratings).iq >= 116 },
  { id: 'iq130', name: 'Cartographer', desc: 'Reach GeoIQ 130', icon: '🗺️', test: (s) => !geoIQ(s.ratings).provisional && geoIQ(s.ratings).iq >= 130 },
  { id: 'iq145', name: 'Atlas', desc: 'Reach GeoIQ 145', icon: '🌐', test: (s) => !geoIQ(s.ratings).provisional && geoIQ(s.ratings).iq >= 145 },
  { id: 'test', name: 'Measured', desc: 'Take the GeoIQ Test', icon: '🧠', test: (s) => s.tests.length > 0 },
  { id: 'daily7', name: 'Daily Devotee', desc: 'Finish 7 Daily Challenges', icon: '☀️', test: (s) => Object.keys(s.daily).length >= 7 },
  { id: 'rush20', name: 'Speed Demon', desc: '20+ in a Shape Rush', icon: '⚡', test: (s) => (s.bests['rush'] ?? 0) >= 20 },
  { id: 'border', name: 'Border Runner', desc: 'Solve a Borderline route perfectly', icon: '🛤️', test: (s) => (s.counters['borderPerfect'] ?? 0) > 0 },
  { id: 'hotcold', name: 'Heat Seeker', desc: 'Find the mystery country in ≤ 4 guesses', icon: '🌡️', test: (s) => (s.bests['hotcold'] ?? 99) <= 4 },
  { id: 'lvl10', name: 'Seasoned', desc: 'Reach level 10', icon: '⭐', test: (s) => levelFor(s.xp).level >= 10 },
  { id: 'photo25', name: 'Street Smart', desc: '25 correct Street Eye answers', icon: '📸', test: (s) => (s.counters['photoRight'] ?? 0) >= 25 },
  { id: 'twist', name: 'Twisted', desc: 'Name 10 rotated shapes', icon: '🌀', test: (s) => (s.counters['twistRight'] ?? 0) >= 10 },
];

/** Returns achievements newly unlocked by the current state. */
export function checkAchievements(ctx: Ctx = {}): Achievement[] {
  const s = useGame.getState();
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) if (!s.achievements[a.id] && a.test(s, ctx) && s.unlock(a.id)) out.push(a);
  return out;
}
