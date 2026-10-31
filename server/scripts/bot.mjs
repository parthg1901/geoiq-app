#!/usr/bin/env node
// GeoIQ bot player — joins (or creates) a live room and plays like a human of a given skill.
//
//   node server/scripts/bot.mjs --room ABCD                      # join your room
//   node server/scripts/bot.mjs --create --topic world:flag      # create a room, print its code, wait for you
//
// Options:
//   --url <base>          server (default https://play.geoiq.workers.dev; local: http://127.0.0.1:8787)
//   --room <CODE>         join this room            --create        create a room instead (bot is host)
//   --name <name>         default "Atlas Bot"       --skill <0..1>  chance of answering right (default 0.7)
//   --quiet               no chat messages or reactions (by default the bot says gl/gg and reacts sometimes)
//   --game <kind>         quiz (default) | crossword | hotcold | borderline   (with --create)
//   --topic <topic>       quiz: e.g. world:mix, world:flag, pack:us-states:shape   (with --create)
//   --rounds <n>          quiz: 5–20 (default 10)   --seconds <n>   quiz: 8–30 (default 15)
//   --sources <a,b>       crossword: CW source keys (default: random mix)   --size mini|standard
//   --limit <sec>         race games: time limit (default per game)
//   --route-len <n>       borderline: shortest route length the bot assumes (default random 3–6)
//   --start-after <n>     host only: start automatically once n players (incl. the bot) are in
//   --data-version <v>    must match the app's (default: version in the repo's package.json)
// While running (when the bot is host) type: start | lobby | quit
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const repoVersion = () => { try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')).version; } catch { return '0.0.0'; } };

const BASE = arg('url', 'https://play.geoiq.workers.dev').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const NAME = arg('name', 'Atlas Bot');
const SKILL = Math.max(0, Math.min(1, Number(arg('skill', '0.7'))));
const DATA_VERSION = arg('data-version', repoVersion());
const START_AFTER = Number(arg('start-after', '0'));
const QUIET = process.argv.includes('--quiet'); // no chat or reactions
const DEVICE = `bot${Math.random().toString(36).slice(2, 12)}`;
const PROTOCOL = 2;
const RACE_DEFAULT_SEC = { crossword: 420, hotcold: 240, borderline: 180 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const t = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${t()}]`, ...a);

let code = (arg('room', '') || '').toUpperCase();
let ws = null, state = null, you = null, stopped = false, backoff = 1000;
let answeredRound = -1, lastPhaseKey = '', racingSeed = 0;

async function main() {
  if (flag('create')) {
    const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataVersion: DATA_VERSION }) });
    if (!r.ok) { log('could not create a room:', r.status, await r.text()); process.exit(1); }
    code = (await r.json()).code;
    log(`created room ${code} — join it in the app with this code (data version ${DATA_VERSION})`);
  }
  if (!/^[A-Z]{4}$/.test(code)) { console.log('usage: --room ABCD  or  --create   (see the header of this file)'); process.exit(1); }
  connect();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'start') send({ t: 'start' });
    else if (cmd === 'lobby') send({ t: 'lobby' });
    else if (cmd === 'quit') { stopped = true; ws?.close(); process.exit(0); }
  });
}

function connect() {
  ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws`);
  ws.onopen = () => { backoff = 1000; send({ t: 'hello', deviceId: DEVICE, name: NAME, rating: Math.round(800 + SKILL * 600), protocol: PROTOCOL, dataVersion: DATA_VERSION }); };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = async (ev) => {
    if (stopped) return;
    log(`connection closed (${ev.code}${ev.reason ? ' ' + ev.reason : ''}) — reconnecting in ${backoff / 1000}s`);
    await sleep(backoff);
    backoff = Math.min(30000, backoff * 2);
    connect();
  };
}
const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const say = (text) => { if (!QUIET) { send({ t: 'chat', text }); log(`💬 me: ${text}`); } };
const react = (emoji) => { if (!QUIET) send({ t: 'react', emoji }); };
setInterval(() => send({ t: 'ping', c: Date.now() }), 20000);

