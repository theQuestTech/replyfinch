import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Webhook, WebhookDelivery, WebhookEvent, WebhookEventType } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { visitors, webhookDeliveries, webhooks } from '../db/schema';
import { newId } from '../ids';

type Row = typeof webhooks.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** Wait before each retry: 1 minute, 10 minutes, 1 hour, 6 hours (5 tries in all). */
export const DEFAULT_RETRY_DELAYS_MS = [60_000, 600_000, 3_600_000, 21_600_000];

/** What the rest of the app calls when something happens. The payload is only built if someone listens. */
export interface EventBus {
  emit(accountId: string, type: WebhookEventType, build: () => Promise<unknown>): void;
}
export const noEvents: EventBus = { emit() {} };

export class UnsafeUrlError extends Error {}

/** Private, loopback and link-local addresses: a webhook must not reach inside our own network. */
function privateIp(ip: string) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** https only (http too in development), and never an address inside our network. */
export async function checkUrl(raw: string, allowPrivate: boolean) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That isn’t a valid web address');
  }
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw new UnsafeUrlError('Use a web address starting with https://');
  if (u.username || u.password) throw new UnsafeUrlError('Leave the user name and password out of the address');
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new UnsafeUrlError('That address isn’t reachable from the internet');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw new UnsafeUrlError('We couldn’t find that web address');
  if (ips.some(privateIp)) throw new UnsafeUrlError('That address isn’t reachable from the internet');
}

/** Replyfinch-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body" with the webhook's secret> */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

const toDto = (r: Row): Webhook => ({
  id: r.id,
  url: r.url,
  events: r.events as WebhookEventType[],
  description: r.description,
  enabled: r.enabled,
  source: r.source,
  secret: r.secret,
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  lastDeliveryAt: r.lastDeliveryAt?.getTime() ?? null,
  failingSince: r.failingSince?.getTime() ?? null,
  createdAt: r.createdAt.getTime(),
});

const deliveryDto = (d: DeliveryRow): WebhookDelivery => ({
  id: d.id,
  eventId: d.eventId,
  type: d.type,
  status: d.status,
  attempts: d.attempts,
  responseStatus: d.responseStatus,
  responseBody: d.responseBody,
  error: d.error,
  createdAt: d.createdAt.getTime(),
  nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt.getTime() : null,
  deliveredAt: d.deliveredAt?.getTime() ?? null,
  payload: d.payload as WebhookEvent,
});

