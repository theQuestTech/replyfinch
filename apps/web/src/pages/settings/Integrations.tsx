import clsx from 'clsx';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, KeyRound, Plus, RotateCw, Send, Trash2, Webhook as WebhookIcon, Zap } from 'lucide-react';
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type ApiKey, type Webhook, type WebhookDelivery, type WebhookEventType } from '@replyfinch/shared';
import { API_URL, api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { dateTime, timeAgo } from '../../lib/format';
import { Button, Card, Field, Modal, Pill, SectionLabel, inputClass } from '../../components/ui';

const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations'] });
const errorText = (e: unknown) => (e instanceof ApiError && e.status === 400 && e.message !== 'invalid_input' ? e.message : 'Something went wrong. Please try again.');

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {done ? 'Copied' : label}
    </button>
  );
}

export function Integrations() {
  const isAdmin = useAuth((s) => s.agent?.role === 'admin');
  if (!isAdmin) return <div className="text-sm text-ink-2">Only admins can manage integrations.</div>;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h2 className="text-lg font-bold">Integrations</h2>
        <p className="text-sm text-ink-2">Send what happens in Replyfinch to other apps — Google Sheets, Slack, your CRM, or your own code.</p>
      </div>
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="size-5 text-warning" /> Zapier and Make
        </div>
        <p className="text-sm text-ink-2">
          The Replyfinch app for Zapier is on its way. Until it’s listed, you can already connect thousands of apps: add a webhook below with the
          address from <b className="text-ink">Make</b> (“Custom webhook”, free) or <b className="text-ink">Zapier</b> (“Webhooks by Zapier → Catch Hook”,
          on paid Zapier plans).
        </p>
      </Card>
      <Webhooks />
      <ApiKeys />
      <Docs />
    </div>
  );
}

// ---------------------------------------------------------------- webhooks
function Webhooks() {
  const { data: hooks, isLoading } = useQuery({ queryKey: ['integrations', 'webhooks'], queryFn: () => api<Webhook[]>('/integrations/webhooks') });
  const [adding, setAdding] = useState(false);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="webhooks-title">
      <div className="flex items-center gap-2">
        <WebhookIcon className="size-5 text-primary" />
        <h3 id="webhooks-title" className="flex-1 text-base font-bold">
          Webhooks
        </h3>
        {!adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add webhook
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-2">Replyfinch sends a message (an HTTPS POST with JSON) to your address whenever one of the chosen events happens.</p>
      {adding && <AddWebhook onDone={() => setAdding(false)} />}
      {isLoading && <div className="text-sm text-ink-2">Loading…</div>}
      {hooks?.length === 0 && !adding && (
        <Card className="p-6 text-center text-sm text-ink-2">No webhooks yet. Add one to send chats, tickets and messages to another app.</Card>
      )}
      {hooks?.map((h) => <WebhookCard key={h.id} hook={h} />)}
    </section>
  );
}

