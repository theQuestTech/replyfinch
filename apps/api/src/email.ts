import type { Message } from '@replyfinch/shared';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  enabled: boolean;
  from: string | null;
  replyTo: string | null;
  send(email: OutgoingEmail): Promise<void>;
}

export class EmailError extends Error {}

/** Keeps emails in memory instead of sending them — for development and browser tests. */
export function createLogMailer(from: string): Mailer & { outbox: (OutgoingEmail & { at: number })[] } {
  const outbox: (OutgoingEmail & { at: number })[] = [];
  return {
    enabled: true,
    from,
    replyTo: null,
    outbox,
    async send(email) {
      outbox.unshift({ ...email, at: Date.now() });
      outbox.length = Math.min(outbox.length, 50);
      console.info(`[email:log] to ${email.to}: ${email.subject}`);
    },
  };
}

/** Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function createMailer(cfg: { apiKey?: string; from?: string; replyTo?: string }): Mailer {
  const { apiKey, from } = cfg;
  if (!apiKey || !from) {
    return {
      enabled: false,
      from: null,
      replyTo: null,
      async send() {
        throw new EmailError('Email isn’t set up yet');
      },
    };
  }
  const replyTo = cfg.replyTo || null;
  return {
    enabled: true,
    from,
    replyTo,
    async send(email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
      }).catch((e: Error) => {
        throw new EmailError(`Couldn’t reach the email service (${e.message})`);
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new EmailError(body.message ?? `The email service answered ${res.status}`);
      }
    },
  };
}

// ---------------------------------------------------------------- templates
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const paragraphs = (s: string) => esc(s).replace(/\n/g, '<br>');

function layout(accountName: string, color: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#121826">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e3e7ef;border-radius:14px;overflow:hidden">
<tr><td style="background:${color};color:#fff;padding:16px 24px;font-weight:700;font-size:16px">${esc(accountName)}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${inner}</td></tr>
</table>
<div style="color:#5b6475;font-size:12px;padding:14px">Sent with Replyfinch</div>
</td></tr></table></body></html>`;
}

const when = (ts: number) => new Date(ts).toUTCString().replace(' GMT', ' UTC');

export function offlineReplyEmail(p: {
  accountName: string;
  color: string;
  customerName: string;
  agentName: string;
  body: string;
  original: { message: string; createdAt: number };
}): Omit<OutgoingEmail, 'to'> {
  const first = p.customerName.split(' ')[0] || p.customerName;
  const subject = `Re: your message to ${p.accountName}`;
  const text = `${p.body}\n\n— ${p.agentName}, ${p.accountName}\n\nOn ${when(p.original.createdAt)} you wrote:\n${p.original.message
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}`;
  const html = layout(
    p.accountName,
    p.color,
    `<p style="margin:0 0 4px;color:#5b6475;font-size:13px">Hi ${esc(first)},</p>
<div style="margin:12px 0">${paragraphs(p.body)}</div>
<p style="margin:16px 0 0">— ${esc(p.agentName)}, ${esc(p.accountName)}</p>
<div style="margin-top:24px;padding:12px 14px;border-left:3px solid #e3e7ef;color:#5b6475;font-size:13px">
On ${esc(when(p.original.createdAt))} you wrote:<br>${paragraphs(p.original.message)}</div>`,
  );
  return { subject, text, html };
}

export function transcriptEmail(p: {
  accountName: string;
  color: string;
  customerName: string | null;
  startedAt: number;
  messages: Message[];
}): Omit<OutgoingEmail, 'to'> {
  const visible = p.messages.filter((m) => !m.internal);
  const subject = `Your chat with ${p.accountName}`;
  const line = (m: Message) => (m.authorType === 'system' ? `— ${m.body} —` : `${m.authorName}: ${m.body}`);
  const text = `Here's a copy of your chat with ${p.accountName} on ${when(p.startedAt)}.\n\n${visible.map(line).join('\n')}`;
  const rows = visible
    .map((m) =>
      m.authorType === 'system'
        ? `<tr><td style="padding:6px 0;text-align:center;color:#5b6475;font-size:12px">${esc(m.body)}</td></tr>`
        : `<tr><td style="padding:6px 0"><div style="font-size:12px;color:#5b6475">${esc(m.authorName)}</div>
<div style="display:inline-block;margin-top:2px;padding:8px 12px;border-radius:12px;background:${m.authorType === 'visitor' ? '#eaf0fe' : '#f0f2f7'}">${paragraphs(m.body)}</div></td></tr>`,
    )
    .join('');
  const html = layout(
    p.accountName,
    p.color,
    `<p style="margin:0 0 16px">${p.customerName ? `Hi ${esc(p.customerName.split(' ')[0]!)}, h` : 'H'}ere's a copy of your chat with ${esc(p.accountName)} on ${esc(when(p.startedAt))}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
  );
  return { subject, text, html };
}

export function testEmail(accountName: string, color: string): Omit<OutgoingEmail, 'to'> {
  return {
    subject: `Replyfinch email is working`,
    text: `This is a test from ${accountName}'s Replyfinch. If you can read this, email is set up correctly.`,
    html: layout(accountName, color, `<p style="margin:0">This is a test from Replyfinch. If you can read this, email is set up correctly. 🎉</p>`),
  };
}
