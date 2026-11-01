/**
 * Async challenge (one Durable Object per "GEO-XXXX" code). Stores the challenge spec and everyone's
 * result; deletes itself after CHALLENGE_TTL_DAYS via an alarm.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  GAMES, LIMITS, CHALLENGE_SECONDS, CHALLENGE_TTL_DAYS, cleanName,
  type Challenge, type ChallengeResult, type ChallengeSpec, type GameKind,
} from '../../src/lib/mp/protocol';
import { validTopic, validSources, validSize, limitFor, validReport, scoreOf, isRace } from './validate';
import { PID_RE } from '../../src/lib/social/protocol';
import type { Env } from './index';

const MAX_RESULTS = 50;

export class ChallengeStore extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const existing = await this.ctx.storage.get<Challenge>('c');

    if (path === '/create' && req.method === 'POST') {
      if (existing) return Response.json({ error: 'taken' }, { status: 409 });
      const body = (await req.json()) as { code?: string; spec?: Partial<ChallengeSpec>; result?: unknown };
      const spec = validSpec(body.spec);
      if (!spec || typeof body.code !== 'string') return Response.json({ error: 'invalid challenge' }, { status: 400 });
      const result = validResult(body.result, spec);
      if (!result) return Response.json({ error: 'invalid result' }, { status: 400 });
      const now = Date.now();
      const challenge: Challenge = {
        code: body.code,
        spec,
        creator: { deviceId: result.deviceId, name: result.name },
        createdAt: now,
        expiresAt: now + CHALLENGE_TTL_DAYS * 86_400_000,
        results: [result],
      };
      await this.ctx.storage.put('c', challenge);
      await this.ctx.storage.setAlarm(challenge.expiresAt);
      return Response.json({ code: challenge.code, challenge });
    }

    if (!existing) return Response.json({ error: 'no such challenge (it may have expired)' }, { status: 404 });

    if (path === '/get') return Response.json(existing);

    if (path === '/result' && req.method === 'POST') {
      const body = (await req.json()) as { result?: unknown };
      const result = validResult(body.result, existing.spec);
      if (!result) return Response.json({ error: 'invalid result' }, { status: 400 });
      // First submission per device counts — replays can't improve a score.
      if (existing.results.some((x) => x.deviceId === result.deviceId)) return Response.json(existing);
      if (existing.results.length >= MAX_RESULTS) return Response.json({ error: 'this challenge is full' }, { status: 409 });
      existing.results.push(result);
      existing.results.sort((a, b) => b.score - a.score || a.timeMs - b.timeMs);
      await this.ctx.storage.put('c', existing);
      return Response.json(existing);
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

function validSpec(s: Partial<ChallengeSpec> | undefined): ChallengeSpec | null {
  if (!s || typeof s !== 'object') return null;
  const game = (s.game ?? 'quiz') as GameKind;
  if (!GAMES.includes(game)) return null;
  const { topic, rounds, dataVersion } = s;
  if (!validTopic(topic)) return null;
  // Quizzes need a real round count; race games don't use it (any small integer is accepted).
  const minRounds = isRace(game) ? 0 : LIMITS.minRounds;
  if (!Number.isInteger(rounds) || rounds! < minRounds || rounds! > LIMITS.maxRounds) return null;
  if (typeof dataVersion !== 'string' || !dataVersion || dataVersion.length > 40) return null;
  const seed = Number.isInteger(s.seed) && s.seed! >= 0 && s.seed! <= 0x7fffffff
    ? s.seed!
    : crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  const spec: ChallengeSpec = { topic, rounds: rounds!, seed, dataVersion };
  if (s.game !== undefined) spec.game = game;
  if (isRace(game)) {
    const sources = validSources(s.sources);
    const size = validSize(s.size);
    if (!sources || !size) return null;
    if (game === 'crossword') { spec.sources = sources; spec.size = size; }
    spec.limitSec = limitFor(game, s.limitSec);
  }
  return spec;
}

function validResult(x: unknown, spec: ChallengeSpec): ChallengeResult | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (typeof r.deviceId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(r.deviceId)) return null;
  const name = cleanName(typeof r.name === 'string' ? r.name : '');
  const pid = typeof r.pid === 'string' && PID_RE.test(r.pid) ? r.pid : undefined;
  const game = spec.game ?? 'quiz';

  if (isRace(game)) {
    // Race challenge: the score is recomputed from the report with the player's own time.
    const report = validReport(r.report);
    const limitMs = (spec.limitSec ?? 300) * 1000;
    if (!report || !num(r.timeMs, 0, limitMs * 30)) return null;
    const timeMs = Math.round(r.timeMs as number);
    const finishMs = report.done ? Math.min(timeMs, limitMs) : null;
    return {
      deviceId: r.deviceId, name, pid, score: scoreOf(game, report, finishMs, limitMs),
      correct: report.done ? 1 : 0, total: 1, timeMs, outcomes: [], report, at: Date.now(),
    };
  }

  const rounds = spec.rounds;
  if (!Array.isArray(r.outcomes) || r.outcomes.length !== rounds || !r.outcomes.every((o) => num(o, 0, 1))) return null;
  if (r.total !== rounds) return null;
  if (!num(r.correct, 0, rounds) || !Number.isInteger(r.correct)) return null;
  if (!num(r.score, 0, rounds * 1000)) return null;
  if (!num(r.timeMs, 0, rounds * CHALLENGE_SECONDS * 1000 * 30)) return null; // generous: people get distracted
  return {
    deviceId: r.deviceId,
    name,
    pid,
    score: Math.round(r.score as number),
    correct: r.correct as number,
    total: rounds,
    timeMs: Math.round(r.timeMs as number),
    outcomes: (r.outcomes as number[]).map((o) => Math.round(o * 100) / 100),
    at: Date.now(),
  };
}
