import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, type Agent } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card, Field, inputClass } from '../../components/ui';

export function Profile() {
  const agent = useAuth((s) => s.agent)!;
  const setAgent = useAuth((s) => s.setAgent);
  const [name, setName] = useState(agent.name);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setAgent(await api<Agent>('/me', { method: 'PATCH', body: JSON.stringify({ name }) }));
      setNameMsg('Saved');
    } catch (err) {
      setNameMsg(err instanceof ApiError ? err.message : 'Could not save');
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);
    if (next.length < MIN_PASSWORD_LENGTH) return setPwError(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
    if (next !== confirm) return setPwError('The new passwords don’t match');
    setBusy(true);
    try {
      await api('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setPwDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not change your password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-bold">Your details</h2>
        <form onSubmit={saveName} className="flex flex-col gap-4">
          <Field label="Name" hint="Customers see this name in the chat.">
            <input className={inputClass} value={name} onChange={(e) => (setName(e.target.value), setNameMsg(null))} required />
          </Field>
          <Field label="Email">
            <input className={inputClass} value={agent.email} disabled />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={!name.trim() || name.trim() === agent.name}>
              Save
            </Button>
            {nameMsg && <span className="text-sm text-ink-2">{nameMsg}</span>}
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-bold">Change password</h2>
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <Field label="Current password">
            <input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            <input className={inputClass} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Confirm new password" error={pwError}>
            <input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
            {pwDone && <span className="text-sm font-medium text-success">Password changed</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
