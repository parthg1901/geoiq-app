/**
 * Friends, friends-only leaderboard and player profiles (client side). See ./protocol.ts.
 * The profile is created on first social use (Friends screen, or joining multiplayer) and its card
 * is republished in the background at most every few minutes while progress changes.
 */
import { create } from 'zustand';
import { useGame, levelFor, type State } from '../store';
import { geoIQ } from '../geoiq';
import { todayKey, addDays } from '../rng';
import { MP_URL } from '../mp/api';
import { weekId, type PlayerCard, type MeView } from './protocol';

export class SocialError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  let res: Response;
  try {
    res = await fetch(`${MP_URL}/api/players${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: ctl.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SocialError("Can't reach the server — check your internet connection.");
  } finally { clearTimeout(t); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new SocialError(res.status === 404 ? (json.error ? cap(json.error) : 'Not found.') : res.status === 429 ? 'Slow down a little and try again.' : cap(json.error ?? `Server problem (${res.status}).`));
  return json as T;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

/** The public card for this player's current progress. */
export function buildCard(s: State, pid: string): PlayerCard {
  const today = todayKey();
  const wk = weekId(today);
  let weekXp = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(today, -i); if (weekId(d) === wk) weekXp += s.days[d]?.xp ?? 0; }
  const logs = Object.values(s.days);
  const answers = logs.reduce((a, d) => a + d.answers, 0);
  const right = logs.reduce((a, d) => a + d.right, 0);
  return {
    pid, name: s.name || 'Explorer',
    iq: geoIQ(s.ratings).iq, level: levelFor(s.xp).level, xp: s.xp,
    streak: s.streak.count, bestStreak: s.streak.best, lastActive: s.streak.last,
    stamps: Object.keys(s.stamps), achievements: Object.keys(s.achievements),
    duel: { rating: s.mp.rating, matches: s.mp.matches, wins: s.mp.wins },
    week: { id: wk, xp: weekXp },
    answers, accuracy: answers ? Math.round((right / answers) * 100) : 0,
    since: s.createdAt, updatedAt: Date.now(),
  };
}
/** This week's XP as seen today (a card from last week counts 0). */
export const weekXp = (c: PlayerCard) => (c.week.id === weekId(todayKey()) ? c.week.xp : 0);

interface SocialState {
  me: MeView | null;
  board: PlayerCard[] | null;
  /** Cards fetched for profile sheets (pid → card). */
  cards: Record<string, PlayerCard>;
  /** Profile sheet currently open. */
  open: string | null;
}
export const useSocial = create<SocialState>(() => ({ me: null, board: null, cards: {}, open: null }));
export const openPlayer = (pid: string) => useSocial.setState({ open: pid });
export const closePlayer = () => useSocial.setState({ open: null });

const auth = () => {
  const s = useGame.getState().social;
  if (!s) throw new SocialError('Create your player profile first.');
  return s;
};

let creating: Promise<string> | null = null;
/** The player's public id, creating the profile (and publishing its card) if needed. */
export function ensureProfile(): Promise<string> {
  const have = useGame.getState().social;
  if (have) return Promise.resolve(have.pid);
  creating ??= (async () => {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    const { pid } = await call<{ pid: string }>('', { key });
    useGame.setState({ social: { pid, key } });
    await publish(true).catch(() => {});
    return pid;
  })().finally(() => { creating = null; });
  return creating;
}

let lastSent = '';
/** Publish the card (if it changed or `force`) and refresh friends + requests. */
export async function publish(force = false): Promise<MeView> {
  const { pid, key } = auth();
  const card = buildCard(useGame.getState(), pid);
  const sig = JSON.stringify({ ...card, updatedAt: 0 });
  const me = await call<MeView>(`/${pid}/me`, force || sig !== lastSent ? { key, card } : { key });
  lastSent = sig;
  useSocial.setState((st) => ({ me, cards: { ...st.cards, [pid]: card } }));
  return me;
}

export async function loadBoard(): Promise<PlayerCard[]> {
  const { pid, key } = auth();
  const { cards } = await call<{ cards: PlayerCard[] }>(`/${pid}/board`, { key });
  useSocial.setState((st) => ({ board: cards, cards: { ...st.cards, ...Object.fromEntries(cards.map((c) => [c.pid, c])) } }));
  return cards;
}

export async function getCard(pid: string, fresh = false): Promise<PlayerCard> {
  const cached = useSocial.getState().cards[pid];
  if (cached && !fresh) return cached;
  const card = await call<PlayerCard>(`/${pid}`);
  useSocial.setState((st) => ({ cards: { ...st.cards, [pid]: card } }));
  return card;
}

async function act(path: string, body: Record<string, unknown>) {
  const { pid, key } = auth();
  const me = await call<MeView>(`/${pid}/${path}`, { key, ...body });
  useSocial.setState({ me });
  void loadBoard().catch(() => {});
  return me;
}
/** via 'code': they shared their friend code → friends right away; 'request': they must accept. */
export const addFriend = (other: string, via: 'code' | 'request') => act('add', { other, via });
export const respond = (other: string, accept: boolean) => act('respond', { other, accept });
export const removeFriend = (other: string) => act('remove', { other });

/** Background publishing: on start, on resume, and a few minutes after progress changes. */
export function initSocial() {
  const tryPublish = () => { if (useGame.getState().social) void publish().catch(() => {}); };
  tryPublish();
  let timer = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryPublish();
    else if (timer) { clearTimeout(timer); timer = 0; tryPublish(); } // leaving with unpublished progress
  });
  useGame.subscribe((s, prev) => {
    if (!s.social || (s.xp === prev.xp && s.name === prev.name && s.stamps === prev.stamps && s.mp === prev.mp)) return;
    if (!timer) timer = window.setTimeout(() => { timer = 0; tryPublish(); }, 180_000);
  });
}
