import { useEffect, useState } from 'react';
import type { CwClue } from '../../lib/crossword';
import { loadPack } from '../../lib/packs';
import { Shape } from '../Shape';

/** Thumbnail for a picture clue: a flag/arms image, a country silhouette or a pack silhouette. */
export function ClueImage({ clue, size = 56 }: { clue: CwClue; size?: number }) {
  const img = clue.image;
  const [packPath, setPackPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPackPath(null);
    if (img?.kind === 'shape' && img.pack) loadPack(img.pack).then((p) => live && setPackPath(p?.shapes?.[img.id] ?? null));
    return () => { live = false; };
  }, [img]);
  if (!img) return null;
  if (img.kind === 'img') {
    return <img src={img.src} alt="" className="rounded-md ring-1 ring-white/10 object-contain bg-white/5 shrink-0" style={{ height: size * 0.72, width: size * 1.08 }} />;
  }
  if (!img.pack) return <div className="shrink-0" style={{ width: size, height: size }}><Shape id={img.id} size={size} glow={false} /></div>;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="shrink-0">
      {packPath && <path d={packPath} fill="var(--color-amber)" />}
    </svg>
  );
}
