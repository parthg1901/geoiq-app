/** "A new version is ready" popup (Android app; see lib/update.ts). */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useUpdate, snoozeUpdate, APP_VERSION } from '../lib/update';
import { onBack } from '../lib/native';

export default function UpdatePrompt() {
  const { available: rel, dismissed } = useUpdate();
  const open = !!rel && !dismissed;
  useEffect(() => (open ? onBack(snoozeUpdate) : undefined), [open]);
  return createPortal(
    <AnimatePresence>
      {open && rel && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] bg-ink/80 grid place-items-center p-4" onClick={snoozeUpdate}>
          <motion.div initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} className="card p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl text-center">🎁</div>
            <div className="display text-2xl font-extrabold text-center mt-1">Update available</div>
            <div className="text-center text-mist text-sm mt-0.5">GeoIQ <b className="text-amber mono">{rel.version}</b> · you have <span className="mono">{APP_VERSION}</span></div>
            {rel.notes.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm max-h-48 overflow-y-auto">
                {rel.notes.map((n, i) => <li key={i} className="flex gap-2"><span className="text-amber">•</span><span className="leading-snug">{n}</span></li>)}
              </ul>
            )}
            <p className="text-xs text-mist mt-4 leading-snug">Download the APK and open it to install. Your progress stays — updates are signed with the same key. Using Obtainium? It’ll update for you.</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button className="btn btn-ghost" onClick={snoozeUpdate}>Later</button>
              <a className="btn btn-primary text-center" href={rel.apk} onClick={() => setTimeout(snoozeUpdate, 300)}>Download</a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
