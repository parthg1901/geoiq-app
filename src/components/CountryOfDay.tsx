import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fmtArea, fmtPop, loadPhotos, type Country, type Photo } from '../data';
import { loadProfile, rank, ordinal, trivia, type Profile } from '../lib/profile';
import { go } from '../lib/router';
import { Flag, Shape } from './Shape';

/** Home-screen feature card for the country of the day — a real mini-profile, not just a blurb. */
export function CountryOfDay({ c }: { c: Country }) {
  const [p, setP] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  useEffect(() => {
    loadProfile(c.id).then(setP);
    loadPhotos(c.id).then((x) => setPhoto(x[0] ?? null));
  }, [c.id]);
  const pop = rank(c.id, 'population'), area = rank(c.id, 'area');
  const facts = trivia(c, p).slice(0, 3);
  const firstPara = (p?.intro || c.fact).split(/\n\n+/)[0];

  const stats: [string, string, string?][] = [
    ['Capital', c.capital || '—'],
    ['Population', fmtPop(c.population), pop ? `${ordinal(pop.rank)} in the world` : undefined],
    ['Area', fmtArea(c.area), area ? `${ordinal(area.rank)} largest` : undefined],
    ['Region', c.subregion],
    [c.languages.length > 1 ? 'Languages' : 'Language', c.languages.slice(0, 3).join(', ') || '—'],
    ['Currency', c.currencies.join(', ') || '—'],
  ];
  if (p?.facts.gov.length) stats.push(['Government', p.facts.gov[0].charAt(0).toUpperCase() + p.facts.gov[0].slice(1)]);
  if (p?.facts.highest) stats.push(['Highest point', p.facts.highest.name, p.facts.highest.el != null ? `${p.facts.highest.el.toLocaleString()} m` : undefined]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="card overflow-hidden">
      {photo && (
        <div className="relative h-44 sm:h-56 bg-deep">
          <img src={photo.u} alt={photo.c} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/20 to-transparent" />
          <div className="absolute right-3 top-3 opacity-90"><Shape id={c.id} size={72} /></div>
        </div>
      )}
      <div className={`p-5 ${photo ? '-mt-14 relative' : ''}`}>
        <div className="flex items-end gap-3">
          <Flag id={c.id} className="w-16 aspect-[3/2] !rounded-md shrink-0" />
          <div>
            <div className="text-sm font-bold uppercase tracking-wider text-amber">Country of the day</div>
            <div className="display text-3xl font-extrabold leading-tight">{c.name}</div>
          </div>
        </div>
        {c.official !== c.name && <div className="text-mist mt-1">{c.official}</div>}

        <div className="grid grid-cols-2 gap-2 mt-4">
          {stats.map(([k, v, sub]) => (
            <div key={k} className="rounded-xl bg-white/5 border border-line/50 px-3 py-2">
              <div className="text-xs uppercase tracking-wider font-bold text-mist">{k}</div>
              <div className="font-semibold leading-snug">{v}</div>
              {sub && <div className="text-sm text-mist">{sub}</div>}
            </div>
          ))}
        </div>

        <p className="mt-4 leading-relaxed text-paper/90">{firstPara}</p>

        {facts.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {facts.map((t) => <li key={t} className="flex gap-2"><span>💡</span><span>{t}</span></li>)}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button className="btn btn-primary" onClick={() => go('/country/' + c.id)}>Full profile →</button>
          <button className="btn btn-ghost" onClick={() => go('/atlas')}>All countries</button>
        </div>
      </div>
    </motion.div>
  );
}
