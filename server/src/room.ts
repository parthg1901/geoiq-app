/**
 * Live room (one Durable Object per 4-letter code).
 *
 * - WebSocket Hibernation API: idle rooms are evicted from memory and cost nothing; every bit of
 *   game state is persisted in DO storage so it survives hibernation.
 * - Phases are driven by a single DO alarm (no setTimeout): countdown → question → reveal → … → end
 *   for quizzes, countdown → race → end for race games (crossword / hotcold / borderline).
 * - The server never sees questions. It runs the clock, timestamps answers itself and keeps score.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  MP_PROTOCOL, LIMITS, TIMING, DEFAULT_SETTINGS, points, cleanName, cleanChat, CHAT, REACTIONS,
  type C2S, type S2C, type RoomSettings, type RoomState, type Player, type Phase, type RoundAnswer, type ErrorCode,
  type RaceProgress, type ChatMsg,
} from '../../src/lib/mp/protocol';
import { PID_RE } from '../../src/lib/social/protocol';
import { validSettings, validReport, scoreOf, isRace } from './validate';
import type { Env } from './index';

const MAX_MSG = 2048;
// Long enough to survive a quick app switch on a phone (the old 10 s handed hosting away too eagerly).
const HOST_GRACE_MS = 20_000;
const EMPTY_TTL_MS = 10 * 60_000;
const MAX_AGE_MS = 3 * 60 * 60_000;
const RATE = { capacity: 20, refillPerSec: 10 }; // per-socket token bucket

interface Seat extends Player { joinedAt: number }

interface RoomRecord {
  code: string;
  createdAt: number;
  dataVersion: string;
  phase: Phase;
  hostId: string;
  settings: RoomSettings;
  seed: number;
  round: number;
  phaseEndsAt: number;
  questionStartedAt: number;
  seats: Record<string, Seat>;
  order: string[]; // join order (host transfer, display)
  answers: Record<string, RoundAnswer>; // current round
  progress: Record<string, RaceProgress>; // race games
  raceStartedAt: number;
  blocked: string[];
  emptySince: number | null;
  hostLostAt: number | null;
  /** The room's first host. If hosting was handed over only because they were away, they get it back on return. */
  creatorId?: string;
  hostAutoMoved?: boolean;
  /** How many times the alarm has fired (diagnostics; guards against alarm loops in tests). */
  alarmFires?: number;
  /** Recent chat (last CHAT.history), so reconnecting players see the conversation. */
  chat: ChatMsg[];
  chatSeq: number;
  muted: string[];
}

interface Attachment { pid: string }

