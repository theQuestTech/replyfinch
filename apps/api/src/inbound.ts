import { createHmac, timingSafeEqual } from 'node:crypto';

// Receiving email: reply addresses, webhook signatures, and turning an email into the new text.

export type AddressKind = 'ticket' | 'offline' | 'account';
const LETTER: Record<AddressKind, string> = { ticket: 't', offline: 'm', account: 'a' };
const PREFIX: Record<AddressKind, string> = { ticket: 'tk_', offline: 'om_', account: 'acc_' };

/**
 * A private reply address, e.g. t-01jc…-9f3a2b7c1d@abc.resend.app for ticket tk_01JC….
 * The signature stops anyone from posting into a ticket by guessing its id.
 */
export function replyAddress(kind: AddressKind, id: string, domain: string, secret: string) {
  const part = id.slice(PREFIX[kind].length).toLowerCase();
  return `${LETTER[kind]}-${part}-${sign(kind, part, secret)}@${domain}`;
}

function sign(kind: AddressKind, part: string, secret: string) {
  return createHmac('sha256', secret).update(`inbound:${kind}:${part}`).digest('hex').slice(0, 10);
}

/** The ids a reply address stands for (several spellings: mail systems may change letter case). */
export function parseReplyAddress(address: string, domain: string, secret: string): { kind: AddressKind; ids: string[] } | null {
  const m = /^([tma])-([a-z0-9]{1,40})-([0-9a-f]{10})@(.+)$/.exec(address.trim().toLowerCase());
  if (!m || m[4] !== domain) return null;
  const kind = (Object.keys(LETTER) as AddressKind[]).find((k) => LETTER[k] === m[1])!;
  const expected = sign(kind, m[2]!, secret);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(m[3]!))) return null;
  return { kind, ids: [...new Set([PREFIX[kind] + m[2]!.toUpperCase(), PREFIX[kind] + m[2]!])] };
}

/** "Pia Novak <pia@example.com>" → { email, name } */
export function parseMailbox(raw: string): { email: string; name: string | null } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { email: m[2]!.trim().toLowerCase(), name: m[1]!.trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

/**
 * Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body", with the secret
 * after "whsec_" base64-decoded. https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
export function verifyWebhook(secret: string, headers: Record<string, string | string[] | undefined>, body: string, now = Date.now()) {
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = h('svix-id');
  const ts = h('svix-timestamp');
  const sigs = h('svix-signature');
  if (!id || !ts || !sigs) return false;
  if (!/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 5 * 60) return false; // replayed or badly delayed
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(' ').some((s) => {
    const [version, sig] = s.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Good-enough plain text from an HTML email, without the quoted earlier messages. */
export function htmlToText(html: string): string {
  let h = html;
  if (/^data:text\/html/i.test(h)) {
    const [meta, data = ''] = h.split(',', 2);
    h = /;base64$/i.test(meta!) ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  }
  // Earlier messages quoted by Gmail, Outlook and Apple Mail: drop everything from there on.
  const cut = h.search(/<div[^>]+class="[^"]*(gmail_quote|gmail_attr)|<blockquote|<div[^>]+id="(appendonsend|divRplyFwdMsg)"|<hr[^>]*id="?stopSpelling/i);
  if (cut > 0) h = h.slice(0, cut);
  return h
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Only what the customer just wrote: drops the quoted earlier email and the usual reply headers. */
export function extractReply(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? '';
    // "On Mon, 3 Oct 2026 at 10:02, Maya <…> wrote:" — sometimes wrapped onto two lines.
    if (/^\s*On\b.+wrote:\s*$/i.test(line) || (/^\s*On\b.+/i.test(line) && /^.*wrote:\s*$/i.test(next) && !/^\s*>/.test(next))) break;
    if (/^\s*(-{2,}\s*Original Message\s*-{2,}|_{10,}|-{5,}\s*Forwarded message)/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && /^\s*(Sent|Date|To):\s/i.test(next)) break; // Outlook header block
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Out-of-office and other automatic emails shouldn't reopen tickets or create new ones. */
export function isAutoReply(headers: Record<string, string> | null | undefined, subject: string) {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h['auto-submitted'] && h['auto-submitted'] !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || /^(bulk|junk|list|auto_reply)$/.test(h.precedence ?? '')) return true;
  return /^(auto(matic)? ?reply|out of (the )?office|abwesenheit|réponse automatique)\b/i.test(subject.trim());
}

/** "Re: Fwd: [#12] Order status" → "[#12] Order status" */
export const cleanSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|sv|tr)\s*:\s*)+/i, '').trim();
