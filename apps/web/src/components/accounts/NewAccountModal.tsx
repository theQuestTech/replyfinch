import { useState } from 'react';
import { Check, CircleCheck, Copy } from 'lucide-react';
import type { PlatformAccountCreated } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { Button, Field, Modal, inputClass } from '../ui';

export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted p-2.5">
      <code className="min-w-0 flex-1 truncate text-xs" data-testid="set-password-url">
        {url}
      </code>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(url).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
        className="flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink"
      >
        {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Create a customer workspace and its first admin, who gets a "set your password" email. */
export function NewAccountModal({
  defaults = {},
  ticketId,
  onClose,
}: {
  defaults?: { company?: string; name?: string | null; email?: string | null };
  ticketId?: string;
  onClose: () => void;
}) {
  const [company, setCompany] = useState(defaults.company ?? '');
  const [name, setName] = useState(defaults.name ?? '');
  const [email, setEmail] = useState(defaults.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PlatformAccountCreated | null>(null);

  if (created) {
    return (
      <Modal title="Account created" onClose={onClose}>
        <div className="flex flex-col gap-3" data-testid="account-created">
          <div className="flex items-center gap-2 font-semibold text-success">
            <CircleCheck className="size-5" /> {created.account.name} is ready
          </div>
          <p className="text-sm text-ink-2">
            {created.emailed ? (
              <>
                We emailed <b className="text-ink">{created.admin.email}</b> a link to set their password (it works for 7 days). You can also send them
                this link yourself:
              </>
            ) : (
              <>
                Email isn’t set up yet, so <b className="text-ink">send {created.admin.name.split(' ')[0]} this link yourself</b> — it lets them set a
                password and sign in, and works for 7 days:
              </>
            )}
          </p>
          <CopyLink url={created.setPasswordUrl} />
          <p className="text-xs text-ink-2">
            Their chat widget account id is <code>{created.account.id}</code>.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New customer account" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api<PlatformAccountCreated>('/platform/accounts', {
              method: 'POST',
              body: JSON.stringify({ company: company.trim(), name: name.trim(), email: email.trim(), ...(ticketId ? { ticketId } : {}) }),
            });
            void queryClient.invalidateQueries({ queryKey: ['platform'] });
            if (ticketId) void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
            setCreated(res);
          } catch (err) {
            setError(err instanceof ApiError && err.status === 400 && err.message !== 'invalid_input' ? err.message : 'Couldn’t create the account. Please try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Company">
          <input className={inputClass} required maxLength={120} value={company} onChange={(e) => setCompany(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Their name">
            <input className={inputClass} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Their email">
            <input className={inputClass} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-ink-2">They become the account’s admin, and get an email with a link to set their password.</p>
        {error && (
          <div role="alert" className="text-sm font-medium text-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