export class Room extends DurableObject<Env> {
  private room: RoomRecord | null = null;
  private loaded = false;
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();
  /** Chat limits per player id (not per socket, so reconnecting doesn't reset them). */
  private chatBuckets = new Map<string, { tokens: number; at: number }>();
  private alarmAt: number | null = null; // cached so we don't read storage on every message

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.load());
  }

  private async load() {
    if (this.loaded) return;
    this.room = (await this.ctx.storage.get<RoomRecord>('room')) ?? null;
    if (this.room) { // rooms stored by the v1 server: fill in the v2 fields
      this.room.settings = { ...DEFAULT_SETTINGS, ...this.room.settings };
      this.room.progress ??= {};
      this.room.raceStartedAt ??= 0;
      this.room.chat ??= [];
      this.room.chatSeq ??= 0;
      this.room.muted ??= [];
    }
    this.loaded = true;
  }
  private async save() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  /* ------------------------------------------------------------------ HTTP (from the Worker) */
  async fetch(req: Request): Promise<Response> {
    await this.load();
    const path = new URL(req.url).pathname;

    if (path === '/claim' && req.method === 'POST') {
      if (this.room) return new Response('taken', { status: 409 });
      const { code, dataVersion } = (await req.json()) as { code: string; dataVersion: string };
      const now = Date.now();
      this.room = {
        code, createdAt: now, dataVersion, phase: 'lobby', hostId: '', settings: { ...DEFAULT_SETTINGS },
        seed: 0, round: 0, phaseEndsAt: 0, questionStartedAt: 0, seats: {}, order: [], answers: {},
        progress: {}, raceStartedAt: 0, blocked: [], emptySince: now, hostLostAt: null, chat: [], chatSeq: 0, muted: [],
      };
      await this.save();
      await this.schedule();
      return new Response('ok');
    }

    if (path === '/info') {
      const r = this.room;
      if (!r) return Response.json({ error: 'no such room' }, { status: 404 });
      return Response.json({
        code: r.code, phase: r.phase, settings: r.settings, dataVersion: r.dataVersion,
        players: r.order.map((id) => ({ name: r.seats[id].name })),
        alarmFires: r.alarmFires ?? 0,
      });
    }

    if (path === '/ws') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      if (!this.room) {
        this.sendTo(server, { t: 'error', code: 'notfound', message: 'This room does not exist (or has expired).' });
        server.close(4004, 'notfound');
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  /* ------------------------------------------------------------------ WebSocket events */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.load();
    const r = this.room;
    if (!r) return;
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return; // drop binary / oversized
    if (!this.allow(ws)) return;
    let msg: C2S;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;

    if (msg.t === 'ping') {
      if (typeof msg.c === 'number') this.sendTo(ws, { t: 'pong', c: msg.c, s: Date.now() });
      return;
    }
    if (msg.t === 'hello') return this.onHello(ws, msg);

    const pid = this.pidOf(ws);
    if (!pid || !r.seats[pid]) return; // must say hello first
    const isHost = pid === r.hostId;
    const now = Date.now();

    // Chat is relayed on its own: it never changes game state, so no full-state broadcast.
    if (msg.t === 'chat' || msg.t === 'react') return this.onChat(pid, msg, now);

    switch (msg.t) {
      case 'settings': {
        if (!isHost || r.phase !== 'lobby') return;
        const s = validSettings(msg.settings);
        if (!s) return;
        r.settings = s;
        break;
      }
      case 'start': {
        if (!isHost || r.phase !== 'lobby') return;
        for (const id of r.order) { r.seats[id].score = 0; r.seats[id].correct = 0; }
        r.seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
        r.round = 0;
        r.answers = {};
        r.progress = {};
        r.phase = 'countdown';
        r.phaseEndsAt = now + TIMING.countdown;
        break;
      }
      case 'answer': {
        if (r.phase !== 'question' || msg.round !== r.round || r.answers[pid]) return;
        if (typeof msg.outcome !== 'number' || !Number.isFinite(msg.outcome)) return;
        const outcome = Math.max(0, Math.min(1, msg.outcome));
        const limit = r.settings.seconds * 1000;
        const ms = Math.max(0, Math.min(limit, now - r.questionStartedAt));
        r.answers[pid] = { outcome, ms, points: points(outcome, ms, r.settings.seconds) };
        // Everyone connected has answered → reveal straight away.
        const connected = this.connectedIds();
        if ([...connected].every((id) => r.answers[id])) this.toReveal(now);
        break;
      }
      case 'progress': {
        if (r.phase !== 'race' || !isRace(r.settings.game)) return;
        const report = validReport(msg.report);
        const cur = r.progress[pid];
        if (!report || !cur || cur.done) return; // nothing after finishing
        const limitMs = r.settings.limitSec * 1000;
        const finishMs = report.done ? Math.max(0, Math.min(limitMs, now - r.raceStartedAt)) : null;
        r.progress[pid] = { ...report, finishMs, score: scoreOf(r.settings.game, report, finishMs, limitMs) };
        if (this.allConnectedDone()) this.finishRace();
        break;
      }
      case 'lobby': {
        if (!isHost || r.phase !== 'end') return;
        this.resetToLobby();
        break;
      }
      case 'mute': {
        if (!isHost || typeof msg.playerId !== 'string' || msg.playerId === pid || !r.seats[msg.playerId]) return;
        r.muted = msg.muted ? [...new Set([...r.muted, msg.playerId])] : r.muted.filter((id) => id !== msg.playerId);
        break;
      }
      case 'kick': {
        if (!isHost || typeof msg.playerId !== 'string' || msg.playerId === pid || !r.seats[msg.playerId]) return;
        const target = msg.playerId;
        for (const s of this.socketsOf(target)) {
          this.sendTo(s, { t: 'error', code: 'kicked', message: 'The host removed you from this room.' });
          try { s.close(4003, 'kicked'); } catch { /* already closing */ }
        }
        r.blocked.push(target);
        delete r.seats[target];
        delete r.answers[target];
        delete r.progress[target];
        r.order = r.order.filter((id) => id !== target);
        if (r.phase === 'question' && r.order.length && this.allConnectedAnswered()) this.toReveal(now);
        if (r.phase === 'race' && r.order.length && this.allConnectedDone()) this.finishRace();
        break;
      }
      default:
        return;
    }
    await this.commit();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch { /* already closed */ }
    await this.onGone(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket) {
    await this.load();
    const r = this.room;
    if (!r) return;
    const pid = this.pidOf(ws);
    const now = Date.now();
    const connected = this.connectedIds(ws);
    if (pid && pid === r.hostId && !connected.has(pid)) r.hostLostAt = now;
    if (connected.size === 0) r.emptySince = now;
    // A player leaving mid-question shouldn't stall the round for everyone else.
    if (r.phase === 'question' && connected.size > 0 && [...connected].every((id) => r.answers[id])) this.toReveal(now);
    if (r.phase === 'race' && connected.size > 0 && [...connected].every((id) => r.progress[id]?.done)) this.finishRace();
    await this.commit(ws);
  }

  private async onHello(ws: WebSocket, msg: Extract<C2S, { t: 'hello' }>) {
    const r = this.room!;
    const fail = (code: ErrorCode, message: string) => {
      this.sendTo(ws, { t: 'error', code, message });
      try { ws.close(4000 + ['notfound', 'full', 'version', 'bad', 'started', 'kicked'].indexOf(code), code); } catch { /* closed */ }
    };
    if (this.pidOf(ws)) return; // one hello per socket
    if (typeof msg.deviceId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(msg.deviceId)) return fail('bad', 'Invalid device id.');
    if (msg.protocol !== MP_PROTOCOL) return fail('version', 'Please update GeoIQ to play in this room.');
    if (msg.dataVersion !== r.dataVersion) {
      return fail('version', `This room needs GeoIQ ${r.dataVersion} (you have ${String(msg.dataVersion).slice(0, 20)}). Update so everyone gets the same questions.`);
    }
    const pid = msg.deviceId;
    if (r.blocked.includes(pid)) return fail('kicked', 'The host removed you from this room.');
    const existing = r.seats[pid];
    if (!existing && r.order.length >= LIMITS.maxPlayers) return fail('full', `This room is full (${LIMITS.maxPlayers} players).`);

    // Reconnect from another socket: the newest connection wins.
    for (const old of this.socketsOf(pid)) {
      if (old === ws) continue;
      try { old.close(4010, 'replaced'); } catch { /* closed */ }
    }
    ws.serializeAttachment({ pid } satisfies Attachment);
    const name = cleanName(typeof msg.name === 'string' ? msg.name : '');
    const rating = typeof msg.rating === 'number' && Number.isFinite(msg.rating) ? Math.round(Math.max(0, Math.min(4000, msg.rating))) : 1000;
    const now = Date.now();
    const pub = typeof msg.pid === 'string' && PID_RE.test(msg.pid) ? msg.pid : undefined;
    if (existing) { existing.name = name; existing.rating = rating; existing.pid = pub; }
    else {
      r.seats[pid] = { id: pid, name, score: 0, correct: 0, connected: true, rating, joinedAt: now, pid: pub };
      r.order.push(pid);
    }
    if (r.phase === 'race' && !r.progress[pid]) r.progress[pid] = emptyProgress(); // late joiner
    if (!r.hostId || !r.seats[r.hostId]) r.hostId = pid;
    r.creatorId ??= r.hostId;
    // The creator coming back reclaims hosting that was only moved because they were away.
    if (pid === r.creatorId && r.hostAutoMoved && r.hostId !== pid) { r.hostId = pid; r.hostAutoMoved = false; }
    if (pid === r.hostId) r.hostLostAt = null;
    r.emptySince = null;
    this.sendTo(ws, { t: 'welcome', you: pid, state: this.view(), chat: r.chat });
    await this.commit();
  }

  /* ------------------------------------------------------------------ phases (alarm-driven) */
  async alarm() {
    this.alarmAt = null; // the alarm that just fired is gone
    await this.load();
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    r.alarmFires = (r.alarmFires ?? 0) + 1;
    // Expiry: empty for too long, or simply too old.
    if ((r.emptySince !== null && now - r.emptySince >= EMPTY_TTL_MS) || now - r.createdAt >= MAX_AGE_MS) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4004, 'expired'); } catch { /* closed */ } }
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    // Host transfer after a grace period.
    const connected = this.connectedIds();
    if (r.hostLostAt !== null && now - r.hostLostAt >= HOST_GRACE_MS && !connected.has(r.hostId)) {
      const next = r.order.find((id) => connected.has(id));
      if (next) { r.hostId = next; r.hostLostAt = null; r.hostAutoMoved = true; }
    }
    // Phase transitions. The next phase starts *now* (when it's actually broadcast), not when it was
    // scheduled: alarms can fire a little late, and speed points must count from when players saw it.
    if (r.phaseEndsAt && now >= r.phaseEndsAt - 5) {
      if (r.phase === 'countdown') { if (isRace(r.settings.game)) this.toRace(now); else this.toQuestion(now); }
      else if (r.phase === 'question') this.toReveal(now);
      else if (r.phase === 'reveal') this.afterReveal(now);
      else if (r.phase === 'race') this.finishRace();
    }
    await this.commit();
  }

  private toQuestion(at: number) {
    const r = this.room!;
    r.phase = 'question';
    r.answers = {};
    r.questionStartedAt = at;
    r.phaseEndsAt = at + r.settings.seconds * 1000;
  }

  private toRace(at: number) {
    const r = this.room!;
    r.phase = 'race';
    r.raceStartedAt = at;
    r.phaseEndsAt = at + r.settings.limitSec * 1000;
    r.progress = Object.fromEntries(r.order.map((id) => [id, emptyProgress()]));
  }

  /** End a race: unfinished players are scored on their progress; the race score becomes Player.score. */
  private finishRace() {
    const r = this.room!;
    if (r.phase !== 'race' || !isRace(r.settings.game)) return;
    const game = r.settings.game, limitMs = r.settings.limitSec * 1000;
    for (const id of r.order) {
      const p = (r.progress[id] ??= emptyProgress());
      if (!p.done) p.score = scoreOf(game, p, null, limitMs);
      const seat = r.seats[id];
      seat.score += p.score;
      seat.correct = p.done ? 1 : 0;
    }
    r.phase = 'end';
    r.phaseEndsAt = 0;
  }

  private toReveal(at: number) {
    const r = this.room!;
    if (r.phase !== 'question') return;
    for (const [id, a] of Object.entries(r.answers)) {
      const s = r.seats[id];
      if (!s) continue;
      s.score += a.points;
      if (a.outcome >= 0.6) s.correct++;
    }
    r.phase = 'reveal';
    r.phaseEndsAt = at + TIMING.reveal;
  }

  private afterReveal(at: number) {
    const r = this.room!;
    if (r.round + 1 < r.settings.rounds) {
      r.round++;
      this.toQuestion(at);
    } else {
      r.phase = 'end';
      r.phaseEndsAt = 0;
    }
  }

  private resetToLobby() {
    const r = this.room!;
    r.phase = 'lobby';
    r.phaseEndsAt = 0;
    r.round = 0;
    r.seed = 0;
    r.answers = {};
    r.progress = {};
    for (const id of r.order) { r.seats[id].score = 0; r.seats[id].correct = 0; }
  }

  /** Persist, broadcast and re-arm the alarm. */
  private async commit(closing?: WebSocket) {
    if (!this.room) return;
    await this.save();
    this.broadcast(closing);
    await this.schedule(closing);
  }

  private async schedule(closing?: WebSocket) {
    const r = this.room;
    if (!r) return;
    const times: number[] = [r.createdAt + MAX_AGE_MS];
    if (r.phaseEndsAt) times.push(r.phaseEndsAt);
    // Host hand-over only matters if someone is still here to take over. (Scheduling it for an empty
    // room left a deadline in the past that re-armed the alarm instantly — a runaway loop.)
    const connected = this.connectedIds(closing);
    if (r.hostLostAt !== null && connected.size > 0 && !connected.has(r.hostId)) times.push(r.hostLostAt + HOST_GRACE_MS);
    if (r.emptySince !== null) times.push(r.emptySince + EMPTY_TTL_MS);
    // Safety net: never arm an alarm for a time that has already passed (it would fire immediately and,
    // if the state doesn't change, again and again). Future deadlines keep their exact time.
    const soonest = Math.min(...times);
    const next = soonest <= Date.now() ? Date.now() + 1000 : soonest;
    if (this.alarmAt === null) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt !== next) { await this.ctx.storage.setAlarm(next); this.alarmAt = next; }
  }

  /* ------------------------------------------------------------------ helpers */
  private view(closing?: WebSocket): RoomState {
    const r = this.room!;
    const connected = this.connectedIds(closing);
    const open = r.phase === 'reveal' || r.phase === 'end';
    return {
      code: r.code,
      phase: r.phase,
      hostId: r.hostId,
      settings: r.settings,
      seed: r.seed,
      round: r.round,
      phaseEndsAt: r.phaseEndsAt,
      players: r.order.map((id) => {
        const { joinedAt: _j, ...p } = r.seats[id];
        return { ...p, connected: connected.has(id) };
      }),
      answered: Object.keys(r.answers),
      answers: open ? r.answers : {},
      progress: r.progress,
      muted: r.muted,
      serverNow: Date.now(),
    };
  }

  private broadcast(closing?: WebSocket) {
    const msg: S2C = { t: 'state', state: this.view(closing) };
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing || !this.pidOf(ws)) continue;
      try { ws.send(text); } catch { /* socket gone */ }
    }
  }

  private sendTo(ws: WebSocket, msg: S2C) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  private pidOf(ws: WebSocket): string | null {
    const a = ws.deserializeAttachment() as Attachment | null;
    return a?.pid ?? null;
  }

  private socketsOf(pid: string) {
    return this.ctx.getWebSockets().filter((ws) => this.pidOf(ws) === pid);
  }

  /** Player ids with at least one open socket (optionally ignoring one that's closing). */
  private connectedIds(closing?: WebSocket) {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing || ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const pid = this.pidOf(ws);
      if (pid && this.room?.seats[pid]) ids.add(pid);
    }
    return ids;
  }

  private allConnectedDone() {
    const r = this.room!;
    const c = this.connectedIds();
    return c.size > 0 && [...c].every((id) => r.progress[id]?.done);
  }

  private async onChat(pid: string, msg: Extract<C2S, { t: 'chat' } | { t: 'react' }>, now: number) {
    const r = this.room!;
    if (r.muted.includes(pid)) return; // silently dropped for muted players
    let entry: Omit<ChatMsg, 'id' | 'from' | 'name' | 'at'>;
    if (msg.t === 'chat') {
      const text = typeof msg.text === 'string' ? cleanChat(msg.text) : '';
      if (!text || !this.chatAllow(pid, 'text', now)) return;
      entry = { text };
    } else {
      if (typeof msg.emoji !== 'string' || !(REACTIONS as readonly string[]).includes(msg.emoji) || !this.chatAllow(pid, 'react', now)) return;
      entry = { emoji: msg.emoji };
    }
    const chat: ChatMsg = { id: ++r.chatSeq, from: pid, name: r.seats[pid].name, at: now, ...entry };
    const text = JSON.stringify({ t: 'chat', msg: chat } satisfies S2C);
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.pidOf(ws)) continue;
      try { ws.send(text); } catch { /* socket gone */ }
    }
    // Only text goes into the replayable history; reactions are fire-and-forget.
    if (chat.text) {
      r.chat = [...r.chat, chat].slice(-CHAT.history);
      await this.save();
    }
  }

  private chatAllow(pid: string, kind: 'text' | 'react', now: number) {
    const lim = CHAT[kind];
    const key = `${kind}:${pid}`;
    const b = this.chatBuckets.get(key) ?? { tokens: lim.burst, at: now };
    b.tokens = Math.min(lim.burst, b.tokens + (now - b.at) / lim.everyMs);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.chatBuckets.set(key, b);
    return ok;
  }

  private allConnectedAnswered() {
    const r = this.room!;
    const c = this.connectedIds();
    return c.size > 0 && [...c].every((id) => r.answers[id]);
  }

  /** Token bucket per socket: drop floods without disconnecting honest clients. */
  private allow(ws: WebSocket) {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: RATE.capacity, at: now };
    b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.at) / 1000) * RATE.refillPerSec);
    b.at = now;
    if (b.tokens < 1) { this.buckets.set(ws, b); return false; }
    b.tokens -= 1;
    this.buckets.set(ws, b);
    return true;
  }
}

const emptyProgress = (): RaceProgress => ({ a: 0, b: 0, c: 0, done: false, finishMs: null, score: 0 });
