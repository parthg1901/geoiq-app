import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGame, levelFor, dueCards, mastery, STREAK_MIN_XP } from '../lib/store';
import { geoIQ, tierFor } from '../lib/geoiq';
import { todayKey, addDays } from '../lib/rng';
import { go } from '../lib/router';
import { countryOfDay, dailyNumber } from '../lib/daily';
import { nextUnit, REGION_META } from '../lib/path';
import { COUNTRIES, BY_ID } from '../data';
import { Globe } from '../components/Globe';
import { Flag } from '../components/Shape';
import { Page, Progress, Ring, SectionTitle } from '../components/ui';
import { SpinWheel } from '../components/SpinWheel';
import { CountryOfDay } from '../components/CountryOfDay';
import { isNative, enableReminders } from '../lib/native';
import { useSocial } from '../lib/social';

export function StatusBar() {
  const { streak, coins, xp, days } = useGame();
  const lvl = levelFor(xp);
  const todayXp = days[todayKey()]?.xp ?? 0;
  const lit = todayXp >= STREAK_MIN_XP;
  return (
    <div className="flex items-center gap-1.5 pt-4 pb-2">
      <button onClick={() => go('/')} className="display text-2xl font-extrabold tracking-tight mr-auto flex items-center gap-1.5">
        <span className="relative inline-grid place-items-center w-8 h-8 rounded-xl bg-amber text-ink text-lg rotate-[-8deg] shadow-[0_4px_0_#b9761a]">G</span>
        {/* wordmark only where it fits next to the chips */}
        <span className="hidden min-[400px]:inline">Geo<span className="text-amber">IQ</span></span>
      </button>
      <span className={`chip !text-sm ${lit ? '!text-amber !border-amber/50' : 'text-mist'}`} title="Day streak">
        <span className={lit ? 'flame' : 'grayscale opacity-60'}>🔥</span><b className="mono">{streak.count}</b>
      </span>
      <span className="chip !text-sm" title="Coins">🪙 <b className="mono">{coins}</b></span>
      <FriendsChip />
      <button onClick={() => go('/me')} className="chip !text-sm !border-violet/50 text-violet" title="Level">Lv <b className="mono">{lvl.level}</b></button>
    </div>
  );
}

