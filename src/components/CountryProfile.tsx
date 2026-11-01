import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { BY_ID, ALL_NAMES, ARMS, ARMS_WORD, fmtPop, fmtArea, loadPhotos, type Photo } from '../data';
import { ArmsImage } from './Answer';
import { loadProfile, rank, metric, money, ordinal, trivia, METRIC_LABEL, type Metric, type Profile } from '../lib/profile';
import { useGame, mastery, stampSkills } from '../lib/store';
import { SKILL_LABEL } from '../lib/geoiq';
import { makeQuestion, eligible, type Variant } from '../lib/questions';
import { shuffle } from '../lib/rng';
import { go } from '../lib/router';
import { REGION_META } from '../lib/path';
import { Flag, Shape } from './Shape';
import { Globe, zoomFor } from './Globe';
import { WorldMap } from './WorldMap';
import { QuizRunner } from './QuizRunner';
import { toast } from './Toasts';
import { onBack } from '../lib/native';

const SECTION_META: Record<string, { icon: string; title: string }> = {
  Etymology: { icon: '🔤', title: 'Name & etymology' },
  History: { icon: '📜', title: 'History' },
  Geography: { icon: '⛰️', title: 'Geography' },
  Climate: { icon: '🌦️', title: 'Climate' },
  Biodiversity: { icon: '🦜', title: 'Nature & wildlife' },
  'Government and politics': { icon: '🏛️', title: 'Government & politics' },
  Economy: { icon: '💹', title: 'Economy' },
  Tourism: { icon: '🧳', title: 'Tourism' },
  Demographics: { icon: '👥', title: 'People' },
  Languages: { icon: '🗣️', title: 'Languages' },
  Religion: { icon: '🕊️', title: 'Religion' },
  Culture: { icon: '🎭', title: 'Culture' },
  Cuisine: { icon: '🍲', title: 'Food & cuisine' },
  Music: { icon: '🎵', title: 'Music' },
  Architecture: { icon: '🏛', title: 'Architecture' },
  Sport: { icon: '⚽', title: 'Sport' },
};
const ORDER = Object.keys(SECTION_META);
const PRACTICE: Variant[] = ['shape', 'flag', 'map-find', 'capital'];


