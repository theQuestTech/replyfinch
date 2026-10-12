import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Inbox, Lock, Mail, MessageCircle, Pencil, Send, User } from 'lucide-react';
import type { Conversation, Message, Ticket, TicketMessage, TicketPriority, TicketStatus } from '@replyfinch/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useEmailStatus } from '../lib/email';
import { queryClient } from '../lib/query';
import { useDesk } from '../lib/store';
import { dateTime, initials, timeAgo } from '../lib/format';
import { PRIORITY, STATUS } from '../lib/tickets';
import { Avatar, Button, Card, Modal, Pill, SectionLabel, inputClass } from '../components/ui';
import { Transcript } from '../components/chat/Transcript';

type Detail = { ticket: Ticket; messages: TicketMessage[] };
type Patch = { subject?: string; status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null };

export function TicketDetail() {
  const { id = '' } = useParams();
  const { data, isError } = useQuery({ queryKey: ['ticket', id], queryFn: () => api<Detail>(`/tickets/${id}`) });
  const [saveError, setSaveError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (p: Patch) => api<{ ticket: Ticket }>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    onSuccess: () => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e) => setSaveError(e instanceof ApiError && e.status === 400 && e.message !== 'invalid_input' ? e.message : 'Couldn’t save. Please try again.'),
  });

  if (isError) return <div className="p-10 text-center text-sm text-danger">Couldn’t load this ticket.</div>;
  if (!data) return <div className="p-10 text-sm text-ink-2">Loading…</div>;
  const t = data.ticket;

  return (
    <div className="flex h-full flex-col gap-4 px-8 py-6" data-testid="ticket-detail">
      <Link to="/tickets" className="flex w-fit items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Tickets
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-[22px] font-semibold text-ink-2 tabular-nums">#{t.number}</span>
        <Subject key={t.subject} value={t.subject} onSave={(subject) => update.mutate({ subject })} />
        <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-5">
        <Card className="flex max-h-full min-h-[420px] min-w-0 flex-1 flex-col self-stretch">
          <Thread messages={data.messages} />
          <Composer key={t.id} ticket={t} />
        </Card>

        <div className="flex w-[290px] shrink-0 flex-col gap-4">
          <Card className="flex flex-col gap-3.5 p-5">
            <div className="flex flex-col gap-1">
              <Select label="Status" value={t.status} onChange={(status) => update.mutate({ status: status as TicketStatus })}>
                {Object.entries(STATUS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-ink-2">{STATUS[t.status].hint}</span>
            </div>
            <Select label="Priority" value={t.priority} onChange={(priority) => update.mutate({ priority: priority as TicketPriority })}>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </Select>
            <AssigneeSelect value={t.assigneeId} name={t.assigneeName} onChange={(assigneeId) => update.mutate({ assigneeId })} />
            {saveError && (
              <span role="alert" className="text-xs font-medium text-danger">
                {saveError}
              </span>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-5 text-[13px]">
            <SectionLabel>Customer</SectionLabel>
            {t.requesterName || t.requesterEmail ? (
              <div className="flex items-center gap-2.5">
                <Avatar text={initials(t.requesterName ?? t.requesterEmail)} size={32} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{t.requesterName ?? t.requesterEmail}</div>
                  {t.requesterEmail && (
                    <a href={`mailto:${t.requesterEmail}`} className="block truncate text-xs text-primary hover:underline">
                      {t.requesterEmail}
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-ink-2">No customer on this ticket.</div>
            )}
            {t.visitorId && (
              <Link to={`/customers/${t.visitorId}`} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                <User className="size-3.5" /> View customer profile
              </Link>
            )}
          </Card>

          <Card className="flex flex-col gap-1.5 p-5 text-xs text-ink-2">
            <SectionLabel>Details</SectionLabel>
            <Source ticket={t} />
            <div>
              Created {dateTime(t.createdAt)}
              {t.createdByName ? ` by ${t.createdByName}` : ''}
            </div>
            <div>Updated {timeAgo(t.updatedAt)}</div>
            {t.solvedAt && <div>Solved {dateTime(t.solvedAt)}</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Subject({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group flex min-w-0 cursor-pointer items-center gap-2 text-left" title="Rename">
        <h1 className="truncate text-[22px] font-bold">{value}</h1>
        <Pencil className="size-4 shrink-0 text-ink-2 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }
  const done = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
    else setDraft(value);
  };
  return (
    <input
      autoFocus
      aria-label="Subject"
      value={draft}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={clsx(inputClass, 'max-w-[600px] flex-1 text-lg font-bold')}
    />
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      <select aria-label={label} className={clsx(inputClass, 'h-9 cursor-pointer')} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function AssigneeSelect({ value, name, onChange }: { value: string | null; name: string | null; onChange: (id: string | null) => void }) {
  const me = useAuth((s) => s.agent);
  const team = useDesk((s) => s.team);
  const others = team.filter((t) => t.id !== me?.id);
  // A removed agent can still be the assignee: keep them in the list so the select shows them.
  const missing = value && value !== me?.id && !others.some((t) => t.id === value);
  return (
    <div className="flex flex-col gap-1">
      <Select label="Assignee" value={value ?? ''} onChange={(v) => onChange(v || null)}>
        <option value="">Unassigned</option>
        {me && <option value={me.id}>Me ({me.name})</option>}
        {others.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {missing && <option value={value}>{name ?? 'Former teammate'}</option>}
      </Select>
      {me && value !== me.id && (
        <button onClick={() => onChange(me.id)} className="w-fit cursor-pointer text-xs font-medium text-primary hover:underline">
          Take it
        </button>
      )}
    </div>
  );
}

function Source({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  if (ticket.source === 'offline' && ticket.sourceId) {
    return (
      <Link to={`/inbox?f=all&m=${ticket.sourceId}`} className="flex items-center gap-1.5 font-medium text-primary hover:underline">
        <Inbox className="size-3.5" /> From an offline message
      </Link>
    );
  }
  if (ticket.source === 'chat' && ticket.sourceId) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="flex w-fit cursor-pointer items-center gap-1.5 font-medium text-primary hover:underline">
          <MessageCircle className="size-3.5" /> From a chat — read it
        </button>
        {open && <ChatModal conversationId={ticket.sourceId} onClose={() => setOpen(false)} />}
      </>
    );
  }
  if (ticket.source === 'website') return <div>From a form on your website</div>;
  if (ticket.source === 'api') return <div>Created by a connected app (for example Zapier)</div>;
  if (ticket.source === 'email') {
    return (
      <div className="flex items-center gap-1.5">
        <Mail className="size-3.5" /> From an email to your support address
      </div>
    );
  }
  return <div>Created by hand</div>;
}

function ChatModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const me = useAuth((s) => s.agent?.id);
  const { data, isError } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api<{ conversation: Conversation; messages: Message[] }>(`/conversations/${conversationId}`),
  });
  return (
    <Modal title={data ? `Chat on ${dateTime(data.conversation.startedAt)}` : 'Chat'} onClose={onClose}>
      <div className="-mx-6 -my-5 flex h-[60vh] flex-col">
        {isError ? (
          <div className="m-auto text-sm text-danger">Couldn’t load the chat.</div>
        ) : (
          <Transcript messages={data?.messages ?? []} meId={me} empty={<div className="m-auto text-sm text-ink-2">Loading…</div>} />
        )}
      </div>
    </Modal>
  );
}

function Thread({ messages }: { messages: TicketMessage[] }) {
  if (!messages.length) {
    return <div className="grid flex-1 place-items-center p-8 text-sm text-ink-2">No messages yet. Reply to the customer or add a note below.</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5" data-testid="ticket-thread">
      {messages.map((m) =>
        m.kind === 'event' ? (
          <div key={m.id} className="text-center text-xs text-ink-2" data-testid="ticket-event">
            <b className="font-semibold">{m.authorName}</b> {m.body} · {timeAgo(m.createdAt)}
          </div>
        ) : (
          <div key={m.id} className={clsx('flex gap-3', m.kind !== 'customer' && 'flex-row-reverse')} data-testid={`ticket-${m.kind}`}>
            <Avatar text={initials(m.authorName)} size={32} tone={m.kind === 'customer' ? 'muted' : 'primary'} />
            <div className={clsx('flex max-w-[78%] min-w-0 flex-col gap-1', m.kind !== 'customer' && 'items-end')}>
              <div className="flex items-center gap-1.5 text-xs text-ink-2">
                <b className="text-ink">{m.authorName}</b>
                {m.kind === 'note' && (
                  <span className="flex items-center gap-1 font-semibold text-warning">
                    <Lock className="size-3" /> Internal note
                  </span>
                )}
                {m.kind === 'reply' && m.emailedTo && (
                  <span className="flex items-center gap-1">
                    <Mail className="size-3" /> emailed to {m.emailedTo}
                  </span>
                )}
                <span>· {dateTime(m.createdAt)}</span>
              </div>
              <div
                className={clsx(
                  'rounded-xl px-4 py-2.5 text-sm break-words whitespace-pre-wrap',
                  m.kind === 'customer' && 'border border-line bg-canvas',
                  m.kind === 'reply' && 'bg-primary-subtle',
                  m.kind === 'note' && 'border border-warning/30 bg-warning-subtle',
                )}
              >
                {m.body}
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function Composer({ ticket }: { ticket: Ticket }) {
  const { data: email } = useEmailStatus();
  const canEmail = !!email?.enabled && !!ticket.requesterEmail;
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [draft, setDraft] = useState('');
  // null: the default — after a reply the ball is usually in the customer's court (pending).
  const [status, setStatus] = useState<TicketStatus | 'same' | null>(null);
  const internal = mode === 'note' || !canEmail;
  const fallback: TicketStatus | '' = internal || ticket.status === 'solved' ? '' : 'pending';
  const nextStatus: TicketStatus | '' = status === null ? fallback : status === 'same' ? '' : status;
  const send = useMutation({
    mutationFn: () =>
      api(`/tickets/${ticket.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft.trim(), internal, ...(nextStatus ? { status: nextStatus } : {}) }),
      }),
    onSuccess: () => {
      setDraft('');
      setStatus(null);
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
  const submit = () => draft.trim() && !send.isPending && send.mutate();

  return (
    <div className={clsx('flex flex-col gap-2 border-t px-5 pt-3 pb-4', internal ? 'border-warning/40 bg-warning-subtle/40' : 'border-line')}>
      <div className="flex gap-1" role="tablist">
        {(
          [
            ['reply', 'Reply to customer'],
            ['note', 'Internal note'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={(id === 'note') === internal}
            disabled={id === 'reply' && !canEmail}
            onClick={() => setMode(id)}
            className={clsx(
              'cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:cursor-default disabled:opacity-50',
              (id === 'note') === internal ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
        {!canEmail && (
          <span className="self-center pl-2 text-xs text-ink-2">
            {!ticket.requesterEmail ? 'No customer email on this ticket.' : 'Email isn’t set up yet (Settings → Email).'}
            {ticket.requesterEmail && (
              <>
                {' '}
                <a
                  href={`mailto:${ticket.requesterEmail}?subject=${encodeURIComponent(`[#${ticket.number}] ${ticket.subject}`)}`}
                  className="text-primary hover:underline"
                >
                  Reply from your email app
                </a>
              </>
            )}
          </span>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        rows={4}
        maxLength={5000}
        aria-label={internal ? 'Internal note' : 'Reply'}
        placeholder={internal ? 'Only your team sees notes.' : `Your reply is emailed to ${ticket.requesterEmail}.`}
        className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-2 focus:border-primary focus:ring-2 focus:ring-primary-subtle"
      />
      {send.isError && (
        <div role="alert" className="text-sm font-medium text-danger">
          Couldn’t send: {send.error instanceof ApiError ? send.error.message : 'please try again'}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          and set status to
          <select
            aria-label="Status after sending"
            value={nextStatus || 'same'}
            onChange={(e) => setStatus(e.target.value as TicketStatus | 'same')}
            className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-[13px] font-medium text-ink outline-none"
          >
            <option value="same">{STATUS[ticket.status].label} (no change)</option>
            {Object.entries(STATUS)
              .filter(([k]) => k !== ticket.status)
              .map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
          </select>
        </label>
        <Button variant="primary" disabled={!draft.trim() || send.isPending} onClick={submit}>
          <Send className="size-4" /> {send.isPending ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
        </Button>
      </div>
    </div>
  );
}
