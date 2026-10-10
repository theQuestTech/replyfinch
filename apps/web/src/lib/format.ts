export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string | null | undefined, fallback = 'V'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || fallback;
}

/** "Visitor 89758790" for anonymous visitors — a stable short number from the id. */
export function visitorLabel(v: { id: string; name: string | null }): string {
  if (v.name) return v.name;
  let h = 0;
  for (const c of v.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `Visitor ${String(h % 100_000_000).padStart(8, '0')}`;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

export function referrerHost(ref: string | null): string {
  if (!ref) return 'Direct';
  try {
    return new URL(ref).host.replace(/^www\./, '');
  } catch {
    return ref;
  }
}

export function localTime(tz: string | null): string | null {
  if (!tz) return null;
  try {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
  } catch {
    return null;
  }
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const clientId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** "Today, 3:04 PM", "Yesterday, 9:12 AM" or "Mar 4, 3:04 PM" (with the year when it isn't this year). */
export function dateTime(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  const time = clock(ts);
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date}, ${time}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
