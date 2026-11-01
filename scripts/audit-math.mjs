// Regression checks for GeoIQ's scoring & progress math. Run: npm run audit:math
// Bundles the real engine (src/lib/geoiq.ts, src/lib/store.ts) and checks it by simulation.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoiq-audit-'));
for (const m of ['geoiq', 'store']) execSync(`npx rolldown src/lib/${m}.ts --format esm --platform node -o ${dir}/${m}.mjs`, { stdio: 'ignore' });
execSync(`npx rolldown src/data.ts --format esm --platform node -o ${dir}/data.mjs`, { stdio: 'ignore' });
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }; // zustand persist in node
const G = await import(`${dir}/geoiq.mjs`);
const St = await import(`${dir}/store.mjs`);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 1. Ratings settle on the true ability (no bias) for every answer format.
for (const format of ['choice4', 'choice6', 'typed', 'map']) {
  for (const trueIQ of [90, 115, 135]) {
    const trueT = G.fromIQ(trueIQ); const ends = [];
    for (let rep = 0; rep < 40; rep++) {
      let r = { theta: 1000, n: 0 }; const tail = [];
      for (let i = 0; i < 400; i++) {
        const d = r.theta - 60 + (rnd() - 0.5) * 240;
        r = G.update(r, d, format, rnd() < G.pCorrect(trueT, d, format) ? 1 : 0);
        if (i >= 300) tail.push(r.theta);
      }
      ends.push(mean(tail));
    }
    const got = G.toIQ(mean(ends));
    check(Math.abs(got - trueIQ) <= 1, `${format.padEnd(7)} true ${trueIQ} → rated ${got}`);
  }
}

// 2. Clue Ladder: per-clue update is unbiased under the ladder model it assumes.
{
  const play = (t, d) => { for (let k = 1; k <= 6; k++) if (rnd() < G.pCorrect(t, d - G.CLUE_STEP * (k - 1), 'partial')) return k; return 0; };
  for (const trueIQ of [90, 115, 135]) {
    const t = G.fromIQ(trueIQ); const ends = [];
    for (let rep = 0; rep < 30; rep++) {
      let r = { theta: 1000, n: 0 }; const tail = [];
      for (let i = 0; i < 300; i++) {
        const d = r.theta - 60 + (rnd() - 0.5) * 240; const s = play(t, d);
        r = G.updateLadder(r, d, s, s || 6);
        if (i >= 200) tail.push(r.theta);
      }
      ends.push(mean(tail));
    }
    const got = G.toIQ(mean(ends));
    check(Math.abs(got - trueIQ) <= 1.5, `clue ladder true ${trueIQ} → rated ${got}`);
  }
}

// 3. Scale sanity.
check(G.percentile(100) === 50 && G.percentile(115) === 84.1 && G.percentile(130) === 97.7, 'percentile follows the normal curve (100→50%, 115→84%, 130→98%)');
check(G.toIQ(G.fromIQ(123)) === 123, 'toIQ/fromIQ round-trip');

// 4. Memory cards: a right answer only promotes once due; a miss always demotes.
{
  const t0 = Date.parse('2026-01-01T10:00:00');
  let c = St.nextCard(undefined, true, t0);
  check(c.box === 1, 'first right answer → box 1');
  const again = St.nextCard(c, true, t0 + 60_000);
  check(again.box === 1, 'repeating it a minute later does not promote (no stamp farming)');
  c = St.nextCard(c, true, c.due + 1);
  check(c.box === 2, 'right answer once due → box 2');
  check(St.nextCard(c, false, t0).box === 0, 'a miss knocks the card back');
}

// 4b. Every country can earn a passport stamp (mastery reaches 1.0 on the skills it can be asked about).
{
  const { COUNTRIES } = await import(`${dir}/data.mjs`);
  const maxed = (id) => Object.fromEntries(St.stampSkills(id).map((s) => [`${id}:${s}`, { box: 4, due: 0, seen: 9, right: 9 }]));
  const stuck = COUNTRIES.filter((c) => St.mastery(maxed(c.id), c.id) < 1).map((c) => c.id);
  check(stuck.length === 0, `every country can reach full mastery (stamp reachable)${stuck.length ? ' — stuck: ' + stuck.join(', ') : ''}`);
  check(St.stampSkills('VAT').join() === 'flag,map' && St.mastery(maxed('VAT'), 'VAT') === 1, 'Vatican City is stamped on flag + map alone');
  check(St.stampSkills('FRA').length === 4 && St.mastery({ 'FRA:flag': { box: 4 }, 'FRA:map': { box: 4 } }, 'FRA') === 0.5, 'a normal country still needs all four skills');
}

// 5. Streaks & freezes.
{
  const base = { count: 5, best: 5, last: '2026-03-10', freezes: 1, frozen: [] };
  check(St.bumpStreak(base, 25, '2026-03-11').count === 6, 'next-day practice extends the streak');
  check(St.bumpStreak(base, 10, '2026-03-11').count === 5, 'under 20 XP does not count yet');
  const bridged = St.bumpStreak(base, 25, '2026-03-12');
  check(bridged.count === 6 && bridged.freezes === 0, 'one missed day is bridged by a freeze, even without an app restart');
  const lost = St.bumpStreak(base, 25, '2026-03-13');
  check(lost.count === 1, 'two missed days with one freeze → streak restarts');
  check(St.settleGap(base, '2026-03-11').froze === 0, 'no freeze spent when nothing was missed');
  const dst = St.bumpStreak({ ...base, last: '2026-03-28' }, 25, '2026-03-29'); // EU DST change night
  check(dst.count === 6, 'daylight-saving night still counts as consecutive days');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
