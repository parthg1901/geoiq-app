/**
 * GeoIQ multiplayer server (Cloudflare Worker).
 * HTTP API + WebSocket routing; live rooms and async challenges each live in their own Durable Object.
 * Protocol: ../../src/lib/mp/protocol.ts
 */
import { MP_PROTOCOL, ROOM_ALPHABET, CHALLENGE_ALPHABET } from '../../src/lib/mp/protocol';
import { Room } from './room';
import { ChallengeStore } from './challenge';
import { SyncVault, VAULT_MAX_BLOB } from './vault';
import { PlayerStore, sha256hex } from './player';
import { PID_ALPHABET, PID_LEN, PID_RE } from '../../src/lib/social/protocol';

export { Room, ChallengeStore, SyncVault, PlayerStore };

export interface Env {
  ROOMS: DurableObjectNamespace;
  CHALLENGES: DurableObjectNamespace;
  VAULTS: DurableObjectNamespace;
  PLAYERS: DurableObjectNamespace;
}

const MAX_BODY = 32 * 1024;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const fail = (status: number, error: string) => json({ error }, status);

/** Re-wrap a DO response so it always carries CORS headers. */
const withCors = (r: Response) => {
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
};

/* ---- light per-IP rate limiting (per isolate; good enough to stop accidents and casual abuse) ---- */
const hits = new Map<string, number[]>();
function limited(ip: string, bucket: string, max: number, windowMs = 60_000) {
  const k = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(k, list);
  if (hits.size > 5000) hits.clear(); // never let the map grow without bound
  return list.length > max;
}

