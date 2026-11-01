/**
 * Progress sync across phones with a sync code (no account). See ./merge.ts for how two copies are
 * combined and ./crypto.ts for the code → vault id / encryption key. Server: server/src/vault.ts.
 *
 * Local bookkeeping: `geonaut-sync` = { code, id, rev, w } and `geonaut-sync-base` = the snapshot both
 * this phone and the cloud agreed on at `rev` (the base of the three-way merge).
 * Every upload carries a random write id; the cloud copy keeps the last few (`w`). If an upload
 * lands but its reply is lost, the next sync recognises its own write id and doesn't count it twice.
 * When: on app open/resume (pull), when the app is hidden (push), and ~30 s after progress changes.
 */
import { create } from 'zustand';
import { useGame, initial, type State } from '../store';
import { MP_URL } from '../mp/api';
import { isNative } from '../native';
import { snapshot, mergeSnapshots, same, type Snapshot } from './merge';
import { newCode, normalizeCode, vaultId, seal, open } from './crypto';

const CONF_KEY = 'geonaut-sync';
const BASE_KEY = 'geonaut-sync-base';
interface Conf { code: string; id: string; rev: number; w: string[] }
/** What is encrypted into the cloud copy: the progress and the ids of the latest writes. */
interface Sealed { s: Snapshot; w: string[] }
const PENDING_KEY = 'geonaut-sync-pending';
interface Pending { wid: string; snap: Snapshot }

export interface SyncStatus { code: string | null; busy: boolean; lastAt: number | null; error: string | null }
export const useSync = create<SyncStatus>(() => ({ code: null, busy: false, lastAt: null, error: null }));

let conf: Conf | null = null;
try { conf = JSON.parse(localStorage.getItem(CONF_KEY) ?? 'null'); if (conf) conf.w ??= []; } catch { conf = null; }
useSync.setState({ code: conf?.code ?? null, lastAt: Number(localStorage.getItem(CONF_KEY + '-at')) || null });

