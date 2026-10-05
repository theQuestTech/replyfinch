import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  Eye,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Paperclip,
  Send,
  Smartphone,
  Smile,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { Conversation, Message } from '@replyfinch/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { clientId, clock, duration, initials, visitorLabel } from '../../lib/format';
import { getSocket } from '../../lib/realtime';
import { useDesk, type ChatMode } from '../../lib/store';
import { Avatar, Button, CountryCode, IconButton, Kbd, Pill } from '../ui';
import { Transcript, type PendingMessage } from './Transcript';
import { VisitorInfo } from './VisitorInfo';

type Tab = 'current' | 'past' | 'activity';

/**
 * A visitor's chat window. Rendered as the side window (over the Visitors list) or
 * as the main window (full content area). Opening it only *views* the chat; pressing
 * any key starts typing, and sending that first message joins the chat.
 */
export function ChatWindow({ visitorId, mode }: { visitorId: string; mode: ChatMode }) {
  const me = useAuth((s) => s.agent)!;
  const visitor = useDesk((s) => s.visitors[visitorId]);
  const [convId, setConvId] = useState<string | null>(visitor?.conversationId ?? null);
  const conversation = useDesk((s) => (convId ? s.conversations[convId] : undefined));
  const messages = useDesk((s) => (convId ? s.messages[convId] : undefined));
  const typingName = useDesk((s) => (convId ? s.typing[convId] : null));
  const { setMode, minimize, closeChat, upsertConversation, setMessages } = useDesk.getState();
  const [tab, setTab] = useState<Tab>('current');

  // Follow the visitor's current chat; keep showing an ended one until a new one starts.
  useEffect(() => {
    if (visitor?.conversationId && visitor.conversationId !== convId) setConvId(visitor.conversationId);
  }, [visitor?.conversationId, convId]);

  // View the conversation (load transcript) — this does not join it.
  useEffect(() => {
    if (!convId) return;
    const s = getSocket();
    s?.timeout(10_000)
      .emitWithAck('conversation:watch', { conversationId: convId })
      .then((res) => {
        if (!res.ok) return;
        upsertConversation(res.data.conversation);
        setMessages(convId, res.data.messages);
      })
      .catch(() => {});
    return () => {
      s?.emit('conversation:unwatch', { conversationId: convId });
    };
  }, [convId, upsertConversation, setMessages]);

  // Window shortcuts: Esc minimizes, ⌘/Ctrl+↑ switches side ⇄ main.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode === 'side') minimize();
      if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMode(mode === 'side' ? 'main' : 'side');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, minimize, setMode]);

  if (!visitor) return null;

  const open = conversation && conversation.status !== 'ended';
  const joined = !!open && conversation.participantIds.includes(me.id);
  const name = visitorLabel(visitor);
  const sideWidth = mode === 'side' ? 270 : 320;

  return (
    <div
      className={clsx('flex min-h-0 flex-1 flex-col', mode === 'main' && 'h-full gap-3 px-8 pt-4 pb-6')}
      data-testid={`chat-window-${mode}`}
    >
      {mode === 'main' && <OpenChatsStrip activeId={visitorId} />}
      <div className={clsx('flex min-h-0 flex-1 flex-col bg-surface', mode === 'main' && 'overflow-hidden rounded-xl border border-line')}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line py-3 pr-4 pl-5">
          <Avatar text={initials(visitor.name)} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold">{name}</span>
              <CountryCode code={visitor.country} />
              {visitor.device === 'mobile' ? <Smartphone className="size-3 text-ink-2" /> : <Monitor className="size-3 text-ink-2" />}
            </div>
            <HeaderStatus conversation={conversation} joined={joined} meId={me.id} left={!!visitor.left} />
          </div>
          <div className="flex-1" />
          {mode === 'side' ? (
            <>
              <Button>
                Actions <ChevronDown className="size-3.5 text-ink-2" />
              </Button>
              <IconButton label="Open in main window (⌘↑)" onClick={() => setMode('main')}>
                <Maximize2 className="size-4" />
              </IconButton>
              <IconButton label="Minimize (Esc)" onClick={minimize}>
                <Minus className="size-4" />
              </IconButton>
              <IconButton label="Close" onClick={() => closeChat(visitorId)}>
                <X className="size-4" />
              </IconButton>
            </>
          ) : (
            <>
              <Button disabled title="Coming soon">
                <ArrowRightLeft className="size-3.5" /> Transfer
              </Button>
              <Button>
                Actions <ChevronDown className="size-3.5 text-ink-2" />
              </Button>
              <IconButton label="Pop out to side window (⌘↑)" onClick={() => setMode('side')}>
                <Minimize2 className="size-4" />
              </IconButton>
              {open && (
                <Button variant="danger" onClick={() => getSocket()?.emit('chat:end', { conversationId: conversation.id })}>
                  End chat
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex gap-5 border-b border-line px-5">
              {(
                [
                  ['current', 'Current chat'],
                  ['past', `Past chats (${Math.max(visitor.pastChats - (open ? 1 : 0), 0)})`],
                  ['activity', 'Visitor activity'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={clsx(
                    'cursor-pointer border-b-2 pt-2.5 pb-2 text-[13px]',
                    tab === id ? 'border-primary font-semibold text-primary' : 'border-transparent font-medium text-ink-2 hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'current' && (
              <CurrentChat
                visitorId={visitor.id}
                visitorName={name}
                visitorLeft={!!visitor.left}
                conversation={conversation}
                messages={messages ?? []}
                typingName={typingName}
                joined={joined}
                meId={me.id}
                onStarted={(c, msgs) => {
                  upsertConversation(c);
                  setMessages(c.id, msgs);
                  setConvId(c.id);
                }}
              />
            )}
            {tab === 'past' && <PastChats visitorId={visitor.id} currentId={open ? conversation.id : null} meId={me.id} />}
            {tab === 'activity' && (
              <div className="flex-1 overflow-y-auto bg-canvas p-5">
                <div className="flex flex-col gap-3">
                  {[...visitor.path].reverse().map((p, i) => (
                    <div key={`${p.at}-${i}`} className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                      <Eye className={clsx('mt-0.5 size-4', i === 0 ? 'text-primary' : 'text-ink-2')} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{p.title}</div>
                        <div className="truncate text-[11px] text-ink-2">{p.url}</div>
                      </div>
                      <span className="text-[11px] text-ink-2">{clock(p.at)}</span>
                    </div>
                  ))}
                  {visitor.path.length === 0 && <div className="text-sm text-ink-2">No page views yet.</div>}
                </div>
              </div>
            )}
          </div>
          <VisitorInfo visitor={visitor} width={sideWidth} />
        </div>
      </div>
    </div>
  );
}

function HeaderStatus({ conversation, joined, meId, left }: { conversation?: Conversation; joined: boolean; meId: string; left: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  if (left) return <div className="text-[11px] text-ink-2">Left the website</div>;
  if (!conversation || conversation.status === 'ended')
    return <div className="text-[11px] text-ink-2">{conversation ? 'Chat ended' : 'Browsing — not chatting'}</div>;
  if (conversation.status === 'waiting')
    return (
      <Pill tone="danger" className="mt-0.5">
        Unassigned · waiting {duration(Date.now() - conversation.startedAt)}
      </Pill>
    );
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
      <span className="size-[7px] rounded-full bg-success" />
      {joined ? 'You’re chatting' : `${conversation.assigneeId === meId ? 'You' : conversation.assigneeName} chatting`}
      {conversation.department && ` · ${conversation.department}`} · started {clock(conversation.startedAt)}
    </div>
  );
}

function CurrentChat({
  visitorId,
  visitorName,
  visitorLeft,
  conversation,
  messages,
  typingName,
  joined,
  meId,
  onStarted,
}: {
  visitorId: string;
  visitorName: string;
  visitorLeft: boolean;
  conversation?: Conversation;
  messages: Message[];
  typingName: string | null | undefined;
  joined: boolean;
  meId: string;
  onStarted: (c: Conversation, m: Message[]) => void;
}) {
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const open = conversation && conversation.status !== 'ended';
  const ended = conversation?.status === 'ended';

  // Drop optimistic messages once the server echo arrives.
  useEffect(() => {
    const ids = new Set(messages.map((m) => m.clientId));
    setPending((p) => (p.some((x) => ids.has(x.clientId)) ? p.filter((x) => !ids.has(x.clientId)) : p));
  }, [messages]);

  const send = useCallback(
    async (body: string, internal: boolean) => {
      const s = getSocket();
      if (!s) return;
      const cid = clientId();
      setPending((p) => [...p, { clientId: cid, body, internal }]);
      const markFailed = () => setPending((p) => p.map((x) => (x.clientId === cid ? { ...x, failed: true } : x)));
      try {
        if (open) {
          const res = await s.timeout(10_000).emitWithAck('message:send', { conversationId: conversation.id, body, clientId: cid, internal });
          if (!res.ok) markFailed();
          else useDesk.getState().addMessage(res.data);
        } else {
          // Visitor is browsing (or their last chat ended): start a new chat with them.
          const res = await s.timeout(10_000).emitWithAck('chat:initiate', { visitorId, body, clientId: cid });
          if (!res.ok) markFailed();
          else onStarted(res.data.conversation, res.data.messages);
        }
      } catch {
        markFailed();
      }
    },
    [open, conversation?.id, visitorId, onStarted],
  );

  const emptyState = (
    <div className="m-auto max-w-sm text-center text-sm text-ink-2">
      <Eye className="mx-auto mb-2 size-6 text-primary" />
      {visitorName} isn’t chatting yet. Start typing to send them a message — the chat opens on their screen.
    </div>
  );

  const visibleMessages = ended || open ? messages : [];
  return (
    <>
      <Transcript messages={visibleMessages} pending={pending} typingName={open ? typingName : null} empty={emptyState} meId={meId} />
      {visitorLeft && !open ? (
        <div className="border-t border-line bg-surface px-4 py-4 text-center text-sm text-ink-2">{visitorName} has left the website.</div>
      ) : (
        <Composer
          key={conversation?.id ?? 'new'}
          joined={joined}
          canInternal={!!open}
          viewingLabel={
            open
              ? conversation.status === 'waiting'
                ? 'You’re viewing this chat. Start typing to join.'
                : 'You’re viewing this chat. Start typing to join the conversation.'
              : ended
                ? 'This chat has ended. Start typing to start a new chat.'
                : 'Start typing to start a chat with this visitor.'
          }
          visitorName={visitorName}
          conversationId={open ? conversation.id : null}
          onSend={send}
        />
      )}
    </>
  );
}

function Composer({
  joined,
  canInternal,
  viewingLabel,
  visitorName,
  conversationId,
  onSend,
}: {
  joined: boolean;
  canInternal: boolean;
  viewingLabel: string;
  visitorName: string;
  conversationId: string | null;
  onSend: (body: string, internal: boolean) => void;
}) {
  const [composing, setComposing] = useState(joined);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const typingRef = useRef<{ on: boolean; timer?: number }>({ on: false });

  useEffect(() => {
    if (joined) setComposing(true);
  }, [joined]);

  // "Press any key to join": a printable key anywhere in the window starts composing.
  useEffect(() => {
    if (composing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      e.preventDefault();
      setText(e.key);
      setComposing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composing]);

  useEffect(() => {
    if (composing && ref.current) {
      ref.current.focus();
      const end = ref.current.value.length;
      ref.current.setSelectionRange(end, end);
    }
  }, [composing]);

  const emitTyping = (on: boolean) => {
    if (!conversationId || internal) return;
    const st = typingRef.current;
    window.clearTimeout(st.timer);
    if (on) st.timer = window.setTimeout(() => emitTyping(false), 4000);
    if (st.on === on) return;
    st.on = on;
    getSocket()?.emit('typing', { conversationId, isTyping: on });
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    emitTyping(false);
    onSend(body, internal && canInternal);
  };

  if (!composing) {
    return (
      <div className="flex flex-col gap-2 border-t border-line bg-surface px-4 pt-3 pb-3.5">
        <button
          onClick={() => setComposing(true)}
          data-testid="join-prompt"
          className="flex cursor-text flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-primary bg-primary-subtle px-4 py-5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Eye className="size-4" /> {viewingLabel}
          </span>
          <span className="text-xs text-ink-2">
            Press any key to start — {visitorName} won’t see you until you send your first message.
          </span>
        </button>
        <div className="flex gap-3.5 text-[11px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> close
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘ ↑</Kbd> switch window
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-surface px-4 pt-3 pb-3.5">
      <div
        className={clsx(
          'flex flex-col gap-2.5 rounded-[10px] border-[1.5px] pt-3 pr-2.5 pb-2.5 pl-3.5',
          internal ? 'border-warning bg-warning-subtle' : 'border-primary',
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={2}
          aria-label="Message"
          placeholder={internal ? 'Write an internal note — only agents can see this' : `Reply to ${visitorName}…`}
          onChange={(e) => {
            setText(e.target.value);
            emitTyping(e.target.value.length > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="resize-none bg-transparent text-sm outline-none placeholder:text-ink-2"
        />
        <div className="flex items-center gap-1.5">
          {[
            [Paperclip, 'Attach'],
            [Smile, 'Emoji'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Paperclip;
            return (
              <button key={label as string} title={`${label as string} (coming soon)`} className="rounded-md p-1.5 text-ink-2 hover:bg-muted" disabled>
                <I className="size-[15px]" />
              </button>
            );
          })}
          <ToolbarButton icon={Zap} label="Shortcuts" disabled />
          <ToolbarButton icon={Sparkles} label="AI suggest" disabled />
          {canInternal && (
            <ToolbarButton icon={Lock} label="Internal note" active={internal} onClick={() => setInternal((v) => !v)} />
          )}
          <div className="flex-1" />
          <span className="text-[11px] text-ink-2">↵ to send</span>
          <Button variant="primary" onClick={submit} disabled={!text.trim()}>
            <Send className="size-3.5" /> {internal ? 'Add note' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: typeof Lock;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} (coming soon)` : label}
      className={clsx(
        'flex items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-xs font-medium',
        active ? 'bg-warning text-white' : 'text-ink-2 enabled:cursor-pointer enabled:hover:bg-muted',
      )}
    >
      <Icon className="size-[15px]" /> {label}
    </button>
  );
}

function PastChats({ visitorId, currentId, meId }: { visitorId: string; currentId: string | null; meId: string }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  useEffect(() => {
    api<Conversation[]>(`/visitors/${visitorId}/conversations`)
      .then((l) => setList(l.filter((c) => c.id !== currentId)))
      .catch(() => setList([]));
  }, [visitorId, currentId]);
  if (selected)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <button onClick={() => setSelected(null)} className="flex cursor-pointer items-center gap-1.5 bg-canvas px-5 pt-3 text-xs font-semibold text-primary">
          <ArrowLeft className="size-3.5" /> All past chats
        </button>
        <Transcript messages={selected.messages} meId={meId} />
      </div>
    );
  return (
    <div className="flex-1 overflow-y-auto bg-canvas p-5">
      {list === null && <div className="text-sm text-ink-2">Loading…</div>}
      {list?.length === 0 && <div className="text-sm text-ink-2">No past chats.</div>}
      <div className="flex flex-col gap-2">
        {list?.map((c) => (
          <button
            key={c.id}
            onClick={() => api<{ conversation: Conversation; messages: Message[] }>(`/conversations/${c.id}`).then(setSelected)}
            className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:border-primary"
          >
            <div>
              <div className="text-[13px] font-semibold">{new Date(c.startedAt).toLocaleString()}</div>
              <div className="text-[11px] text-ink-2">
                {c.assigneeName ? `With ${c.assigneeName}` : 'Not answered'}
                {c.department && ` · ${c.department}`}
              </div>
            </div>
            <Pill tone={c.status === 'ended' ? 'muted' : 'success'}>{c.status}</Pill>
          </button>
        ))}
      </div>
    </div>
  );
}

function OpenChatsStrip({ activeId }: { activeId: string }) {
  const tabs = useDesk((s) => s.openTabs);
  const visitors = useDesk((s) => s.visitors);
  const conversations = useDesk((s) => s.conversations);
  const unread = useDesk((s) => s.unread);
  const { openChat, closeChat, minimize } = useDesk.getState();
  const dotFor = useMemo(
    () => (id: string) => {
      const v = visitors[id];
      if (!v || v.left) return 'bg-offline';
      const c = v.conversationId ? conversations[v.conversationId] : undefined;
      return c?.status === 'waiting' ? 'bg-warning' : 'bg-success';
    },
    [visitors, conversations],
  );
  return (
    <div className="flex items-center gap-2">
      <button onClick={minimize} className="flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-3 pl-2 text-[13px] font-medium text-ink-2 hover:bg-muted">
        <ArrowLeft className="size-3.5" /> Back
      </button>
      <span className="h-5 w-px bg-line" />
      {tabs.map((id) => {
        const v = visitors[id];
        if (!v) return null;
        const on = id === activeId;
        return (
          <div
            key={id}
            className={clsx(
              'flex items-center gap-2 rounded-lg py-1.5 pr-2.5 pl-3 text-[13px]',
              on ? 'border border-line bg-surface font-semibold' : 'font-medium text-ink-2',
            )}
          >
            <button onClick={() => openChat(id, 'main')} className="flex cursor-pointer items-center gap-2">
              <span className={clsx('size-2 rounded-full', dotFor(id))} />
              {visitorLabel(v)}
              {(unread[id] ?? 0) > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] leading-4 font-bold text-white">{unread[id]}</span>}
            </button>
            <button onClick={() => closeChat(id)} aria-label={`Close ${visitorLabel(v)}`} className="cursor-pointer text-ink-2 hover:text-ink">
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