function randomCode(alphabet: string, n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function readJson(req: Request): Promise<unknown | null> {
  const len = Number(req.headers.get('Content-Length') ?? 0);
  if (len > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const VAULT_RE = /^[0-9a-f]{64}$/;
const ROOM_RE = new RegExp(`^[${ROOM_ALPHABET}]{4}$`);
const CHALLENGE_RE = new RegExp(`^GEO-[${CHALLENGE_ALPHABET}]{4}$`);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', 'ABCD', 'ws']
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
    if (parts[0] !== 'api') return fail(404, 'not found');

    try {
      // GET /api/health
      if (parts[1] === 'health' && parts.length === 2) return json({ ok: true, protocol: MP_PROTOCOL });

      // ---------------- rooms ----------------
      if (parts[1] === 'rooms') {
        if (parts.length === 2 && req.method === 'POST') {
          if (limited(ip, 'room', 20)) return fail(429, 'too many rooms, try again in a minute');
          const body = (await readJson(req)) as { dataVersion?: unknown } | null;
          const dataVersion = typeof body?.dataVersion === 'string' ? body.dataVersion.slice(0, 40) : '';
          if (!dataVersion) return fail(400, 'dataVersion required');
          for (let i = 0; i < 12; i++) {
            const code = randomCode(ROOM_ALPHABET, 4);
            const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
            const r = await stub.fetch('https://room/claim', { method: 'POST', body: JSON.stringify({ code, dataVersion }) });
            if (r.ok) return json({ code });
          }
          return fail(503, 'could not allocate a room code');
        }
        const code = (parts[2] ?? '').toUpperCase();
        if (!ROOM_RE.test(code)) return fail(404, 'no such room');
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (parts.length === 3 && req.method === 'GET') return withCors(await stub.fetch('https://room/info'));
        if (parts.length === 4 && parts[3] === 'ws') {
          if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'expected a WebSocket upgrade');
          return stub.fetch(new Request('https://room/ws', req));
        }
        return fail(404, 'not found');
      }

      // ---------------- progress sync ----------------
      // /api/sync/<sha256 of the sync code>: GET (?rev=N), PUT {baseRev, blob}, DELETE
      if (parts[1] === 'sync' && parts.length === 3) {
        const id = parts[2];
        if (!VAULT_RE.test(id)) return fail(404, 'not found');
        if (limited(ip, 'sync', 60)) return fail(429, 'slow down');
        const stub = env.VAULTS.get(env.VAULTS.idFromName(id));
        if (req.method === 'GET') return withCors(await stub.fetch(`https://vault/?rev=${encodeURIComponent(url.searchParams.get('rev') ?? '')}`));
        if (req.method === 'DELETE') return withCors(await stub.fetch('https://vault/', { method: 'DELETE' }));
        if (req.method === 'PUT') {
          if (Number(req.headers.get('Content-Length') ?? 0) > VAULT_MAX_BLOB + 1000) return fail(413, 'too large');
          const text = await req.text();
          if (text.length > VAULT_MAX_BLOB + 1000) return fail(413, 'too large');
          return withCors(await stub.fetch('https://vault/', { method: 'PUT', body: text }));
        }
        return fail(405, 'method not allowed');
      }

      // ---------------- players & friends ----------------
      if (parts[1] === 'players') {
        if (parts.length === 2 && req.method === 'POST') {
          if (limited(ip, 'player-new', 10)) return fail(429, 'slow down');
          const body = (await readJson(req)) as { key?: unknown } | null;
          if (typeof body?.key !== 'string' || !/^[0-9a-f]{32,128}$/.test(body.key)) return fail(400, 'bad key');
          const keyHash = await sha256hex(body.key);
          for (let i = 0; i < 12; i++) {
            const pid = randomCode(PID_ALPHABET, PID_LEN);
            const r = await env.PLAYERS.get(env.PLAYERS.idFromName(pid)).fetch('https://player/_create', { method: 'POST', body: JSON.stringify({ pid, keyHash }) });
            if (r.ok) return json({ pid });
          }
          return fail(503, 'could not allocate a player id');
        }
        const pid = (parts[2] ?? '').toUpperCase();
        if (!PID_RE.test(pid)) return fail(404, 'no such player');
        const stub = env.PLAYERS.get(env.PLAYERS.idFromName(pid));
        if (parts.length === 3 && req.method === 'GET') {
          if (limited(ip, 'player-get', 240)) return fail(429, 'slow down');
          return withCors(await stub.fetch('https://player/card'));
        }
        const action = parts[3];
        if (parts.length === 4 && req.method === 'POST' && ['me', 'board', 'add', 'respond', 'remove'].includes(action)) {
          if (limited(ip, 'player', 120)) return fail(429, 'slow down');
          const body = await readJson(req);
          if (!body || typeof body !== 'object') return fail(400, 'bad request');
          return withCors(await stub.fetch(`https://player/${action}`, { method: 'POST', body: JSON.stringify(body) }));
        }
        return fail(404, 'not found');
      }

      // ---------------- challenges ----------------
      if (parts[1] === 'challenges') {
        if (parts.length === 2 && req.method === 'POST') {
          if (limited(ip, 'challenge', 20)) return fail(429, 'too many challenges, try again in a minute');
          const body = await readJson(req);
          if (!body || typeof body !== 'object') return fail(400, 'bad request');
          for (let i = 0; i < 12; i++) {
            const code = `GEO-${randomCode(CHALLENGE_ALPHABET, 4)}`;
            const stub = env.CHALLENGES.get(env.CHALLENGES.idFromName(code));
            const r = await stub.fetch('https://challenge/create', { method: 'POST', body: JSON.stringify({ code, ...(body as object) }) });
            if (r.status === 409) continue; // code taken
            return withCors(r);
          }
          return fail(503, 'could not allocate a challenge code');
        }
        const code = (parts[2] ?? '').toUpperCase();
        if (!CHALLENGE_RE.test(code)) return fail(404, 'no such challenge');
        const stub = env.CHALLENGES.get(env.CHALLENGES.idFromName(code));
        if (parts.length === 3 && req.method === 'GET') return withCors(await stub.fetch('https://challenge/get'));
        if (parts.length === 4 && parts[3] === 'results' && req.method === 'POST') {
          if (limited(ip, 'result', 60)) return fail(429, 'slow down');
          const body = await readJson(req);
          if (!body) return fail(400, 'bad request');
          return withCors(await stub.fetch('https://challenge/result', { method: 'POST', body: JSON.stringify(body) }));
        }
        return fail(404, 'not found');
      }
      return fail(404, 'not found');
    } catch (e) {
      console.error('unhandled', e);
      return fail(500, 'server error');
    }
  },
} satisfies ExportedHandler<Env>;