function onMessage(m) {
  if (m.t === 'error') {
    log(`server says: ${m.message} (${m.code})`);
    if (['version', 'full', 'kicked', 'notfound'].includes(m.code)) { stopped = true; process.exit(2); }
    return;
  }
  if (m.t === 'pong') return;
  if (m.t === 'chat') {
    const c = m.msg;
    if (c.from !== you) log(c.text ? `💬 ${c.name}: ${c.text}` : `${c.emoji} from ${c.name}`);
    // answer a greeting or a "gg"
    if (!QUIET && c.from !== you && c.text && /\b(hi|hey|hello|yo)\b/i.test(c.text)) setTimeout(() => say(pick(['hey! 👋', 'hi there', 'hello hello'])), rnd(900, 2200));
    if (!QUIET && c.from !== you && c.text && /\bgg\b/i.test(c.text)) setTimeout(() => react('🫡'), rnd(500, 1500));
    return;
  }
  if (m.t === 'welcome') { you = m.you; log(`joined room ${code} as "${NAME}" (skill ${SKILL})`); }
  if (m.t !== 'welcome' && m.t !== 'state') return;
  const prev = state;
  state = m.state;
  const isHost = state.hostId === you;
  if (m.t === 'welcome' && isHost && flag('create')) {
    const game = arg('game', 'quiz');
    const settings = {
      game, topic: arg('topic', 'world:mix'), rounds: Number(arg('rounds', '10')), seconds: Number(arg('seconds', '15')),
      sources: arg('sources', '') ? arg('sources').split(',') : [], size: arg('size', 'mini'),
      limitSec: Number(arg('limit', String(RACE_DEFAULT_SEC[game] ?? 300))),
    };
    send({ t: 'settings', settings });
    const what = game === 'quiz' ? `${settings.topic}, ${settings.rounds} rounds, ${settings.seconds}s` : `${game} race, ${settings.limitSec}s${game === 'crossword' ? `, ${settings.size}, ${settings.sources.join('+') || 'random mix'}` : ''}`;
    log(`settings: ${what} — type "start" when everyone is in${START_AFTER ? ` (or I'll start at ${START_AFTER} players)` : ''}`);
  }
  // roster changes
  if (prev) {
    const before = new Map(prev.players.map((p) => [p.id, p]));
    for (const p of state.players) {
      const b = before.get(p.id);
      if (!b) log(`+ ${p.name} joined (${state.players.length} players)`);
      else if (b.connected && !p.connected) log(`… ${p.name} disconnected`);
      else if (!b.connected && p.connected) log(`↺ ${p.name} reconnected`);
    }
    for (const b of prev.players) if (!state.players.some((p) => p.id === b.id)) log(`- ${b.name} left`);
    if (prev.hostId !== state.hostId) log(`host is now ${state.players.find((p) => p.id === state.hostId)?.name ?? '?'}`);
  }
  if (isHost && state.phase === 'lobby' && START_AFTER && state.players.filter((p) => p.connected).length >= START_AFTER) {
    log(`${START_AFTER} players in — starting`);
    send({ t: 'start' });
  }

  const key = `${state.phase}:${state.round}`;
  if (key === lastPhaseKey) return;
  lastPhaseKey = key;
  switch (state.phase) {
    case 'countdown': {
      const s = state.settings;
      log(`game starting: ${s.game === 'quiz' || !s.game ? `${s.topic}, ${s.rounds} rounds` : `${s.game} race (${s.limitSec}s)`}`);
      if (Math.random() < 0.7) setTimeout(() => say(pick(['gl hf!', 'good luck 🍀', "let's go", 'ready 🧭'])), rnd(300, 1800));
      answeredRound = -1;
      break;
    }
    case 'question': playRound(state.round); break;
    case 'race': playRace(); break;
    case 'reveal': {
      const mine = state.answers[you];
      const board = [...state.players].sort((a, b) => b.score - a.score).slice(0, 3).map((p, i) => `${i + 1}. ${p.name} ${p.score}`).join('  ');
      log(`  round ${state.round + 1}: ${mine ? (mine.outcome >= 0.6 ? `✓ +${mine.points}` : '✗ +0') : 'no answer'} | ${board}`);
      if (Math.random() < 0.35) setTimeout(() => react(mine?.outcome >= 0.6 ? pick(['🔥', '👏', '🤯']) : pick(['😭', '😱', '😂'])), rnd(400, 2000));
      break;
    }
    case 'end': {
      const ranking = [...state.players].sort((a, b) => b.score - a.score);
      const race = state.settings.game && state.settings.game !== 'quiz';
      const detail = (p) => (race ? (state.progress[p.id]?.done ? 'finished' : 'unfinished') : `${p.correct}/${state.settings.rounds}`);
      log(`game over — ${ranking.map((p, i) => `${i + 1}. ${p.name} ${p.score} (${detail(p)})`).join(', ')}`);
      setTimeout(() => say(ranking[0]?.id === you ? pick(['gg! 😎', 'gg, close one', 'gg wp']) : pick(['gg 👏', 'gg, rematch?', 'nice one, gg'])), rnd(800, 2500));
      if (isHost) log('type "lobby" for another game, or "quit"');
      break;
    }
    case 'lobby': if (prev && prev.phase !== 'lobby') log('back in the lobby'); break;
  }
}

async function playRound(round) {
  if (answeredRound >= round) return;
  answeredRound = round;
  const right = Math.random() < SKILL;
  const limit = state.settings.seconds * 1000;
  // humans who know it answer fast; guesses take longer
  const delay = Math.min(limit - 600, right ? rnd(1500, 5000) : rnd(3000, 9000));
  await sleep(delay);
  if (!state || state.phase !== 'question' || state.round !== round) return;
  send({ t: 'answer', round, outcome: right ? 1 : 0 });
  log(`  round ${round + 1}: answered ${right ? 'right' : 'wrong'} after ${(delay / 1000).toFixed(1)}s`);
}

/**
 * Race games: the bot can't see the puzzle, so it fakes a plausible human run and reports progress.
 *   crossword  – solves words one by one; finishes with probability ≈ skill
 *   hotcold    – 3–9 guesses with shrinking distance, finding it on the last
 *   borderline – the shortest route plus 0–3 extra guesses
 */
async function playRace() {
  if (racingSeed === state.seed) return; // already running this race (e.g. after a reconnect)
  racingSeed = state.seed;
  const seed = state.seed, game = state.settings.game;
  const deadline = Date.now() + state.settings.limitSec * 1000 - 1500;
  const alive = () => state && state.phase === 'race' && state.seed === seed && Date.now() < deadline;
  const report = (r) => send({ t: 'progress', report: r });
  const pace = (base) => base * (1.6 - SKILL); // stronger bots move faster

  if (game === 'crossword') {
    const total = state.settings.size === 'standard' ? Math.round(rnd(11, 15)) : Math.round(rnd(6, 9));
    const finishes = Math.random() < SKILL;
    const stopAt = finishes ? total : Math.max(1, Math.floor(total * rnd(0.4, 0.9)));
    const per = (state.settings.limitSec * 1000 * rnd(0.35, 0.85)) / total;
    log(`  crossword race: ${total} words, ${finishes ? 'going for the finish' : `will stall at ${stopAt}`}`);
    report({ a: 0, b: total, c: 0, done: false }); // show the total from the start
    for (let a = 1; a <= stopAt; a++) {
      await sleep(per * rnd(0.6, 1.4));
      if (!alive()) return;
      const done = a === total;
      report({ a, b: total, c: 0, done });
      log(`  crossword: ${a}/${total} words${done ? ' — finished!' : ''}`);
    }
  } else if (game === 'hotcold') {
    const n = Math.max(3, Math.min(9, Math.round(3 + (1 - SKILL) * 6 * Math.random() + rnd(0, 2))));
    let km = rnd(3000, 9000);
    log(`  hot & cold race: will find it in ${n} guesses`);
    for (let a = 1; a <= n; a++) {
      await sleep(pace(rnd(5000, 14000)));
      if (!alive()) return;
      const done = a === n;
      km = done ? 0 : Math.max(50, km * rnd(0.35, 0.75));
      report({ a, b: Math.round(km), c: 0, done });
      log(`  hot & cold: guess ${a} → ${done ? 'found it!' : `${Math.round(km)} km`}`);
    }
  } else if (game === 'borderline') {
    const c = Number(arg('route-len', '')) || Math.round(rnd(3, 6));
    const extra = Math.min(3, Math.round((1 - SKILL) * 3 * Math.random() + rnd(0, 1)));
    const total = c + extra;
    const offRoute = new Set();
    while (offRoute.size < extra) offRoute.add(Math.floor(rnd(1, total))); // never the final guess
    log(`  borderline race: route of ${c}, ${extra} extra guess${extra === 1 ? '' : 'es'}`);
    let b = 0;
    for (let a = 1; a <= total; a++) {
      await sleep(pace(rnd(4000, 11000)));
      if (!alive()) return;
      if (!offRoute.has(a)) b++;
      const done = b === c;
      report({ a, b, c, done });
      log(`  borderline: guess ${a} (${b}/${c} placed)${done ? ' — connected!' : ''}`);
      if (done) return;
    }
  }
}

main();
