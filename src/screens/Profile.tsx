import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame, levelFor } from '../lib/store';
import { ACHIEVEMENTS } from '../lib/achievements';
import { geoIQ, tierFor } from '../lib/geoiq';
import { todayKey, addDays } from '../lib/rng';
import { sfx } from '../lib/sound';
import { isNative, enableReminders } from '../lib/native';
import { go } from '../lib/router';
import { Page, Progress, SectionTitle } from '../components/ui';
import { toast } from '../components/Toasts';
import { StatusBar } from './Home';
import SyncSettings from '../components/SyncSettings';
import { checkForUpdate, APP_VERSION } from '../lib/update';
import { useSync, disableSync } from '../lib/sync';

const GOALS = [
  { xp: 30, label: 'Chill' },
  { xp: 60, label: 'Regular' },
  { xp: 100, label: 'Serious' },
  { xp: 150, label: 'Intense' },
];
const FREEZE_COST = 200;
const WEEKS = 16;

export default function Profile() {
  const s = useGame();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [confirmReset, setConfirmReset] = useState(false);
  const syncing = useSync((x) => !!x.code);
  const lvl = levelFor(s.xp);
  const { iq } = geoIQ(s.ratings);
  const tier = tierFor(iq);

  const stats = useMemo(() => {
    const logs = Object.values(s.days);
    const answers = logs.reduce((a, d) => a + d.answers, 0);
    const right = logs.reduce((a, d) => a + d.right, 0);
    return {
      answers, acc: answers ? Math.round((right / answers) * 100) : 0,
      active: Object.values(s.days).filter((d) => d.xp > 0).length,
    };
  }, [s.days]);

  // Heatmap: columns = weeks (oldest → newest), rows = Sun..Sat
  const today = todayKey();
  const todayDow = new Date(today + 'T12:00').getDay();
  const start = addDays(today, -(WEEKS - 1) * 7 - todayDow);
  const maxXp = Math.max(s.dailyGoal, ...Object.values(s.days).map((d) => d.xp));
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i));

  const saveName = () => { s.set({ name: name.trim() || 'Explorer' }); setEditing(false); };
  const buyFreeze = () => {
    if (s.coins < FREEZE_COST || s.streak.freezes >= 3) return;
    s.set({ coins: s.coins - FREEZE_COST, streak: { ...s.streak, freezes: s.streak.freezes + 1 } });
    sfx.level();
    toast({ icon: '🧊', title: 'Streak freeze bought', body: 'It will protect your streak on a missed day.' });
  };
  const unlocked = ACHIEVEMENTS.filter((a) => s.achievements[a.id]).length;

  return (
    <Page>
      <StatusBar />

      {/* Identity */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-5 mt-2 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full opacity-25" style={{ background: `radial-gradient(circle, ${tier.color} 0%, transparent 68%)` }} />
        <div className="relative flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl grid place-items-center text-3xl border-2" style={{ borderColor: tier.color, background: tier.color + '22' }}>{tier.emoji}</div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex gap-2">
                <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  className="min-w-0 flex-1 bg-ink/70 border-2 border-amber outline-none rounded-xl px-3 py-1.5 display text-lg" />
                <button className="btn btn-primary !py-1.5 !px-3 text-sm" onClick={saveName}>Save</button>
              </div>
            ) : (
              <button onClick={() => { setName(s.name); setEditing(true); }} className="display text-2xl font-extrabold break-words max-w-full text-left leading-tight">
                {s.name || 'Explorer'} <span className="text-sm text-mist">✎</span>
              </button>
            )}
            <div className="text-sm text-mist">{tier.name} · IQ <b className="text-paper mono">{iq}</b> · since {s.createdAt}</div>
          </div>
        </div>
        <div className="relative mt-4">
          <div className="flex justify-between text-sm"><span className="display font-bold text-violet">Level {lvl.level}</span><span className="mono text-mist">{lvl.into}/{lvl.need} XP</span></div>
          <Progress value={lvl.into / lvl.need} color="var(--color-violet)" className="mt-1.5" />
          <div className="text-sm text-mist mt-1.5">{s.xp.toLocaleString()} XP lifetime</div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        {[
          { k: 'Answers', v: stats.answers.toLocaleString(), c: '' },
          { k: 'Accuracy', v: `${stats.acc}%`, c: 'text-mint' },
          { k: 'Days active', v: stats.active, c: 'text-sky' },
          { k: 'Streak', v: <>{s.streak.count}🔥</>, c: 'text-amber' },
          { k: 'Best streak', v: s.streak.best, c: 'text-coral' },
          { k: 'Freezes', v: <>{s.streak.freezes}🧊</>, c: 'text-sky' },
        ].map((x, i) => (
          <motion.div key={x.k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }} className="card p-3 text-center">
            <div className={`display text-2xl font-extrabold ${x.c}`}>{x.v}</div>
            <div className="text-xs uppercase tracking-wider text-mist font-semibold mt-0.5">{x.k}</div>
          </motion.div>
        ))}
      </div>

      {/* Activity heatmap */}
      <SectionTitle sub={`last ${WEEKS} weeks`}>Activity</SectionTitle>
      <div className="card p-4">
        <div className="flex gap-[3px] justify-between">
          {Array.from({ length: WEEKS }, (_, w) => (
            <div key={w} className="flex flex-col gap-[3px] flex-1">
              {cells.slice(w * 7, w * 7 + 7).map((d) => {
                const xp = s.days[d]?.xp ?? 0;
                const future = d > today;
                const frozen = s.streak.frozen.includes(d);
                const a = xp ? 0.25 + 0.75 * Math.min(1, xp / maxXp) : 0;
                return (
                  <div key={d} title={`${d}: ${xp} XP`} className={`aspect-square rounded-[3px] ${d === today ? 'ring-1 ring-paper/70' : ''}`}
                    style={{ background: future ? 'transparent' : frozen && !xp ? 'rgba(83,184,255,.45)' : xp ? `rgba(255,181,71,${a})` : 'rgba(255,255,255,.06)' }} />
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-3 text-xs text-mist">
          less {[0, 0.35, 0.6, 1].map((a) => <span key={a} className="w-3 h-3 rounded-[3px]" style={{ background: a ? `rgba(255,181,71,${a})` : 'rgba(255,255,255,.06)' }} />)} more
          <span className="ml-2 w-3 h-3 rounded-[3px]" style={{ background: 'rgba(83,184,255,.45)' }} /> frozen
        </div>
      </div>

      {/* Achievements */}
      <SectionTitle sub={`${unlocked}/${ACHIEVEMENTS.length}`}>Achievements</SectionTitle>
      <div className="grid grid-cols-2 min-[400px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
        {[...ACHIEVEMENTS].sort((a, b) => Number(!!s.achievements[b.id]) - Number(!!s.achievements[a.id])).map((a, i) => {
          const got = s.achievements[a.id];
          return (
            <motion.div key={a.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.02 * i }}
              className={`card !rounded-2xl p-3 text-center ${got ? '!border-amber/50' : ''}`}>
              <div className={`text-3xl ${got ? '' : 'grayscale opacity-30'}`}>{a.icon}</div>
              <div className={`display font-bold text-sm leading-tight mt-1 ${got ? 'text-amber' : 'text-mist'}`}>{a.name}</div>
              <div className="text-[13px] text-mist leading-snug mt-0.5">{a.desc}</div>
              {got && <div className="mono text-xs text-mist/90 mt-1">{got}</div>}
            </motion.div>
          );
        })}
      </div>

      {/* Shop */}
      <SectionTitle sub={<>🪙 <span className="mono">{s.coins}</span></>}>Shop</SectionTitle>
      <div className="card p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-sky/15 border border-sky/50 grid place-items-center text-3xl">🧊</div>
        <div className="flex-1 min-w-0">
          <div className="display font-bold">Streak freeze</div>
          <div className="text-sm text-mist leading-snug">Saves your streak if you miss a day. Holding {s.streak.freezes}/3.</div>
        </div>
        <button className="btn btn-primary !py-2 !px-3 text-sm" disabled={s.coins < FREEZE_COST || s.streak.freezes >= 3} onClick={buyFreeze}>
          {s.streak.freezes >= 3 ? 'Full' : `${FREEZE_COST} 🪙`}
        </button>
      </div>

      {/* Sync & backup */}
      <SectionTitle>Sync & backup</SectionTitle>
      <SyncSettings />

      {/* Settings */}
      <SectionTitle>Settings</SectionTitle>
      <div className="card p-4 space-y-5">
        <div>
          <div className="display font-bold">Daily goal</div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {GOALS.map((g) => (
              <button key={g.xp} onClick={() => s.set({ dailyGoal: g.xp })}
                className={`rounded-2xl border-2 py-2 text-center transition-colors ${s.dailyGoal === g.xp ? 'border-amber bg-amber/15 text-amber' : 'border-line bg-white/5 text-mist hover:border-mist'}`}>
                <div className="display font-extrabold">{g.xp}</div>
                <div className="text-xs uppercase tracking-wider font-semibold">{g.label}</div>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between cursor-pointer select-none">
          <span><b className="display">Sound effects</b><span className="block text-sm text-mist">Chimes, combos, stamps</span></span>
          <button onClick={() => { s.set({ sound: !s.sound }); if (!s.sound) setTimeout(() => sfx.right(), 50); }} className={`w-12 h-7 rounded-full p-1 transition-colors ${s.sound ? 'bg-mint' : 'bg-white/10'}`} aria-label="Toggle sound">
            <motion.span layout className="block w-5 h-5 rounded-full bg-white" style={{ marginLeft: s.sound ? 20 : 0 }} />
          </button>
        </label>
        <ReminderSettings />
        <VersionRow />
        <div className="pt-2 border-t border-line/60">
          <button className="text-rose text-sm font-semibold" onClick={() => setConfirmReset(true)}>Reset all progress…</button>
        </div>
      </div>

      {createPortal(<AnimatePresence>
        {confirmReset && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-4" onClick={() => setConfirmReset(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="card p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="text-4xl">⚠️</div>
              <div className="display text-xl font-extrabold mt-2">Reset everything?</div>
              <p className="text-sm text-mist mt-1">Your IQ, streak, XP, stamps and achievements will be erased. This can’t be undone.{syncing && ' This phone also stops syncing; the cloud copy is kept.'}</p>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
                <button className="btn !bg-rose text-white shadow-[0_4px_0_#a8293b]" onClick={() => { if (syncing) void disableSync(false); s.reset(); localStorage.removeItem('geoiq-seen-stamps'); setConfirmReset(false); go('/'); }}>Reset</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </Page>
  );
}

function VersionRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'error'>('idle');
  const check = async () => {
    setState('checking');
    try { setState((await checkForUpdate(true)) ? 'idle' : 'latest'); } catch { setState('error'); }
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <span><b className="display">Version</b><span className="block text-sm text-mist mono">Geonaut {APP_VERSION}</span></span>
      {isNative && (
        <button className="btn btn-ghost !py-1.5 !px-3 text-sm" disabled={state === 'checking'} onClick={check}>
          {state === 'checking' ? 'Checking…' : state === 'latest' ? 'Up to date ✓' : state === 'error' ? 'Offline — retry' : 'Check for updates'}
        </button>
      )}
    </div>
  );
}

function ReminderSettings() {
  const reminder = useGame((x) => x.reminder);
  const set = useGame((x) => x.set);
  const [denied, setDenied] = useState(false);
  const time = `${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`;
  if (!isNative) {
    return <div className="text-sm text-mist"><b className="display text-paper">Streak reminders</b><span className="block">Daily reminder notifications are available in the Android app.</span></div>;
  }
  const toggle = async () => {
    if (reminder.on) { set({ reminder: { ...reminder, on: false } }); return; }
    setDenied(!(await enableReminders()));
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between cursor-pointer select-none">
        <span><b className="display">Streak reminders</b><span className="block text-sm text-mist">A daily nudge — skipped once your streak is safe</span></span>
        <button onClick={toggle} className={`w-12 h-7 rounded-full p-1 transition-colors ${reminder.on ? 'bg-mint' : 'bg-white/10'}`} aria-label="Toggle reminders">
          <motion.span layout className="block w-5 h-5 rounded-full bg-white" style={{ marginLeft: reminder.on ? 20 : 0 }} />
        </button>
      </label>
      {reminder.on && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Remind me at</span>
          <input type="time" value={time} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h)) set({ reminder: { ...reminder, hour: h, minute: m || 0 } }); }}
            className="bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-xl px-3 py-1.5 mono text-paper" />
        </label>
      )}
      {denied && <div className="text-sm text-rose">Notifications are blocked. Enable them for Geonaut in Android Settings → Apps → Geonaut → Notifications.</div>}
    </div>
  );
}
