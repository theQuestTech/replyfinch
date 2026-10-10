import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { desktopPermission, requestDesktopPermission, useNotifyPrefs } from '../lib/notify';
import { Button } from './ui';

const DISMISS_KEY = 'rf_notify_banner_dismissed';

/** Asks once to turn on desktop notifications, so agents don't miss chats in another tab. */
export function NotificationBanner() {
  const wantsDesktop = useNotifyPrefs((s) => s.desktop);
  const [perm, setPerm] = useState(desktopPermission);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!wantsDesktop || perm !== 'default' || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-3 border-b border-line bg-primary-subtle px-8 py-2.5 text-sm" data-testid="notify-banner">
      <BellRing className="size-4 text-primary" />
      <span className="flex-1">
        <b>Never miss a chat.</b> Turn on desktop notifications to get alerted when you’re in another tab.
      </span>
      <Button variant="primary" onClick={async () => setPerm(await requestDesktopPermission())}>
        Turn on
      </Button>
      <button onClick={dismiss} aria-label="Dismiss" className="cursor-pointer rounded p-1 text-ink-2 hover:bg-surface">
        <X className="size-4" />
      </button>
    </div>
  );
}
