import { sfx } from '../../lib/sound';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/**
 * On-screen letter keyboard. Using our own keys (instead of a focused <input>) means the phone's
 * keyboard never opens and squashes the grid.
 */
export function Keyboard({ onKey, onBack, onToggle, dir }: { onKey: (l: string) => void; onBack: () => void; onToggle: () => void; dir: 'across' | 'down' }) {
  const key = (label: React.ReactNode, onPress: () => void, cls = '', aria?: string) => (
    <button
      aria-label={aria}
      onPointerDown={(e) => { e.preventDefault(); sfx.tap(); onPress(); }}
      className={`h-12 rounded-xl bg-panel2 border border-line/70 display font-bold text-lg active:bg-amber active:text-ink select-none touch-manipulation ${cls}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-1.5 px-1.5 pb-2 pt-2">
      {ROWS.map((row, i) => (
        <div key={row} className="flex gap-1.5 justify-center">
          {i === 2 && key(dir === 'across' ? '⇄' : '⇅', onToggle, 'w-[13%] text-amber', `Switch to ${dir === 'across' ? 'down' : 'across'}`)}
          {[...row].map((l) => key(l, () => onKey(l), 'flex-1 max-w-11'))}
          {i === 2 && key('⌫', onBack, 'w-[13%]', 'Delete')}
        </div>
      ))}
    </div>
  );
}
