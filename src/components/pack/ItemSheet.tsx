import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { PackData, PackItem } from '../../lib/packs';
import { onBack } from '../../lib/native';
import { PackMap } from './PackMap';

const fmtNum = (n: number) => n.toLocaleString();

/** Everything we know about one pack item: picture, numbers, facts, blurb. */
export function ItemFacts({ pack, it, hideSample = false }: { pack: PackData; it: PackItem; hideSample?: boolean }) {
  const rows: [string, string][] = [];
  if (it.capital) rows.push(['Capital', it.capital]);
  if (it.rank) rows.push([it.rank.label, `${fmtNum(it.rank.value)} ${it.rank.unit}`]);
  if (it.population) rows.push(['Population', fmtNum(it.population)]);
  if (it.area) rows.push(['Area', `${fmtNum(Math.round(it.area))} km²`]);
  for (const f of it.facts ?? []) {
    const i = rows.findIndex((r) => r[0] === f[0]);
    if (i < 0) rows.push(f);
    else rows[i] = f; // the pack's own wording wins (e.g. "Area: 2.5 million km²")
  }
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        {(it.flag || it.arms) && (
          <div className="flex items-center gap-2 shrink-0">
            {it.flag && <img src={it.flag} alt="" className="h-10 w-auto max-w-20 rounded ring-1 ring-white/10 object-contain bg-white/5" />}
            {it.arms && <img src={it.arms} alt="" className="h-12 w-auto max-w-14 object-contain" />}
          </div>
        )}
        {!it.flag && !it.arms && pack.shapes?.[it.id] && (
          <svg viewBox="0 0 200 200" width={48} height={48} className="shrink-0"><path d={pack.shapes[it.id]} fill={pack.meta.color} /></svg>
        )}
        <div className="min-w-0 flex-1 basis-40">
          <div className="display text-2xl font-extrabold leading-tight break-words">{it.name}</div>
          {it.kind && <div className="text-sm text-mist capitalize">{it.kind}</div>}
        </div>
      </div>
      {/* Languages & scripts: the text and how to recognise it come first — that's what you learn here. */}
      {it.sample?.text && !hideSample && <SampleText it={it} className="mt-3 text-lg" />}
      {it.tells && it.tells.length > 0 && <Tells tells={it.tells} />}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-white/5 border border-line/50 px-3 py-2 min-w-0">
              <div className="text-xs uppercase tracking-wide font-bold text-mist">{k}</div>
              <div className="font-semibold leading-snug break-words">{v}</div>
            </div>
          ))}
        </div>
      )}
      {it.blurb && <p className="mt-3 leading-relaxed text-paper/90">{it.blurb}</p>}
      {it.wiki && (
        <a className="inline-block mt-2 text-sky font-semibold" target="_blank" rel="noreferrer" href={`https://en.wikipedia.org/wiki/${encodeURIComponent(it.wiki.replace(/ /g, '_'))}`}>Read more on Wikipedia →</a>
      )}
    </div>
  );
}

/** A text sample (e.g. UDHR Article 1) set in the system font so every script renders and shapes correctly. */
/** hideSource: during a question the source can give the answer away ("Berber" → Tifinagh). */
export function SampleText({ it, className = '', big = false, hideSource = false }: { it: PackItem; className?: string; big?: boolean; hideSource?: boolean }) {
  if (!it.sample?.text) return null;
  return (
    <figure className={`rounded-2xl bg-paper/5 border border-line/60 px-4 py-3 ${className}`}>
      <blockquote dir={it.sample.dir ?? 'auto'} lang={it.sample.lang} className={`sample-text leading-relaxed text-paper break-words ${big ? 'text-[1.35rem] sm:text-2xl' : ''}`}>
        {it.sample.text}
      </blockquote>
      {it.sample.source && <figcaption className="text-xs text-mist mt-2">{hideSource ? it.sample.source.replace(/\s*\(.*\)\s*$/, '') : it.sample.source}</figcaption>}
    </figure>
  );
}

/** "How to spot it": the telltale letters / features of a language or script. */
export function Tells({ tells, className = 'mt-3' }: { tells: string[]; className?: string }) {
  return (
    <div className={`rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3 ${className}`}>
      <div className="text-xs uppercase tracking-wide font-bold text-amber">How to spot it</div>
      <ul className="mt-1.5 space-y-1">
        {tells.map((t) => <li key={t} className="flex gap-2 leading-snug"><span className="text-amber">•</span><span className="break-words">{t}</span></li>)}
      </ul>
    </div>
  );
}

/** Bottom sheet with an item's map location and facts. */
export function ItemSheet({ pack, id, onClose }: { pack: PackData; id: string; onClose: () => void }) {
  const it = pack.items.find((x) => x.id === id);
  useEffect(() => onBack(onClose), [onClose]);
  if (!it) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-ink/85 flex items-end sm:items-center justify-center" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="w-full max-w-lg max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-deep border-t-4 safe-bottom" style={{ borderColor: pack.meta.color }}
        onClick={(e) => e.stopPropagation()}>
        <div className="relative h-52 bg-ink">
          <PackMap pack={pack} highlight={id} fills={{ [id]: pack.meta.color }} focus={[id]} interactive={false} className="absolute inset-0" />
        </div>
        <div className="p-5">
          <ItemFacts pack={pack} it={it} />
          <button className="btn btn-ghost w-full mt-4" onClick={onClose}>Close</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
