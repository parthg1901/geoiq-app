import { useEffect, useRef, useState } from 'react';
import type { PackItem } from '../../lib/packs';
import { matchItem, searchItems } from './questions';

/** Free-text answer for packs, with autocomplete over item names and alternative spellings. */
export function PackTypeAnswer({ items, onSubmit, disabled, placeholder = 'Type the name…', autoFocus = true, keepOpen = false }: {
  items: PackItem[]; onSubmit: (id: string | null, raw: string) => void; disabled?: boolean; placeholder?: string; autoFocus?: boolean;
  /** Name-them-all mode: submit as soon as the text exactly matches an item, no suggestions. */
  keepOpen?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const sugg = !keepOpen && q.length >= 1 ? searchItems(items, q, 5) : [];
  useEffect(() => { if (autoFocus && !disabled) ref.current?.focus({ preventScroll: true }); }, [autoFocus, disabled]);

  const submit = (id?: string) => {
    if (disabled) return;
    const chosen = id ?? matchItem(items, q)?.id ?? sugg[sel]?.id ?? null;
    if (!chosen && !q.trim()) return;
    onSubmit(chosen, q);
    setQ(''); setSel(0);
  };
  const change = (v: string) => {
    setQ(v); setSel(0);
    if (keepOpen) { const m = matchItem(items, v); if (m) { onSubmit(m.id, v); setQ(''); } }
  };

  return (
    <div>
      {sugg.length > 0 && !disabled && (
        <div className="flex gap-2 mb-2 overflow-x-auto scrollbar-none">
          {sugg.map((it, i) => (
            <button onPointerDown={(e) => e.preventDefault()} key={it.id} onClick={() => submit(it.id)}
              className={`chip shrink-0 whitespace-nowrap !text-sm !py-1.5 !px-3 ${i === sel ? '!bg-amber/20 !border-amber text-amber' : ''}`}>{it.name}</button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input ref={ref} value={q} disabled={disabled} onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (!keepOpen) submit(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, sugg.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          }}
          placeholder={placeholder} autoComplete="off" autoCorrect="off" spellCheck={false}
          className="flex-1 min-w-0 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3.5 text-lg display placeholder:text-mist/80" />
        {!keepOpen && <button onPointerDown={(e) => e.preventDefault()} className="btn btn-primary px-5" disabled={disabled || !q.trim()} onClick={() => submit()}>Go</button>}
      </div>
    </div>
  );
}
