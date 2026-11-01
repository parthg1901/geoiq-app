/**
 * Native (Capacitor / Android) integration. Everything here is a no-op in the browser.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { useGame, STREAK_MIN_XP } from './store';
import { todayKey, addDays } from './rng';

export const isNative = Capacitor.isNativePlatform();

/* ---------- Android back button: overlays close first, then history, then exit ---------- */
const backHandlers: (() => void)[] = [];
/** Register a handler (e.g. "close this sheet") for the hardware back button. Returns an unregister fn. */
export function onBack(fn: () => void) {
  backHandlers.push(fn);
  return () => { const i = backHandlers.lastIndexOf(fn); if (i >= 0) backHandlers.splice(i, 1); };
}

/* ---------- Haptics ---------- */
export function haptic(kind: 'tap' | 'right' | 'wrong' | 'win') {
  if (!isNative) return false;
  if (kind === 'tap') Haptics.impact({ style: ImpactStyle.Light });
  else if (kind === 'right') Haptics.impact({ style: ImpactStyle.Medium });
  else if (kind === 'wrong') Haptics.notification({ type: NotificationType.Error });
  else Haptics.notification({ type: NotificationType.Success });
  return true;
}

/* ---------- Streak reminders ---------- */
const BASE_ID = 7000;
const DAYS_AHEAD = 7;

function message(streak: number, dayOffset: number) {
  const lines = streak > 0 && dayOffset === 0
    ? [`🔥 Your ${streak}-day streak ends at midnight — one quick round saves it.`, `🔥 ${streak} days strong. Don't let it slip today!`]
    : ['🌍 2 minutes of Geonaut? A few shapes and flags keep your brain sharp.', '🧭 Your daily challenge is waiting — same 5 questions for everyone.', '🗺️ A new Country of the Day just dropped. Come take a look!', '⚡ Quick Shape Rush before bed?'];
  return lines[(new Date().getDate() + dayOffset) % lines.length];
}

/** (Re)schedule the next week of daily reminders. Skips today if the streak is already secured. */
export async function scheduleReminders() {
  if (!isNative) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter((n) => n.id >= BASE_ID && n.id < BASE_ID + 100);
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    const s = useGame.getState();
    if (!s.reminder.on) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return;
    const today = todayKey();
    const secured = (s.days[today]?.xp ?? 0) >= STREAK_MIN_XP;
    const notifications = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const day = addDays(today, i);
      const at = new Date(`${day}T${String(s.reminder.hour).padStart(2, '0')}:${String(s.reminder.minute).padStart(2, '0')}:00`);
      if (at.getTime() <= Date.now() + 60_000) continue;
      if (i === 0 && secured) continue;
      notifications.push({
        id: BASE_ID + i,
        title: 'Geonaut',
        body: message(i === 0 ? s.streak.count : 0, i),
        schedule: { at, allowWhileIdle: true },
        smallIcon: 'ic_stat_geoiq',
        iconColor: '#ffb547',
      });
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.warn('reminders', e);
  }
}

/** Ask for notification permission (Android 13+ shows a system prompt). */
export async function enableReminders() {
  if (!isNative) return false;
  const p = await LocalNotifications.requestPermissions();
  const ok = p.display === 'granted';
  useGame.getState().set({ reminder: { ...useGame.getState().reminder, on: ok } });
  await scheduleReminders();
  return ok;
}

/* ---------- Boot ---------- */
export async function initNative() {
  if (!isNative) return;
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#070d1c' }).catch(() => {});
  setTimeout(() => SplashScreen.hide().catch(() => {}), 250);

  // Web Share API isn't available in Android WebView — route it to the native share sheet.
  if (!navigator.share) {
    (navigator as Navigator & { share: Navigator['share'] }).share = async (d?: ShareData) => { await Share.share({ title: d?.title, text: d?.text, url: d?.url }); };
  }

  App.addListener('backButton', () => {
    const h = backHandlers[backHandlers.length - 1];
    if (h) { h(); return; }
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && hash !== '/') window.history.back();
    else App.exitApp();
  });
  App.addListener('resume', () => { useGame.getState().checkStreak(); scheduleReminders(); });
  LocalNotifications.addListener('localNotificationActionPerformed', () => { window.location.hash = '/'; });

  // Re-plan reminders whenever today's streak gets secured or settings change.
  let lastKey = '';
  useGame.subscribe((s) => {
    const key = `${(s.days[todayKey()]?.xp ?? 0) >= STREAK_MIN_XP}|${s.reminder.on}|${s.reminder.hour}:${s.reminder.minute}|${s.streak.count}`;
    if (key !== lastKey) { lastKey = key; scheduleReminders(); }
  });
  scheduleReminders();
}
