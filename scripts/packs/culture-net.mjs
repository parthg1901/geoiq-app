// Cached network lookups for the Languages & Scripts packs (UDHR texts, Wikipedia, Wikidata).
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.resolve('scripts/.cache/packs-culture');
fs.mkdirSync(CACHE, { recursive: true });
const UA = { 'User-Agent': 'Geonaut-build/1.0 (+https://github.com/parthg1901/geonaut)' };
const UDHR_RAW = 'https://raw.githubusercontent.com/eric-muller/udhr/main/data/udhr';

async function get(url, as = 'json') {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!r.ok) return null;
      return as === 'json' ? await r.json() : await r.text();
    } catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  return null;
}
async function cached(key, fn, ext = 'json') {
  const f = path.join(CACHE, key.replace(/[^a-z0-9_-]/gi, '_') + '.' + ext);
  if (fs.existsSync(f)) return ext === 'json' ? JSON.parse(fs.readFileSync(f, 'utf8')) : fs.readFileSync(f, 'utf8');
  const v = await fn();
  if (v != null) fs.writeFileSync(f, ext === 'json' ? JSON.stringify(v) : v);
  return v;
}

/** Raw UDHR XML for a file id (e.g. "pol", "srp_cyrl"). */
export const udhrXml = (f) => cached(`udhr-${f}`, () => get(`${UDHR_RAW}/udhr_${f}.xml`, 'text'), 'xml');

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** Article 1 text (all paragraphs joined) from a UDHR XML document. */
export function article1(xml) {
  const m = xml.match(/<article\s+number=['"]1['"][^>]*>([\s\S]*?)<\/article>/);
  if (!m) return null;
  const paras = [...m[1].matchAll(/<para[^>]*>([\s\S]*?)<\/para>/g)].map((p) => unescapeXml(p[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
  const text = paras.filter(Boolean).join(' ');
  return text || null;
}

/** Wikipedia page → { title, qid, extract } (follows redirects). */
export const wikiPage = (title) => cached(`page-${title}`, async () => {
  const j = await get(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops|extracts&exintro=1&explaintext=1&exsentences=3&ppprop=wikibase_item&titles=${encodeURIComponent(title)}`);
  const p = j && Object.values(j.query?.pages || {})[0];
  if (!p || p.missing != null) return null;
  return { title: p.title, qid: p.pageprops?.wikibase_item ?? null, extract: p.extract ?? '' };
});

export const pageviews = (title) => cached(`pv-${title}`, async () => {
  const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/2025010100/2025123100`);
  return (j?.items || []).reduce((a, b) => a + b.views, 0);
});

/** Wikidata entity, trimmed to the claims we use (P1098 number of speakers, P282 writing system). */
export const entity = (qid) => cached(`wd-${qid}`, async () => {
  const j = await get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const e = j?.entities?.[qid] ?? Object.values(j?.entities || {})[0];
  if (!e) return null;
  const claims = {};
  for (const k of ['P1098', 'P282']) {
    if (!e.claims?.[k]) continue;
    claims[k] = e.claims[k].filter((c) => c.rank !== 'deprecated').map((c) => ({
      rank: c.rank,
      v: c.mainsnak?.datavalue?.value,
      time: c.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? null,
      // P518 applies to part (e.g. L1 / L2 speakers), P3831 object has role
      part: c.qualifiers?.P518?.[0]?.datavalue?.value?.id ?? c.qualifiers?.P3831?.[0]?.datavalue?.value?.id ?? null,
    }));
  }
  return { label: e.labels?.en?.value, claims };
});
