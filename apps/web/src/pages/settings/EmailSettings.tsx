import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Send } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useEmailStatus } from '../../lib/email';
import { Button, Card } from '../../components/ui';

export function EmailSettings() {
  const { data } = useEmailStatus();
  const test = useMutation({ mutationFn: () => api<{ to: string }>('/settings/email/test', { method: 'POST' }) });
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Email</h2>
        <p className="text-sm text-ink-2">Reply to offline messages from the Inbox, and send chat transcripts to customers.</p>
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
            <li>Create an API key (API Keys → Create, “Sending access”).</li>
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