const saveConf = (c: Conf | null) => {
  conf = c;
  if (c) localStorage.setItem(CONF_KEY, JSON.stringify(c)); else localStorage.removeItem(CONF_KEY);
  useSync.setState({ code: c?.code ?? null });
};
const loadBase = (): Snapshot | null => { try { return JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null'); } catch { return null; } };
const saveBase = (b: Snapshot | null) => (b ? localStorage.setItem(BASE_KEY, JSON.stringify(b)) : localStorage.removeItem(BASE_KEY));
/** Uploads whose reply never arrived (newest last; a few in case several replies were lost in a row). */
const loadPending = (): Pending[] => { try { const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };
const savePending = (p: Pending[] | null) => (p?.length ? localStorage.setItem(PENDING_KEY, JSON.stringify(p.slice(-3))) : localStorage.removeItem(PENDING_KEY));
const newWid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
async function unseal(code: string, blob: string): Promise<{ theirs: Snapshot; w: string[] }> {
  const p = await open<Sealed>(code, blob);
  return { theirs: normalize(p.s), w: Array.isArray(p.w) ? p.w : [] };
}

/** Fill fields a copy from another app version may lack. */
export function normalize(x: Partial<Snapshot>): Snapshot {
  const d = snapshot(initial() as unknown as State);
  return { ...d, ...x, streak: { ...d.streak, ...x.streak }, mp: { ...d.mp, ...x.mp } };
}

/** Write a merged snapshot into the game, keeping this phone's own settings and device identity. */
export function apply(next: Snapshot) {
  const s = useGame.getState();
  useGame.setState({ ...next, mp: { ...s.mp, ...next.mp, deviceId: s.mp.deviceId, lastGame: s.mp.lastGame, lastResult: s.mp.lastResult } });
}

export class SyncError extends Error {}
async function call(method: string, id: string, body?: unknown, query = ''): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${MP_URL}/api/sync/${id}${query}`, {
      method, signal: ctl.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    throw new SyncError("Can't reach the sync server — you're probably offline. Progress is safe on this phone.");
  } finally { clearTimeout(t); }
}
const serverError = (r: { status: number; json: Record<string, unknown> }) =>
  new SyncError(r.status === 429 ? 'Syncing too often — will retry shortly.' : `Sync server problem (${r.status}${r.json.error ? `: ${r.json.error}` : ''}).`);

let onGone: (() => void) | null = null;
/** Called when the cloud copy disappeared (deleted from another phone): sync turns off here. */
export const onSyncGone = (fn: () => void) => { onGone = fn; };
function gone() { saveConf(null); saveBase(null); savePending(null); onGone?.(); }

async function run(mode: 'pull' | 'push') {
  const c = conf;
  if (!c) return;
  let local = snapshot(useGame.getState());
  let base = loadBase();
  let remote: { rev: number; blob: string } | null = null;
  if (mode === 'push' && base && same(local, base)) return; // nothing new
  if (mode === 'pull') {
    const r = await call('GET', c.id, undefined, `?rev=${c.rev}`);
    if (r.status === 404) { if (c.rev > 0) return gone(); }
    else if (r.status !== 200) throw serverError(r);
    else if (!r.json.same) remote = r.json as { rev: number; blob: string };
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (remote) {
      const { theirs, w } = await unseal(c.code, remote.blob);
      const landed = loadPending().filter((p) => w.includes(p.wid)).pop(); // an upload of ours did land
      if (landed) base = landed.snap;
      savePending(null);
      c.w = w;
      const merged = mergeSnapshots(base, local, theirs);
      // Anything played while we were on the network is layered on top of the merge.
      const now = snapshot(useGame.getState());
      const final = same(now, local) ? merged : mergeSnapshots(local, now, merged);
      if (!same(final, now)) apply(final);
      // Saved in the same tick as apply: from now on the cloud copy at this revision is the base.
      base = theirs; saveBase(base); saveConf({ ...c, rev: remote.rev }); c.rev = remote.rev;
      local = snapshot(useGame.getState());
      remote = null;
    }
    if (base && same(local, base)) break;
    const wid = newWid();
    const w = [...c.w, wid].slice(-20);
    savePending([...loadPending(), { wid, snap: local }]);
    const r = await call('PUT', c.id, { baseRev: c.rev, blob: await seal(c.code, { s: local, w } satisfies Sealed) });
    if (r.status === 200) { base = local; saveBase(base); savePending(null); c.rev = r.json.rev as number; c.w = w; saveConf({ ...c }); break; }
    if (r.status === 409) { remote = r.json as { rev: number; blob: string }; continue; }
    if (r.status === 404) return gone();
    throw serverError(r);
  }
  const at = Date.now();
  localStorage.setItem(CONF_KEY + '-at', String(at));
  useSync.setState({ lastAt: at });
}

let running: Promise<void> | null = null;
let queued: 'pull' | 'push' | null = null;
/** Sync now. 'pull' checks the cloud first (app open/resume); 'push' only uploads local changes. */
export function syncNow(mode: 'pull' | 'push' = 'pull'): Promise<void> {
  if (!conf) return Promise.resolve();
  if (running) { if (queued !== 'pull') queued = mode; return running; }
  useSync.setState({ busy: true });
  running = run(mode)
    .then(() => useSync.setState({ error: null }))
    .catch((e) => { useSync.setState({ error: e instanceof SyncError ? e.message : String(e?.message ?? e) }); })
    .finally(() => {
      running = null;
      useSync.setState({ busy: false });
      if (queued) { const m = queued; queued = null; void syncNow(m); }
    });
  return running;
}

/** Turn sync on with a brand-new code (uploads this phone's progress). */
export async function enableSync(): Promise<string> {
  const code = newCode();
  saveBase(null); savePending(null);
  saveConf({ code, id: await vaultId(code), rev: 0, w: [] });
  await syncNow('push');
  const err = useSync.getState().error;
  if (err) { saveConf(null); throw new SyncError(err); }
  return code;
}

export interface Found { code: string; id: string; rev: number; theirs: Snapshot; w: string[] }
/** Look up a code typed on another phone before linking. */
export async function findCode(input: string): Promise<Found> {
  const code = normalizeCode(input);
  if (!code) throw new SyncError('That doesn’t look like a sync code — it has 20 letters and digits.');
  const id = await vaultId(code);
  const r = await call('GET', id);
  if (r.status === 404) throw new SyncError('No progress found for that code. Check it on the other phone (Profile → Sync).');
  if (r.status !== 200) throw serverError(r);
  const { theirs, w } = await unseal(code, r.json.blob as string);
  return { code, id, rev: r.json.rev as number, theirs, w };
}

/** Link this phone: 'replace' takes the cloud progress as-is, 'combine' merges this phone's progress in. */
export async function linkSync(f: Found, how: 'replace' | 'combine') {
  const local = snapshot(useGame.getState());
  apply(how === 'replace' ? f.theirs : mergeSnapshots(null, local, f.theirs));
  saveBase(f.theirs); savePending(null);
  saveConf({ code: f.code, id: f.id, rev: f.rev, w: f.w });
  await syncNow('push');
}

/** Stop syncing on this phone; optionally delete the cloud copy (other phones then stop too). */
export async function disableSync(deleteCloud: boolean) {
  const c = conf;
  if (!c) return;
  if (deleteCloud) {
    const r = await call('DELETE', c.id);
    if (r.status !== 200) throw serverError(r);
  }
  saveConf(null); saveBase(null); savePending(null);
  localStorage.removeItem(CONF_KEY + '-at');
  useSync.setState({ lastAt: null, error: null });
}

/** Hook sync into the app lifecycle (call once at startup). */
export function initSync() {
  void syncNow('pull');
  document.addEventListener('visibilitychange', () => void syncNow(document.visibilityState === 'hidden' ? 'push' : 'pull'));
  if (isNative) import('@capacitor/app').then(({ App }) => { App.addListener('pause', () => void syncNow('push')); App.addListener('resume', () => void syncNow('pull')); }).catch(() => {});
  // Push ~30 s after progress stops changing, and at least every 3 minutes during long sessions.
  let timer = 0, firstChange = 0;
  useGame.subscribe((s, prev) => {
    if (!conf || s === prev) return;
    const now = Date.now();
    if (!firstChange) firstChange = now;
    clearTimeout(timer);
    const wait = Math.max(0, Math.min(30_000, firstChange + 180_000 - now));
    timer = window.setTimeout(() => { firstChange = 0; void syncNow('push'); }, wait);
  });
}
