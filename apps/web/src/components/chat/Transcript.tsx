import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { Bird, Lock, MessageCircle } from 'lucide-react';
import type { Message } from '@replyfinch/shared';
import { clock, initials } from '../../lib/format';
import { Avatar } from '../ui';

export interface PendingMessage {
  clientId: string;
  body: string;
  internal: boolean;
  failed?: boolean;
}

export function Transcript({
  messages,
  pending = [],
  typingName,
  empty,
  meId,
}: {
  messages: Message[];
  pending?: PendingMessage[];
  typingName?: string | null;
  empty?: React.ReactNode;
  meId?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending.length, typingName]);

  // Group consecutive messages by the same author into one block.
  const groups: Message[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && m.authorType !== 'system' && prev.authorType === m.authorType && prev.authorId === m.authorId && prev.internal === m.internal && m.createdAt - prev.createdAt < 5 * 60_000)
      last!.push(m);
    else groups.push([m]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-canvas px-5 py-[18px]" data-testid="transcript">
      {messages.length === 0 && pending.length === 0 && empty}
      {groups.map((g) => (
        <Group key={g[0]!.id} messages={g} meId={meId} />
      ))}
      {pending.map((p) => (
        <div key={p.clientId} className="flex justify-end">
          <div
            className={clsx(
              'max-w-[70%] rounded-[14px] rounded-br px-3 py-2 text-[13px] whitespace-pre-wrap',
              p.internal ? 'border border-warning/40 bg-warning-subtle' : 'bg-primary text-white',
              p.failed ? 'opacity-100 ring-2 ring-danger' : 'opacity-60',
            )}
          >
            {p.body}
            {p.failed && <div className="mt-1 text-[11px] font-semibold text-danger">Not sent</div>}
          </div>
        </div>
      ))}
      {typingName && (
        <div className="flex items-center gap-2.5">
          <Avatar text={initials(typingName)} size={28} />
          <span className="flex gap-1 rounded-[14px] rounded-bl border border-line bg-surface px-3 py-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink-2" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          <span className="text-[11px] font-medium text-ink-2">{typingName} is typing…</span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Group({ messages, meId }: { messages: Message[]; meId?: string }) {
  const first = messages[0]!;
  if (first.authorType === 'system') {
    return (
      <div className="flex justify-center">
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-ink-2">
          <MessageCircle className="size-3" />
          {first.body} · {clock(first.createdAt)}
        </span>
      </div>
    );
  }
  const mine = first.authorType === 'agent';
  const internal = first.internal;
  return (
    <div className={clsx('flex items-end gap-2.5', mine && 'flex-row-reverse')}>
      {first.authorType === 'bot' ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold">
          <Bird className="size-4 text-navy" />
        </span>
      ) : (
        <Avatar text={initials(first.authorName)} size={28} tone={mine ? 'gold' : 'primary'} />
      )}
      <div className={clsx('flex max-w-[70%] flex-col gap-1', mine && 'items-end')}>
        <div className="flex items-center gap-1 text-[11px] font-medium text-ink-2">
          {internal && <Lock className="size-3 text-warning" />}
          {first.authorId === meId && mine ? 'You' : first.authorName} · {clock(first.createdAt)}
          {internal && <span className="font-semibold text-warning">Internal note</span>}
        </div>
        {messages.map((m) => (
          <div
            key={m.id}
            className={clsx(
              'rounded-[14px] px-3 py-2 text-[13px] whitespace-pre-wrap break-words',
              internal
                ? 'border border-warning/40 bg-warning-subtle text-ink'
                : mine
                  ? 'rounded-br bg-primary text-white'
                  : first.authorType === 'bot'
                    ? 'rounded-bl bg-muted'
                    : 'rounded-bl border border-line bg-surface',
            )}
          >
            {m.body}
          </div>
        ))}
      </div>
    </div>
  );
}
