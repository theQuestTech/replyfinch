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
