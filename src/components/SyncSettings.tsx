/** Profile → Sync & backup: link phones with a sync code, or save/restore a backup file. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame, levelFor } from '../lib/store';
import { geoIQ } from '../lib/geoiq';
import { useSync, syncNow, enableSync, findCode, linkSync, disableSync, type Found } from '../lib/sync';
import { formatCode } from '../lib/sync/crypto';
import type { Snapshot } from '../lib/sync/merge';
import { exportBackup, readBackup, restoreBackup } from '../lib/sync/backup';
import { toast } from './Toasts';

type Dialog =
  | { kind: 'enter' }
  | { kind: 'found'; found: Found }
  | { kind: 'restore'; at: string; progress: Snapshot }
  | { kind: 'off' }
  | null;

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};

function Summary({ p }: { p: Snapshot }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-3 text-center">
      {[
        ['Level', levelFor(p.xp).level],
        ['IQ', geoIQ(p.ratings).iq],
        ['Stamps', Object.keys(p.stamps).length],
        ['Streak', `${p.streak.count}🔥`],
      ].map(([k, v]) => (
        <div key={k} className="rounded-xl bg-white/5 border border-line/60 py-2">
          <div className="display font-extrabold">{v}</div>
          <div className="text-[11px] uppercase tracking-wider text-mist font-semibold">{k}</div>
        </div>
      ))}
    </div>
  );
}

export default function SyncSettings() {
  const { code, busy, lastAt, error } = useSync();
  const hasProgress = useGame((s) => s.xp > 0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  const close = () => { setDialog(null); setMsg(''); setInput(''); };
  const attempt = async (fn: () => Promise<void>) => {
    setWorking(true); setMsg('');
    try { await fn(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setWorking(false); }
  };

  const turnOn = () => attempt(async () => {
    await enableSync();
    toast({ icon: '☁️', title: 'Sync is on', body: 'Enter this code on your other phone to share progress.' });
  });
  const shareCode = async () => {
    if (!code) return;
    const text = `My Geonaut sync code: ${formatCode(code)}`;
    try { await navigator.clipboard.writeText(formatCode(code)); toast({ icon: '📋', title: 'Code copied' }); }
    catch { await navigator.share?.({ title: 'Geonaut sync code', text }).catch(() => {}); }
  };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    try { const b = await readBackup(f); setDialog({ kind: 'restore', ...b }); }
    catch (e) { toast({ icon: '⚠️', title: 'Can’t restore', body: e instanceof Error ? e.message : String(e) }); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="card p-4 space-y-4">
      {code ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="display font-bold">☁️ Sync is on</div>
              <div className={`text-sm ${error ? 'text-rose' : 'text-mist'}`}>
                {busy ? 'Syncing…' : error ? error : lastAt ? `Synced ${ago(lastAt)}` : 'Waiting to sync'}
              </div>
            </div>
            <button className="btn btn-ghost !py-1.5 !px-3 text-sm" disabled={busy} onClick={() => void syncNow('pull')}>Sync now</button>
          </div>
          <div className="mt-3 rounded-2xl bg-ink/70 border border-line p-3 text-center">
            <div className="text-xs uppercase tracking-wider text-mist font-semibold">Your sync code</div>
            <div className="mono text-lg sm:text-xl font-bold tracking-wide mt-1 select-all break-all">{formatCode(code)}</div>
            <button className="text-sm text-amber font-semibold mt-1" onClick={shareCode}>Copy code</button>
          </div>
          <p className="text-sm text-mist mt-2 leading-snug">
            Enter it on another phone (Profile → Sync → <i>I have a code</i>). Keep it safe: it’s the only way to reach your progress, and anyone with it can see and change it.
          </p>
          <button className="text-sm text-mist underline mt-2" onClick={() => setDialog({ kind: 'off' })}>Turn off sync…</button>
        </div>
      ) : (
        <div>
          <div className="display font-bold">☁️ Sync across phones</div>
          <p className="text-sm text-mist leading-snug mt-0.5">
            Share progress between phones with a sync code — no account or email. Your progress is encrypted on this phone before it’s uploaded.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn btn-primary !py-2 text-sm" disabled={working} onClick={turnOn}>{working ? '…' : 'Turn on sync'}</button>
            <button className="btn btn-ghost !py-2 text-sm" onClick={() => setDialog({ kind: 'enter' })}>I have a code</button>
          </div>
          {msg && !dialog && <div className="text-sm text-rose mt-2">{msg}</div>}
        </div>
      )}

      <div className="pt-3 border-t border-line/60">
        <div className="display font-bold">💾 Backup file</div>
        <p className="text-sm text-mist leading-snug mt-0.5">Save your progress to a file (e.g. to Drive) and restore it on any phone. Works offline.</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button className="btn btn-ghost !py-2 text-sm" onClick={() => exportBackup().catch((e) => toast({ icon: '⚠️', title: 'Backup failed', body: String(e?.message ?? e) }))}>Save backup</button>
          <button className="btn btn-ghost !py-2 text-sm" onClick={() => fileRef.current?.click()}>Restore…</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
      </div>

      {createPortal(<AnimatePresence>
        {dialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-4" onClick={() => !working && close()}>
            <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} className="card p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              {dialog.kind === 'enter' && (<>
                <div className="display text-xl font-extrabold">Enter your sync code</div>
                <p className="text-sm text-mist mt-1">Find it on your other phone under Profile → Sync.</p>
                <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  onKeyDown={(e) => e.key === 'Enter' && attempt(async () => setDialog({ kind: 'found', found: await findCode(input) }))}
                  className="w-full mt-3 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-xl px-3 py-2 mono text-paper uppercase" />
                {msg && <div className="text-sm text-rose mt-2">{msg}</div>}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button className="btn btn-ghost" onClick={close}>Cancel</button>
                  <button className="btn btn-primary" disabled={working || !input.trim()} onClick={() => attempt(async () => setDialog({ kind: 'found', found: await findCode(input) }))}>{working ? '…' : 'Find'}</button>
                </div>
              </>)}

              {dialog.kind === 'found' && (<>
                <div className="display text-xl font-extrabold">Progress found ☁️</div>
                <Summary p={dialog.found.theirs} />
                {hasProgress ? (<>
                  <p className="text-sm text-mist mt-3">This phone has progress too. <b className="text-paper">Combine</b> keeps every stamp and achievement from both, and the more-practised side of everything else.</p>
                  {msg && <div className="text-sm text-rose mt-2">{msg}</div>}
                  <div className="grid gap-2 mt-4">
                    <button className="btn btn-primary" disabled={working} onClick={() => attempt(async () => { await linkSync(dialog.found, 'combine'); close(); toast({ icon: '☁️', title: 'Phones linked', body: 'Progress combined and syncing.' }); })}>Combine both</button>
                    <button className="btn btn-ghost" disabled={working} onClick={() => attempt(async () => { await linkSync(dialog.found, 'replace'); close(); toast({ icon: '☁️', title: 'Phones linked', body: 'This phone now uses the synced progress.' }); })}>Use the synced progress only</button>
                    <button className="text-sm text-mist mt-1" onClick={close}>Cancel</button>
                  </div>
                </>) : (<>
                  {msg && <div className="text-sm text-rose mt-2">{msg}</div>}
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <button className="btn btn-ghost" onClick={close}>Cancel</button>
                    <button className="btn btn-primary" disabled={working} onClick={() => attempt(async () => { await linkSync(dialog.found, 'replace'); close(); toast({ icon: '☁️', title: 'Phones linked', body: 'Your progress is here.' }); })}>Link</button>
                  </div>
                </>)}
              </>)}

              {dialog.kind === 'restore' && (<>
                <div className="display text-xl font-extrabold">Restore backup?</div>
                <p className="text-sm text-mist mt-1">Saved {dialog.at ? new Date(dialog.at).toLocaleString() : 'at an unknown time'}.</p>
                <Summary p={dialog.progress} />
                <div className="grid gap-2 mt-4">
                  <button className="btn btn-primary" onClick={() => { restoreBackup(dialog.progress, 'combine'); close(); toast({ icon: '💾', title: 'Backup restored', body: 'Combined with this phone’s progress.' }); }}>Combine with this phone</button>
                  <button className="btn btn-ghost" onClick={() => { restoreBackup(dialog.progress, 'replace'); close(); toast({ icon: '💾', title: 'Backup restored' }); }}>Replace this phone’s progress</button>
                  <button className="text-sm text-mist mt-1" onClick={close}>Cancel</button>
                </div>
              </>)}

              {dialog.kind === 'off' && (<>
                <div className="display text-xl font-extrabold">Turn off sync?</div>
                <p className="text-sm text-mist mt-1">Your progress stays on this phone either way.</p>
                {msg && <div className="text-sm text-rose mt-2">{msg}</div>}
                <div className="grid gap-2 mt-4">
                  <button className="btn btn-ghost" disabled={working} onClick={() => attempt(async () => { await disableSync(false); close(); })}>Stop syncing this phone</button>
                  <button className="btn !bg-rose text-white shadow-[0_4px_0_#a8293b]" disabled={working} onClick={() => attempt(async () => { await disableSync(true); close(); toast({ icon: '🗑️', title: 'Cloud copy deleted', body: 'Other phones stop syncing too.' }); })}>Delete the cloud copy</button>
                  <button className="text-sm text-mist mt-1" onClick={close}>Cancel</button>
                </div>
              </>)}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
