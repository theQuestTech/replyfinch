import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, CheckCircle2, CircleAlert, Copy, Inbox, Send } from 'lucide-react';
import type { EmailStatus } from '@replyfinch/shared';
import { API_URL, api, ApiError } from '../../lib/api';
import { useEmailStatus } from '../../lib/email';
import { Button, Card } from '../../components/ui';

export function EmailSettings() {
  const { data } = useEmailStatus();
  const test = useMutation({ mutationFn: () => api<{ to: string }>('/settings/email/test', { method: 'POST' }) });
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Email</h2>
        <p className="text-sm text-ink-2">Reply to offline messages and tickets by email, send chat transcripts, and get customers’ replies back in tickets.</p>
      </div>
      {!data && <div className="text-sm text-ink-2">Loading…</div>}
      {data?.enabled && (
        <Card className="flex flex-col gap-4 p-6" data-testid="email-status">
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <CheckCircle2 className="size-5" /> Email is set up
          </div>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-ink-2">Sent from</dt>
            <dd className="font-medium">{data.from}</dd>
            <dt className="text-ink-2">Replies go to</dt>
            <dd className="font-medium">{data.replyTo ?? data.from}</dd>
          </dl>
          <div className="flex items-center gap-3">
            <Button onClick={() => test.mutate()} disabled={test.isPending}>
              <Send className="size-4" /> {test.isPending ? 'Sending…' : 'Send me a test email'}
            </Button>
            {test.isSuccess && <span className="text-sm font-medium text-success">Sent to {test.data.to} — check your inbox.</span>}
            {test.isError && (
              <span role="alert" className="text-sm font-medium text-danger">
                {test.error instanceof ApiError ? test.error.message : 'Could not send'}
              </span>
            )}
          </div>
        </Card>
      )}
      {data?.enabled && <Receiving status={data} />}
      {data && !data.enabled && (
        <Card className="flex flex-col gap-3 p-6" data-testid="email-status">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <CircleAlert className="size-5" /> Email isn’t set up yet
          </div>
          <p className="text-sm text-ink-2">Until it is, “Reply by email” opens your own email app, and visitors can’t ask for a copy of their chat.</p>
          <ol className="ml-5 list-decimal text-sm leading-relaxed">
            <li>
              Create a free account at <b>resend.com</b> and add your domain (Domains → Add domain). Add the DNS records it shows at your domain
              provider, then click Verify.
            </li>
            <li>Create an API key (API Keys → Create, “Full access” — it’s needed to read customers’ replies too).</li>
            <li>
              In Railway → your API service → Variables, add <code className="rounded bg-muted px-1">RESEND_API_KEY</code> and{' '}
              <code className="rounded bg-muted px-1">EMAIL_FROM</code> (for example <i>Your Company &lt;support@yourdomain.com&gt;</i>). Optionally{' '}
              <code className="rounded bg-muted px-1">EMAIL_REPLY_TO</code> for where customers’ replies should go.
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 truncate rounded bg-muted px-2 py-1 text-xs" data-testid="support-address">
        {text}
      </code>
      <button
        onClick={() => navigator.clipboard?.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/** Customers' replies back into tickets (Resend → Receiving). */
function Receiving({ status }: { status: EmailStatus }) {
  const inbound = status.inbound;
  if (inbound?.enabled && inbound.supportAddress) {
    return (
      <Card className="flex flex-col gap-3 p-6" data-testid="receiving-status">
        <div className="flex items-center gap-2 text-sm font-semibold text-success">
          <Inbox className="size-5" /> Customers’ replies come back into tickets
        </div>
        <p className="text-sm text-ink-2">
          When a customer answers an email you sent from a ticket or the Inbox, their reply appears in the ticket and it reopens. The person
          handling the ticket gets an alert.
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Your support address</span>
          <CopyText text={inbound.supportAddress} />
          <span className="text-xs text-ink-2">
            Emails sent here become new tickets. Tip: in your normal email account, forward your support mailbox (for example support@yourdomain.com)
            to this address, and every customer email lands in Tickets.
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3 p-6" data-testid="receiving-status">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Inbox className="size-5 text-ink-2" /> Get customers’ replies in tickets (optional)
      </div>
      <p className="text-sm text-ink-2">Right now customers’ replies go to {status.replyTo ?? status.from}. To have them come back into the ticket instead:</p>
      <ol className="ml-5 list-decimal text-sm leading-relaxed">
        <li>
          In Resend, open <b>Receiving</b> and copy your receiving domain (it looks like <i>something.resend.app</i>). No DNS changes needed.
        </li>
        <li>
          In Resend → <b>Webhooks</b> → Add webhook: endpoint <code className="rounded bg-muted px-1 break-all">{API_URL}/webhooks/resend</code>, event{' '}
          <b>email.received</b>. Then copy its signing secret (starts with <i>whsec_</i>).
        </li>
        <li>
          In Railway → your API service → Variables, add <code className="rounded bg-muted px-1">INBOUND_DOMAIN</code> (the receiving domain) and{' '}
          <code className="rounded bg-muted px-1">RESEND_WEBHOOK_SECRET</code> (the signing secret).
        </li>
        <li>Make sure your Resend API key has “Full access” (a “Sending access” key can’t read replies).</li>
      </ol>
    </Card>
  );
}
