// Cached network helpers for the region-pack build (Wikidata, Wikipedia, Commons).
import fs from 'node:fs';
import path from 'node:path';

export const CACHE = path.resolve('scripts/.cache/packs-regions');
fs.mkdirSync(CACHE, { recursive: true });
const UA = { 'User-Agent': 'GeoIQ-build/1.0 (educational; parth.eng1210@gmail.com)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const keyFile = (key, ext = 'json') => path.join(CACHE, key.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 180) + '.' + ext);

/** JSON GET with retries; result (including null for 404) cached on disk under `key`. */
export async function cachedJSON(key, url, headers = {}) {
  const f = keyFile(key);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let out = null;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers } });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      out = r.ok ? await r.json() : null;
      break;
    } catch { await sleep(2000 * (i + 1)); }
  }
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

/** Binary GET (image) cached on disk; returns Buffer or null. */
export async function cachedBinary(key, url) {
  const f = keyFile(key, 'bin');
  const miss = keyFile(key, 'miss');
  if (fs.existsSync(f)) return fs.readFileSync(f);
  if (fs.existsSync(miss)) return null;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) break;
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(f, buf);
      return buf;
    } catch { await sleep(2000 * (i + 1)); }
  }
  fs.writeFileSync(miss, '');
  return null;
}

/** Run async fn over items with limited concurrency. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** wbgetentities in batches of 50 → { Qid: entity } */
export async function entities(ids, props = 'labels|aliases|claims|sitelinks') {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&sitefilter=enwiki&props=${props}&ids=${batch.join('|')}`;
    const j = await cachedJSON(`wd-${props.replace(/\|/g, '-')}-${batch[0]}-${batch.length}-${batch[batch.length - 1]}`, url);
    Object.assign(out, j?.entities || {});
  }
  return out;
}
