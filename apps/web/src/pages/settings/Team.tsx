import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, type TeamMember } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { initials } from '../../lib/format';
import { useDesk } from '../../lib/store';
import { Avatar, Button, Card, Field, IconButton, inputClass, Modal, Pill, StatusDot } from '../../components/ui';

type Dialog = { kind: 'add' } | { kind: 'edit'; member: TeamMember } | { kind: 'password'; member: TeamMember } | { kind: 'remove'; member: TeamMember };

/** A readable temporary password, e.g. "finch-7391-cove". */
function tempPassword() {
  const words = ['finch', 'cove', 'maple', 'river', 'cedar', 'lark', 'spruce', 'harbor', 'ember', 'pebble'];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${Math.floor(1000 + Math.random() * 9000)}-${pick()}`;
}

export function Team() {
  const me = useAuth((s) => s.agent)!;
  const team = useDesk((s) => s.team);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (me.role !== 'admin') return <Navigate to="/settings/profile" replace />;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center">
        <div className="flex-1">
          <h2 className="text-lg font-bold">Team</h2>
          <p className="text-sm text-ink-2">Add the people who answer chats, and set how many chats each can handle at once.</p>
        </div>
        <Button variant="primary" onClick={() => setDialog({ kind: 'add' })}>
          <Plus className="size-4" /> Add agent
        </Button>
      </div>

      <Card>
        <div className="flex items-center gap-3 bg-muted px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <span className="flex-1">Agent</span>
          <span className="w-24">Role</span>
          <span className="w-28">Chat limit</span>
          <span className="w-24">Status</span>
          <span className="w-[108px]" />
        </div>
        {team.map((m) => (
          <div key={m.id} data-testid="team-row" className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar text={initials(m.name)} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {m.name}
                  {m.id === me.id && <span className="font-normal text-ink-2"> (you)</span>}
                </div>
                <div className="truncate text-xs text-ink-2">{m.email}</div>
              </div>
            </div>
            <span className="w-24">
              <Pill tone={m.role === 'admin' ? 'primary' : 'muted'}>{m.role === 'admin' ? 'Admin' : 'Agent'}</Pill>
            </span>
            <span className="w-28 text-sm">{m.maxChats} chats</span>
            <span className="flex w-24 items-center gap-1.5 text-sm capitalize">
              <StatusDot status={m.status} /> {m.status}
            </span>
            <span className="flex w-[108px] justify-end gap-1.5">
              <IconButton label={`Edit ${m.name}`} onClick={() => setDialog({ kind: 'edit', member: m })}>
                <Pencil className="size-3.5" />
              </IconButton>
              {m.id !== me.id && (
                <>
                  <IconButton label={`Reset password for ${m.name}`} onClick={() => setDialog({ kind: 'password', member: m })}>
                    <KeyRound className="size-3.5" />
                  </IconButton>
                  <IconButton label={`Remove ${m.name}`} onClick={() => setDialog({ kind: 'remove', member: m })} className="hover:text-danger">
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </>
              )}
            </span>
          </div>
        ))}
      </Card>
      <p className="text-xs text-ink-2">
        Replyfinch doesn’t send emails yet — share the temporary password with your new agent yourself. They can change it under Settings → My profile.
      </p>

      {dialog?.kind === 'add' && <AddAgent onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <EditAgent member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'password' && <ResetPassword member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'remove' && <RemoveAgent member={dialog.member} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useSubmit(fn: () => Promise<void>, onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { submit, error, busy };
}

function AddAgent({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  const [maxChats, setMaxChats] = useState(4);
  const [password, setPassword] = useState(tempPassword);
  const [done, setDone] = useState(false);
  const { submit, error, busy } = useSubmit(
    async () => {
      await api('/team', { method: 'POST', body: JSON.stringify({ name, email, role, maxChats, password }) });
    },
    () => setDone(true),
  );

  if (done)
    return (
      <Modal title="Agent added" onClose={onClose}>
        <p className="text-sm">Send {name.split(' ')[0]} these sign-in details:</p>
        <div className="my-4 rounded-lg bg-muted p-4 font-mono text-sm" data-testid="new-agent-credentials">
          <div>Email: {email.toLowerCase()}</div>
          <div>Password: {password}</div>
        </div>
        <p className="text-xs text-ink-2">They can change their password after signing in (Settings → My profile).</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => navigator.clipboard?.writeText(`Email: ${email.toLowerCase()}\nPassword: ${password}`)}>Copy</Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );

  return (
    <Modal title="Add agent" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Full name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role" hint={role === 'admin' ? 'Can manage the team and settings' : 'Answers chats'}>
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as 'agent' | 'admin')}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Chat limit" hint="Chats at the same time">
            <input className={inputClass} type="number" min={1} max={20} value={maxChats} onChange={(e) => setMaxChats(Number(e.target.value))} required />
          </Field>
        </div>
        <Field label="Temporary password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. We made one up for you.`} error={error}>
          <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD_LENGTH} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add agent'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditAgent({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [maxChats, setMaxChats] = useState(member.maxChats);
  const { submit, error, busy } = useSubmit(async () => {
    await api(`/team/${member.id}`, { method: 'PATCH', body: JSON.stringify({ name, role, maxChats }) });
  }, onClose);
  return (
    <Modal title={`Edit ${member.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Full name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as 'agent' | 'admin')}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Chat limit">
            <input className={inputClass} type="number" min={1} max={20} value={maxChats} onChange={(e) => setMaxChats(Number(e.target.value))} required />
          </Field>
        </div>
        {error && <div className="text-sm font-medium text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [password, setPassword] = useState(tempPassword);
  const [done, setDone] = useState(false);
  const { submit, error, busy } = useSubmit(
    async () => {
      await api(`/team/${member.id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
    },
    () => setDone(true),
  );
  return (
    <Modal title={`Reset password for ${member.name}`} onClose={onClose}>
      {done ? (
        <>
          <p className="text-sm">
            Done. {member.name.split(' ')[0]}’s new password is <span className="font-mono font-semibold">{password}</span>
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="New temporary password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={error}>
            <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD_LENGTH} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              Reset password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RemoveAgent({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { submit, error, busy } = useSubmit(async () => {
    await api(`/team/${member.id}`, { method: 'DELETE' });
  }, onClose);
  return (
    <Modal title={`Remove ${member.name}?`} onClose={onClose}>
      <p className="text-sm">
        {member.name} will be signed out right away and won’t be able to sign in again. Their past chats stay in your history.
      </p>
      {error && <div className="mt-3 text-sm font-medium text-danger">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => submit()} disabled={busy}>
          Remove agent
        </Button>
      </div>
    </Modal>
  );
}
