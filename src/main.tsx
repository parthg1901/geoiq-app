import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initNative, isNative } from './lib/native';
import { initKeyboard } from './lib/keyboard';
import { initSync, onSyncGone } from './lib/sync';
import { initSocial } from './lib/social';
import { initUpdateCheck } from './lib/update';
import { toast } from './components/Toasts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

initNative();
initKeyboard();
onSyncGone(() => toast({ icon: '☁️', title: 'Sync turned off', body: 'The cloud copy was deleted from another phone. Your progress here is kept.' }));
initSync();
initSocial();
initUpdateCheck();

// The Android app bundles every file already, so the offline service worker is web-only.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
