import { useGame } from './store';
import { haptic } from './native';

let ctx: AudioContext | null = null;
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, delay = 0, slide = 0) {
  if (!useGame.getState().sound) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch { /* audio unavailable */ }
}

export const sfx = {
  right: (combo = 0) => { const b = 660 * Math.pow(1.06, Math.min(combo, 8)); tone(b, 0.12, 'triangle'); tone(b * 1.5, 0.18, 'triangle', 0.1, 0.07); },
  wrong: () => { tone(220, 0.25, 'sawtooth', 0.05, 0, 0.6); },
  tap: () => tone(880, 0.04, 'sine', 0.05),
  hint: () => tone(520, 0.1, 'sine', 0.07, 0, 1.3),
  stamp: () => { tone(140, 0.12, 'square', 0.08, 0, 0.5); tone(90, 0.2, 'sine', 0.15, 0.02); },
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, i * 0.09)),
  spin: () => tone(1200, 0.02, 'square', 0.03),
  win: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, 'triangle', 0.09, i * 0.07)),
};

/** Vibration feedback: native haptics in the Android app, navigator.vibrate on the web. */
export const buzz = (ms: number | number[] = 15) => {
  if (haptic(Array.isArray(ms) ? 'wrong' : ms <= 12 ? 'right' : 'tap')) return;
  try { navigator.vibrate?.(ms); } catch { /* no-op */ }
};
