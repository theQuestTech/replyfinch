import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Globe, Inbox, Mail, MessageCircle, Monitor, Smartphone, Tablet } from 'lucide-react';
import type { Conversation, CustomerProfile as Profile, Message } from '@replyfinch/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { queryClient } from '../lib/query';
import { useDesk } from '../lib/store';
import { dateTime, duration, initials, localTime, shortUrl, timeAgo } from '../lib/format';
import { Avatar, Button, Card, CountryCode, Pill, RatingPill, SectionLabel } from '../components/ui';
import { ProfileField, TagEditor } from '../components/chat/VisitorInfo';
import { Transcript } from '../components/chat/Transcript';
import { customerName } from './Customers';

type Patch = Partial<Pick<Profile['customer'], 'name' | 'email' | 'phone' | 'notes' | 'tags'>>;

export function CustomerProfile() {
  const { id = '' } = useParams();
  const { data, isError } = useQuery({ queryKey: ['customer', id], queryFn: () => api<Profile>(`/customers/${id}`) });
  const online = useDesk((s) => !!s.visitors[id] && !s.visitors[id]!.left);
  const openChat = useDesk((s) => s.openChat);

  const [saveError, setSaveError] = useState<string | null>(null);
  const save = async (p: Patch) => {
    // Show the change right away, then sync with the server.
    queryClient.setQueryData<Profile>(['customer', id], (old) => (old ? { ...old, customer: { ...old.customer, ...p } } : old));
    await api(`/visitors/${id}`, { method: 'PATCH', body: JSON.stringify(p) })
      .then(() => setSaveError(null))
      .catch((e) => setSaveError(e instanceof ApiError && e.status === 400 ? 'That doesn’t look right — please check it.' : 'Couldn’t save. Please try again.'));
    void queryClient.invalidateQueries({ queryKey: ['customer', id] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  if (isError) return <div className="p-10 text-center text-sm text-danger">Couldn’t load this customer.</div>;
  if (!data) return <div className="p-10 text-sm text-ink-2">Loading…</div>;
  const c = data.customer;
  const sat = c.good + c.bad ? Math.round((c.good / (c.good + c.bad)) * 100) : null;
  const DeviceIcon = c.device === 'mobile' ? Smartphone : c.device === 'tablet' ? Tablet : Monitor;
  const local = localTime(c.timezone);

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7" data-testid="customer-profile">
      <Link to="/customers" className="flex w-fit items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Customers
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <Avatar text={initials(c.name ?? c.email)} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[24px] font-bold">{customerName(c)}</h1>
            <CountryCode code={c.country} />
            {online && <Pill tone="success">On your website now</Pill>}
          </div>
          <div className="text-sm text-ink-2">
            Customer since {new Date(c.firstSeenAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })} · last seen{' '}
            {online ? 'now' : timeAgo(c.lastSeenAt)}
          </div>
        </div>
        {c.email && (
          <a
            href={`mailto:${c.email}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold hover:bg-muted"
          >
            <Mail className="size-4" /> Email
          </a>
        )}
        {online && (
          <Button variant="primary" onClick={() => openChat(id, 'side')}>
            <MessageCircle className="size-4" /> Chat now
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Chats" value={String(c.chats)} />
        <Stat label="Satisfaction" value={sat == null ? '—' : `${sat}%`} sub={c.good + c.bad ? `${c.good} 👍 · ${c.bad} 👎` : 'No ratings yet'} />
        <Stat label="Offline messages" value={String(c.offlineMessages)} />
        <Stat label="Website visits" value={String(c.visits)} />
      </div>

      <div className="flex items-start gap-5">
        <Card className="flex w-[300px] shrink-0 flex-col gap-4 p-5">
          <div className="flex flex-col gap-2">
            <SectionLabel>Contact</SectionLabel>
            <ProfileField value={c.name} placeholder="Add name" onSave={(name) => save({ name })} />
            <ProfileField value={c.email} placeholder="Add email" type="email" onSave={(email) => save({ email })} />
            <ProfileField value={c.phone} placeholder="Add phone number" onSave={(phone) => save({ phone })} />
            <ProfileField value={c.notes} placeholder="Add notes" multiline onSave={(notes) => save({ notes })} />
            {saveError && (
              <span role="alert" className="text-xs font-medium text-danger">
                {saveError}
              </span>
            )}
          </div>
          <TagEditor tags={c.tags} onChange={(tags) => save({ tags })} />
          <div className="flex flex-col gap-1.5 text-xs">
            <SectionLabel>Details</SectionLabel>
            {(c.timezone || local) && (
              <div className="flex items-center gap-2">
                <Globe className="size-3.5 text-ink-2" />
                {[c.timezone?.split('/').pop()?.replace(/_/g, ' '), local && `${local} local`].filter(Boolean).join(' · ')}
              </div>
            )}
            {c.browser && (
              <div className="flex items-center gap-2">
                <DeviceIcon className="size-3.5 text-ink-2" /> {c.browser} · {c.os}
              </div>
            )}
          </div>
        </Card>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Card>
            <SectionHeader title="Conversations" count={data.conversations.length} />
            {data.conversations.length === 0 && <Empty>No chats yet.</Empty>}
            {data.conversations.map((conv) => (
              <ConversationRow key={conv.id} conv={conv} />
            ))}
          </Card>

          {data.offlineMessages.length > 0 && (
            <Card>
              <SectionHeader title="Offline messages" count={data.offlineMessages.length} />
              {data.offlineMessages.map((m) => (
                <Link
                  key={m.id}
                  to={`/inbox?f=all&m=${m.id}`}
                  className="flex items-start gap-3 border-t border-line px-5 py-3 text-[13px] hover:bg-muted"
                >
                  <Inbox className="mt-0.5 size-4 shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1 truncate">{m.message}</span>
                  {m.status === 'new' ? <Pill tone="primary">New</Pill> : <Pill tone="success">Handled</Pill>}
                  <span className="shrink-0 text-xs text-ink-2">{dateTime(m.createdAt)}</span>
                </Link>
              ))}
            </Card>
          )}

          <Card>
            <SectionHeader title="Recent pages" />
            {data.pages.length === 0 && <Empty>No pages recorded.</Empty>}
            {data.pages.slice(0, 15).map((p, i) => (
              <a
                key={`${p.at}-${i}`}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 border-t border-line px-5 py-2 text-[13px] hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{p.title || shortUrl(p.url)}</span>
                <span className="hidden max-w-[40%] truncate text-xs text-ink-2 md:block">{shortUrl(p.url)}</span>
                <span className="shrink-0 text-xs text-ink-2">{timeAgo(p.at)}</span>
              </a>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col gap-0.5 px-5 py-4">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <span className="text-[24px] leading-tight font-semibold">{value}</span>
      {sub && <span className="text-xs text-ink-2">{sub}</span>}
    </Card>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-5 py-3.5">
      <h2 className="text-base font-bold">{title}</h2>
      {count !== undefined && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-ink-2">{count}</span>}
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <div className="border-t border-line px-5 py-6 text-center text-sm text-ink-2">{children}</div>;

/** One past chat; click to read the transcript right here. */
function ConversationRow({ conv }: { conv: Profile['conversations'][number] }) {
  const [open, setOpen] = useState(false);
  const me = useAuth((s) => s.agent?.id);
  const { data } = useQuery({
    queryKey: ['conversation', conv.id],
    queryFn: () => api<{ conversation: Conversation; messages: Message[] }>(`/conversations/${conv.id}`),
    enabled: open,
  });
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx('flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left text-[13px] hover:bg-muted', open && 'bg-muted')}
      >
        <Chevron className="size-4 shrink-0 text-ink-2" />
        <span className="w-36 shrink-0 text-ink-2">{dateTime(conv.startedAt)}</span>
        <span className="min-w-0 flex-1 truncate">{conv.preview ?? <em className="text-ink-2">Started by an agent</em>}</span>
        <RatingPill rating={conv.rating} />
        <span className="w-28 shrink-0 truncate text-right text-ink-2">{conv.assigneeName ?? 'Missed'}</span>
        <span className="w-14 shrink-0 text-right text-xs text-ink-2">
          {conv.status === 'ended' ? duration((conv.endedAt ?? conv.startedAt) - conv.startedAt) : <Pill tone="success">Open</Pill>}
        </span>
      </button>
      {open && (
        <div className="flex h-[360px] flex-col border-t border-line">
          {conv.ratingComment && (
            <div className="border-b border-line bg-surface px-5 py-2 text-xs">
              Rating comment: <span className="font-medium">“{conv.ratingComment}”</span>
            </div>
          )}
          <Transcript messages={data?.messages ?? []} meId={me} empty={<div className="m-auto text-sm text-ink-2">Loading…</div>} />
        </div>
      )}
    </div>
  );
}
