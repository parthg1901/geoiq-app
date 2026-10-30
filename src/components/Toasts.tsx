import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

interface Toast { id: number; icon: string; title: string; body?: string }
export const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (t) => set((s) => ({ list: [...s.list, { ...t, id: Date.now() + Math.random() }] })),
  drop: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}));
export const toast = (t: Omit<Toast, 'id'>) => useToasts.getState().push(t);

function Item({ t }: { t: Toast }) {
  const drop = useToasts((s) => s.drop);
  useEffect(() => { const h = setTimeout(() => drop(t.id), 3800); return () => clearTimeout(h); }, [t.id, drop]);
  return (
    <motion.div layout initial={{ y: -40, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -30, opacity: 0 }}
      onClick={() => drop(t.id)}
      className="pointer-events-auto card !rounded-2xl px-4 py-3 flex items-center gap-3 border-amber/50 shadow-[0_10px_40px_rgba(255,181,71,.25)]">
      <span className="text-3xl">{t.icon}</span>
      <div><div className="display font-bold text-amber">{t.title}</div>{t.body && <div className="text-sm text-mist">{t.body}</div>}</div>
    </motion.div>
  );
}

export function Toasts() {
  const list = useToasts((s) => s.list);
  return (
    <div style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }} className="fixed inset-x-0 z-[70] flex flex-col items-center gap-2 pointer-events-none px-4">
      <AnimatePresence>{list.map((t) => <Item key={t.id} t={t} />)}</AnimatePresence>
    </div>
  );
}
