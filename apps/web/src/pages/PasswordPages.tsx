import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bird, MailCheck } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, type Agent, type PasswordLinkInfo } from '@replyfinch/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const fieldClass =
  'h-10 rounded-lg border border-line px-3 text-sm font-normal text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-subtle';

function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-navy p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-surface p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gold">
            <Bird className="size-6 text-navy" />
          </span>
          <div>
            <div className="text-lg font-bold">Replyfinch</div>
            <div className="text-xs text-ink-2">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

const back = (
  <Link to="/login" className="text-center text-sm font-medium text-primary hover:underline">
    Back to sign in
  </Link>
);

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ emailEnabled: boolean } | null>(null);
  if (sent) {
    return (
      <AuthCard subtitle="Reset your password">
        <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
          <MailCheck className="size-10 text-success" />
          {sent.emailEnabled ? (
            <p className="text-sm text-ink-2">
              If <b className="text-ink">{email}</b> has a Replyfinch account, we’ve sent it a link to choose a new password. It works for 1 hour —
              check your spam folder if you don’t see it.
            </p>
          ) : (
            <p className="text-sm text-ink-2">Email isn’t set up on this Replyfinch yet, so we can’t send a link. Ask an admin on your team to reset your password in Settings → Team.</p>
          )}
        </div>
        {back}
      </AuthCard>
    );
  }
  return (
    <AuthCard subtitle="Reset your password">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setSent(await api<{ emailEnabled: boolean }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }));
          } catch (err) {
            setError(err instanceof ApiError && err.status === 429 ? 'Too many tries. Please wait a few minutes.' : err instanceof ApiError && err.status === 400 ? err.message : 'Could not reach the server.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-ink-2">Enter the email you sign in with, and we’ll send you a link to choose a new password.</p>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          Email
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </label>
        {error && (
          <div role="alert" className="text-sm text-danger">
            {error}
          </div>
        )}
        <button disabled={busy} className="h-10 cursor-pointer rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60">
          {busy ? 'Sending…' : 'Send me a link'}
        </button>
        {back}
      </form>
    </AuthCard>
  );
}

/** From a reset or welcome email: choose a password, then you're signed in. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const { data: info, isError, isLoading } = useQuery({
    queryKey: ['password-link', token],
    queryFn: () => api<PasswordLinkInfo>(`/auth/reset/${encodeURIComponent(token)}`),
    enabled: token.length > 10,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || isError) {
    return (
      <AuthCard subtitle="Choose a password">
        <p className="text-sm text-ink-2" role="alert">
          This link has expired or was already used. Links from “Forgot password” work for 1 hour, and welcome links for 7 days.
        </p>
        <Link to="/forgot-password" className="h-10 rounded-lg bg-primary text-center text-sm leading-10 font-semibold text-white hover:bg-primary/90">
          Send me a new link
        </Link>
        {back}
      </AuthCard>
    );
  }
  if (isLoading || !info) return <AuthCard subtitle="Choose a password">{<div className="text-sm text-ink-2">Checking your link…</div>}</AuthCard>;
  const welcome = info.purpose === 'welcome';

  return (
    <AuthCard subtitle={welcome ? `Welcome to Replyfinch, ${info.name.split(' ')[0]}!` : 'Choose a new password'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
          if (password !== again) return setError('The two passwords don’t match.');
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ token: string; agent: Agent }>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
            login(res.token, res.agent);
            navigate(welcome ? '/settings/widget' : '/', { replace: true });
          } catch (err) {
            setError(err instanceof ApiError && err.status === 400 ? err.message : 'Could not reach the server.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-ink-2">
          {welcome ? (
            <>
              Your account for <b className="text-ink">{info.accountName}</b> is ready. Choose a password for <b className="text-ink">{info.email}</b>.
            </>
          ) : (
            <>
              Choose a new password for <b className="text-ink">{info.email}</b>. You’ll be signed out on your other devices.
            </>
          )}
        </p>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          {welcome ? 'Password' : 'New password'}
          <input type="password" required autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          Type it again
          <input type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={fieldClass} />
        </label>
        <p className="text-xs text-ink-2">At least {MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.</p>
        {error && (
          <div role="alert" className="text-sm text-danger">
            {error}
          </div>
        )}
        <button disabled={busy} className="h-10 cursor-pointer rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60">
          {busy ? 'Saving…' : welcome ? 'Set password and sign in' : 'Save and sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