function EventPicker({ value, onChange }: { value: WebhookEventType[]; onChange: (v: WebhookEventType[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-semibold">Send these events</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((ev) => (
          <label key={ev} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={value.includes(ev)}
              onChange={(e) => onChange(e.target.checked ? [...value, ev] : value.filter((x) => x !== ev))}
            />
            <span>
              <span className="block font-medium">{WEBHOOK_EVENT_LABELS[ev]}</span>
              <code className="text-[11px] text-ink-2">{ev}</code>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddWebhook({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>(['chat.ended', 'ticket.created']);
  const add = useMutation({
    mutationFn: () => api<Webhook>('/integrations/webhooks', { method: 'POST', body: JSON.stringify({ url: url.trim(), description, events }) }),
    onSuccess: () => {
      void refresh();
      onDone();
    },
  });
  return (
    <Card className="flex flex-col gap-4 p-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Address (URL)" hint="Where to send events, e.g. the address Make or Zapier gives you.">
          <input className={inputClass} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hook.eu1.make.com/…" autoFocus />
        </Field>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Ended chats → Google Sheets" />
        </Field>
        <EventPicker value={events} onChange={setEvents} />
        {add.isError && (
          <div role="alert" className="text-sm font-medium text-danger">
            {errorText(add.error)}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!url.trim() || !events.length || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add webhook'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function hookState(h: Webhook): { tone: 'success' | 'danger' | 'muted' | 'warning'; label: string } {
  if (!h.enabled) return { tone: 'muted', label: 'Off' };
  if (h.failingSince) return { tone: 'danger', label: `Failing since ${timeAgo(h.failingSince)}` };
  if (h.lastError) return { tone: 'warning', label: 'Retrying' };
  if (h.lastDeliveryAt) return { tone: 'success', label: 'Working' };
  return { tone: 'muted', label: 'Nothing sent yet' };
}

function WebhookCard({ hook: h }: { hook: Webhook }) {
  const [showSecret, setShowSecret] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState(h.events);
  const update = useMutation({
    mutationFn: (p: Partial<Pick<Webhook, 'enabled' | 'events'>>) => api(`/integrations/webhooks/${h.id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    onSuccess: () => (setEditing(false), refresh()),
  });
  const remove = useMutation({ mutationFn: () => api(`/integrations/webhooks/${h.id}`, { method: 'DELETE' }), onSuccess: refresh });
  const test = useMutation({
    mutationFn: () => api<WebhookDelivery>(`/integrations/webhooks/${h.id}/test`, { method: 'POST' }),
    onSettled: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['integrations', 'deliveries', h.id] });
    },
  });
  const state = hookState(h);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Card className="flex flex-col" data-testid="webhook">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <code className="truncate text-[13px] font-semibold">{h.url}</code>
              <Pill tone={state.tone}>{state.label}</Pill>
              {h.source === 'api' && <Pill tone="primary">Added by an app</Pill>}
            </div>
            {h.description && <div className="mt-0.5 text-sm text-ink-2">{h.description}</div>}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
            <input type="checkbox" className="size-4 accent-primary" checked={h.enabled} onChange={(e) => update.mutate({ enabled: e.target.checked })} aria-label="Webhook on" />
            On
          </label>
        </div>
        {editing ? (
          <div className="flex flex-col gap-3">
            <EventPicker value={events} onChange={setEvents} />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!events.length || update.isPending} onClick={() => update.mutate({ events })}>
                Save events
              </Button>
              <Button onClick={() => (setEditing(false), setEvents(h.events))}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {h.events.map((ev) => (
              <span key={ev} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-2" title={WEBHOOK_EVENT_LABELS[ev]}>
                {ev}
              </span>
            ))}
          </div>
        )}
        {h.lastError && <div className="text-xs text-danger">Last try: {h.lastError}</div>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
            Signing secret
            <code className="max-w-[240px] truncate rounded bg-muted px-1.5 py-0.5">{showSecret ? h.secret : '••••••••••••••••'}</code>
            <button onClick={() => setShowSecret((s) => !s)} aria-label={showSecret ? 'Hide secret' : 'Show secret'} className="cursor-pointer hover:text-ink">
              {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
            <CopyButton text={h.secret} />
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending || !h.enabled}>
              <Send className="size-3.5" /> {test.isPending ? 'Sending…' : 'Send test'}
            </Button>
            {!editing && (
              <Button variant="ghost" onClick={() => setEditing(true)}>
                Edit events
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => window.confirm('Delete this webhook? Replyfinch will stop sending events to it.') && remove.mutate()}
              aria-label="Delete webhook"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        {test.data && (
          <div role="status" className={clsx('text-xs font-medium', test.data.status === 'succeeded' ? 'text-success' : 'text-danger')}>
            {test.data.status === 'succeeded' ? `Test sent — your address answered ${test.data.responseStatus}.` : `Test failed: ${test.data.error ?? 'no answer'}`}
          </div>
        )}
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 border-t border-line px-5 py-2.5 text-left text-xs font-semibold text-ink-2 hover:bg-muted"
      >
        <Chevron className="size-3.5" /> Recent deliveries
        {h.lastDeliveryAt && <span className="font-normal">· last {timeAgo(h.lastDeliveryAt)}</span>}
      </button>
      {open && <Deliveries hookId={h.id} />}
    </Card>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const { data } = useQuery({
    queryKey: ['integrations', 'deliveries', hookId],
    queryFn: () => api<WebhookDelivery[]>(`/integrations/webhooks/${hookId}/deliveries`),
    refetchInterval: 5000,
  });
  const [shown, setShown] = useState<string | null>(null);
  const retry = useMutation({
    mutationFn: (id: string) => api(`/integrations/deliveries/${id}/retry`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });
  if (!data) return <div className="border-t border-line px-5 py-3 text-xs text-ink-2">Loading…</div>;
  if (!data.length) return <div className="border-t border-line px-5 py-3 text-xs text-ink-2">Nothing sent yet. Try “Send test”.</div>;
  return (
    <div className="border-t border-line" data-testid="deliveries">
      {data.map((d) => (
        <div key={d.id} className="border-b border-line text-xs last:border-b-0">
          <div className="flex items-center gap-3 px-5 py-2">
            <button onClick={() => setShown(shown === d.id ? null : d.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
              <code className="w-40 shrink-0 truncate font-semibold">{d.type}</code>
              <Pill tone={d.status === 'succeeded' ? 'success' : d.status === 'failed' ? 'danger' : 'warning'}>
                {d.status === 'succeeded' ? `Sent · ${d.responseStatus}` : d.status === 'failed' ? `Failed${d.responseStatus ? ` · ${d.responseStatus}` : ''}` : d.status === 'pending' && d.attempts ? `Retrying` : 'Sending'}
              </Pill>
              <span className="text-ink-2">{d.attempts > 1 ? `${d.attempts} tries` : ''}</span>
              <span className="ml-auto text-ink-2">{dateTime(d.createdAt)}</span>
            </button>
            {(d.status === 'failed' || (d.status === 'pending' && d.attempts > 0)) && (
              <Button variant="ghost" onClick={() => retry.mutate(d.id)} disabled={retry.isPending}>
                <RotateCw className="size-3.5" /> Retry now
              </Button>
            )}
          </div>
          {shown === d.id && (
            <div className="flex flex-col gap-2 bg-canvas px-5 py-3">
              {d.error && <div className="text-danger">{d.error}</div>}
              {d.nextAttemptAt && d.attempts > 0 && <div className="text-ink-2">Next try {dateTime(d.nextAttemptAt)}</div>}
              <pre className="max-h-64 overflow-auto rounded-lg bg-navy p-3 text-[11px] leading-relaxed text-white">{JSON.stringify(d.payload, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- API keys
function ApiKeys() {
  const { data: keys } = useQuery({ queryKey: ['integrations', 'keys'], queryFn: () => api<ApiKey[]>('/integrations/api-keys') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ name: string; key: string }>('/integrations/api-keys', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: (k) => {
      setCreated(k);
      setName('');
      void refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/integrations/api-keys/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  return (
    <section className="flex flex-col gap-3" aria-labelledby="keys-title">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" />
        <h3 id="keys-title" className="text-base font-bold">
          API keys
        </h3>
      </div>
      <p className="text-sm text-ink-2">For apps that connect to Replyfinch, like the Zapier app or your own code. Treat a key like a password.</p>
      {created && (
        <Modal title="Your new API key" onClose={() => setCreated(null)}>
          <div className="flex flex-col gap-3" data-testid="new-api-key">
            <p className="text-sm text-ink-2">
              Copy it now — for your security, <b className="text-ink">you won’t see it again</b>. If you lose it, create a new one.
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
              <code className="min-w-0 flex-1 text-[13px] break-all">{created.key}</code>
              <CopyButton text={created.key} />
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}
      <Card>
        {keys?.map((k) => (
          <div key={k.id} className="flex items-center gap-3 border-b border-line px-5 py-3 text-sm last:border-b-0" data-testid="api-key">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{k.name}</div>
              <div className="text-xs text-ink-2">
                <code>{k.prefix}…</code> · created {timeAgo(k.createdAt)}
                {k.createdByName ? ` by ${k.createdByName}` : ''} · {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used'}
              </div>
            </div>
            <Button
              variant="danger"
              onClick={() => window.confirm(`Revoke “${k.name}”? Apps using it will stop working straight away.`) && revoke.mutate(k.id)}
            >
              Revoke
            </Button>
          </div>
        ))}
        <form
          className="flex items-center gap-2 border-t border-line bg-canvas px-5 py-3 first:border-t-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input className={clsx(inputClass, 'h-9 flex-1')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Zapier" aria-label="New key name" />
          <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
            <Plus className="size-4" /> Create key
          </Button>
        </form>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------- docs
function Docs() {
  const verify = `// Node.js: check a webhook really came from Replyfinch
const crypto = require('crypto');
function isFromReplyfinch(rawBody, header, secret) {
  const [, t, sig] = /t=(\\d+),v1=([0-9a-f]+)/.exec(header) || [];
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false; // older than 5 minutes
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}`;
  return (
    <Card className="flex flex-col gap-3 p-6 text-sm">
      <SectionLabel>For developers</SectionLabel>
      <ul className="ml-5 list-disc space-y-1.5 text-ink-2">
        <li>
          Each webhook is a <b className="text-ink">POST</b> with a JSON body: <code>{'{ id, type, createdAt, accountId, data }'}</code>. Answer with any 2xx
          within 10 seconds.
        </li>
        <li>
          Headers: <code>Replyfinch-Event</code>, <code>Replyfinch-Delivery</code> and <code>Replyfinch-Signature</code> (<code>t=…,v1=…</code>, an
          HMAC-SHA256 of <code>t.body</code> with the webhook’s signing secret).
        </li>
        <li>Failed deliveries are retried after 1 minute, 10 minutes, 1 hour and 6 hours.</li>
        <li>
          API: <code>{API_URL}/v1/…</code> with <code>Authorization: Bearer &lt;API key&gt;</code> — <code>GET /v1/me</code>,{' '}
          <code>POST /v1/tickets</code>, <code>POST /v1/hooks</code>, <code>DELETE /v1/hooks/:id</code>, <code>GET /v1/samples/:event</code>.
        </li>
      </ul>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-navy p-4 text-[12px] leading-relaxed text-white">{verify}</pre>
        <div className="absolute top-2 right-2 rounded bg-white/90 px-1.5 py-0.5">
          <CopyButton text={verify} />
        </div>
      </div>
    </Card>
  );
}
