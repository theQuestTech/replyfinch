import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Bird } from 'lucide-react';
import type { Agent } from '@replyfinch/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Login() {
  const token = useAuth((s) => s.token);
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (token) return <Navigate to="/" replace />;

  return (
    <div className="grid h-full place-items-center bg-navy p-4">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-surface p-8 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ token: string; agent: Agent }>('/auth/login', {
              method: 'POST',
              body: JSON.stringify({ email, password }),
            });
            login(res.token, res.agent);
          } catch (err) {
            setError(err instanceof ApiError && err.status === 401 ? 'Wrong email or password.' : 'Could not reach the server.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gold">
            <Bird className="size-6 text-navy" />
          </span>
          <div>
            <div className="text-lg font-bold">Replyfinch</div>
            <div className="text-xs text-ink-2">Sign in to your agent workspace</div>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          Email
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-lg border border-line px-3 text-sm font-normal text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-lg border border-line px-3 text-sm font-normal text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-subtle"
          />
        </label>
        {error && <div className="text-sm text-danger">{error}</div>}
        <button disabled={busy} className="h-10 cursor-pointer rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
