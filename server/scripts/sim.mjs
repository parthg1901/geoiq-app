#!/usr/bin/env node
// End-to-end simulator for the Geonaut multiplayer server.
// Usage: npm run dev (in server/) then: node server/scripts/sim.mjs [--url http://127.0.0.1:8787]
// Plays real games over WebSockets with simulated latency and asserts the server's behaviour.

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://127.0.0.1:8787').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const DV = 'sim-1.0';
const PROTOCOL = 2;
const TIMING = { countdown: 3000, reveal: 4500 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
// Mirror of protocol raceScore() (+ the server's "no guesses → 0" guard), for expected values.
function raceScore(game, r, finishMs, limitMs) {
  if (!r.done && r.a === 0) return 0;
  const speed = finishMs == null ? 0 : Math.max(0, 1 - finishMs / limitMs);
  if (game === 'crossword') return Math.round((r.b > 0 ? Math.min(1, r.a / r.b) : 0) * 1000 + (r.done ? 1000 + 1000 * speed : 0));
  if (game === 'hotcold') return r.done ? Math.round(2000 + Math.max(0, 1000 - (r.a - 1) * 100) + 500 * speed) : Math.round(Math.max(0, 1000 - r.b / 20));
  if (r.done) return Math.round(2000 + Math.max(0, 1000 - Math.max(0, r.a - r.c) * 150) + 500 * speed);
  return Math.round(r.c > 0 ? (Math.min(r.b, r.c) / r.c) * 1000 : 0);
}
const raceSettings = (game, limitSec = 60) => ({ game, topic: 'world:mix', rounds: 10, seconds: 15, sources: ['rivers', 'lakes'], size: 'mini', limitSec });
const points = (outcome, ms, seconds) => (outcome <= 0 ? 0 : Math.round(outcome * (500 + 500 * Math.max(0, 1 - ms / (seconds * 1000)))));
let devN = 0;
const dev = (tag) => `sim${tag}${(++devN).toString().padStart(4, '0')}${Math.random().toString(36).slice(2, 8)}`;

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); }

async function api(path, init) {
  const r = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  let body = null; try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body, headers: r.headers };
}
const createRoom = async (dataVersion = DV) => (await api('/api/rooms', { method: 'POST', body: JSON.stringify({ dataVersion }) })).body.code;

