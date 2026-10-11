import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ReceivedEmail } from '../email';
import { htmlToText, verifyWebhook } from '../inbound';
import type { IncomingEmail, InboundService } from '../services/inbound';

const webhookSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().min(1).max(200), to: z.array(z.string()).optional() }).passthrough(),
});

/** Resend's received email → what the inbound service needs. */
export function toIncoming(email: ReceivedEmail, extraTo: string[] = []): IncomingEmail {
  const auth = email.authentication;
  return {
    from: email.headers?.from ?? email.headers?.From ?? email.from,
    recipients: [...(email.to ?? []), ...(email.cc ?? []), ...(email.received_for ?? []), ...extraTo],
    subject: email.subject ?? '',
    text: email.text?.trim() ? email.text : htmlToText(email.html ?? ''),
    headers: email.headers ?? null,
    authenticated: !auth || auth.spf === 'pass' || auth.dkim === 'pass',
    attachments: (email.attachments ?? []).map((a) => a.filename ?? 'attachment'),
  };
}

/**
 * POST /webhooks/resend — Resend calls this for every email received (event "email.received").
 * The webhook only carries the email's id; the content is read from Resend's API.
 */
export async function inboundRoutes(
  app: FastifyInstance,
  d: {
    inbound: InboundService;
    secret: string | undefined;
    redis: Redis;
    fetchEmail: ((id: string) => Promise<ReceivedEmail>) | null;
    /** Development only: POST /dev/inbound pretends an email arrived. */
    devRoute: boolean;
  },
) {
  await app.register(async (r) => {
    // The signature covers the exact bytes sent, so keep the body as a string.
    r.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

    r.post('/webhooks/resend', async (req, reply) => {
      if (!d.secret || !d.inbound.enabled || !d.fetchEmail) return reply.code(404).send({ error: 'receiving_not_set_up' });
      const raw = req.body as string;
      if (!verifyWebhook(d.secret, req.headers, raw)) return reply.code(401).send({ error: 'bad_signature' });
      let event;
      try {
        event = webhookSchema.parse(JSON.parse(raw));
      } catch {
        return reply.code(400).send({ error: 'invalid_input' });
      }
      if (event.type !== 'email.received') return { ok: true, ignored: event.type };

      // Resend retries until it gets a 2xx: handle each delivery once.
      const key = `inbound:${req.headers['svix-id']}`;
      if ((await d.redis.set(key, '1', 'EX', 86_400, 'NX').catch(() => 'OK')) !== 'OK') return { ok: true, duplicate: true };
      try {
        const email = await d.fetchEmail(event.data.email_id);
        const result = await d.inbound.receive(toIncoming(email, event.data.to ?? []));
        req.log.info({ result, emailId: event.data.email_id }, 'inbound email');
        return { ok: true, result };
      } catch (err) {
        await d.redis.del(key).catch(() => {}); // let Resend's retry try again
        req.log.error(err, 'inbound email failed');
        return reply.code(502).send({ error: 'could_not_process' });
      }
    });
  });

  if (d.devRoute) {
    const devSchema = z.object({
      from: z.string().min(3),
      to: z.string().min(3),
      subject: z.string().default(''),
      text: z.string().default(''),
      html: z.string().optional(),
    });
    app.post('/dev/inbound', async (req, reply) => {
      const b = devSchema.safeParse(req.body);
      if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
      return d.inbound.receive(
        toIncoming({ id: 'dev', from: b.data.from, to: [b.data.to], subject: b.data.subject, text: b.data.text || null, html: b.data.html ?? null }),
      );
    });
  }
}
