import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BY_ID, ARMS, ARMS_WORD, searchCountries, matchCountry } from '../data';
import { Flag } from './Shape';
import { sfx } from '../lib/sound';

export type ChoiceRender = 'name' | 'flag' | 'capital';

export function ChoiceGrid({ choices, answer, picked, onPick, render = 'name', disabled }: {
  choices: string[]; answer: string; picked: string | null; onPick: (id: string) => void; render?: ChoiceRender; disabled?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!disabled && !picked && n >= 1 && n <= choices.length) onPick(choices[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, disabled, picked, onPick]);

  return (
    <div className={`grid gap-2.5 ${render === 'flag' ? 'grid-cols-2' : choices.length > 4 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
      {choices.map((id, i) => {
        const c = BY_ID[id];
        const done = !!picked;
        const isAns = id === answer;
        const isPicked = id === picked;
        const state = !done ? 'idle' : isAns ? 'right' : isPicked ? 'wrong' : 'dim';
        const cls = {
          idle: 'bg-panel2/80 hover:bg-panel2 border-line hover:border-sky/60',
          right: 'bg-mint/20 border-mint text-mint',
          wrong: 'bg-rose/20 border-rose text-rose shake',
          dim: 'bg-panel/50 border-line/50 opacity-50',
        }[state];
        return (
          <motion.button
            key={id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: state === 'dim' ? 0.5 : 1, y: 0, scale: state === 'right' ? [1, 1.04, 1] : 1 }}
            transition={{ delay: done ? 0 : i * 0.04 }}
            disabled={done || disabled}
            onClick={() => { sfx.tap(); onPick(id); }}
            className={`relative border-2 rounded-2xl text-left transition-colors ${cls} ${render === 'flag' ? 'p-2 aspect-[3/2]' : 'px-4 py-3.5 min-h-14'}`}
          >
            {render === 'flag' ? (
              <Flag id={id} className="w-full h-full" />
            ) : (
              <span className="flex items-center gap-3">
                <span className="mono text-xs text-mist/90 w-4 hidden sm:inline">{i + 1}</span>
                <span className="display font-semibold text-[1.05rem] leading-tight">{render === 'capital' ? c.capital : c.name}</span>
              </span>
            )}
            {state === 'right' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xl">✓</span>}
            {render === 'flag' && done && (
              <span className="absolute bottom-1 left-1 right-1 text-xs font-bold bg-ink/85 rounded-md px-1 py-0.5 text-paper leading-tight text-center">{c.name}</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

/** Free-text answer with forgiving autocomplete. */
export function TypeAnswer({ onSubmit, disabled, placeholder = 'Type a country…', autoFocus = true }: {
  onSubmit: (id: string | null, raw: string) => void; disabled?: boolean; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const sugg = q.length >= 1 ? searchCountries(q, 5) : [];
  useEffect(() => { if (autoFocus && !disabled) ref.current?.focus({ preventScroll: true }); }, [autoFocus, disabled]);
  useEffect(() => setSel(0), [q]);

  const submit = (id?: string) => {
    if (disabled) return;
    const chosen = id ?? matchCountry(q) ?? sugg[sel]?.id ?? null;
    if (!chosen && !q.trim()) return;
    onSubmit(chosen, q);
    setQ('');
  };

  return (
    <div className="relative">
      {sugg.length > 0 && !disabled && (
        <div className="flex gap-2 mb-2 overflow-x-auto scrollbar-none">
          {sugg.map((c, i) => (
            <button onPointerDown={(e) => e.preventDefault()} key={c.id} onClick={() => submit(c.id)}
              className={`chip shrink-0 whitespace-nowrap !text-sm !py-1.5 !px-3 transition-colors ${i === sel ? '!bg-amber/20 !border-amber text-amber' : 'hover:!border-sky'}`}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={ref}
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, sugg.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          }}
          placeholder={placeholder}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          className="flex-1 min-w-0 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3.5 text-lg display placeholder:text-mist/90"
        />
        <button onPointerDown={(e) => e.preventDefault()} className="btn btn-primary px-5" disabled={disabled || !q.trim()} onClick={() => submit()}>Go</button>
      </div>
    </div>
  );
}

/** Coat of arms on a soft paper disc so dark or transparent heraldry stays visible on the dark theme. */
export function ArmsImage({ id, className = '', small = false }: { id: string; className?: string; small?: boolean }) {
  const a = ARMS[id];
  if (!a) return null;
  return (
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 14 }}
      className={`aspect-square rounded-full grid place-items-center shrink-0 ${className}`}
      style={{ background: 'radial-gradient(circle, #f6f2e7 55%, #d9deea 100%)', boxShadow: small ? '0 2px 8px rgba(0,0,0,.4)' : '0 20px 60px rgba(0,0,0,.55), inset 0 0 0 2px rgba(255,255,255,.6)' }}>
      <img src={a.file} alt={ARMS_WORD[a.kind]} draggable={false} className="w-[78%] h-[78%] object-contain" />
    </motion.div>
  );
}

