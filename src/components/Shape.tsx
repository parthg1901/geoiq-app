import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { loadShapes } from '../data';

export function useShapes() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  useEffect(() => { loadShapes().then(setS); }, []);
  return s;
}

/** A country silhouette, normalized to a 200×200 box. */
export function Shape({ id, size = 220, color = 'var(--color-amber)', rotate = 0, glow = true, className = '', reveal = 1 }: {
  id: string; size?: number | string; color?: string; rotate?: number; glow?: boolean; className?: string; reveal?: number;
}) {
  const shapes = useShapes();
  const d = shapes?.[id];
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={className} style={{ overflow: 'visible' }}>
      <defs>
        <filter id="shape-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {d ? (
        <motion.g
          key={id}
          initial={{ opacity: 0, scale: 0.6, rotate: rotate - 25 }}
          animate={{ opacity: 1, scale: 1, rotate }}
          transition={{ type: 'spring', stiffness: 160, damping: 16 }}
          style={{ transformOrigin: '100px 100px', filter: reveal < 1 ? `blur(${(1 - reveal) * 14}px)` : undefined }}
        >
          <path d={d} fill={color} fillRule="evenodd" filter={glow ? 'url(#shape-glow)' : undefined} stroke="rgba(255,255,255,.35)" strokeWidth={0.6} />
        </motion.g>
      ) : (
        <circle cx="100" cy="100" r="30" fill="none" stroke="var(--color-line)" strokeWidth="3" strokeDasharray="8 8">
          <animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

export function Flag({ id, className = '', style }: { id: string; className?: string; style?: React.CSSProperties }) {
  return <img src={`/flags/${id}.svg`} alt="flag" draggable={false} className={`rounded-md shadow-lg ring-1 ring-white/10 object-cover ${className}`} style={style} />;
}
