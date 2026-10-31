/**
 * Live room client: one WebSocket to the room's Durable Object, with automatic reconnects and an
 * NTP-style clock offset so countdowns match the server's clock on every phone.
 */
import { create } from 'zustand';
import { MP_PROTOCOL, type C2S, type ChatMsg, type ErrorCode, type RoomState, type S2C } from './protocol';
import { wsUrl } from './api';
import { DATA_VERSION } from './version';
import { isNative } from '../native';

export type RoomStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
/** Errors after which reconnecting is pointless. */
const FATAL: ErrorCode[] = ['notfound', 'full', 'version', 'kicked', 'bad', 'started'];

interface RoomStore {
  code: string | null;
  status: RoomStatus;
  state: RoomState | null;
  you: string | null;
  error: { code: ErrorCode | 'offline'; message: string } | null;
  /** serverTime ≈ Date.now() + offset */
  offset: number;
  rtt: number;
  /** Room chat, oldest first (text and reactions); `unread` counts text since the panel was last open. */
  chat: ChatMsg[];
  unread: number;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  connect: (code: string, me: { deviceId: string; name: string; rating: number }) => void;
  send: (m: C2S) => void;
  leave: () => void;
}

let ws: WebSocket | null = null;
let me: { deviceId: string; name: string; rating: number } | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let intentional = false;
let fatal = false;
/** Recent clock samples; the one with the lowest round-trip time is the most trustworthy. */
let samples: { rtt: number; offset: number }[] = [];

export const useRoom = create<RoomStore>((set, get) => {
  const open = () => {
    const code = get().code;
    if (!code || !me) return;
    cleanupSocket();
    set({ status: attempt ? 'reconnecting' : 'connecting' });
    const sock = new WebSocket(wsUrl(code));
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      set({ status: 'open', error: null });
      sock.send(JSON.stringify({ t: 'hello', deviceId: me!.deviceId, name: me!.name, rating: me!.rating, protocol: MP_PROTOCOL, dataVersion: DATA_VERSION } satisfies C2S));
      ping();
      pingTimer = setInterval(ping, 5000);
    };
    sock.onmessage = (ev) => {
      let m: S2C;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'welcome') {
        if (!samples.length) set({ offset: m.state.serverNow - Date.now() });
        // Merge history with anything we already have (reconnects), keyed by message id.
        const known = new Set(get().chat.map((c) => c.id));
        const merged = [...get().chat, ...(m.chat ?? []).filter((c) => !known.has(c.id))].sort((a, b) => a.id - b.id).slice(-80);
        set({ you: m.you, state: m.state, chat: merged });
      } else if (m.t === 'chat') {
        const s0 = get();
        if (s0.chat.some((c) => c.id === m.msg.id)) return;
        const mine = m.msg.from === s0.you;
        set({ chat: [...s0.chat, m.msg].slice(-80), unread: s0.chatOpen || mine || !m.msg.text ? s0.unread : s0.unread + 1 });
      } else if (m.t === 'state') {
        set({ state: m.state });
      } else if (m.t === 'pong') {
        const now = Date.now();
        const rtt = now - m.c;
        samples = [...samples, { rtt, offset: m.s - (m.c + rtt / 2) }].slice(-12);
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        set({ offset: best.offset, rtt });
      } else if (m.t === 'error') {
        set({ error: { code: m.code, message: m.message } });
        if (FATAL.includes(m.code)) { fatal = true; sock.close(); }
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return; // a newer socket replaced this one
      stopPing();
      if (intentional || fatal) { set({ status: 'closed' }); return; }
      scheduleRetry();
    };
    sock.onerror = () => { /* onclose follows */ };
  };

  const scheduleRetry = () => {
    if (retryTimer) return;
    attempt++;
    const delay = Math.min(8000, 400 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
    set({ status: 'reconnecting' });
    retryTimer = setTimeout(() => { retryTimer = null; open(); }, delay);
  };

  const ping = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', c: Date.now() } satisfies C2S)); };
  const stopPing = () => { if (pingTimer) clearInterval(pingTimer); pingTimer = null; };
  const cleanupSocket = () => {
    stopPing();
    if (ws) { const old = ws; ws = null; old.onclose = null; old.onmessage = null; old.onerror = null; try { old.close(); } catch { /* already closed */ } }
  };

  // Phones drop sockets in the background: reconnect straight away when the app comes back.
  const wake = () => {
    const s = get();
    if (!s.code || intentional || fatal || document.visibilityState === 'hidden') return;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      attempt = Math.max(attempt, 1);
      open();
    } else ping();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
  if (isNative) import('@capacitor/app').then(({ App }) => App.addListener('resume', wake)).catch(() => {});

  return {
    code: null, status: 'idle', state: null, you: null, error: null, offset: 0, rtt: 0,
    chat: [], unread: 0, chatOpen: false,
    setChatOpen: (chatOpen) => set(chatOpen ? { chatOpen, unread: 0 } : { chatOpen }),
    connect: (code, who) => {
      me = who;
      intentional = false; fatal = false; attempt = 0; samples = [];
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      set({ code, status: 'connecting', state: null, you: null, error: null, chat: [], unread: 0, chatOpen: false });
      open();
    },
    send: (m) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    leave: () => {
      intentional = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      cleanupSocket();
      set({ code: null, status: 'idle', state: null, you: null, error: null, chat: [], unread: 0, chatOpen: false });
    },
  };
});

/** Current server time estimate. */
export const serverNow = () => Date.now() + useRoom.getState().offset;

// Dev-only handle for debugging in the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __room: typeof useRoom }).__room = useRoom;
