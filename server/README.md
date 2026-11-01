# Geonaut multiplayer server

Live rooms (2–8 players, 4-letter code) and async challenges (`GEO-XXXX` codes) for Geonaut. It runs on **Cloudflare Workers + Durable Objects** and will live at `https://play.geoiq.workers.dev`.

- **Live rooms:** one Durable Object per room code. It uses the WebSocket Hibernation API, so idle rooms cost nothing. Game state is kept in DO storage, and phases (countdown → question → reveal → … → end for quizzes, countdown → race → end for race games) are driven by DO alarms.
- **Challenges:** one Durable Object per code. It stores the spec and everyone's result, and deletes itself after 30 days.
- **Protocol:** [`../src/lib/mp/protocol.ts`](../src/lib/mp/protocol.ts), shared with the app.

## How a live game works

1. The app creates a room (`POST /api/rooms`) and connects to `/api/rooms/:code/ws`.
2. Each player says `hello` with a stable device id, name and the app's `dataVersion`. The first player becomes host. Players with a different `dataVersion` are turned away, because everyone must generate the same questions.
3. The host sends `start`. The server picks a fresh random **seed**; every client builds the identical question list from `(topic, seed, rounds)` using the data bundled in the app. **Questions never go over the wire.**
4. For each question, clients send `{answer, round, outcome}`. The server timestamps it on arrival and scores with `points(outcome, ms, seconds)`: up to 1000 points, half for being right and half for speed. The round ends early once every connected player has answered.
5. After the last reveal the room goes to `end`. The host can send `lobby` to play again with a new seed.

## Race games (protocol 2)

Besides the quiz (`settings.game = 'quiz'`), a room can play a **race** on one shared puzzle that every client builds from the seed:

| `game` | Puzzle | Progress report `{a, b, c, done}` |
|---|---|---|
| `crossword` | Crossword from `settings.sources` + `size` (no check/reveal) | a = words solved, b = total words |
| `hotcold` | Mystery country found by distance clues | a = guesses, b = closest distance in km |
| `borderline` | Connect two countries over land borders | a = guesses, b = countries placed on a shortest route, c = countries that route needs |

After the countdown the room enters one `race` phase lasting `settings.limitSec`. Clients send `{t:'progress', report}` whenever their progress changes; the server stamps `finishMs` itself the first time `done` is true, scores with `raceScore()` and broadcasts everyone's progress live. The race ends when every connected player is done, or at the time limit (alarm). Unfinished players are scored on their progress (a Hot & Cold player with no guesses scores 0). Each race score becomes that player's `score`, so the usual podium works; `correct` is 1 for finishers.

Async challenges support races too: `spec.game` (+ `sources`, `size`, `limitSec`) and `result.report`. The server recomputes the score from the report and the player's own time.

**Other rules:**
- **Reconnects** keep your seat and score; the newest connection replaces any older one.
- **Late joiners** start on 0.
- **The host role passes** to the next player if the host is gone for more than 10 seconds.
- **Kicked devices** can't rejoin.
- **Expiry:** rooms are deleted after 10 minutes with nobody connected, or 3 hours after creation.

### Trust model

This is for friends and family. Clients report whether they were right, so a modified app could claim every answer correct. The server measures **time** itself (server receive time − question start), so speed points can't be faked. Every message is validated and rate-limited; malformed input is ignored.

## Develop

```bash
cd server
npm install
npm run dev                         # local server on http://127.0.0.1:8787 (workerd, alarms + hibernation included)
npm run typecheck
```

### End-to-end simulator

With `npm run dev` running:

```bash
node server/scripts/sim.mjs                 # all scenarios (~1 min)
node server/scripts/sim.mjs --only basic    # one scenario: http | basic | reconnect | host | join | malformed
```

It plays real games over WebSockets with simulated latency (0–400 ms, order-preserving). It checks:
- phase progression on alarms, early round end, and scoring against server-measured time
- hidden answers, reconnects, host transfer, late join, kick
- version mismatch, full room, junk and flood messages, playing again
- the whole challenge API

### Bot

The bot plays quizzes and all three races (`--create --game crossword|hotcold|borderline [--limit 240] [--sources rivers,lakes --size mini] [--route-len 4]`). In races it can't see the puzzle, so it fakes a plausible human run: words solved over time, shrinking Hot & Cold distances, or a route with 0–3 extra guesses.


Play against a bot, locally or against the deployed server:

```bash
node server/scripts/bot.mjs --room ABCD                                  # join your room
node server/scripts/bot.mjs --create --topic world:flag --start-after 2  # bot hosts; starts when you join
node server/scripts/bot.mjs --url http://127.0.0.1:8787 --create         # against the local server
```

Options:
- `--name` and `--skill 0.7` (the chance of answering right). Answers come after a human-like 1.5–9 s, faster when it knows the answer.
- `--data-version` (defaults to the app version in the repo's `package.json`).

When the bot is host, type `start`, `lobby` or `quit`.

## Deploy

```bash
cd server
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
```

The first deploy creates the `play` worker and the SQLite-backed Durable Object classes (migration `v1`), which are available on the Workers free plan. Check it with `curl https://play.geoiq.workers.dev/api/health`.
