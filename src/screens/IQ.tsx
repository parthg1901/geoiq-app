import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useGame, mastery } from '../lib/store';
import { iqScore, tierFor, percentile, TIERS } from '../lib/iq';
import { go } from '../lib/router';
import { COUNTRIES, REGIONS } from '../data';
import { REGION_META } from '../lib/path';
import { WorldMap } from '../components/WorldMap';
import { CountUp, Page, Progress, SectionTitle } from '../components/ui';
import { Radar, HistoryChart, TierLadder } from '../components/iq/Charts';
import { StatusBar } from './Home';

/** Mastery 0..1 → map colour (unseen stays default land). */
function heat(m: number) {
  if (m <= 0) return undefined;
  if (m >= 0.75) return '#ffb547';
  if (m >= 0.5) return '#3ddc97';
  if (m >= 0.25) return '#2f9bd6';
  return '#2a5f8f';
}

export default function IQ() {
  const s = useGame();
  const { iq, provisional, answered } = iqScore(s.ratings);
  const tier = tierFor(iq);
  const pct = percentile(iq);
  const lastTest = s.tests[s.tests.length - 1];

  const { fills, regions } = useMemo(() => {
    const fills: Record<string, string> = {};
    const acc: Record<string, { sum: number; n: number; seen: number }> = {};
    for (const c of COUNTRIES) {
      const m = mastery(s.cards, c.id);
      const f = heat(m);
      if (f) fills[c.id] = f;
      const a = (acc[c.region] ??= { sum: 0, n: 0, seen: 0 });
      a.sum += m; a.n++; if (m > 0) a.seen++;
    }
    return { fills, regions: REGIONS.map((r) => ({ r, v: acc[r] ? acc[r].sum / acc[r].n : 0, seen: acc[r]?.seen ?? 0, n: acc[r]?.n ?? 0 })) };
  }, [s.cards]);

  const strongest = [...regions].sort((a, b) => b.v - a.v)[0];
  const weakest = [...regions].sort((a, b) => a.v - b.v)[0];

  return (
    <Page>
      <StatusBar />

      {/* Hero score */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden mt-2 p-6 text-center">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-80 h-80 rounded-full opacity-25 -translate-y-1/3" style={{ background: `radial-gradient(circle, ${tier.color} 0%, transparent 68%)` }} />
        <div className="relative">
          <div className="text-xs uppercase tracking-[.25em] text-mist font-bold">IQ</div>
          <div className="display font-extrabold leading-none tracking-tight mt-2" style={{ fontSize: 'clamp(5rem, 28vw, 8.5rem)', color: tier.color, textShadow: `0 0 60px ${tier.color}66` }}>
            <CountUp from={Math.max(60, iq - 30)} to={iq} duration={1.4} />
          </div>
          <div className="display text-2xl font-bold mt-1">{tier.emoji} {tier.name}</div>
          <div className="text-mist mt-1">
            {provisional
              ? <>Calibrating — <b className="text-paper">{Math.min(answered, 30)}/30</b> answers until your score is reliable</>
              : <>Sharper than <b className="text-paper">{pct}%</b> of explorers</>}
          </div>
          {provisional && <Progress value={answered / 30} className="mt-3 max-w-xs mx-auto" color={tier.color} h={6} />}
          <div className="flex justify-center gap-2 mt-5">
            <button className="btn btn-primary" onClick={() => go('/test')}>🧠 {s.tests.length ? 'Retake the test' : 'Take the IQ Test'}</button>
          </div>
          {lastTest && <div className="text-sm text-mist mt-2">Last test: <b className="mono text-paper">{lastTest.iq}</b> on {lastTest.date}</div>}
        </div>
      </motion.div>

      <SectionTitle>Tier ladder</SectionTitle>
      <div className="card p-4"><TierLadder iq={iq} /></div>

      <SectionTitle sub="dashed ring = 100 (average)">Skill profile</SectionTitle>
      <div className="card p-3">
        <Radar ratings={s.ratings} />
        <div className="text-sm text-mist text-center -mt-1 mb-1 leading-snug">Untested skills sit at the baseline — play them to reveal your real level.</div>
      </div>

      <SectionTitle sub={`${s.iqHistory.length} day${s.iqHistory.length === 1 ? '' : 's'} tracked`}>Your trend</SectionTitle>
      <div className="card p-3"><HistoryChart history={s.iqHistory} tests={s.tests} /></div>

      <SectionTitle sub={strongest.v > 0 ? `best: ${strongest.r}` : undefined}>World strength</SectionTitle>
      <div className="card p-3">
        <div className="aspect-[1.9] w-full rounded-2xl overflow-hidden border border-line/60">
          <WorldMap fills={fills} detail="110" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs text-mist mt-2">
          {[['#2a5f8f', 'Seen'], ['#2f9bd6', 'Learning'], ['#3ddc97', 'Strong'], ['#ffb547', 'Mastered']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
        </div>
        <div className="space-y-2.5 mt-4">
          {regions.map(({ r, v, seen, n }) => (
            <div key={r} className="flex items-center gap-3">
              <span className="w-24 text-sm font-semibold flex items-center gap-1.5">{REGION_META[r].emoji} {r}</span>
              <Progress value={v} color={REGION_META[r].color} h={8} className="flex-1" />
              <span className="mono text-xs text-mist w-16 text-right">{Math.round(v * 100)}% · {seen}/{n}</span>
            </div>
          ))}
        </div>
        {weakest && strongest.v > 0 && (
          <button className="btn btn-ghost w-full mt-4 !py-2.5 text-sm" onClick={() => go(`/play/mix?region=${weakest.r}`)}>
            Train your weakest region: {REGION_META[weakest.r].emoji} {weakest.r} →
          </button>
        )}
      </div>

      <SectionTitle>How your IQ works</SectionTitle>
      <div className="card p-5 space-y-3 text-sm leading-relaxed">
        <p><b className="display text-amber">Every question has a difficulty.</b> It's estimated from how well-known a country is (Wikipedia traffic, population, size) and the skill — a tiny island's silhouette is harder than Brazil's flag.</p>
        <p><b className="display text-amber">Your answers move your ability.</b> Your IQ uses a 3-parameter item response model (the maths behind standardised tests): beating a hard item lifts you a lot, missing an easy one costs you.</p>
        <p><b className="display text-amber">Guessing is corrected.</b> A lucky pick among 4 choices counts for less than a typed answer or a map click, so typing really is the fastest way up.</p>
        <p><b className="display text-amber">The scale.</b> 100 is an average explorer and 15 points is one standard deviation, like an IQ score. The adaptive test pins your level down fastest.</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {TIERS.map((t) => <span key={t.name} className="chip" style={{ color: t.color, borderColor: t.color + '55' }}>{t.emoji} {t.name} {t.min ? `${t.min}+` : ''}</span>)}
        </div>
      </div>
    </Page>
  );
}
