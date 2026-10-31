import { useEffect } from 'react';
import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { onBack } from '../lib/native';

/**
 * In-app confirmation sheet. Unlike window.confirm it doesn't block the page, so live-game
 * WebSockets and timers keep running while it's open.
 */
interface Ask { message: string; confirm: string; danger: boolean; resolve: (ok: boolean) => void }
const useConfirm = create<{ ask: Ask | null }>(() => ({ ask: null }));

export function askConfirm(message: string, opts: { confirm?: string; danger?: boolean } = {}): Promise<boolean> {
  useConfirm.getState().ask?.resolve(false);
  return new Promise((resolve) => useConfirm.setState({ ask: { message, confirm: opts.confirm ?? 'OK', danger: opts.danger ?? true, resolve } }));
}

export function ConfirmHost() {
  const ask = useConfirm((s) => s.ask);
  const close = (ok: boolean) => { ask?.resolve(ok); useConfirm.setState({ ask: null }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (ask ? onBack(() => close(false)) : undefined), [ask]);
  return (
    <AnimatePresence>
      {ask && (
        <motion.div key="confirm" className="fixed inset-0 z-[90] bg-ink/80 flex items-end sm:items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => close(false)}>
          <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-deep border-t border-line sm:border sm:rounded-3xl rounded-t-3xl p-5" style={{ paddingBottom: 'calc(var(--sab) + 1.25rem)' }}>
            <div className="display text-lg font-bold leading-snug">{ask.message}</div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button className="btn btn-ghost" onClick={() => close(false)}>Cancel</button>
              <button className={`btn ${ask.danger ? 'bg-rose text-ink' : 'btn-primary'}`} onClick={() => close(true)}>{ask.confirm}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
