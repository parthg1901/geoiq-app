/**
 * Room chat UI: a floating chat button (with unread badge), a bottom-sheet chat panel, bubbles for
 * new messages while you play, and one-tap reactions that float up the screen.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useRoom } from '../../lib/mp/room';
import { CHAT, REACTIONS, cleanChat, type ChatMsg, type Phase } from '../../lib/mp/protocol';
import { useGame } from '../../lib/store';
import { onBack } from '../../lib/native';
import { sfx } from '../../lib/sound';

/** Phases where the screen is busy with a question/race: chat stays out of the way. */
const BUSY: Phase[] = ['countdown', 'question', 'race'];

export function ChatDock({ phase }: { phase: Phase }) {
  const { chat, unread, chatOpen, setChatOpen, you, state } = useRoom();
  const bubblesOn = useGame((s) => s.mp.chatBubbles !== false);
  const busy = BUSY.includes(phase);
  const mutedByHost = !!you && !!state?.muted.includes(you);

  useEffect(() => (chatOpen ? onBack(() => setChatOpen(false)) : undefined), [chatOpen, setChatOpen]);

  return createPortal(
    <>
      <Reactions chat={chat} />
      {!chatOpen && bubblesOn && <Bubbles chat={chat} you={you} compact={busy} />}
      {!chatOpen && (
        <button aria-label={`Chat${unread ? ` (${unread} new)` : ''}`} onClick={() => setChatOpen(true)}
          className={`fixed z-[45] right-3 rounded-full grid place-items-center bg-deep border border-line shadow-[0_6px_20px_rgba(0,0,0,.5)] ${busy ? 'w-10 h-10 text-lg' : 'w-12 h-12 text-xl'}`}
          // During questions/races: small, top-right under the header. Otherwise: bottom-right above the actions.
          style={busy ? { top: 'calc(var(--sat) + 5.75rem)', opacity: 0.85 } : { bottom: 'calc(var(--sab) + 6.5rem)' }}>
          💬
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-coral text-ink text-xs font-bold grid place-items-center">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      )}
      <AnimatePresence>{chatOpen && <ChatSheet onClose={() => setChatOpen(false)} mutedByHost={mutedByHost} />}</AnimatePresence>
    </>,
    document.body,
  );
}

function ChatSheet({ onClose, mutedByHost }: { onClose: () => void; mutedByHost: boolean }) {
  const { chat, you, send, state } = useRoom();
  const bubblesOn = useGame((s) => s.mp.chatBubbles !== false);
  const mpUpdate = useGame((s) => s.mpUpdate);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const texts = chat.filter((m) => m.text);
  const players = state?.players ?? [];

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [texts.length]);

  const submit = () => {
    const t = cleanChat(text);
    if (!t || mutedByHost) return;
    send({ t: 'chat', text: t });
    setText('');
    sfx.tap();
  };

  return (
    <motion.div className="fixed inset-0 z-[60] flex flex-col justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button aria-label="Close chat" className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <motion.div initial={{ y: 60 }} animate={{ y: 0 }} exit={{ y: 60 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="relative mx-auto w-full max-w-lg bg-deep border-t border-line rounded-t-3xl flex flex-col max-h-[72dvh]"
        style={{ paddingBottom: 'calc(var(--sab) + 0.5rem)' }}>
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-line/50">
          <div className="display font-bold text-lg flex-1">Room chat</div>
          <label className="flex items-center gap-2 text-sm text-mist">
            <input type="checkbox" checked={bubblesOn} onChange={(e) => mpUpdate({ chatBubbles: e.target.checked })} className="accent-amber w-4 h-4" />
            Pop-ups while playing
          </label>
          <button aria-label="Close" onClick={onClose} className="w-9 h-9 rounded-full grid place-items-center bg-white/5 border border-line ml-1">✕</button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-32">
          {texts.length === 0 && <div className="text-center text-mist text-sm py-6">No messages yet. Say hi 👋</div>}
          {texts.map((m) => {
            const mine = m.from === you;
            const idx = players.findIndex((p) => p.id === m.from);
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-amber/20 border border-amber/40' : 'bg-white/5 border border-line/60'}`}>
                  {!mine && <div className="text-xs font-bold mb-0.5" style={{ color: nameColor(idx) }}>{m.name}</div>}
                  <div className="leading-snug break-words">{m.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-3 pt-2 border-t border-line/50">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-2">
            {REACTIONS.map((e) => (
              <button key={e} disabled={mutedByHost} onClick={() => { send({ t: 'react', emoji: e }); sfx.tap(); }}
                className="shrink-0 h-10 min-w-10 px-2 rounded-xl bg-white/5 border border-line text-lg font-bold disabled:opacity-40">{e}</button>
            ))}
          </div>
          {mutedByHost ? (
            <div className="text-sm text-rose text-center py-2">The host has muted you in this room.</div>
          ) : (
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value.slice(0, CHAT.maxLen))} placeholder="Message…" maxLength={CHAT.maxLen}
                // keep keystrokes away from game shortcuts (crossword letters, 1–4 answer picks)
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
                enterKeyHint="send" autoComplete="off"
                className="flex-1 min-w-0 bg-ink/70 border-2 border-line focus:border-amber outline-none rounded-2xl px-4 py-3 placeholder:text-mist/80" />
              <button onPointerDown={(e) => e.preventDefault()} onClick={submit} disabled={!cleanChat(text)} className="btn btn-primary px-4">Send</button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** New text messages pop up briefly (smaller and higher up during questions/races). */
function Bubbles({ chat, you, compact }: { chat: ChatMsg[]; you: string | null; compact: boolean }) {
  const [shown, setShown] = useState<ChatMsg[]>([]);
  const seen = useRef<number>(chat.at(-1)?.id ?? 0);
  useEffect(() => {
    const fresh = chat.filter((m) => m.id > seen.current && m.text && m.from !== you);
    if (chat.length) seen.current = Math.max(seen.current, chat.at(-1)!.id);
    if (!fresh.length) return;
    setShown((s) => [...s, ...fresh].slice(-3));
    const ids = fresh.map((m) => m.id);
    const t = setTimeout(() => setShown((s) => s.filter((m) => !ids.includes(m.id))), compact ? 3500 : 5000);
    return () => clearTimeout(t);
  }, [chat, you, compact]);
  return (
    <div className="fixed z-[44] left-3 right-16 flex flex-col items-start gap-1.5 pointer-events-none"
      style={compact ? { top: 'calc(var(--sat) + 5.75rem)' } : { bottom: 'calc(var(--sab) + 6.5rem)' }}>
      <AnimatePresence>
        {shown.map((m) => (
          <motion.div key={m.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            className={`max-w-full rounded-2xl bg-deep/95 border border-line shadow-lg ${compact ? 'px-2.5 py-1 text-sm' : 'px-3 py-2'}`}>
            <span className="font-bold text-amber">{m.name}: </span><span className="break-words">{m.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Reactions float up from the bottom-right, livestream style. */
function Reactions({ chat }: { chat: ChatMsg[] }) {
  const [live, setLive] = useState<(ChatMsg & { x: number })[]>([]);
  const seen = useRef<number>(chat.at(-1)?.id ?? 0);
  useEffect(() => {
    const fresh = chat.filter((m) => m.id > seen.current && m.emoji);
    if (chat.length) seen.current = Math.max(seen.current, chat.at(-1)!.id);
    if (!fresh.length) return;
    setLive((l) => [...l, ...fresh.map((m) => ({ ...m, x: Math.random() * 60 }))].slice(-12));
    const ids = fresh.map((m) => m.id);
    const t = setTimeout(() => setLive((l) => l.filter((m) => !ids.includes(m.id))), 2600);
    return () => clearTimeout(t);
  }, [chat]);
  return (
    <div className="fixed z-[46] right-2 w-24 pointer-events-none" style={{ bottom: 'calc(var(--sab) + 9rem)', height: '45dvh' }}>
      <AnimatePresence>
        {live.map((m) => (
          <motion.div key={m.id} className="absolute bottom-0 flex flex-col items-center" style={{ right: m.x }}
            initial={{ y: 0, opacity: 0, scale: 0.5 }} animate={{ y: '-38dvh', opacity: [0, 1, 1, 0], scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 2.4, ease: 'easeOut' }}>
            <span className={m.emoji === 'GG' ? 'display font-extrabold text-amber text-xl' : 'text-3xl'}>{m.emoji}</span>
            <span className="text-[11px] font-bold text-paper/80 bg-ink/70 rounded px-1 max-w-20 truncate">{m.name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const NAME_COLORS = ['#53b8ff', '#3ddc97', '#b48cff', '#ff6b5e', '#ffb547', '#5ed3a8', '#ff8fc7', '#9fe7ff'];
const nameColor = (i: number) => NAME_COLORS[Math.max(0, i) % NAME_COLORS.length];
