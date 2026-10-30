import { hash } from '../../lib/rng';
import { BY_ID } from '../../data';
import { useShapes } from '../Shape';

export const REGION_INK: Record<string, string> = {
  Europe: '#53b8ff', Asia: '#ff6b5e', Africa: '#ffb547', Americas: '#3ddc97', Oceania: '#b48cff',
};

/** Procedurally generated ink stamp for a country. */
export function Stamp({ id, date, size = 104 }: { id: string; date?: string; size?: number }) {
  const c = BY_ID[id];
  const shapes = useShapes();
  const h = hash(id);
  const kind = h % 4; // 0 circle, 1 rounded rect, 2 hexagon, 3 double ring
  const rot = ((h >> 3) % 17) - 8;
  const ink = REGION_INK[c.region] ?? '#ffb547';
  const fid = `grunge-${id}`;
  const name = c.name.toUpperCase();
  const label = name.length > 16 ? name.slice(0, 15) + '…' : name;
  const hex = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 6; return `${50 + 46 * Math.cos(a)},${50 + 46 * Math.sin(a)}`; }).join(' ');
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ transform: `rotate(${rot}deg)`, overflow: 'visible' }}>
      <defs>
        <filter id={fid}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={h % 97} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.35" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <path id={`arc-${id}`} d="M 50 50 m -36 0 a 36 36 0 1 1 72 0" />
        <path id={`arcb-${id}`} d="M 50 50 m -38 0 a 38 38 0 0 0 76 0" />
      </defs>
      <g filter={`url(#${fid})`} fill="none" stroke={ink} strokeWidth="2.4" opacity={0.92}>
        {kind === 0 && <><circle cx="50" cy="50" r="46" /><circle cx="50" cy="50" r="28" strokeWidth="1.2" /></>}
        {kind === 1 && <><rect x="5" y="14" width="90" height="72" rx="10" /><rect x="11" y="20" width="78" height="60" rx="6" strokeWidth="1.2" /></>}
        {kind === 2 && <><polygon points={hex} /><circle cx="50" cy="50" r="28" strokeWidth="1.2" strokeDasharray="3 2" /></>}
        {kind === 3 && <><circle cx="50" cy="50" r="47" strokeWidth="3.2" /><circle cx="50" cy="50" r="42" strokeWidth="1" /><circle cx="50" cy="50" r="28" strokeWidth="1.2" /></>}
        {kind === 1 ? (
          <>
            <text x="50" y="31" textAnchor="middle" fontSize="8" fontWeight="800" fill={ink} stroke="none" letterSpacing="0.8" style={{ fontFamily: 'var(--font-display)' }}>{label}</text>
            {date && <text x="50" y="76" textAnchor="middle" fontSize="7" fill={ink} stroke="none" style={{ fontFamily: 'var(--font-mono)' }}>{date}</text>}
          </>
        ) : (
          <>
            <text fontSize="8" fontWeight="800" fill={ink} stroke="none" letterSpacing="1" style={{ fontFamily: 'var(--font-display)' }}>
              <textPath href={`#arc-${id}`} startOffset="50%" textAnchor="middle">{label}</textPath>
            </text>
            {date && (
              <text fontSize="7" fill={ink} stroke="none" style={{ fontFamily: 'var(--font-mono)' }}>
                <textPath href={`#arcb-${id}`} startOffset="50%" textAnchor="middle" dominantBaseline="hanging">{date}</textPath>
              </text>
            )}
          </>
        )}
        {shapes?.[id] && (
          <g transform="translate(34 34) scale(0.16)">
            <path d={shapes[id]} fill={ink} stroke="none" fillRule="evenodd" />
          </g>
        )}
      </g>
    </svg>
  );
}
