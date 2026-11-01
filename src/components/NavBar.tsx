import { go } from '../lib/router';
import { motion } from 'framer-motion';

const ITEMS = [
  { key: '', label: 'Home', icon: (a: boolean) => <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" fill={a ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /> },
  { key: 'learn', label: 'Learn', icon: (a: boolean) => <path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z M12 6v14" fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.25 : 0} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /> },
  { key: 'play', label: 'Play', icon: (a: boolean) => <><circle cx="12" cy="12" r="9" fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.25 : 0} stroke="currentColor" strokeWidth="2" /><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" /></> },
  { key: 'iq', label: 'IQ', icon: (a: boolean) => <><path d="M3 18l5-6 4 3 6-8 3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />{a && <circle cx="18" cy="7" r="2.5" fill="currentColor" />}</> },
  { key: 'passport', label: 'Passport', icon: (a: boolean) => <><rect x="5" y="3" width="14" height="18" rx="2" fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.25 : 0} stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="11" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M9 17h6" stroke="currentColor" strokeWidth="2" /></> },
];

export function NavBar({ active }: { active: string }) {
  return (
    <nav className="app-nav fixed bottom-0 inset-x-0 z-30 bg-deep border-t border-line/70 rounded-t-[26px] shadow-[0_-10px_40px_rgba(0,0,0,.45)]" style={{ paddingBottom: 'max(var(--sab), 6px)' }}>
      <div className="mx-auto max-w-md flex justify-around px-2 pt-1.5">
        {ITEMS.map((it) => {
          const a = active === it.key || (it.key === 'passport' && (active === 'me' || active === 'atlas'));
          return (
            <button key={it.key} onClick={() => go('/' + it.key)} className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl transition-colors ${a ? 'text-amber' : 'text-mist hover:text-paper'}`}>
              {a && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-amber/10" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
              <svg viewBox="0 0 24 24" width="24" height="24" className="relative">{it.icon(a)}</svg>
              <span className="relative text-xs font-bold tracking-wide">{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
