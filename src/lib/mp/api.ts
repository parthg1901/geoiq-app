/** REST calls to the GeoIQ multiplayer server, with timeouts and friendly errors. */
import { MP_DEFAULT_URL, type Challenge, type ChallengeResult, type CreateChallenge, type Phase, type RoomSettings } from './protocol';
import { DATA_VERSION } from './version';

export const MP_URL: string = ((import.meta.env.VITE_MP_URL as string | undefined) ?? MP_DEFAULT_URL).replace(/\/$/, '');
export const wsUrl = (code: string) => `${MP_URL.replace(/^http/, 'ws')}/api/rooms/${encodeURIComponent(code)}/ws`;

export type MpErrorKind = 'offline' | 'notfound' | 'version' | 'server';
export class MpError extends Error {
  kind: MpErrorKind;
  constructor(kind: MpErrorKind, message: string) { super(message); this.kind = kind; }
}

async function req<T>(path: string, init: RequestInit = {}, timeoutMs = 9000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${MP_URL}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new MpError('offline', "Can't reach the game server — check your internet connection and try again.");
  } finally {
    clearTimeout(t);
  }
  if (res.status === 404) throw new MpError('notfound', 'Not found — double-check the code.');
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j?.message ?? j?.error ?? ''; } catch { /* not JSON */ }
    throw new MpError('server', msg || `The game server had a problem (${res.status}). Try again in a moment.`);
  }
  return res.json() as Promise<T>;
}

export interface RoomInfo { code: string; phase: Phase; players: { name: string }[]; settings: RoomSettings; dataVersion: string }

export const createRoom = () => req<{ code: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ dataVersion: DATA_VERSION }) });

/** Look a room up before joining (also checks you're on the same app version). */
export async function getRoom(code: string): Promise<RoomInfo> {
  const r = await req<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`);
  if (r.dataVersion && r.dataVersion !== DATA_VERSION) {
    throw new MpError('version', `This room is on GeoIQ ${r.dataVersion} and you have ${DATA_VERSION}. Everyone needs the same version — update GeoIQ to play together.`);
  }
  return r;
}

export const createChallenge = (body: CreateChallenge) =>
  req<{ code: string; challenge: Challenge }>('/api/challenges', { method: 'POST', body: JSON.stringify(body) });
export const getChallenge = (code: string) => req<Challenge>(`/api/challenges/${encodeURIComponent(code)}`);
export const postChallengeResult = (code: string, result: ChallengeResult) =>
  req<Challenge>(`/api/challenges/${encodeURIComponent(code)}/results`, { method: 'POST', body: JSON.stringify({ result }) });

/** "geo7k2p", "GEO 7K2P", "7k2p" → "GEO-7K2P" */
export function normalizeChallengeCode(s: string) {
  const core = s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^GEO/, '');
  return core ? `GEO-${core}` : '';
}
