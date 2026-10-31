import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { go } from '../lib/router';

export function TopBar({ title, onClose, right }: { title?: React.ReactNode; onClose?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <button aria-label="Back" onClick={onClose ?? (() => history.length > 1 ? history.back() : go('/'))}
        className="w-10 h-10 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line text-lg">✕</button>
      <div className="flex-1 min-w-0 display font-bold text-lg leading-tight break-words">{title}</div>
      {right}
    </div>
  );
}

export function Progress({ value, color = 'var(--color-amber)', className = '', h = 10 }: { value: number; color?: string; className?: string; h?: number }) {
  return (
    <div className={`w-full rounded-full bg-white/8 overflow-hidden ${className}`} style={{ height: h, background: 'rgba(255,255,255,.08)' }}>
      <motion.div className="h-full rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }}
        initial={false} animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, color = 'var(--color-amber)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }} transition={{ duration: 1, ease: 'easeOut' }} />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`relative mx-auto px-4 pb-24 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mt-7 mb-3 flex items-end justify-between gap-3">
      <h2 className="display text-xl font-extrabold tracking-tight">{children}</h2>
      {sub && <div className="text-sm text-mist">{sub}</div>}
    </div>
  );
}

/** Animated count-up number. */
export function CountUp({ to, from = 0, duration = 1.2, className = '' }: { to: number; from?: number; duration?: number; className?: string }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / (duration * 1000));
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, from, duration]);
  return <span className={className}>{v}</span>;
}