/** A full country profile. Rendered as a page (route) or as a full-screen overlay (onClose given). */
export function CountryProfile({ id, onClose }: { id: string; onClose?: () => void }) {
  const c = BY_ID[id];
  const cards = useGame((s) => s.cards);
  const stamp = useGame((s) => s.stamps[id]);
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [practice, setPractice] = useState<ReturnType<typeof makeQuestion>[] | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true); setP(null);
    loadProfile(id).then((x) => { setP(x); setLoading(false); });
    setPhotos([]); loadPhotos(id).then(setPhotos);
    (onClose ? scroller.current : window)?.scrollTo({ top: 0 });
  }, [id, onClose]);

  useEffect(() => {
    if (lightbox != null) return onBack(() => setLightbox(null));
    if (practice) return onBack(() => setPractice(null));
    if (onClose) return onBack(onClose);
  }, [lightbox, practice, onClose]);

  const facts = useMemo(() => (c ? trivia(c, p) : []), [c, p]);
  if (!c) return null;
  const meta = REGION_META[c.region as keyof typeof REGION_META];
  const color = meta?.color ?? '#ffb547';
  const m = mastery(cards, id);
  const f = p?.facts;
  const pop = rank(id, 'population'), area = rank(id, 'area');
  const gdpPc = metric(c, 'gdpPc');
  const sections = p ? ORDER.filter((k) => p.sections[k]) : [];
  const openCountry = (x: string) => (onClose ? go('/country/' + x) : go('/country/' + x));

  if (practice) {
    return createPortal(
      <div className="fixed inset-0 z-[60] atlas-bg overflow-y-auto safe-top">
        <QuizRunner title={`Drill · ${c.name}`} questions={practice} practice hideSummary onQuit={() => setPractice(null)}
          onDone={(r) => {
            const right = r.filter((x) => x.outcome >= 0.6).length;
            toast({ icon: right === r.length ? '🎯' : '📚', title: `${right}/${r.length} on ${c.name}`, body: right === r.length ? 'Memory strengthened.' : 'It will stick next time.' });
            setPractice(null);
          }} />
      </div>, document.body);
  }

  const body = (
    <div className="mx-auto max-w-3xl px-4 pb-32">
      {/* Top bar */}
      <div style={{ top: onClose ? 0 : 'var(--sat)' }} className="sticky z-20 -mx-4 px-4 py-3 bg-ink flex items-center gap-3 border-b border-line/40">
        <button aria-label="Close" onClick={onClose ?? (() => (history.length > 1 ? history.back() : go('/atlas')))}
          className="w-10 h-10 shrink-0 rounded-full grid place-items-center bg-white/5 hover:bg-white/10 border border-line">{onClose ? '✕' : '←'}</button>
        <Flag id={id} className="w-9 h-6 !rounded-sm" />
        <div className="display font-bold text-lg flex-1 min-w-0 leading-tight">{c.name}</div>
        <button className="btn btn-primary !py-2 !px-3 text-sm shrink-0" onClick={() => setPractice(shuffle(PRACTICE.filter((v) => eligible(c, v)).map((v) => makeQuestion(id, v))))}>Practice</button>
      </div>

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden mt-4 p-5">
        <img src={`/flags/${id}.svg`} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[.07] scale-110" />
        <div className="relative flex flex-col sm:flex-row gap-5 sm:items-center">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold uppercase tracking-wider" style={{ color }}>{meta?.emoji} {c.subregion}</div>
            <h1 className="display text-4xl sm:text-5xl font-extrabold leading-tight mt-1">{c.name}</h1>
            {c.official !== c.name && <div className="text-mist mt-1">{c.official}</div>}
            <div className="flex items-center gap-3 mt-4">
              <Flag id={id} className="w-32 aspect-[3/2] !rounded-lg" />
              {ARMS[id] && <ArmsImage id={id} className="w-[86px]" small />}
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {stamp ? <span className="chip !text-violet !border-violet/60">🛂 Stamped {stamp}</span> : <span className="chip">🛂 {Math.round(m * 100)}% to stamp</span>}
              {c.landlocked && <span className="chip">🏔️ Landlocked</span>}
              {f?.drive && <span className="chip">🚗 Drives on the {f.drive}</span>}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 shrink-0">
            <Shape id={id} size={130} color={color} />
            <Globe size={150} zoom={zoomFor(id)} focus={id} spin={false} fills={{ [id]: color }} />
          </div>
        </div>
      </motion.div>

      {/* Memory */}
      <div className="card mt-3 p-4">
        <div className="display font-bold mb-2">Your memory of {c.name}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stampSkills(id).map((s) => {
            const box = cards[`${id}:${s}`]?.box ?? 0;
            return (
              <div key={s}>
                <div className="flex justify-between text-sm"><span>{SKILL_LABEL[s]}</span><span className="mono text-mist">{box}/5</span></div>
                <div className="flex gap-1 mt-1">{[1, 2, 3, 4, 5].map((i) => <span key={i} className="h-2 flex-1 rounded-full" style={{ background: i <= box ? color : 'rgba(255,255,255,.1)' }} />)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key facts */}
      <H2>Key facts</H2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Fact icon="★" k="Capital" v={c.capital || '—'} />
        <Fact icon="👥" k="Population" v={fmtPop(c.population)} sub={pop ? `${ordinal(pop.rank)} of ${pop.of} countries` : undefined} />
        <Fact icon="📐" k="Area" v={fmtArea(c.area)} sub={area ? `${ordinal(area.rank)} largest` : undefined} />
        <Fact icon="🏙️" k="Density" v={c.population ? `${Math.round(c.population / c.area).toLocaleString()} people / km²` : '—'} />
        <Fact icon="🌍" k="Region" v={`${c.subregion}`} sub={c.region} />
        <Fact icon="🗣️" k={c.languages.length > 1 ? 'Languages' : 'Language'} v={c.languages.join(', ') || '—'} />
        <Fact icon="💰" k="Currency" v={c.currencies.join(', ') || '—'} />
        <Fact icon="🧑" k="People are called" v={c.demonym || '—'} />
        {f?.gov.length ? <Fact icon="🏛️" k="Government" v={cap(f.gov.join(', '))} /> : null}
        {f?.hos.length ? <Fact icon="👑" k="Head of state" v={f.hos.join(', ')} /> : null}
        {f?.hog.length && f.hog.join() !== f.hos.join() ? <Fact icon="🎙️" k="Head of government" v={f.hog.join(', ')} /> : null}
        {f?.gdp && <Fact icon="💹" k="GDP (nominal)" v={money(f.gdp.v)} sub={`${f.gdp.year}${gdpPc ? ` · ${money(gdpPc)} per person` : ''}`} />}
        {f?.hdi && <Fact icon="📈" k="Human Development Index" v={f.hdi.v.toFixed(3)} sub={`${hdiBand(f.hdi.v)} · ${f.hdi.year}`} />}
        {f?.life && <Fact icon="❤️" k="Life expectancy" v={`${f.life.v} years`} sub={f.life.year} />}
        {f?.gini && <Fact icon="⚖️" k="Inequality (Gini)" v={`${f.gini.v}`} sub={`${f.gini.v < 30 ? 'Low' : f.gini.v < 40 ? 'Moderate' : 'High'} inequality · ${f.gini.year}`} />}
        {f?.highest && <Fact icon="🏔️" k="Highest point" v={f.highest.name} sub={f.highest.el != null ? `${f.highest.el.toLocaleString()} m` : undefined} />}
        {f?.lowest && <Fact icon="🌊" k="Lowest point" v={f.lowest.name} sub={f.lowest.el != null ? `${f.lowest.el.toLocaleString()} m` : undefined} />}
        {f?.anthem && <Fact icon="🎶" k="National anthem" v={f.anthem} />}
        {f?.timezones.length ? <Fact icon="🕒" k={f.timezones.length > 1 ? 'Time zones' : 'Time zone'} v={f.timezones.join(', ')} /> : null}
        <Fact icon="📞" k="Calling code" v={c.calling || '—'} />
        <Fact icon="🌐" k="Internet domain" v={c.tld || '—'} />
        {ARMS[id] && <Fact icon="🛡️" k={cap(ARMS_WORD[ARMS[id].kind])} v={<a className="text-sky underline" href={ARMS[id].page} target="_blank" rel="noreferrer">View on Wikimedia Commons</a>} />}
        {f?.drive && <Fact icon="🚗" k="Driving side" v={cap(f.drive)} />}
      </div>
      {loading && <div className="text-mist text-sm mt-3 animate-pulse">Loading the full dossier…</div>}

      {f?.members.length ? (
        <>
          <H2>Member of</H2>
          <div className="flex flex-wrap gap-2">{f.members.map((x) => <span key={x} className="chip !text-sm !py-1.5 !px-3">{x}</span>)}</div>
        </>
      ) : null}

      {/* Neighbours + map */}
      <H2>Where it is</H2>
      <div className="card overflow-hidden">
        <div className="relative h-72 sm:h-96">
          <WorldMap className="absolute inset-0" focus={[id, ...c.borders.filter((b) => BY_ID[b])].slice(0, 8)} fills={{ [id]: color, ...Object.fromEntries(c.borders.map((b) => [b, '#3b5b96'])) }}
            highlight={id} labels={{ [id]: c.name, ...Object.fromEntries(c.borders.filter((b) => BY_ID[b]).map((b) => [b, BY_ID[b].name])) }} onPick={(x) => x !== id && openCountry(x)} />
        </div>
        <div className="p-4">
          <div className="text-sm text-mist mb-2">{c.borders.length ? `Shares land borders with ${c.borders.length} ${c.borders.length === 1 ? 'country' : 'countries'} — tap one to visit` : 'No land borders.'}</div>
          <div className="flex flex-wrap gap-2">
            {c.borders.map((b) => BY_ID[b] ? (
              <button key={b} onClick={() => openCountry(b)} className="chip !text-sm !py-1.5 !px-3 hover:!border-amber"><Flag id={b} className="w-5 h-3.5 !rounded-sm !shadow-none" />{BY_ID[b].name}</button>
            ) : <span key={b} className="chip !text-sm !py-1.5 !px-3">{ALL_NAMES[b] ?? b}</span>)}
          </div>
        </div>
      </div>

      {/* Compared with the world */}
      <H2>Compared with the world</H2>
      <div className="card p-4 space-y-3.5">
        {(['population', 'area', 'density', 'gdp', 'gdpPc', 'hdi', 'life'] as Metric[]).map((mk) => {
          const r = rank(id, mk);
          if (!r) return null;
          const pct = 1 - (r.rank - 1) / Math.max(1, r.of - 1);
          return (
            <div key={mk}>
              <div className="flex justify-between gap-3 text-sm"><span>{METRIC_LABEL[mk]}</span><span className="mono text-mist">#{r.rank} of {r.of}</span></div>
              <div className="h-2.5 rounded-full bg-white/8 mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}>
                <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} whileInView={{ width: `${Math.max(3, pct * 100)}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} />
              </div>
            </div>
          );
        })}
        <div className="text-sm text-mist">Longer bar = higher in the world ranking.</div>
      </div>

      {/* Did you know */}
      {facts.length > 0 && (
        <>
          <H2>Did you know?</H2>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {facts.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="card !rounded-2xl p-4 flex gap-3">
                <span className="text-xl">💡</span><span className="leading-relaxed">{t}</span>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Overview */}
      {p?.intro && (
        <>
          <H2>Overview</H2>
          <div className="card p-5"><Prose text={p.intro} /></div>
        </>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <>
          <H2>In pictures</H2>
          <div className="flex gap-3 overflow-x-auto scrollbar-none -mx-4 px-4 pb-2 snap-x">
            {photos.slice(0, 14).map((ph, i) => (
              <button key={ph.u} onClick={() => setLightbox(i)} className="snap-start shrink-0 w-64 card !rounded-2xl overflow-hidden text-left">
                <img src={ph.u} alt={ph.c} loading="lazy" referrerPolicy="no-referrer" className="w-full h-40 object-cover bg-deep" />
                <div className="p-3 text-sm leading-snug">{ph.c || 'Photo'}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <>
          <H2>Deep dive</H2>
          <div className="flex flex-wrap gap-2 mb-3">
            {sections.map((k) => (
              <button key={k} className="chip !text-sm !py-1.5 !px-3 hover:!border-sky"
                onClick={() => document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {SECTION_META[k].icon} {SECTION_META[k].title}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {sections.map((k) => (
              <section key={k} id={`sec-${k}`} className="card p-5 scroll-mt-20">
                <h3 className="display text-xl font-bold mb-2 flex items-center gap-2"><span>{SECTION_META[k].icon}</span>{SECTION_META[k].title}</h3>
                <Prose text={p!.sections[k]} />
              </section>
            ))}
          </div>
        </>
      )}

      <div className="text-sm text-mist mt-8 leading-relaxed">
        Text from <a className="text-sky underline" href={`https://en.wikipedia.org/wiki/${encodeURIComponent(c.name)}`} target="_blank" rel="noreferrer">Wikipedia</a> (CC BY-SA 4.0); facts from Wikidata, World Bank and mledoze/countries. Photos from Wikimedia Commons; credits shown in each photo.{ARMS[id] && <> {cap(ARMS_WORD[ARMS[id].kind])}: {ARMS[id].credit || 'Wikimedia Commons'}.</>}
      </div>

      {lightbox != null && photos[lightbox] && createPortal(
        <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={photos[lightbox].u} alt={photos[lightbox].c} referrerPolicy="no-referrer" className="max-h-[70dvh] max-w-full rounded-xl" />
          <div className="max-w-2xl text-center mt-4 leading-relaxed">{photos[lightbox].c}</div>
          <div className="text-sm text-mist mt-1">{photos[lightbox].a} · {photos[lightbox].l}</div>
          <div className="flex gap-3 mt-4" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-ghost" onClick={() => setLightbox((lightbox - 1 + photos.length) % photos.length)}>← Prev</button>
            <button className="btn btn-ghost" onClick={() => setLightbox((lightbox + 1) % photos.length)}>Next →</button>
          </div>
        </div>, document.body)}
    </div>
  );

  if (!onClose) return <div className="relative">{body}</div>;
  return createPortal(
    <motion.div ref={scroller} initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="fixed inset-0 z-[55] atlas-bg overflow-y-auto safe-top">
      {body}
    </motion.div>, document.body);
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="display text-2xl font-extrabold mt-8 mb-3">{children}</h2>;
}

function Fact({ icon, k, v, sub }: { icon: string; k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="card !rounded-2xl px-3.5 py-3 min-w-0">
      <div className="text-xs uppercase tracking-wide font-bold text-mist flex items-center gap-1.5"><span className="text-base">{icon}</span>{k}</div>
      <div className="font-semibold leading-snug break-words mt-1">{v}</div>
      {sub && <div className="text-sm text-mist leading-snug">{sub}</div>}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return <div className="space-y-3 leading-relaxed text-[15px] text-paper/90">{text.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}</div>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hdiBand = (v: number) => (v >= 0.8 ? 'Very high' : v >= 0.7 ? 'High' : v >= 0.55 ? 'Medium' : 'Low');