/** 👥 Friends, with a dot when friend requests are waiting. */
function FriendsChip() {
  const waiting = useSocial((s) => s.me?.requests.length ?? 0);
  return (
    <button onClick={() => go('/friends')} className="chip !text-sm !px-2.5 relative" title="Friends" aria-label="Friends">
      👥{waiting > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose text-white text-[10px] font-bold grid place-items-center">{waiting}</span>}
    </button>
  );
}

export default function Home() {
  const s = useGame();
  const { iq, provisional, answered } = geoIQ(s.ratings);
  const tier = tierFor(iq);
  const today = todayKey();
  const todayXp = s.days[today]?.xp ?? 0;
  const [spin, setSpin] = useState(false);
  const due = dueCards(s.cards).length;
  const unit = nextUnit(s.lessons);
  const cotd = countryOfDay();
  const daily = s.daily[today];
  const stamps = Object.keys(s.stamps).length;
  const globeFills = useMemo(() => {
    const f: Record<string, string> = {};
    for (const c of COUNTRIES) {
      const m = mastery(s.cards, c.id);
      if (s.stamps[c.id]) f[c.id] = '#ffb547';
      else if (m > 0) f[c.id] = `rgba(83,184,255,${0.25 + m * 0.6})`;
    }
    return f;
  }, [s.cards, s.stamps]);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const prevIQ = s.iqHistory.length > 1 ? s.iqHistory[Math.max(0, s.iqHistory.length - 8)].iq : iq;

  return (
    <Page>
      <StatusBar />

      {/* Hero: GeoIQ + globe */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden mt-2 p-5 pr-2 flex items-center gap-2">
        <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full opacity-30" style={{ background: `radial-gradient(circle, ${tier.color} 0%, transparent 68%)` }} />
        <div className="relative flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[.22em] text-mist font-bold">Your GeoIQ</div>
          <button onClick={() => go('/iq')} className="flex items-baseline gap-2 mt-1">
            <span className="display text-7xl font-extrabold leading-none tracking-tight" style={{ color: tier.color, textShadow: `0 0 40px ${tier.color}55` }}>{iq}</span>
            {iq !== prevIQ && <span className={`mono text-sm font-bold ${iq > prevIQ ? 'text-mint' : 'text-rose'}`}>{iq > prevIQ ? '▲' : '▼'}{Math.abs(iq - prevIQ)}</span>}
          </button>
          <div className="display font-bold text-lg mt-1">{tier.emoji} {tier.name}</div>
          <div className="text-sm text-mist mt-0.5 leading-snug">{provisional ? `Calibrating… ${Math.min(answered, 30)}/30 answers` : tier.blurb}</div>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary !py-2.5 !px-4 text-sm whitespace-nowrap" onClick={() => go('/test')}>🧠 IQ Test</button>
            <button className="btn btn-ghost !py-2.5 !px-3 text-sm" onClick={() => go('/iq')}>Stats</button>
          </div>
        </div>
        <div className="relative shrink-0 -mr-10 sm:mr-0" onClick={(e) => e.stopPropagation()}>
          <Globe size={typeof window !== 'undefined' && window.innerWidth < 400 ? 150 : 200} fills={globeFills} />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 chip !bg-ink/70 whitespace-nowrap">🛂 {stamps}/{COUNTRIES.length}</div>
        </div>
      </motion.div>

      {/* Daily goal + streak week */}
      <div className="card mt-4 p-4 flex items-center gap-4">
        <Ring value={todayXp / s.dailyGoal} size={72} color={todayXp >= s.dailyGoal ? 'var(--color-mint)' : 'var(--color-amber)'}>
          <div className="text-center leading-none"><div className="display font-extrabold text-lg">{todayXp}</div><div className="text-xs text-mist">/{s.dailyGoal} XP</div></div>
        </Ring>
        <div className="flex-1 min-w-0">
          <div className="display font-bold">{todayXp >= s.dailyGoal ? 'Daily goal smashed! 🎉' : todayXp >= STREAK_MIN_XP ? 'Streak secured — go for the goal' : `Earn ${STREAK_MIN_XP - todayXp} XP to keep your streak`}</div>
          <div className="flex justify-between mt-2.5">
            {week.map((d) => {
              const x = s.days[d]?.xp ?? 0;
              const frozen = s.streak.frozen.includes(d);
              const on = x >= STREAK_MIN_XP;
              return (
                <div key={d} className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full grid place-items-center text-sm ${on ? 'bg-amber/20 border border-amber' : frozen ? 'bg-sky/20 border border-sky' : 'bg-white/5 border border-line'} ${d === today ? 'ring-2 ring-paper/40' : ''}`}>
                    {on ? '🔥' : frozen ? '🧊' : ''}
                  </div>
                  <span className="text-xs text-mist font-semibold">{'SMTWTFS'[new Date(d + 'T12:00').getDay()]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isNative && !s.reminder.on && !s.counters.reminderAsked && (
        <div className="card mt-4 p-4 flex items-center gap-3 border-amber/50">
          <span className="text-3xl">🔔</span>
          <div className="flex-1"><div className="display font-bold">Never lose your streak</div><div className="text-sm text-mist">Get one gentle reminder a day, only if you haven't played yet.</div></div>
          <div className="flex flex-col gap-1.5">
            <button className="btn btn-primary !py-2 !px-3 text-sm" onClick={() => { s.bump('reminderAsked'); enableReminders(); }}>Turn on</button>
            <button className="text-sm text-mist" onClick={() => s.bump('reminderAsked')}>Not now</button>
          </div>
        </div>
      )}

      {/* Check-in + Daily challenge */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <button onClick={() => s.spinDay !== today && setSpin(true)} className={`card p-4 text-left relative overflow-hidden ${s.spinDay !== today ? 'ring-2 ring-amber/60' : ''}`}>
          <div className={`text-3xl ${s.spinDay !== today ? 'animate-[spin_6s_linear_infinite]' : ''} inline-block`}>🎡</div>
          <div className="display font-bold mt-1">Daily Spin</div>
          <div className="text-sm text-mist leading-snug">{s.spinDay === today ? 'Come back tomorrow' : 'Free reward waiting!'}</div>
          {s.spinDay !== today && <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-coral animate-ping" />}
        </button>
        <button onClick={() => go('/daily')} className={`card p-4 text-left relative overflow-hidden ${!daily ? 'ring-2 ring-sky/60' : ''}`}>
          <div className="text-3xl">☀️</div>
          <div className="display font-bold mt-1">Daily #{dailyNumber()}</div>
          <div className="text-sm text-mist leading-snug">{daily ? <span className="tracking-widest">{daily.grid}</span> : '5 questions · same for everyone'}</div>
        </button>
      </div>

      {/* Continue path */}
      <SectionTitle sub={<button className="text-sky" onClick={() => go('/learn')}>Atlas Path →</button>}>Keep learning</SectionTitle>
      <button onClick={() => go('/lesson/' + unit.id)} className="card w-full p-4 flex items-center gap-4 text-left hover:border-sky/50 transition-colors">
        <div className="relative w-16 h-16 rounded-2xl grid place-items-center text-3xl shrink-0" style={{ background: REGION_META[unit.region].color + '22', border: `2px solid ${REGION_META[unit.region].color}` }}>
          {REGION_META[unit.region].emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider font-bold" style={{ color: REGION_META[unit.region].color }}>{unit.region} · Unit {unit.index + 1}</div>
          <div className="display font-bold text-lg">{unit.title}</div>
          <div className="flex gap-1 mt-1.5">{unit.ids.map((id) => <Flag key={id} id={id} className="w-6 h-4 !rounded-sm !shadow-none" />)}</div>
        </div>
        <span className="btn btn-primary !px-4 !py-2 text-sm">Start</span>
      </button>

      {due > 0 && (
        <button onClick={() => go('/play/review')} className="card w-full p-4 mt-3 flex items-center gap-4 text-left border-violet/40">
          <div className="w-12 h-12 rounded-2xl bg-violet/20 grid place-items-center text-2xl">🧠</div>
          <div className="flex-1"><div className="display font-bold">Smart Review</div><div className="text-sm text-mist">{due} memories are fading — refresh them</div></div>
          <span className="mono font-bold text-violet text-xl">{due}</span>
        </button>
      )}

      {/* Country of the day */}
      <SectionTitle sub={<button className="text-sky" onClick={() => go('/atlas')}>World Atlas →</button>}>Country of the day</SectionTitle>
      <CountryOfDay c={cotd} />

      {/* Packs */}
      <button onClick={() => go('/packs')} className="card w-full mt-6 p-4 flex items-center gap-4 text-left relative overflow-hidden hover:border-amber/60 transition-colors">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(61,220,151,.25) 0%, transparent 68%)' }} />
        <div className="text-4xl relative">🧭</div>
        <div className="flex-1 relative">
          <div className="text-xs font-bold uppercase tracking-wider text-mint">New</div>
          <div className="display font-bold text-lg leading-tight">Languages & scripts</div>
          <div className="text-sm text-mist">Which language is that sign in? Plus states, rivers, peaks and maps from 1914…</div>
        </div>
        <span className="text-mint text-xl relative">→</span>
      </button>

      {/* Quick play */}
      <SectionTitle sub={<button className="text-sky" onClick={() => go('/play')}>All games →</button>}>Quick play</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/mp', t: 'Multiplayer', d: 'Play friends live with a room code, or send a challenge', e: '⚔️', c: '#ff5d73', wide: true },
          { to: '/play/rush', t: 'Shape Rush', d: '60s time attack', e: '⚡', c: '#ffb547' },
          { to: '/hotcold', t: 'Hot & Cold', d: 'Find the mystery country', e: '🌡️', c: '#ff6b5e' },
          { to: '/borderline', t: 'Borderline', d: 'Walk across borders', e: '🛤️', c: '#3ddc97' },
          { to: '/play/photo', t: 'Street Eye', d: 'Guess from photos', e: '📸', c: '#53b8ff' },
          { to: '/crossword', t: 'Crosswords', d: 'Daily grid or your own topics', e: '🧩', c: '#b48cff' },
          { to: '/packs', t: 'Explore packs', d: 'States, rivers, history, languages', e: '🗺️', c: '#3ddc97' },
        ].map((m) => (
          <button key={m.to} onClick={() => go(m.to)} className={`card p-4 text-left relative overflow-hidden group ${'wide' in m && m.wide ? 'col-span-2' : ''}`}>
            <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full opacity-20 group-hover:opacity-35 transition-opacity pointer-events-none" style={{ background: `radial-gradient(circle, ${m.c} 0%, transparent 68%)` }} />
            <div className="relative text-2xl">{m.e}</div>
            <div className="relative display font-bold mt-1">{m.t}</div>
            <div className="relative text-sm text-mist leading-snug">{m.d}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 card p-4">
        <div className="flex justify-between text-sm"><span className="display font-bold">World progress</span><span className="mono text-mist">{stamps}/{COUNTRIES.length}</span></div>
        <Progress value={stamps / COUNTRIES.length} className="mt-2" color="var(--color-violet)" />
        <div className="text-sm text-mist mt-2 leading-snug">Master a country's shape, flag, location and capital to earn its passport stamp. Latest: {Object.entries(s.stamps).slice(-3).map(([id]) => BY_ID[id]?.name).join(', ') || 'none yet'}</div>
      </div>

      {spin && <SpinWheel onClose={() => setSpin(false)} />}
    </Page>
  );
}