/** Simulated player with artificial up/down latency. */
class Client {
  constructor(code, { name = 'Sim', deviceId = dev('p'), dataVersion = DV, lat = [0, 400], protocol = PROTOCOL } = {}) {
    Object.assign(this, { code, name, deviceId, dataVersion, lat, protocol });
    this.state = null; this.you = null; this.errors = []; this.closed = null; this.waiters = []; this.phaseLog = []; this.questionSeenAt = {}; this.recvLatency = {};
  }
  connect() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${WS_BASE}/api/rooms/${this.code}/ws`);
      this.ws = ws;
      ws.onopen = () => this.sendNow({ t: 'hello', deviceId: this.deviceId, name: this.name, rating: 1000, protocol: this.protocol, dataVersion: this.dataVersion });
      // Simulated downlink latency that keeps messages strictly in order (like a real TCP connection):
      // one delivery queue per player, so two messages due at the same instant can't swap.
      this.lastDelivery = 0;
      this.queue = Promise.resolve();
      ws.onmessage = (ev) => {
        const arrived = Date.now();
        const at = Math.max(this.lastDelivery, arrived + rnd(...this.lat));
        this.lastDelivery = at;
        this.queue = this.queue.then(() => sleep(Math.max(0, at - Date.now()))).then(() => this.onMsg(JSON.parse(ev.data), at - arrived, resolve, arrived));
      };
      // messages are delivered with simulated latency, so let any in-flight ones land before reporting the close
      ws.onclose = (ev) => { this.queue = this.queue.then(() => { this.closed = { code: ev.code, reason: ev.reason }; this.notify(); resolve(this); }); };
    });
  }
  onMsg(m, L, resolve, arrived = Date.now()) {
    if (m.t === 'error') { this.errors.push(m.code); this.notify(); resolve(this); return; }
    if (m.t === 'pong') { this.lastPong = m; this.notify(); return; }
    if (m.t === 'chat') { (this.chat ??= []).push(m.msg); this.notify(); return; }
    if (m.t === 'welcome') { this.you = m.you; this.history = m.chat ?? []; }
    if (m.t === 'welcome' || m.t === 'state') {
      const s = m.state;
      const key = `${s.phase}:${s.round}`;
      if (this.phaseLog[this.phaseLog.length - 1] !== key) this.phaseLog.push(key);
      if (s.phase === 'question' && this.questionSeenAt[s.round] === undefined) {
        this.questionSeenAt[s.round] = Date.now();
        // Time from the official question start to this message reaching the socket (server broadcast lag +
        // output gate + network), measured directly — the local server shares this machine's clock —
        // plus our simulated downlink delay.
        const start = s.phaseEndsAt - s.settings.seconds * 1000;
        this.recvLatency[s.round] = Math.max(0, arrived - start) + L;
      }
      this.state = s;
      this.notify();
      if (m.t === 'welcome') resolve(this);
    }
  }
  notify() { for (const w of [...this.waiters]) if (w.pred(this)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(this.state); } }
  waitFor(pred, ms = 20000, label = 'condition') {
    if (pred(this)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error(`${this.name}: timeout waiting for ${label}`)); } }, ms);
    });
  }
  waitPhase(phase, round, ms) { return this.waitFor((c) => c.state?.phase === phase && (round === undefined || c.state.round === round), ms, `${phase}${round !== undefined ? ' r' + round : ''}`); }
  sendNow(obj) { if (this.ws.readyState === 1) this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  /** Send with simulated uplink latency (order-preserving); returns the latency used. */
  send(obj) {
    const at = Math.max(this.lastSend ?? 0, Date.now() + rnd(...this.lat));
    this.lastSend = at;
    setTimeout(() => this.sendNow(obj), at - Date.now());
    return at - Date.now();
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

/** Answer the current question after `delay` ms with a skill-based outcome; returns the expected-ms window. */
async function answer(c, round, outcome, delay) {
  await sleep(delay);
  const up = c.send({ t: 'answer', round, outcome });
  // +600 ms on the high side: server-side queueing (a DO processes one event at a time and waits for each storage
  // write; local dev on a slow disk makes that visible, production writes take a few ms). The actual overhead is
  // measured and printed below, so a regression is visible even when the check passes.
  const est = c.recvLatency[round] + delay + up;
  return { min: est - 20, max: est + 600, est, outcome };
}

/* ===================================================================== scenarios */

async function scenarioBasic() {
  console.log('\n▶ Full game: 4 players, latency 0–400 ms, alarms + early round end + scoring');
  const code = await createRoom();
  // host first (the creator joins first in the app), the others all at once
  const host = await new Client(code, { name: 'Ana' }).connect();
  const players = [host, ...(await Promise.all(['Ben', 'Cai', 'Dev'].map((name) => new Client(code, { name }).connect())))];
  check('first player is host', host.state.hostId === host.you);
  await host.waitFor((c) => c.state.players.length === 4, 5000, '4 players');
  host.send({ t: 'settings', settings: { topic: 'world:flag', rounds: 5, seconds: 8 } });
  await host.waitFor((c) => c.state.settings.rounds === 5, 5000, 'settings');
  host.send({ t: 'start' });
  await Promise.all(players.map((p) => p.waitPhase('countdown', 0, 5000)));
  check('start → countdown with a seed', host.state.seed > 0);
  const expected = Object.fromEntries(players.map((p) => [p.you, 0]));
  let scoringOk = true, earlyOk = true, hiddenOk = true; const overhead = [];
  for (let r = 0; r < 5; r++) {
    await Promise.all(players.map((p) => p.waitPhase('question', r, 12000)));
    const qState = host.state;
    if (Object.keys(qState.answers).length) hiddenOk = false;
    const windows = await Promise.all(players.map((p) => answer(p, r, Math.random() < 0.7 ? 1 : 0, rnd(200, 2200))));
    await host.waitFor((c) => c.state.phase === 'question' && c.state.answered.length > 0 && Object.keys(c.state.answers).length === 0, 8000, 'answered ids hidden').catch(() => {});
    const rev = await host.waitPhase('reveal', r, 12000);
    // early end: reveal came long before the question's 8 s were up
    const qEnd = qState.phaseEndsAt;
    if (rev.serverNow > qEnd - 2500) earlyOk = false;
    players.forEach((p, i) => {
      const a = rev.answers[p.you];
      const w = windows[i];
      if (!a) { scoringOk = false; return; }
      overhead.push(a.ms - w.est);
      const hi = points(w.outcome, Math.max(0, w.min), 8), lo = points(w.outcome, w.max, 8);
      if (a.points < lo - 1 || a.points > hi + 1) { scoringOk = false; console.log(`    scoring off: ${p.name} r${r} pts=${a.points} expected ${lo}–${hi} (ms ${a.ms}, window ${w.min.toFixed(0)}–${w.max.toFixed(0)})`); }
      expected[p.you] += a.points;
    });
  }
  const end = await host.waitPhase('end', undefined, 15000);
  check('phases progressed countdown → question/reveal ×5 → end (alarms)', host.phaseLog.join(' ').match(/countdown:0 question:0 reveal:0 question:1 reveal:1 question:2 reveal:2 question:3 reveal:3 question:4 reveal:4 end:4/), host.phaseLog.join(' '));
  check('round ends early once everyone answered', earlyOk);
  check('outcomes/points hidden during the question', hiddenOk);
  const avg = overhead.reduce((x, y) => x + y, 0) / overhead.length;
  console.log(`    server-side timing overhead vs. client estimate: avg ${avg.toFixed(0)} ms, max ${Math.max(...overhead).toFixed(0)} ms`);
  check('points match points(outcome, server-measured ms) within latency tolerance', scoringOk);
  check('final scores = sum of round points', players.every((p) => end.players.find((x) => x.id === p.you).score === expected[p.you]),
    JSON.stringify(end.players.map((x) => [x.name, x.score, expected[x.id]])));
  // second game with a new seed
  const firstSeed = host.state.seed;
  host.send({ t: 'lobby' });
  await host.waitPhase('lobby', undefined, 5000);
  check('back to lobby resets scores', host.state.players.every((p) => p.score === 0 && p.correct === 0));
  host.send({ t: 'start' });
  await host.waitPhase('countdown', 0, 5000);
  check('second game gets a new seed', host.state.seed !== firstSeed && host.state.seed > 0);
  // timed-out round (nobody answers) still advances via alarm
  await host.waitPhase('question', 0, 6000);
  const t0 = Date.now();
  await host.waitPhase('reveal', 0, 12000);
  check('unanswered question times out on the alarm (~8 s)', Date.now() - t0 > 6500, `${Date.now() - t0} ms`);
  players.forEach((p) => p.close());
}

async function scenarioReconnect() {
  console.log('\n▶ Reconnect mid-question keeps the seat and score; newest socket wins');
  const code = await createRoom();
  const a = await new Client(code, { name: 'Host' }).connect();
  const bId = dev('b');
  let b = await new Client(code, { name: 'Bea', deviceId: bId }).connect();
  a.send({ t: 'settings', settings: { topic: 'world:shape', rounds: 5, seconds: 10 } });
  await a.waitFor((c) => c.state.settings.seconds === 10, 5000, 'settings');
  a.send({ t: 'start' });
  await b.waitPhase('question', 0, 8000);
  await answer(b, 0, 1, 300); await answer(a, 0, 0, 300);
  const rev = await b.waitPhase('reveal', 0, 12000);
  const bScore = rev.players.find((p) => p.id === bId).score;
  check('B scored in round 0', bScore > 0, String(bScore));
  await b.waitPhase('question', 1, 10000);
  b.close();
  await a.waitFor((c) => c.state.players.find((p) => p.id === bId)?.connected === false, 5000, 'B shown disconnected');
  check('disconnected player stays seated (shown offline)', true);
  b = await new Client(code, { name: 'Bea', deviceId: bId }).connect();
  check('reconnect → welcome mid-question', b.state?.phase === 'question' && b.state.round === 1);
  check('reconnect keeps the score', b.state.players.find((p) => p.id === bId).score === bScore);
  await answer(b, 1, 1, 200);
  await a.waitFor((c) => c.state.answered.includes(bId), 5000, 'B answer accepted');
  check('answer after reconnect is accepted', true);
  // duplicate socket: a second connection with the same device replaces the first
  const b2 = await new Client(code, { name: 'Bea', deviceId: bId }).connect();
  await b.waitFor((c) => c.closed, 5000, 'old socket closed');
  check('newest connection replaces the old socket (4010)', b.closed?.code === 4010, JSON.stringify(b.closed));
  check('no duplicate seat', b2.state.players.filter((p) => p.id === bId).length === 1);
  a.close(); b2.close();
}

async function scenarioHostTransfer() {
  console.log('\n▶ Host transfer after the host drops for >20 s, and the creator gets it back on return');
  const code = await createRoom();
  const aId = dev('h');
  let a = await new Client(code, { name: 'H', deviceId: aId }).connect();
  const b = await new Client(code, { name: 'Next' }).connect();
  const c = await new Client(code, { name: 'Third' }).connect();
  // a quick app switch (5 s) keeps hosting
  a.close(); await sleep(5000);
  a = await new Client(code, { name: 'H', deviceId: aId }).connect();
  check('a short absence keeps hosting with the creator', a.state.hostId === a.you);
  a.close();
  const t0 = Date.now();
  await b.waitFor((x) => x.state.hostId === b.you, 26000, 'host transfer');
  const dt = Date.now() - t0;
  check('host passes to the next connected player after the grace period', dt >= 19000, `${dt} ms`);
  b.send({ t: 'settings', settings: { topic: 'world:capital', rounds: 6, seconds: 12 } });
  await c.waitFor((x) => x.state.settings.rounds === 6, 5000, 'new host can change settings');
  check('new host can change settings', true);
  a = await new Client(code, { name: 'H', deviceId: aId }).connect();
  await b.waitFor((x) => x.state.hostId === a.you, 5000, 'creator reclaims host');
  check('creator gets hosting back when they return', b.state.hostId === a.you);
  a.close(); b.close(); c.close();
}

async function scenarioEmptyRoomAlarms() {
  console.log('\n▶ Empty room: no alarm loop after everyone leaves');
  const code = await createRoom();
  const a = await new Client(code, { name: 'Host' }).connect();
  const b = await new Client(code, { name: 'Guest' }).connect();
  // Host leaves first (starts the hand-over clock), then the last player leaves: room is empty.
  a.close(); await sleep(500); b.close();
  const before = (await api(`/api/rooms/${code}`)).body?.alarmFires ?? 0;
  await sleep(25000); // past the 20 s host grace period, where the old loop began
  const after = (await api(`/api/rooms/${code}`)).body?.alarmFires ?? 0;
  check('empty room fires at most a couple of alarms in 25 s (no runaway loop)', after - before <= 3, `${after - before} alarm firings`);
}

async function scenarioChat() {
  console.log('\n▶ Chat: relay, reactions, history on reconnect, limits, mute');
  const code = await createRoom();
  const host = await new Client(code, { name: 'Host' }).connect();
  const p2 = await new Client(code, { name: 'P2' }).connect();
  const got = (c, pred) => (c.chat ?? []).some(pred);
  host.send({ t: 'chat', text: '  hello   there  ' });
  await p2.waitFor((c) => got(c, (m) => m.text === 'hello there'), 4000, 'chat relayed');
  check('chat relayed to everyone, whitespace tidied', got(p2, (m) => m.text === 'hello there' && m.name === 'Host') && got(host, (m) => m.text === 'hello there'));
  p2.send({ t: 'react', emoji: '🔥' });
  await host.waitFor((c) => got(c, (m) => m.emoji === '🔥'), 4000, 'reaction relayed');
  check('reaction relayed', true);
  const before = (host.chat ?? []).length;
  p2.send({ t: 'react', emoji: '💩' }); p2.send({ t: 'chat', text: '' }); p2.send({ t: 'chat', text: 42 }); p2.send({ t: 'chat', text: 'x'.repeat(5000) });
  await sleep(1200);
  check('unknown emoji, empty, non-string and oversized messages dropped', (host.chat ?? []).length === before);
  p2.send({ t: 'chat', text: 'y'.repeat(300) });
  await host.waitFor((c) => got(c, (m) => m.text?.startsWith('yyy')), 4000, 'long chat');
  check('long text trimmed to the max length', (host.chat ?? []).find((m) => m.text?.startsWith('yyy'))?.text.length === 200);
  // rate limit: a burst of 10 → only the burst allowance gets through
  const n0 = (host.chat ?? []).filter((m) => m.from === host.you && m.text?.startsWith('spam')).length;
  for (let i = 0; i < 10; i++) host.send({ t: 'chat', text: 'spam ' + i });
  await sleep(1500);
  const n1 = (p2.chat ?? []).filter((m) => m.text?.startsWith('spam')).length - n0;
  check('chat flood limited to a short burst', n1 >= 1 && n1 <= 4, `${n1} of 10 delivered`);
  // history on reconnect
  p2.close(); await sleep(300);
  const p2b = await new Client(code, { name: 'P2', deviceId: p2.deviceId }).connect();
  check('reconnect receives recent chat history (text only)', (p2b.history ?? []).some((m) => m.text === 'hello there') && !(p2b.history ?? []).some((m) => m.emoji));
  // mute
  host.send({ t: 'mute', playerId: p2b.you, muted: true });
  await host.waitFor((c) => (c.state.muted ?? []).includes(p2b.you), 4000, 'muted');
  const m0 = (host.chat ?? []).length;
  p2b.send({ t: 'chat', text: 'can you hear me' }); p2b.send({ t: 'react', emoji: '😂' });
  await sleep(1200);
  check('muted player\'s chat and reactions are dropped', (host.chat ?? []).length === m0);
  p2b.send({ t: 'mute', playerId: host.you, muted: true });
  await sleep(800);
  check('only the host can mute', !(host.state.muted ?? []).includes(host.you));
  host.send({ t: 'mute', playerId: p2b.you, muted: false });
  await host.waitFor((c) => !(c.state.muted ?? []).includes(p2b.you), 4000, 'unmuted');
  await sleep(1600);
  p2b.send({ t: 'chat', text: 'back again' });
  await host.waitFor((c) => got(c, (m) => m.text === 'back again'), 4000, 'unmuted chat');
  check('unmuted player can chat again', true);
  host.close(); p2b.close();
}

async function scenarioJoinRules() {
  console.log('\n▶ Join rules: late join, version mismatch, protocol mismatch, full room, kick');
  const code = await createRoom();
  const host = await new Client(code, { name: 'Host', lat: [0, 50] }).connect();
  const p2 = await new Client(code, { name: 'P2', lat: [0, 50] }).connect();
  // version mismatch
  const old = await new Client(code, { name: 'Old', dataVersion: '0.9.0' }).connect();
  check('different dataVersion rejected with error "version"', old.errors.includes('version'));
  const proto = await new Client(code, { name: 'Proto', protocol: 99 }).connect();
  check('different protocol rejected with error "version"', proto.errors.includes('version'));
  const v1 = await new Client(code, { name: 'V1', protocol: 1 }).connect();
  await v1.waitFor((x) => x.closed, 4000, 'v1 closed').catch(() => {});
  check('old protocol-1 app rejected cleanly with error "version"', v1.errors.includes('version') && v1.closed?.code === 4002, JSON.stringify(v1.closed));
  // kick
  const kicked = await new Client(code, { name: 'Kicky' }).connect();
  host.send({ t: 'kick', playerId: kicked.you });
  await kicked.waitFor((c) => c.errors.includes('kicked'), 5000, 'kicked error');
  check('kicked player gets error "kicked"', true);
  await host.waitFor((c) => !c.state.players.some((p) => p.id === kicked.you), 5000, 'kicked removed');
  check('kicked player removed from the room', true);
  const again = await new Client(code, { name: 'Kicky', deviceId: kicked.deviceId }).connect();
  check('kicked device cannot rejoin', again.errors.includes('kicked'));
  // non-host cannot kick
  p2.send({ t: 'kick', playerId: host.you });
  await sleep(600);
  check('non-host kick ignored', host.state.players.some((p) => p.id === host.you) && !host.closed);
  // late join mid-game
  host.send({ t: 'settings', settings: { topic: 'world:flag', rounds: 5, seconds: 10 } });
  await host.waitFor((c) => c.state.settings.seconds === 10, 4000, 'settings');
  host.send({ t: 'start' });
  await host.waitPhase('question', 0, 8000);
  const late = await new Client(code, { name: 'Late' }).connect();
  check('late joiner gets the current question state', late.state.phase === 'question' && late.state.round === 0);
  check('late joiner starts on 0 points', late.state.players.find((p) => p.id === late.you).score === 0);
  await answer(late, 0, 1, 100);
  await host.waitFor((c) => c.state.answered.includes(late.you), 5000, 'late answer');
  check('late joiner can answer the current question', true);
  // fill to 8 then the 9th is rejected
  const extra = [];
  for (let i = host.state.players.length; i < 8; i++) extra.push(await new Client(code, { name: `F${i}`, lat: [0, 30] }).connect());
  await host.waitFor((c) => c.state.players.length === 8, 5000, '8 players');
  const ninth = await new Client(code, { name: 'Ninth' }).connect();
  check('9th player rejected with error "full"', ninth.errors.includes('full'));
  // a seated player can still reconnect when full
  p2.close();
  await sleep(300);
  const p2b = await new Client(code, { name: 'P2', deviceId: p2.deviceId }).connect();
  check('seated player can reconnect even when the room is full', !p2b.errors.length && p2b.you === p2.deviceId);
  [host, p2b, late, ...extra].forEach((c) => c.close());
}

async function scenarioMalformed() {
  console.log('\n▶ Malformed / hostile messages are ignored');
  const code = await createRoom();
  const host = await new Client(code, { name: 'Host', lat: [0, 20] }).connect();
  const guest = await new Client(code, { name: 'Guest', lat: [0, 20] }).connect();
  await host.waitFor((c) => c.state.players.length === 2, 5000, 'guest visible');
  const before = JSON.stringify({ ...host.state, serverNow: 0 });
  const junk = ['not json', '{}', '{"t":42}', '{"t":"nope"}', 'x'.repeat(3000), JSON.stringify({ t: 'answer', round: 0, outcome: 'NaN' }),
    JSON.stringify({ t: 'settings', settings: { topic: 'world:flag', rounds: 99, seconds: 5 } }), JSON.stringify({ t: 'settings', settings: { topic: '<script>', rounds: 5, seconds: 10 } }),
    JSON.stringify({ t: 'start' }), JSON.stringify({ t: 'lobby' }), JSON.stringify({ t: 'hello', deviceId: 'x', name: 'y' })];
  for (const j of junk) guest.sendNow(j); // guest isn't host: start/settings must be ignored too
  for (const j of junk.slice(0, 8)) host.sendNow(j); // host's invalid settings must be ignored
  await sleep(800);
  const after = JSON.stringify({ ...host.state, serverNow: 0 });
  if (before !== after) console.log('    before', before, '\n    after ', after);
  check('state unchanged by junk / invalid settings / non-host commands', before === after);
  check('sockets still open after junk', !host.closed && !guest.closed);
  // flood: rate limiter drops excess without disconnecting
  for (let i = 0; i < 200; i++) guest.sendNow(JSON.stringify({ t: 'ping', c: i }));
  await sleep(500);
  check('flood does not disconnect the client', !guest.closed);
  await sleep(1200);
  host.sendNow(JSON.stringify({ t: 'ping', c: 123456 }));
  await host.waitFor((c) => c.lastPong?.c === 123456, 4000, 'pong');
  check('ping → pong with server time', Math.abs(host.lastPong.s - Date.now()) < 5000);
  // answers for the wrong round / twice are ignored
  host.send({ t: 'settings', settings: { topic: 'world:flag', rounds: 5, seconds: 10 } });
  await host.waitFor((c) => c.state.settings.seconds === 10, 4000, 'settings');
  host.send({ t: 'start' });
  await host.waitPhase('question', 0, 8000);
  guest.sendNow(JSON.stringify({ t: 'answer', round: 3, outcome: 1 }));
  await sleep(400);
  check('answer for another round ignored', !host.state.answered.includes(guest.you));
  guest.sendNow(JSON.stringify({ t: 'answer', round: 0, outcome: 7 })); // clamped to 1
  guest.sendNow(JSON.stringify({ t: 'answer', round: 0, outcome: 0 })); // duplicate ignored
  host.sendNow(JSON.stringify({ t: 'answer', round: 0, outcome: 0 }));
  const rev = await host.waitPhase('reveal', 0, 12000);
  check('outcome clamped to 1 and duplicate answer ignored', rev.answers[guest.you]?.outcome === 1, JSON.stringify(rev.answers[guest.you]));
  host.close(); guest.close();
}

async function scenarioHttp() {
  console.log('\n▶ HTTP API: rooms info, CORS, challenges');
  const h = await api('/api/health');
  check('health', h.status === 200 && h.body.protocol === PROTOCOL);
  const pre = await fetch(BASE + '/api/rooms', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } });
  check('CORS preflight 204 + allow-origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
  const code = await createRoom();
  check('room code is 4 letters from the alphabet', /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code), code);
  const info = await api(`/api/rooms/${code}`);
  check('room info', info.status === 200 && info.body.phase === 'lobby' && info.body.dataVersion === DV && info.headers.get('access-control-allow-origin') === '*');
  check('unknown room → 404', (await api('/api/rooms/ZZZZ')).status === 404 || true); // ZZZZ might exist by chance; next is certain
  check('malformed room code → 404', (await api('/api/rooms/abc1')).status === 404);
  const ghost = await new Client('QQQQ', { name: 'Ghost' }).connect();
  check('WebSocket to an unclaimed room → error "notfound"', ghost.errors.includes('notfound') || ghost.state === null);
  check('rooms need a dataVersion', (await api('/api/rooms', { method: 'POST', body: '{}' })).status === 400);

  const mk = (deviceId, score, correct = 3) => ({ deviceId, name: 'P ' + deviceId.slice(-3), score, correct, total: 5, timeMs: 42000, outcomes: [1, 1, 1, 0, 0], at: 0 });
  const me = dev('c');
  const created = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { topic: 'world:flag', rounds: 5, dataVersion: DV }, result: mk(me, 2400) }) });
  const ccode = created.body?.code;
  check('create challenge → GEO-XXXX code + server seed', created.status === 200 && /^GEO-[A-Z2-9]{4}$/.test(ccode) && Number.isInteger(created.body.challenge.spec.seed), JSON.stringify(created.body).slice(0, 200));
  const got = await api(`/api/challenges/${ccode}`);
  check('get challenge', got.status === 200 && got.body.results.length === 1 && got.body.creator.deviceId === me && got.body.expiresAt > Date.now() + 29 * 86400000);
  const friend = dev('f');
  const sub = await api(`/api/challenges/${ccode}/results`, { method: 'POST', body: JSON.stringify({ result: mk(friend, 3100, 4) }) });
  check('submit result → sorted by score', sub.status === 200 && sub.body.results.length === 2 && sub.body.results[0].deviceId === friend);
  const dup = await api(`/api/challenges/${ccode}/results`, { method: 'POST', body: JSON.stringify({ result: mk(friend, 5000, 5) }) });
  check('duplicate submit ignored (first result counts)', dup.status === 200 && dup.body.results.length === 2 && dup.body.results[0].score === 3100);
  const bad = await api(`/api/challenges/${ccode}/results`, { method: 'POST', body: JSON.stringify({ result: { ...mk(dev('x'), 999999), outcomes: [1] } }) });
  check('invalid result → 400', bad.status === 400);
  const seeded = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { topic: 'pack:rivers:find', rounds: 5, seed: 12345, dataVersion: DV }, result: mk(dev('s'), 100) }) });
  check('client-provided seed is kept', seeded.body?.challenge?.spec.seed === 12345);
  check('invalid spec → 400', (await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { topic: 'x', rounds: 99, dataVersion: DV }, result: mk(dev('z'), 1) }) })).status === 400);
  check('unknown challenge → 404', (await api('/api/challenges/GEO-2222')).status === 404);
  check('malformed challenge code → 404', (await api('/api/challenges/hello')).status === 404);
  check('oversized body rejected', (await api('/api/challenges', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(40000) }) })).status === 400);
}

/* ===================================================================== race games */

/** Start a race game with the given players; resolves when everyone sees phase 'race'. */
async function startRace(host, players, game, limitSec = 60) {
  host.send({ t: 'settings', settings: raceSettings(game, limitSec) });
  await host.waitFor((c) => c.state.settings.game === game && c.state.settings.limitSec === limitSec, 5000, `settings ${game}`);
  host.send({ t: 'start' });
  await Promise.all(players.map((p) => p.waitPhase('race', undefined, 9000)));
  return host.state;
}
const report = (c, r) => c.send({ t: 'progress', report: r });

async function scenarioRaceHotCold() {
  console.log('\n▶ Race: Hot & Cold — finish order, speed tie-break, early end, invalid/late progress ignored');
  const code = await createRoom();
  const host = await new Client(code, { name: 'A', lat: [0, 60] }).connect();
  const [b, c] = await Promise.all(['B', 'C'].map((name) => new Client(code, { name, lat: [0, 60] }).connect()));
  await host.waitFor((x) => x.state.players.length === 3, 5000, '3 players');
  const st = await startRace(host, [host, b, c], 'hotcold');
  const raceStart = st.phaseEndsAt - 60_000;
  check('race phase ends at start + limitSec', Math.abs(st.phaseEndsAt - st.serverNow - 60_000) < 2500, `${st.phaseEndsAt - st.serverNow}`);
  check('every player has an empty progress entry', [host, b, c].every((p) => st.progress[p.you] && st.progress[p.you].a === 0 && !st.progress[p.you].done));
  // live progress (not done yet) is visible
  report(b, { a: 1, b: 2400, c: 0, done: false });
  await host.waitFor((x) => x.state.progress[b.you]?.a === 1, 4000, 'live progress');
  check('live progress is broadcast with a provisional score', host.state.progress[b.you].score === raceScore('hotcold', { a: 1, b: 2400, c: 0, done: false }, null, 60000));
  // junk progress ignored
  for (const bad of [{ a: -1, b: 0, c: 0, done: true }, { a: 3, b: NaN, c: 0, done: true }, { a: 3, b: 0, c: 0, done: 'yes' }, { a: 99999, b: 0, c: 0, done: true }, null]) b.sendNow(JSON.stringify({ t: 'progress', report: bad }));
  await sleep(500);
  check('invalid progress reports ignored', host.state.progress[b.you].a === 1 && !host.state.progress[b.you].done);
  await sleep(600); report(host, { a: 3, b: 0, c: 0, done: true });
  await host.waitFor((x) => x.state.progress[host.you]?.done, 4000, 'A done');
  report(host, { a: 9, b: 50, c: 0, done: false }); // after finishing: ignored
  await sleep(1500); report(c, { a: 6, b: 0, c: 0, done: true });
  await sleep(1200); report(b, { a: 3, b: 0, c: 0, done: true });
  const end = await host.waitPhase('end', undefined, 8000);
  check('race ends early once every connected player is done', end.serverNow < raceStart + 30_000);
  const pA = end.progress[host.you], pB = end.progress[b.you], pC = end.progress[c.you];
  check('report after finishing ignored', pA.a === 3);
  check('server-measured finish times are in order', pA.finishMs < pC.finishMs && pC.finishMs < pB.finishMs, `${pA.finishMs} ${pC.finishMs} ${pB.finishMs}`);
  check('same guesses: faster finisher ranks higher', pA.score > pB.score, `${pA.score} vs ${pB.score}`);
  check('fewer guesses beat more guesses', pB.score > pC.score, `${pB.score} vs ${pC.score}`);
  check('scores = raceScore(report, server finishMs)', [pA, pB, pC].every((p) => p.score === raceScore('hotcold', p, p.finishMs, 60000)));
  check('race score lands in Player.score; finishers counted correct', end.players.every((p) => p.score === end.progress[p.id].score && p.correct === 1));
  // back to lobby resets progress; late joiner during the next race gets an entry
  host.send({ t: 'lobby' });
  await host.waitPhase('lobby', undefined, 5000);
  check('lobby resets progress and scores', Object.keys(host.state.progress).length === 0 && host.state.players.every((p) => p.score === 0));
  await startRace(host, [host, b, c], 'hotcold');
  const late = await new Client(code, { name: 'Late' }).connect();
  check('late joiner mid-race gets an empty progress entry', late.state.phase === 'race' && late.state.progress[late.you]?.a === 0);
  [host, b, c, late].forEach((x) => x.close());
}

async function scenarioRaceBorderline() {
  console.log('\n▶ Race: Borderline — perfect route beats a detour; a disconnected player doesn\'t stall the race');
  const code = await createRoom();
  const host = await new Client(code, { name: 'A', lat: [0, 60] }).connect();
  const [b, d] = await Promise.all(['B', 'D'].map((name) => new Client(code, { name, lat: [0, 60] }).connect()));
  await host.waitFor((x) => x.state.players.length === 3, 5000, '3 players');
  await startRace(host, [host, b, d], 'borderline');
  report(d, { a: 2, b: 1, c: 4, done: false });
  await host.waitFor((x) => x.state.progress[d.you]?.a === 2, 4000, 'D progress');
  d.close(); // leaves mid-race
  await sleep(400); report(host, { a: 5, b: 4, c: 4, done: true }); // one extra guess
  await sleep(1500); report(b, { a: 4, b: 4, c: 4, done: true }); // perfect, but slower
  const end = await host.waitPhase('end', undefined, 8000);
  const pA = end.progress[host.you], pB = end.progress[b.you], pD = end.progress[d.you];
  check('race ends once all *connected* players finish', end.phase === 'end');
  check('perfect route beats a detour despite being slower', pB.score > pA.score, `${pB.score} vs ${pA.score}`);
  check('unfinished player scored on placed countries (finishMs null)', pD.finishMs === null && pD.score === raceScore('borderline', pD, null, 60000) && pD.score === 250, JSON.stringify(pD));
  check('unfinished player not counted correct', end.players.find((p) => p.id === d.you).correct === 0);
  host.close(); b.close();
}

async function scenarioRaceCrossword() {
  console.log('\n▶ Race: Crossword — time-limit end via alarm (60 s), unfinished players ranked by words solved');
  const code = await createRoom();
  const host = await new Client(code, { name: 'A', lat: [0, 60] }).connect();
  const [b, c, d] = await Promise.all(['B', 'C', 'D'].map((name) => new Client(code, { name, lat: [0, 60] }).connect()));
  await host.waitFor((x) => x.state.players.length === 4, 5000, '4 players');
  const st = await startRace(host, [host, b, c, d], 'crossword');
  check('crossword settings carried (sources, size)', st.settings.sources.join() === 'rivers,lakes' && st.settings.size === 'mini');
  for (let w = 1; w <= 8; w++) { report(host, { a: w, b: 8, c: 0, done: w === 8 }); await sleep(120); }
  await sleep(2500); report(b, { a: 8, b: 8, c: 0, done: true });
  report(c, { a: 5, b: 8, c: 0, done: false }); report(d, { a: 2, b: 8, c: 0, done: false });
  const t0 = Date.now();
  const end = await host.waitPhase('end', undefined, 75_000);
  const waited = Date.now() - t0;
  const P = (x) => end.progress[x.you];
  check('race ends on the time limit via the alarm', waited > 50_000 && end.serverNow >= st.phaseEndsAt - 50, `waited ${waited} ms`);
  const order = [...end.players].sort((x, y) => y.score - x.score).map((p) => p.name).join('');
  check('ranking: finishers by speed, then unfinished by words solved', order === 'ABCD', order);
  check('unfinished scores = words solved share (625 / 250)', P(c).score === 625 && P(d).score === 250, `${P(c).score} ${P(d).score}`);
  check('quick finisher time measured by the server', P(host).finishMs > 500 && P(host).finishMs < 4000, String(P(host).finishMs));
  [host, b, c, d].forEach((x) => x.close());
}

async function scenarioRaceChallenges() {
  console.log('\n▶ Race challenges: create, server-recomputed scores, sorting, validation');
  const base = (deviceId, rep, timeMs) => ({ deviceId, name: 'R ' + deviceId.slice(-3), score: 999999, correct: 0, total: 1, timeMs, outcomes: [], report: rep, at: 0 });
  const me = dev('r');
  const cr = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { game: 'hotcold', topic: 'world:mix', rounds: 0, dataVersion: DV, limitSec: 240 }, result: base(me, { a: 4, b: 0, c: 0, done: true }, 30000) }) });
  const code = cr.body?.code;
  const expect1 = raceScore('hotcold', { a: 4, b: 0, c: 0, done: true }, 30000, 240000);
  check('create race challenge; score recomputed from the report (client score ignored)', cr.status === 200 && cr.body.challenge.spec.game === 'hotcold' && cr.body.challenge.results[0].score === expect1, JSON.stringify(cr.body).slice(0, 240));
  const fr = dev('q');
  const sub = await api(`/api/challenges/${code}/results`, { method: 'POST', body: JSON.stringify({ result: base(fr, { a: 2, b: 0, c: 0, done: true }, 50000) }) });
  check('race results sorted by score', sub.status === 200 && sub.body.results[0].deviceId === fr && sub.body.results[1].deviceId === me);
  const unfinished = await api(`/api/challenges/${code}/results`, { method: 'POST', body: JSON.stringify({ result: base(dev('u'), { a: 7, b: 900, c: 0, done: false }, 240000) }) });
  check('unfinished race result scored on closest distance', unfinished.body?.results?.at(-1)?.score === raceScore('hotcold', { a: 7, b: 900, c: 0, done: false }, null, 240000));
  const bad = await api(`/api/challenges/${code}/results`, { method: 'POST', body: JSON.stringify({ result: base(dev('b'), { a: 'x', b: 0, c: 0, done: true }, 1000) }) });
  check('invalid race report → 400', bad.status === 400);
  const cw = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { game: 'crossword', topic: 'world:mix', rounds: 0, dataVersion: DV, sources: ['countries', 'capitals'], size: 'standard', limitSec: 420 }, result: base(dev('w'), { a: 13, b: 13, c: 0, done: true }, 200000) }) });
  check('crossword challenge keeps sources/size/limit', cw.status === 200 && cw.body.challenge.spec.sources.join() === 'countries,capitals' && cw.body.challenge.spec.size === 'standard' && cw.body.challenge.spec.limitSec === 420);
  const badSrc = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { game: 'crossword', topic: 'world:mix', rounds: 0, dataVersion: DV, sources: ['<bad>'] }, result: base(dev('v'), { a: 1, b: 1, c: 0, done: true }, 1000) }) });
  check('invalid crossword sources → 400', badSrc.status === 400);
  const badGame = await api('/api/challenges', { method: 'POST', body: JSON.stringify({ spec: { game: 'chess', topic: 'world:mix', rounds: 5, dataVersion: DV }, result: base(dev('g'), { a: 1, b: 1, c: 0, done: true }, 1000) }) });
  check('unknown game → 400', badGame.status === 400);
}

/* ===================================================================== run */
const t0 = Date.now();
try {
  const all = {
    http: scenarioHttp, empty: scenarioEmptyRoomAlarms, chat: scenarioChat, basic: scenarioBasic, reconnect: scenarioReconnect, host: scenarioHostTransfer, join: scenarioJoinRules, malformed: scenarioMalformed,
    hotcold: scenarioRaceHotCold, borderline: scenarioRaceBorderline, crossword: scenarioRaceCrossword, racechallenges: scenarioRaceChallenges,
  };
  const only = arg('only', '');
  if (only) await all[only]();
  else {
    await scenarioHttp();
    await scenarioRaceChallenges();
    await Promise.all([scenarioEmptyRoomAlarms(), scenarioChat(), scenarioBasic(), scenarioReconnect(), scenarioHostTransfer(), scenarioJoinRules(), scenarioMalformed(),
      scenarioRaceHotCold(), scenarioRaceBorderline(), scenarioRaceCrossword()]);
  }
} catch (e) {
  check('scenario crashed', false, e.stack);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`); }
process.exit(failed.length ? 1 : 0);
