import { useMemo, useState } from 'react';
import { QuizRunner } from '../components/QuizRunner';
import { MODE_BY_KEY } from '../lib/modes';
import { useGame, dueCards } from '../lib/store';
import { sessionQuestions, makeQuestion, type Question, type Variant } from '../lib/questions';
import { useRoute, go } from '../lib/router';
import { regionFrame } from '../lib/path';
import { shuffle } from '../lib/rng';

function build(modeKey: string, region: string | null, typed: boolean): Question[] {
  const s = useGame.getState();
  const m = MODE_BY_KEY[modeKey];
  if (modeKey === 'review') {
    const due = dueCards(s.cards).slice(0, 15);
    const V: Record<string, Variant> = { shape: 'shape', flag: 'flag', map: 'map-find', capital: 'capital' };
    if (due.length) return shuffle(due.map(([k]) => { const [id, sk] = k.split(':'); return makeQuestion(id, V[sk], { choices: typed ? 0 : 4 }); }));
    return sessionQuestions(['shape', 'flag', 'map-find', 'capital'], 10, { theta: s.ratings.all.theta, cards: s.cards });
  }
  const skill = m.variants[0] === 'map-find' ? 'map' : m.variants[0].split('-')[0];
  const theta = (s.ratings as Record<string, { theta: number }>)[skill]?.theta ?? s.ratings.all.theta;
  const n = m.rush ? 15 : m.n ?? 10;
  return sessionQuestions(m.variants, n, { region, theta, cards: s.cards, choices: typed && m.typed ? 0 : 4 });
}

export default function PlayScreen({ mode }: { mode: string }) {
  const { query } = useRoute();
  const region = query.get('region');
  const typed = query.get('typed') === '1';
  const m = MODE_BY_KEY[mode];
  const [round, setRound] = useState(0);
  const questions = useMemo(() => (m ? build(mode, region, typed) : []), [mode, region, typed, round, m]);
  if (!m) { go('/play'); return null; }
  // Frame the region without far-flung outliers (Russia across the 180° line, French overseas territories…).
  const regionFocus = region ? regionFrame(region) : null;
  return (
    <QuizRunner
      key={`${mode}|${region}|${typed}|${round}`}
      title={m.title + (region ? ` · ${region}` : '')}
      questions={questions}
      rush={m.rush}
      modeKey={m.key}
      regionFocus={regionFocus}
      more={m.rush ? () => build(mode, region, typed) : undefined}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}
