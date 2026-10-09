import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { API_URL } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Card } from '../../components/ui';

const WIDGET_URL = (import.meta.env.VITE_WIDGET_URL ?? 'http://localhost:5174').replace(/\/$/, '');

export function InstallWidget() {
  const accountId = useAuth((s) => s.agent?.accountId ?? '');
  const [copied, setCopied] = useState<string | null>(null);
  const snippet = `<script src="${WIDGET_URL}/widget.js" data-account="${accountId}" data-api="${API_URL}" async></script>`;
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Install the chat widget</h2>
        <p className="text-sm text-ink-2">Add the chat bubble to your website so visitors can chat with your team.</p>
      </div>
      <Card className="flex flex-col gap-3 p-6">
        <div className="text-sm font-semibold">1. Copy this code</div>
        <pre data-testid="widget-snippet" className="overflow-x-auto rounded-lg bg-navy p-4 text-xs leading-relaxed whitespace-pre-wrap break-all text-white">
          {snippet}
        </pre>
        <div>
          <Button variant="primary" onClick={() => copy('snippet', snippet)}>
            {copied === 'snippet' ? <Check className="size-4" /> : <Copy className="size-4" />} {copied === 'snippet' ? 'Copied' : 'Copy code'}
          </Button>
        </div>
        <div className="mt-2 text-sm font-semibold">2. Paste it on every page, just before &lt;/body&gt;</div>
        <p className="text-sm text-ink-2">
          Most website builders have a “custom code” or “footer scripts” setting that adds it to every page at once. Then open your site — the
          chat bubble appears in the bottom-right corner, and visitors show up under Visitors right away.
        </p>
      </Card>
      <Card className="flex items-center gap-3 px-6 py-4">
        <div className="flex-1">
          <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Your account ID</div>
          <div className="font-mono text-sm" data-testid="account-id">
            {accountId}
          </div>
        </div>
        <Button onClick={() => copy('id', accountId)}>{copied === 'id' ? 'Copied' : 'Copy'}</Button>
      </Card>
    </div>
  );
}
