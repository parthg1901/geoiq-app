import { useSyncExternalStore } from 'react';

const sub = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const snap = () => window.location.hash.slice(1) || '/';

export function useRoute() {
  const path = useSyncExternalStore(sub, snap);
  const [p, q = ''] = path.split('?');
  return { path: p, parts: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}
export const go = (to: string) => { window.location.hash = to; window.scrollTo({ top: 0 }); };