export function createWebhookService(d: {
  db: Db;
  /** Development and tests: allow http:// and local addresses. */
  allowPrivate: boolean;
  retryDelaysMs?: number[];
  fetch?: typeof fetch;
  log?: (msg: string, err?: unknown) => void;
}) {
  const db = d.db;
  const delays = d.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const doFetch = d.fetch ?? fetch;
  const log = d.log ?? ((m, e) => console.error(`[webhooks] ${m}`, e ?? ''));

  async function enqueue(accountId: string, hooks: Row[], event: WebhookEvent) {
    if (!hooks.length) return;
    await db.insert(webhookDeliveries).values(
      hooks.map((h) => ({ id: newId.webhookDelivery(), accountId, webhookId: h.id, eventId: event.id, type: event.type, payload: event })),
    );
  }

  /** Send one delivery and record what happened. */
  async function attempt(del: DeliveryRow) {
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, del.webhookId));
    if (!hook || !hook.enabled) {
      await db.update(webhookDeliveries).set({ status: 'failed', error: 'Webhook removed or turned off', updatedAt: new Date() }).where(eq(webhookDeliveries.id, del.id));
      return;
    }
    const body = JSON.stringify(del.payload);
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      await checkUrl(hook.url, d.allowPrivate);
      const res = await doFetch(hook.url, {
        method: 'POST',
        redirect: 'manual', // a redirect could point somewhere we wouldn't allow
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Replyfinch-Webhooks/1.0',
          'replyfinch-event': del.type,
          'replyfinch-delivery': del.id,
          'replyfinch-signature': sign(hook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 500);
      if (status < 200 || status >= 300) error = `The address answered ${status}`;
    } catch (err) {
      error = err instanceof UnsafeUrlError ? err.message : `Couldn’t connect (${(err as Error).message})`;
    }
    const attempts = del.attempts + 1;
    const now = new Date();
    if (!error) {
      await db
        .update(webhookDeliveries)
        .set({ status: 'succeeded', attempts, responseStatus: status, responseBody, error: null, deliveredAt: now, updatedAt: now })
        .where(eq(webhookDeliveries.id, del.id));
      await db.update(webhooks).set({ lastStatus: status, lastError: null, lastDeliveryAt: now, failingSince: null }).where(eq(webhooks.id, hook.id));
      return;
    }
    // Zapier (and the REST hooks convention): 410 Gone means "unsubscribe me".
    if (status === 410 && hook.source === 'api') {
      await db.delete(webhooks).where(eq(webhooks.id, hook.id));
      return;
    }
    const retry = attempts <= delays.length;
    await db
      .update(webhookDeliveries)
      .set({
        status: retry ? 'pending' : 'failed',
        attempts,
        responseStatus: status,
        responseBody,
        error,
        nextAttemptAt: retry ? new Date(now.getTime() + delays[attempts - 1]!) : now,
        updatedAt: now,
      })
      .where(eq(webhookDeliveries.id, del.id));
    await db
      .update(webhooks)
      .set({ lastStatus: status, lastError: error, lastDeliveryAt: now, ...(retry ? {} : { failingSince: hook.failingSince ?? now }) })
      .where(eq(webhooks.id, hook.id));
  }

  /** Claim due deliveries (safe with several API servers running) and send them. */
  async function tick() {
    // Deliveries stuck in "sending" (a server stopped mid-send) go back in the queue.
    await db
      .update(webhookDeliveries)
      .set({ status: 'pending' })
      .where(and(eq(webhookDeliveries.status, 'sending'), lte(webhookDeliveries.updatedAt, new Date(Date.now() - 2 * 60_000))));
    const claimed = (await db.execute(sql`
      update ${webhookDeliveries} set status = 'sending', updated_at = now()
      where id in (
        select id from ${webhookDeliveries}
        where status = 'pending' and next_attempt_at <= now()
        order by next_attempt_at limit 25
        for update skip locked
      )
      returning id`)) as unknown as { id: string }[];
    if (!claimed.length) return 0;
    const rows = await db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, claimed.map((c) => c.id)));
    await Promise.all(rows.map((r) => attempt(r).catch((e) => log('delivery failed', e))));
    return rows.length;
  }

  return {
    async list(accountId: string) {
      const rows = await db.select().from(webhooks).where(eq(webhooks.accountId, accountId)).orderBy(desc(webhooks.createdAt));
      return rows.map(toDto);
    },

    async create(accountId: string, w: { url: string; events: WebhookEventType[]; description?: string; source?: 'settings' | 'api'; apiKeyId?: string; createdBy?: string | null }) {
      await checkUrl(w.url, d.allowPrivate);
      const [row] = await db
        .insert(webhooks)
        .values({
          id: newId.webhook(),
          accountId,
          url: w.url,
          events: [...new Set(w.events)],
          description: w.description ?? '',
          secret: `whsec_${randomBytes(24).toString('base64url')}`,
          source: w.source ?? 'settings',
          apiKeyId: w.apiKeyId ?? null,
          createdBy: w.createdBy ?? null,
        })
        .returning();
      return toDto(row!);
    },

    async update(accountId: string, id: string, p: { url?: string; events?: WebhookEventType[]; description?: string; enabled?: boolean }) {
      if (p.url) await checkUrl(p.url, d.allowPrivate);
      const [row] = await db
        .update(webhooks)
        .set({ ...p, ...(p.events ? { events: [...new Set(p.events)] } : {}), ...(p.enabled ? { failingSince: null } : {}) })
        .where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId)))
        .returning();
      return row ? toDto(row) : null;
    },

    async remove(accountId: string, id: string, apiKeyId?: string) {
      const [row] = await db
        .delete(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId), apiKeyId ? eq(webhooks.apiKeyId, apiKeyId) : undefined))
        .returning({ id: webhooks.id });
      return !!row;
    },

    async deliveries(accountId: string, webhookId: string) {
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.accountId, accountId)))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(25);
      return rows.map(deliveryDto);
    },

    /** Try a failed (or waiting) delivery again now. */
    async retry(accountId: string, deliveryId: string) {
      const [row] = await db
        .update(webhookDeliveries)
        .set({ status: 'pending', nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.accountId, accountId), inArray(webhookDeliveries.status, ['failed', 'pending'])))
        .returning();
      return row ? deliveryDto(row) : null;
    },

    /** A "ping" event to check the address works. */
    async test(accountId: string, id: string) {
      const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.accountId, accountId)));
      if (!hook) return null;
      const event: WebhookEvent = { id: newId.event(), type: 'ping', createdAt: new Date().toISOString(), accountId, data: { message: 'Hello from Replyfinch! Your webhook works.' } };
      await enqueue(accountId, [hook], event);
      await tick();
      const [del] = await db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.eventId, event.id), eq(webhookDeliveries.webhookId, hook.id)));
      return deliveryDto(del!);
    },

    bus: {
      emit(accountId, type, build) {
        void (async () => {
          const hooks = await db
            .select()
            .from(webhooks)
            .where(and(eq(webhooks.accountId, accountId), eq(webhooks.enabled, true), sql`${type} = any(${webhooks.events})`));
          if (!hooks.length) return;
          const data = await build();
          await enqueue(accountId, hooks, { id: newId.event(), type, createdAt: new Date().toISOString(), accountId, data });
          void tick().catch((e) => log('send failed', e)); // don't wait for the next round
        })().catch((e) => log(`couldn’t queue ${type}`, e));
      },
    } satisfies EventBus,

    tick,

    /** Sends due deliveries every few seconds; old successful ones are cleared after 30 days. */
    start(intervalMs = 3000) {
      let busy = false;
      let n = 0;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void (async () => {
          await tick();
          if (++n % 1200 === 0) {
            await db
              .delete(webhookDeliveries)
              .where(and(eq(webhookDeliveries.status, 'succeeded'), lte(webhookDeliveries.createdAt, new Date(Date.now() - 30 * 86_400_000))));
          }
        })()
          .catch((e) => log('worker', e))
          .finally(() => (busy = false));
      }, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
export type WebhookService = ReturnType<typeof createWebhookService>;

/** The customer part of an event. */
export async function eventCustomer(db: Db, visitorId: string | null) {
  if (!visitorId) return null;
  const [v] = await db.select({ id: visitors.id, name: visitors.name, email: visitors.email, phone: visitors.phone }).from(visitors).where(eq(visitors.id, visitorId));
  return v ?? null;
}
