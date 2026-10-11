import type { Ticket } from '@replyfinch/shared';
import { cleanSubject, extractReply, isAutoReply, parseMailbox, parseReplyAddress, replyAddress, type AddressKind } from '../inbound';
import type { OfflineService } from './offline';
import { offlineThread, type TicketService } from './tickets';

/** An email that arrived, already read out of Resend. */
export interface IncomingEmail {
  from: string;
  /** Every address it was sent to (to, cc, and where it was forwarded for). */
  recipients: string[];
  subject: string;
  /** Plain text of the whole email (quoted earlier messages are dropped here). */
  text: string;
  headers?: Record<string, string> | null;
  /** SPF or DKIM passed (unknown counts as passed: development and tests). */
  authenticated: boolean;
  attachments: string[];
}

export type InboundResult =
  | { action: 'reply'; ticketId: string; reopened: boolean }
  | { action: 'created'; ticketId: string }
  | { action: 'ignored'; reason: 'no_address' | 'unknown_target' | 'auto_reply' | 'empty' | 'loop' | 'unverified_sender' };

const MAX_BODY = 20_000;

/**
 * Customers' emails into tickets:
 *   t-… (a ticket's reply address)        → added to that ticket, which reopens
 *   m-… (an offline message's reply address) → into the ticket made from it, or a new one
 *   a-… (the account's support address)   → "[#12]" from the ticket's customer adds to #12; otherwise a new ticket
 */
export function createInboundService(d: {
  tickets: TicketService;
  offline: OfflineService;
  domain: string | null;
  secret: string;
  /** Our own sending address: never treat our emails as a customer's. */
  ownAddress: string | null;
  onTicket: (accountId: string, ticket: Ticket, event: { kind: 'reply' | 'created'; preview: string; from: string }) => void;
}) {
  const domain = d.domain;

  const addressFor = (kind: AddressKind, id: string) => (domain ? replyAddress(kind, id, domain, d.secret) : null);

  async function announce(accountId: string, row: Parameters<TicketService['dto']>[0], kind: 'reply' | 'created', preview: string, from: string) {
    const t = await d.tickets.dto(row);
    d.onTicket(accountId, t, { kind, preview: preview.slice(0, 200), from });
    return t;
  }

  return {
    enabled: !!domain,
    ticketAddress: (id: string) => addressFor('ticket', id),
    offlineAddress: (id: string) => addressFor('offline', id),
    accountAddress: (id: string) => addressFor('account', id),

    async receive(e: IncomingEmail): Promise<InboundResult> {
      if (!domain) return { action: 'ignored', reason: 'no_address' };
      const sender = parseMailbox(e.from);
      if (sender.email.endsWith(`@${domain}`) || (d.ownAddress && sender.email === parseMailbox(d.ownAddress).email)) {
        return { action: 'ignored', reason: 'loop' };
      }
      const target = e.recipients.map((r) => parseReplyAddress(parseMailbox(r).email, domain, d.secret)).find((x) => x !== null);
      if (!target) return { action: 'ignored', reason: 'no_address' };
      if (isAutoReply(e.headers, e.subject)) return { action: 'ignored', reason: 'auto_reply' };

      let body = extractReply(e.text) || e.text.trim();
      if (e.attachments.length) body += `\n\n📎 Attached to the email (not shown here yet): ${e.attachments.join(', ')}`;
      body = body.slice(0, MAX_BODY).trim();
      if (!body) return { action: 'ignored', reason: 'empty' };

      const reply = async (row: NonNullable<Awaited<ReturnType<TicketService['getAny']>>>): Promise<InboundResult> => {
        const r = await d.tickets.customerReply(row, sender.name ?? row.requesterName ?? sender.email, body);
        const t = await announce(row.accountId, r.row, 'reply', body, sender.name ?? sender.email);
        return { action: 'reply', ticketId: t.id, reopened: r.reopened };
      };

      if (target.kind === 'ticket') {
        for (const id of target.ids) {
          const row = await d.tickets.getAny(id);
          if (row) return reply(row);
        }
        return { action: 'ignored', reason: 'unknown_target' };
      }

      if (target.kind === 'offline') {
        let m = null;
        for (const id of target.ids) m ??= await d.offline.getAny(id);
        if (!m) return { action: 'ignored', reason: 'unknown_target' };
        const existing = await d.tickets.bySource(m.accountId, 'offline', m.id);
        if (existing) return reply(existing);
        const row = await d.tickets.create(m.accountId, {
          subject: cleanSubject(e.subject).replace(/^your message to .+$/i, '') || m.message.split('\n')[0]!.slice(0, 120),
          priority: 'normal',
          assigneeId: null,
          visitorId: m.visitorId,
          requesterName: m.name,
          requesterEmail: m.email,
          source: 'offline',
          sourceId: m.id,
          createdBy: { id: null, name: m.name },
          messages: [...(await offlineThread(d.offline, m)), { kind: 'customer', author: { id: null, name: sender.name ?? m.name }, body }],
        });
        const t = await announce(m.accountId, row, 'created', body, sender.name ?? sender.email);
        return { action: 'created', ticketId: t.id };
      }

      // The account's support address.
      const accountId = (await Promise.all(target.ids.map(async (id) => ((await d.tickets.accountExists(id)) ? id : null)))).find(Boolean);
      if (!accountId) return { action: 'ignored', reason: 'unknown_target' };
      const num = /\[#(\d{1,9})\]/.exec(e.subject)?.[1];
      if (num) {
        const row = await d.tickets.byNumber(accountId, Number(num));
        if (row && row.requesterEmail?.toLowerCase() === sender.email) return reply(row);
      }
      // Anyone can email a support address: only start new tickets from senders whose domain vouches for them.
      if (!e.authenticated) return { action: 'ignored', reason: 'unverified_sender' };
      const customer = await d.tickets.findOrCreateCustomer(accountId, sender.name, sender.email);
      const row = await d.tickets.create(accountId, {
        subject: cleanSubject(e.subject).replace(/\[#\d+\]\s*/, '').slice(0, 200) || `Email from ${sender.name ?? sender.email}`,
        priority: 'normal',
        assigneeId: null,
        visitorId: customer?.id ?? null,
        requesterName: sender.name ?? customer?.name ?? null,
        requesterEmail: sender.email,
        source: 'email',
        sourceId: null,
        createdBy: { id: null, name: sender.name ?? sender.email },
        messages: [{ kind: 'customer', author: { id: null, name: sender.name ?? sender.email }, body }],
      });
      const t = await announce(accountId, row, 'created', body, sender.name ?? sender.email);
      return { action: 'created', ticketId: t.id };
    },
  };
}
export type InboundService = ReturnType<typeof createInboundService>;
