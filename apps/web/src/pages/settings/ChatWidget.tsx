import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bird, MessageCircle, Plus, X } from 'lucide-react';
import type { WidgetSettings } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { InstallWidget } from './InstallWidget';

type Settings = WidgetSettings & { accountName: string };

export function useWidgetSettings() {
  return useQuery({ queryKey: ['widget-settings'], queryFn: () => api<Settings>('/settings/widget') });
}

const SWATCHES = ['#2F5BEA', '#0F766E', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#0F172A'];

/** Same rule as the widget: dark text on light colors, white on dark ones. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#121826' : '#FFFFFF';
}

const strip = ({ accountName: _, ...rest }: Settings): WidgetSettings => rest;

export function ChatWidget() {
  const { data } = useWidgetSettings();
  return (
    <div className="flex flex-col gap-8">
      {data ? <WidgetForm initial={data} /> : <div className="text-sm text-ink-2">Loading…</div>}
      <InstallWidget />
    </div>
  );
}

function WidgetForm({ initial }: { initial: Settings }) {
  const isAdmin = useAuth((s) => s.agent?.role === 'admin');
  const [base, setBase] = useState<WidgetSettings>(() => strip(initial));
  const [s, setS] = useState<WidgetSettings>(base);
  const [newDept, setNewDept] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(base);
  const save = useMutation({
    mutationFn: () => api<WidgetSettings>('/settings/widget', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: (r) => {
      setS(r);
      setBase(r);
      setSaved(true);
      setError(null);
      queryClient.setQueryData<Settings>(['widget-settings'], { ...r, accountName: initial.accountName });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save'),
  });
  const set = (patch: Partial<WidgetSettings>) => {
    setS((x) => ({ ...x, ...patch }));
    setSaved(false);
  };

  const addDept = (e?: FormEvent) => {
    e?.preventDefault();
    const d = newDept.trim();
    if (!d) return;
    if (s.departments.some((x) => x.toLowerCase() === d.toLowerCase())) return setError(`“${d}” is already a department`);
    set({ departments: [...s.departments, d] });
    setNewDept('');
    setError(null);
  };

  const custom = s.color && !SWATCHES.includes(s.color);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Chat widget</h2>
        <p className="text-sm text-ink-2">
          How the chat bubble looks on your website and what it asks visitors. Changes show on your site the next time a page loads.
          {!isAdmin && ' Only admins can change these.'}
        </p>
      </div>
      <div className="flex items-start gap-6">
        <fieldset disabled={!isAdmin} className="flex max-w-xl min-w-0 flex-1 flex-col gap-4">
          <Card className="flex flex-col gap-4 p-6">
            <h3 className="text-base font-bold">Appearance</h3>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Theme color</span>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Theme color">
                <button
                  type="button"
                  role="radio"
                  aria-checked={s.color === null}
                  onClick={() => set({ color: null })}
                  className={clsx(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium',
                    s.color === null ? 'border-primary ring-2 ring-primary-subtle' : 'border-line',
                  )}
                >
                  <span className="size-4 rounded-full bg-navy ring-2 ring-gold" /> Replyfinch
                </button>
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={s.color === c}
                    aria-label={c}
                    onClick={() => set({ color: c })}
                    className={clsx('size-9 cursor-pointer rounded-lg', s.color === c && 'ring-2 ring-primary ring-offset-2')}
                    style={{ background: c }}
                  />
                ))}
                <label
                  className={clsx(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium',
                    custom ? 'border-primary ring-2 ring-primary-subtle' : 'border-line',
                  )}
                >
                  <input
                    type="color"
                    aria-label="Custom color"
                    value={s.color ?? '#2F5BEA'}
                    onChange={(e) => set({ color: e.target.value.toUpperCase() })}
                    className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  {custom ? s.color : 'Custom'}
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Bubble position</span>
              <div className="flex gap-2">
                {(['left', 'right'] as const).map((p) => (
                  <label
                    key={p}
                    className={clsx(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium',
                      s.position === p ? 'border-primary bg-primary-subtle text-primary' : 'border-line',
                    )}
                  >
                    <input type="radio" name="position" className="sr-only" checked={s.position === p} onChange={() => set({ position: p })} />
                    Bottom {p}
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h3 className="text-base font-bold">Messages</h3>
            <Field label="Greeting" hint="Shown above the form visitors fill in to start a chat.">
              <textarea className={clsx(inputClass, 'h-auto py-2')} rows={2} maxLength={300} value={s.greeting} onChange={(e) => set({ greeting: e.target.value })} />
            </Field>
            <Field label="When nobody is online" hint="Shown above the leave-a-message form.">
              <textarea
                className={clsx(inputClass, 'h-auto py-2')}
                rows={2}
                maxLength={300}
                value={s.offlineGreeting}
                onChange={(e) => set({ offlineGreeting: e.target.value })}
              />
            </Field>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h3 className="text-base font-bold">Pre-chat form</h3>
            <Field label="Email address" hint="The leave-a-message form always asks for an email, so you can reply.">
              <select className={inputClass} value={s.emailField} onChange={(e) => set({ emailField: e.target.value as WidgetSettings['emailField'] })}>
                <option value="optional">Ask, but optional</option>
                <option value="required">Required</option>
                <option value="hidden">Don’t ask</option>
              </select>
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">Departments</span>
              <span className="text-xs text-ink-2">
                Visitors pick one before chatting, and agents can transfer chats to them. Remove them all to skip the question.
              </span>
              <div className="flex flex-wrap gap-2" data-testid="departments">
                {s.departments.map((d) => (
                  <span key={d} className="flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-3 text-[13px] font-medium">
                    {d}
                    <button
                      type="button"
                      aria-label={`Remove ${d}`}
                      onClick={() => set({ departments: s.departments.filter((x) => x !== d) })}
                      className="cursor-pointer rounded-full p-0.5 text-ink-2 hover:bg-line hover:text-ink"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Add a department, e.g. Returns"
                  aria-label="New department"
                  maxLength={60}
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addDept(e)}
                />
                <Button type="button" onClick={() => addDept()} disabled={!newDept.trim() || s.departments.length >= 20}>
                  <Plus className="size-4" /> Add
                </Button>
              </div>
            </div>
          </Card>

          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" onClick={() => setS(base)} disabled={!dirty}>
                Undo changes
              </Button>
              {saved && <span className="text-sm font-medium text-success">Saved</span>}
              {error && (
                <span role="alert" className="text-sm font-medium text-danger">
                  {error}
                </span>
              )}
            </div>
          )}
        </fieldset>

        <div className="sticky top-4 hidden shrink-0 xl:block">
          <div className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">Preview</div>
          <Preview s={s} accountName={initial.accountName} />
        </div>
      </div>
    </div>
  );
}

/** A static copy of the widget's pre-chat screen. */
function Preview({ s, accountName }: { s: WidgetSettings; accountName: string }) {
  const brand = s.color ?? '#14213D';
  const primary = s.color ?? '#2F5BEA';
  const on = s.color ? textOn(s.color) : '#FFFFFF';
  const input = 'rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-2';
  return (
    <div className={clsx('flex w-[320px] flex-col gap-3', s.position === 'left' ? 'items-start' : 'items-end')} data-testid="widget-preview">
      <div className="w-full overflow-hidden rounded-2xl border border-line bg-canvas shadow-xl">
        <div className="flex items-center gap-3 px-4 py-4" style={{ background: brand, color: on }}>
          <span className="grid size-9 place-items-center rounded-xl bg-gold">
            <Bird className="size-5 text-navy" />
          </span>
          <div>
            <div className="text-sm font-bold">{accountName || 'Your company'}</div>
            <div className="text-[11px] opacity-80">We typically reply in a few minutes</div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 p-4">
          <div className="rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-ink-2">{s.greeting}</div>
          <div className={input}>Your name</div>
          {s.emailField !== 'hidden' && <div className={input}>you@example.com{s.emailField === 'required' && ' *'}</div>}
          {s.departments.length > 0 && <div className={input}>{s.departments[0]} ▾</div>}
          <div className={clsx(input, 'h-14')}>How can we help?</div>
          <div className="rounded-[10px] py-2.5 text-center text-[13px] font-semibold" style={{ background: primary, color: on }}>
            Start chat
          </div>
        </div>
      </div>
      <span className="grid size-12 place-items-center rounded-full shadow-lg" style={{ background: brand }}>
        <MessageCircle className="size-6" style={{ color: s.color ? on : '#FFC93C' }} />
      </span>
    </div>
  );
}
