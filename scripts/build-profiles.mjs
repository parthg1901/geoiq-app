// Builds public/data/profiles/{ID}.json — rich per-country profiles, loaded on demand.
import fs from 'node:fs';
import countries from 'world-countries';

const { wd, profiles } = JSON.parse(fs.readFileSync('scripts/.cache/profiles-combined.json', 'utf8'));
const sel = countries.filter((x) => x.unMember || ['VAT', 'PSE', 'UNK', 'TWN'].includes(x.cca3));

const latest = (arr) => (arr?.length ? [...arr].sort((a, b) => (b.t || '').localeCompare(a.t || ''))[0] : null);
const ORGS = [
  ['European Union', 'EU'], ['NATO', 'NATO'], ['North Atlantic Treaty Organization', 'NATO'], ['African Union', 'African Union'],
  ['Association of Southeast Asian Nations', 'ASEAN'], ['G20', 'G20'], ['G7', 'G7'], ['Commonwealth of Nations', 'Commonwealth'],
  ['Arab League', 'Arab League'], ['OPEC', 'OPEC'], ['Organization of the Petroleum Exporting Countries', 'OPEC'], ['BRICS', 'BRICS'],
  ['Organisation of Islamic Cooperation', 'OIC'], ['Mercosur', 'Mercosur'], ['Organisation for Economic Co-operation and Development', 'OECD'],
  ['Organization for Economic Cooperation and Development', 'OECD'], ['Shanghai Cooperation Organisation', 'SCO'], ['Pacific Islands Forum', 'Pacific Islands Forum'],
  ['Caribbean Community', 'CARICOM'], ['Gulf Cooperation Council', 'GCC'], ['Council of Europe', 'Council of Europe'],
  ['Organization of American States', 'OAS'], ['Commonwealth of Independent States', 'CIS'], ['Organisation internationale de la Francophonie', 'Francophonie'],
  ['Economic Community of West African States', 'ECOWAS'], ['Southern African Development Community', 'SADC'], ['East African Community', 'EAC'],
  ['South Asian Association for Regional Cooperation', 'SAARC'], ['Andean Community', 'Andean Community'], ['Schengen Area', 'Schengen'],
];

let total = 0;
const stats = {};
fs.mkdirSync('public/data/profiles', { recursive: true });
for (const c of sel) {
  const w = wd[c.cca3] || {};
  const p = profiles[c.cca3] || { intro: '', sections: {} };
  const gdp = latest(w.gdp);
  const members = [...new Set((w.member || []).map((m) => ORGS.find(([k]) => m === k)?.[1]).filter(Boolean))];
  const tz = [...new Set((w.tz || []).filter((t) => /^UTC[+−-]/.test(t)).map((t) => t.replace('−', '-')))]
    .sort((a, b) => parseFloat(a.slice(3).replace(':', '.')) - parseFloat(b.slice(3).replace(':', '.')));
  const pick = (arr, n = 2) => [...new Set(arr || [])].slice(0, n);
  const peak = (w.highest || []).sort((a, b) => (b.el || 0) - (a.el || 0))[0];
  const low = (w.lowest || []).sort((a, b) => (a.el || 0) - (b.el || 0))[0];
  const out = {
    intro: p.intro,
    sections: p.sections,
    facts: {
      gov: pick(w.gov, 2),
      hos: pick(w.hos, 2),
      hog: pick(w.hog, 2),
      anthem: pick(w.anthem, 1)[0] || null,
      drive: pick(w.drive, 1)[0] || null,
      gdp: gdp ? { v: gdp.v, year: gdp.t.slice(0, 4) } : null,
      hdi: latest(w.hdi) ? { v: latest(w.hdi).v, year: latest(w.hdi).t.slice(0, 4) } : null,
      life: latest(w.life) ? { v: Math.round(latest(w.life).v * 10) / 10, year: latest(w.life).t.slice(0, 4) } : null,
      gini: latest(w.gini) ? { v: latest(w.gini).v, year: latest(w.gini).t.slice(0, 4) } : null,
      highest: peak ? { name: peak.name, el: peak.el != null ? Math.round(peak.el) : null } : null,
      lowest: low ? { name: low.name, el: low.el != null ? Math.round(low.el) : null } : null,
      timezones: tz,
      members,
    },
  };
  if (c.unMember && !out.facts.members.includes('UN')) out.facts.members.unshift('UN');
  stats[c.cca3] = { gdp: out.facts.gdp?.v ?? null, hdi: out.facts.hdi?.v ?? null, life: out.facts.life?.v ?? null };
  const s = JSON.stringify(out);
  total += s.length;
  fs.writeFileSync(`public/data/profiles/${c.cca3}.json`, s);
}
fs.writeFileSync('src/data/stats.json', JSON.stringify(stats));
console.log('profiles', sel.length, 'avg KB', Math.round(total / sel.length / 1024));
