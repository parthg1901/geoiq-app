/**
 * In-app update check for people who installed the APK by hand (Obtainium users update on their own).
 * Asks GitHub for the latest release at most every few hours; the prompt offers the APK download,
 * which Android opens in the system browser.
 */
import { create } from 'zustand';
import { isNative } from './native';

export const REPO = 'parthg1901/geonaut';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const CHECK_EVERY_MS = 6 * 3600_000;
const SNOOZE_MS = 24 * 3600_000;
const LS = 'geonaut-update'; // { checkedAt, latest, snoozed: { [version]: until } }

export interface Release { version: string; notes: string[]; apk: string; page: string }
export const useUpdate = create<{ available: Release | null; dismissed: boolean }>(() => ({ available: null, dismissed: false }));

/** 1.10.0 > 1.9.3; anything that isn't x.y.z counts as 0.0.0. */
export function newer(a: string, b: string) {
  const p = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : [0, 0, 0]);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Release notes → plain bullet lines (drops headings, links-only lines and markdown decoration). */
export function noteLines(body: string): string[] {
  return body.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !/^\*\*Full Changelog\*\*/i.test(l) && !/^(what's changed|new contributors)/i.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/ by @\S+ in https?:\/\/\S+$/, ''))
    .filter((l) => l.length > 1)
    .slice(0, 10);
}

const load = (): { checkedAt?: number; latest?: Release | null; snoozed?: Record<string, number> } => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } };
const save = (v: ReturnType<typeof load>) => localStorage.setItem(LS, JSON.stringify(v));

/** `force`: from the "Check for updates" button — ignores the timer and snoozes, returns the result. */
export async function checkForUpdate(force = false): Promise<Release | null> {
  const st = load();
  const show = (rel: Release | null) => {
    const ok = rel && newer(rel.version, APP_VERSION) ? rel : null;
    useUpdate.setState({ available: ok, dismissed: !!ok && !force && Date.now() < (st.snoozed?.[ok.version] ?? 0) });
    return ok;
  };
  // Checked recently: reuse what GitHub said last time instead of asking again.
  if (!force && st.checkedAt && Date.now() - st.checkedAt < CHECK_EVERY_MS) return show(st.latest ?? null);
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const j = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
  const version = j.tag_name.replace(/^v/, '');
  const apk = j.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url ?? j.html_url;
  const latest: Release = { version, notes: noteLines(j.body ?? ''), apk, page: j.html_url };
  save({ ...st, checkedAt: Date.now(), latest });
  return show(latest);
}

export function snoozeUpdate() {
  const v = useUpdate.getState().available?.version;
  if (!v) return;
  const st = load();
  save({ ...st, snoozed: { [v]: Date.now() + SNOOZE_MS } });
  useUpdate.setState({ dismissed: true });
}

/** Android app only — the web version updates itself through the service worker. */
export function initUpdateCheck() {
  if (!isNative) return;
  const run = () => void checkForUpdate().catch(() => {});
  setTimeout(run, 4000); // let the app settle first
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
}
