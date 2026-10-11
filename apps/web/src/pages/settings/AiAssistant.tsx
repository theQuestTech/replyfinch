import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, Sparkles } from 'lucide-react';
import type { AiSettings, AiStatus } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { Button, Card, Field, inputClass } from '../../components/ui';

type Data = { settings: AiSettings; status: AiStatus };

const usd = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2).replace(/\.00$/, '')}`);

export function AiAssistant() {
  const isAdmin = useAuth((s) => s.agent?.role === 'admin');
  const { data } = useQuery({ queryKey: ['ai'], queryFn: () => api<Data>('/settings/ai') });
  const [knowledge, setKnowledge] = useState('');
  const [cap, setCap] = useState('10');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!data) return;
    setKnowledge(data.settings.knowledge);
    setCap(String(data.settings.monthlyCapUsd));
  }, [data]);
  const save = useMutation({
    mutationFn: () =>
      api<AiSettings>('/settings/ai', { method: 'PUT', body: JSON.stringify({ knowledge, monthlyCapUsd: Number(cap) }) }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['ai'] });
    },
  });
  if (!data) return <div className="text-sm text-ink-2">Loading…</div>;
  const { status, settings } = data;
  const ai = status.engine === 'claude';
  const capNum = settings.monthlyCapUsd;
  const pct = Math.min(100, (status.spentUsd / capNum) * 100);
  const dirty = knowledge !== settings.knowledge || Number(cap) !== settings.monthlyCapUsd;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">AI assistant</h2>
        <p className="text-sm text-ink-2">
          “AI suggest” in a chat drafts a reply for you to check and edit. It never sends anything by itself.
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-6" data-testid="ai-status">
        {ai ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <CircleCheck className="size-5" /> AI mode · {status.model}
            </div>
            <p className="text-sm text-ink-2">Suggestions are written by AI using the conversation, your business information and your saved replies.</p>
            <div>
              <div className="mb-1 flex justify-between text-xs text-ink-2">
                <span>
                  This month: {status.suggestions.toLocaleString()} suggestions · {usd(status.spentUsd)} of {usd(capNum)}
                </span>
                <span>{pct >= 100 ? 'Budget used up — saved replies only until next month' : `${usd(Math.max(0, capNum - status.spentUsd))} left`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={capNum} aria-valuenow={status.spentUsd} aria-label="AI budget used">
                <div className={pct >= 90 ? 'h-full bg-warning' : 'h-full bg-primary'} style={{ width: `${Math.max(pct, 1)}%` }} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-5 text-primary" /> Free mode
            </div>
            <p className="text-sm text-ink-2">
              AI suggest picks your saved reply that best fits the customer’s message, with their name filled in. Add more shortcuts in Settings →
              Shortcuts to cover more questions. It costs nothing.
            </p>
            <p className="text-sm text-ink-2">
              <b className="text-ink">Switch to AI mode later:</b> add an Anthropic API key as <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code>{' '}
              on your API server (Railway → Variables). Buy prepaid credit with auto-reload off, and the monthly cap below keeps spending
              under your limit.
            </p>
          </>
        )}
      </Card>

      <fieldset disabled={!isAdmin} className="contents">
        <Card className="flex flex-col gap-4 p-6">
          <Field
            label="Business information for the AI"
            hint="What you sell, prices, shipping and refund rules, opening hours, tone of voice, and anything it must never promise. Used in AI mode."
          >
            <textarea
              className={`${inputClass} h-auto py-2`}
              rows={9}
              maxLength={8000}
              value={knowledge}
              onChange={(e) => (setKnowledge(e.target.value), setSaved(false))}
              placeholder={'We sell … \nShipping: … days to …\nRefunds: within … days\nOpening hours: …\nTone: friendly and short.\nNever promise: …'}
            />
          </Field>
          <Field label="Monthly AI budget (US$)" hint="A hard limit for AI mode. When it’s reached, AI suggest uses saved replies until next month.">
            <input
              className={`${inputClass} w-32`}
              type="number"
              min={1}
              max={500}
              step={1}
              value={cap}
              onChange={(e) => (setCap(e.target.value), setSaved(false))}
            />
          </Field>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {saved && <span className="text-sm font-medium text-success">Saved</span>}
              {save.isError && (
                <span role="alert" className="text-sm font-medium text-danger">
                  {save.error instanceof ApiError ? save.error.message : 'Could not save'}
                </span>
              )}
            </div>
          )}
          {!isAdmin && <p className="text-xs text-ink-2">Only admins can change these.</p>}
        </Card>
      </fieldset>
    </div>
  );
}
