import { lazy, Suspense, useEffect } from 'react';
import { useRoute, go } from './lib/router';
import { useGame } from './lib/store';
import { Toasts, toast } from './components/Toasts';
import { NavBar } from './components/NavBar';
import Home from './screens/Home';
import PlayHub from './screens/PlayHub';

const PlayScreen = lazy(() => import('./screens/PlayScreen'));
const Learn = lazy(() => import('./screens/Learn'));
const Lesson = lazy(() => import('./screens/Lesson'));
const IQ = lazy(() => import('./screens/IQ'));
const IQTest = lazy(() => import('./screens/IQTest'));
const Daily = lazy(() => import('./screens/Daily'));
const Borderline = lazy(() => import('./screens/Borderline'));
const HotCold = lazy(() => import('./screens/HotCold'));
const Passport = lazy(() => import('./screens/Passport'));
const Profile = lazy(() => import('./screens/Profile'));
const Country = lazy(() => import('./screens/Country'));
const Atlas = lazy(() => import('./screens/Atlas'));
const Onboarding = lazy(() => import('./screens/Onboarding'));

export default function App() {
  const { parts } = useRoute();
  const onboarded = useGame((s) => s.onboarded);
  const checkStreak = useGame((s) => s.checkStreak);

  useEffect(() => {
    const r = checkStreak();
    if (r.froze) toast({ icon: '🧊', title: `Streak freeze used ×${r.froze}`, body: 'Your streak survived. Phew!' });
    else if (r.lost >= 2) toast({ icon: '💔', title: `Streak of ${r.lost} lost`, body: 'Start a new one today!' });
  }, [checkStreak]);

  const top = parts[0] ?? '';
  const immersive = ['play', 'lesson', 'test', 'daily', 'borderline', 'hotcold', 'country'].includes(top) && parts.length > (top === 'play' ? 1 : 0);

  let screen: React.ReactNode;
  if (!onboarded) screen = <Onboarding />;
  else switch (top) {
    case '': screen = <Home />; break;
    case 'play': screen = parts[1] ? <PlayScreen mode={parts[1]} /> : <PlayHub />; break;
    case 'learn': screen = <Learn />; break;
    case 'lesson': screen = <Lesson id={parts[1]} />; break;
    case 'iq': screen = <IQ />; break;
    case 'test': screen = <IQTest />; break;
    case 'daily': screen = <Daily />; break;
    case 'borderline': screen = <Borderline />; break;
    case 'hotcold': screen = <HotCold />; break;
    case 'passport': screen = <Passport />; break;
    case 'me': screen = <Profile />; break;
    case 'country': screen = <Country id={parts[1]} />; break;
    case 'atlas': screen = <Atlas />; break;
    default: go('/');
  }

  return (
    <div className="atlas-bg min-h-dvh">
      <Toasts />
      <Suspense fallback={<div className="min-h-dvh grid place-items-center text-mist display">Unfolding the map…</div>}>{screen}</Suspense>
      {onboarded && !immersive && <NavBar active={top} />}
    </div>
  );
}
