import { useEffect, useState } from 'react';
import { onBack } from '../lib/native';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGame } from '../lib/store';
import { todayKey } from '../lib/rng';
import { sfx } from '../lib/sound';

export const PRIZES = [
  { label: '+20 XP', color: '#53b8ff', apply: () => useGame.getState().addXP(20) },
  { label: '+30 🪙', color: '#ffb547', apply: () => useGame.getState().set({ coins: useGame.getState().coins + 30 }) },
  { label: '+50 XP', color: '#3ddc97', apply: () => useGame.getState().addXP(50) },
  { label: '🧊 Freeze', color: '#9fe7ff', apply: () => { const s = useGame.getState(); s.set({ streak: { ...s.streak, freezes: Math.min(3, s.streak.freezes + 1) } }); } },
  { label: '+15 XP', color: '#b48cff', apply: () => useGame.getState().addXP(15) },
  { label: '+80 🪙', color: '#ff6b5e', apply: () => useGame.getState().set({ coins: useGame.getState().coins + 80 }) },
  { label: '+100 XP', color: '#ff5d73', apply: () => useGame.getState().addXP(100) },
  { label: '+10 🪙', color: '#8aa0c8', apply: () => useGame.getState().set({ coins: useGame.getState().coins + 10 }) },
];
const WEIGHTS = [22, 18, 12, 6, 20, 5, 3, 14];

export function SpinWheel({ onClose }: { onClose: () => void }) {
  const set = useGame((s) => s.set);
  const [angle, setAngle] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const n = PRIZES.length, seg = 360 / n;
  useEffect(() => onBack(() => { if (!spinning) onClose(); }), [spinning, onClose]);

  const spin = () => {
    if (spinning || result != null) return;
    let x = Math.random() * WEIGHTS.reduce((a, b) => a + b, 0), i = 0;
    while ((x -= WEIGHTS[i]) > 0) i++;
    setSpinning(true);
    set({ spinDay: todayKey() });
    // pointer at top: segment i centre must end at -90deg
    const target = 360 * 6 + (360 - (i * seg + seg / 2));
    setAngle(target);
    const ticks = setInterval(() => sfx.spin(), 90);
    setTimeout(() => {
      clearInterval(ticks);
      setSpinning(false); setResult(i); PRIZES[i].apply(); sfx.win();
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.45 }, colors: [PRIZES[i].color, '#fff', '#ffb547'] });
    }, 4200);
  };

  const R = 140;
  return (
    <div className="fixed inset-0 z-50 bg-ink/90 grid place-items-center p-4" onClick={() => !spinning && onClose()}>
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
        <div className="display text-2xl font-extrabold">Daily Check-in</div>
        <div className="text-mist text-sm">Spin once a day for a free reward</div>
        <div className="relative mx-auto mt-5" style={{ width: R * 2, height: R * 2 }}>
          <div className="absolute left-1/2 -top-3 -translate-x-1/2 z-10 w-0 h-0 border-l-[14px] border-r-[14px] border-t-[26px] border-l-transparent border-r-transparent border-t-amber drop-shadow-lg" />
          <motion.svg viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} width={R * 2} height={R * 2} animate={{ rotate: angle }} transition={{ duration: 4.1, ease: [0.15, 0.85, 0.25, 1] }}>
            {PRIZES.map((p, i) => {
              const a0 = ((i * seg - 90) * Math.PI) / 180, a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
              const mid = ((i + 0.5) * seg - 90);
              return (
                <g key={i}>
                  <path d={`M0 0 L${R * Math.cos(a0)} ${R * Math.sin(a0)} A${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} Z`} fill={p.color} fillOpacity={result == null || result === i ? 0.9 : 0.3} stroke="#070d1c" strokeWidth={3} />
                  <text transform={`rotate(${mid}) translate(${R * 0.62} 0) rotate(90)`} textAnchor="middle" dy="0.35em" fontSize="15" fontWeight="800" fill="#070d1c" style={{ fontFamily: 'var(--font-display)' }}>{p.label}</text>
                </g>
              );
            })}
            <circle r={26} fill="#070d1c" stroke="#ffb547" strokeWidth={4} />
            <text textAnchor="middle" dy="0.35em" fontSize="20">🌍</text>
          </motion.svg>
        </div>
        {result == null ? (
          <button className="btn btn-primary w-full mt-6" disabled={spinning} onClick={spin}>{spinning ? 'Spinning…' : 'Spin!'}</button>
        ) : (
          <>
            <div className="display text-xl font-bold mt-5">You won <span style={{ color: PRIZES[result].color }}>{PRIZES[result].label}</span></div>
            <button className="btn btn-mint w-full mt-3" onClick={onClose}>Collect</button>
          </>
        )}
      </motion.div>
    </div>
  );
}
