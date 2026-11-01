import { motion } from 'framer-motion';
import { SKILLS, SKILL_LABEL, toIQ, TIERS, tierFor, type Ratings } from '../../lib/iq';

/** Six-axis skill radar. Axes with no answers are drawn dimmed at the baseline. */
export function Radar({ ratings, size = 300 }: { ratings: Ratings; size?: number }) {
  const c = size / 2, R = size / 2 - 46;
  const lo = 70, hi = 135;
  const val = (iq: number) => Math.max(0.04, Math.min(1, (iq - lo) / (hi - lo)));
  const ang = (i: number) => (-90 + (360 / SKILLS.length) * i) * (Math.PI / 180);
  const pt = (i: number, r: number) => [c + Math.cos(ang(i)) * r, c + Math.sin(ang(i)) * r];
  const pts = SKILLS.map((s, i) => pt(i, R * (ratings[s].n ? val(toIQ(ratings[s].theta)) : val(100) * 0.6)));
  const poly = pts.map((p) => p.join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[320px] mx-auto" role="img" aria-label="Skill radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={SKILLS.map((_, i) => pt(i, R * f).join(',')).join(' ')} fill="none" stroke="rgba(142,163,204,.15)" />
      ))}
      {/* 100-IQ reference ring */}
      <polygon points={SKILLS.map((_, i) => pt(i, R * val(100)).join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,.35)" strokeDasharray="3 4" />
      {SKILLS.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(142,163,204,.15)" />; })}
      <motion.polygon points={poly} fill="rgba(255,181,71,.22)" stroke="#ffb547" strokeWidth={2.5} strokeLinejoin="round"
        initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 90, damping: 14 }}
        style={{ transformOrigin: `${c}px ${c}px` }} />
      {SKILLS.map((s, i) => {
        const [x, y] = pts[i];
        const [lx, ly] = pt(i, R + 26);
        const n = ratings[s].n;
        const iq = toIQ(ratings[s].theta);
        return (
          <g key={s}>
            <circle cx={x} cy={y} r={4} fill={n ? '#ffb547' : '#4b5d85'} stroke="#070d1c" strokeWidth={2} />
            <text x={lx} y={ly - 6} textAnchor="middle" fontSize="11.5" fontWeight={700} fill={n ? '#eef2ff' : '#6d80a8'} style={{ fontFamily: 'var(--font-display)' }}>{SKILL_LABEL[s]}</text>
            <text x={lx} y={ly + 9} textAnchor="middle" fontSize="11" fill={n ? tierFor(iq).color : '#6d80a8'} style={{ fontFamily: 'var(--font-mono)' }}>{n ? iq : '—'}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Smooth IQ history line with gradient area and test markers. */
export function HistoryChart({ history, tests }: { history: { date: string; iq: number }[]; tests: { date: string; iq: number }[] }) {
  const W = 340, H = 170, P = { l: 30, r: 12, t: 14, b: 24 };
  const pts = history.slice(-30);
  if (pts.length < 2) {
    return <div className="h-[170px] grid place-items-center text-sm text-mist text-center px-6">Play on a couple of different days to see your IQ trend line grow here.</div>;
  }
  const iqs = [...pts.map((p) => p.iq), ...tests.map((t) => t.iq)];
  const lo = Math.floor((Math.min(...iqs, 95) - 5) / 5) * 5, hi = Math.ceil((Math.max(...iqs, 105) + 5) / 5) * 5;
  const x = (i: number) => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const xy = pts.map((p, i) => [x(i), y(p.iq)] as const);
  // Catmull-Rom → cubic bezier for a smooth line
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${xy[xy.length - 1][0]},${H - P.b} L${xy[0][0]},${H - P.b} Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const idxOf = (date: string) => pts.findIndex((p) => p.date === date);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="IQ over time">
      <defs>
        <linearGradient id="iq-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffb547" stopOpacity=".35" />
          <stop offset="100%" stopColor="#ffb547" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="rgba(142,163,204,.12)" />
          <text x={P.l - 6} y={y(t)} dy="0.35em" textAnchor="end" fontSize="10" fill="#8ea3cc" style={{ fontFamily: 'var(--font-mono)' }}>{t}</text>
        </g>
      ))}
      {lo < 100 && hi > 100 && <line x1={P.l} x2={W - P.r} y1={y(100)} y2={y(100)} stroke="rgba(255,255,255,.3)" strokeDasharray="3 4" />}
      <motion.path d={area} fill="url(#iq-area)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} />
      <motion.path d={d} fill="none" stroke="#ffb547" strokeWidth={2.5} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
      {tests.map((t, i) => {
        const j = idxOf(t.date);
        if (j < 0) return null;
        return (
          <g key={i}>
            <circle cx={x(j)} cy={y(t.iq)} r={6} fill="#b48cff" stroke="#070d1c" strokeWidth={2} />
            <text x={x(j)} y={y(t.iq) - 10} textAnchor="middle" fontSize="9" fontWeight={700} fill="#b48cff">TEST</text>
          </g>
        );
      })}
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={5} fill="#ffb547" stroke="#fff" strokeWidth={2} />
      <text x={P.l} y={H - 6} fontSize="10" fill="#8ea3cc">{pts[0].date.slice(5)}</text>
      <text x={W - P.r} y={H - 6} textAnchor="end" fontSize="10" fill="#8ea3cc">{pts[pts.length - 1].date.slice(5)}</text>
    </svg>
  );
}

/** Vertical tier ladder with a "you are here" marker. */
export function TierLadder({ iq }: { iq: number }) {
  const cur = tierFor(iq);
  const ci = TIERS.indexOf(cur);
  const next = TIERS[ci + 1];
  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-2 gap-y-4">
        {TIERS.map((t, i) => {
          const reached = i <= ci;
          const span = next && i === ci ? Math.max(0.05, Math.min(1, (iq - t.min) / (next.min - t.min))) : reached ? 1 : 0;
          return (
            <div key={t.name} className="flex-1 min-w-0 text-center">
              <div className={`text-xl ${reached ? '' : 'grayscale opacity-40'} ${i === ci ? 'scale-125' : ''} transition-transform`}>{t.emoji}</div>
              <div className="h-2 rounded-full bg-white/8 mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
                <motion.div className="h-full rounded-full" style={{ background: t.color }} initial={{ width: 0 }} animate={{ width: `${(i < ci ? 1 : span) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.08 }} />
              </div>
              <div className={`text-[13px] mt-1 font-bold leading-tight ${i === ci ? '' : 'text-mist'}`} style={i === ci ? { color: t.color } : undefined}>{t.name}</div>
              <div className="text-xs mono text-mist/90">{t.min || '<88'}</div>
            </div>
          );
        })}
      </div>
      <div className="text-sm text-mist mt-3 text-center">
        {next ? <><b className="text-paper mono">{next.min - iq}</b> points to {next.emoji} <b style={{ color: next.color }}>{next.name}</b></> : 'Top tier reached. The world is your atlas.'}
      </div>
    </div>
  );
}
