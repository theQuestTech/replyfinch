import { useState } from 'react';
import { CircleCheck } from 'lucide-react';
import type { Ticket, TicketPriority } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { goTo } from '../../lib/realtime';
import { useDesk } from '../../lib/store';
import { PRIORITY } from '../../lib/tickets';
import { Button, Field, Modal, inputClass } from '../ui';

/**
 * Create a ticket: by hand, for a known customer, or from a chat / offline message
 * (the customer and their words come from there).
 */
export function NewTicketModal({
  from,
  visitorId,
  defaults = {},
  onClose,
}: {
  from?: { type: 'chat' | 'offline'; id: string };
  visitorId?: string;
  defaults?: { subject?: string; name?: string | null; email?: string | null; description?: string };
  onClose: () => void;
}) {
  const me = useAuth((s) => s.agent);
  const team = useDesk((s) => s.team);
  const [subject, setSubject] = useState(defaults.subject ?? '');
  const [name, setName] = useState(defaults.name ?? '');
  const [email, setEmail] = useState(defaults.email ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [assigneeId, setAssigneeId] = useState(me?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Ticket | null>(null);
  // From an offline message we already have their name and email; elsewhere let the agent fill gaps.
  const askName = !from && !visitorId;
  const askEmail = from?.type !== 'offline' && !defaults.email;

  const submit = async () => {
    if (!subject.trim()) return setError('Add a subject');
    setBusy(true);
    setError(null);
    try {
      const t = await api<Ticket>('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          description: description.trim(),
          priority,
          assigneeId: assigneeId || null,
          ...(from ? { from } : visitorId ? { visitorId } : {}),
          ...(askName && name.trim() ? { name: name.trim() } : {}),
          ...(askEmail && email.trim() ? { email: email.trim() } : {}),
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setCreated(t);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 && e.message !== 'invalid_input' ? e.message : 'Couldn’t create the ticket. Please check the fields and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal title="Ticket created" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-2 text-center" data-testid="ticket-created">
          <CircleCheck className="size-10 text-success" />
          <div>
            <div className="text-base font-bold">Ticket #{created.number} created</div>
            <div className="text-sm text-ink-2">{created.subject}</div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={onClose}>Done</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                goTo(`/tickets/${created.id}`);
              }}
            >
              Open ticket
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={from?.type === 'chat' ? 'Create a ticket from this chat' : from?.type === 'offline' ? 'Turn this message into a ticket' : 'New ticket'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Subject">
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Refund for order 1182" />
        </Field>
        {(askName || askEmail) && (
          <div className="grid grid-cols-2 gap-3">
            {askName && (
              <Field label="Customer name">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Optional" />
              </Field>
            )}
            {askEmail && (
              <Field label="Customer email" hint={askName ? undefined : 'So you can reply by email'}>
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
              </Field>
            )}
          </div>
        )}
        <Field label="Description" hint="Only your team sees this.">
          <textarea
            className={`${inputClass} h-auto py-2`}
            rows={4}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What’s needed, and anything you already know"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assign to">
            <select className={inputClass} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {me && <option value={me.id}>Me ({me.name})</option>}
              {team
                .filter((t) => t.id !== me?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
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
            {busy ? 'Creating…' : 'Create ticket'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
