import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import { helpArticlePatchSchema, helpArticleSchema, helpCategorySchema, helpFeedbackSchema, helpSearchSchema } from '@replyfinch/shared';
import type { HelpService } from '../services/help';
import type { WidgetSettingsService } from '../services/widget-settings';

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? 'invalid_input';

/** Writing and organizing articles. Registered behind agent auth. */
export async function helpAgentRoutes(r: FastifyInstance, d: { help: HelpService }) {
  r.get('/help/categories', async (req) => d.help.categories(req.agent.acc));

  r.post('/help/categories', async (req, reply) => {
    const b = helpCategorySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
    return reply.code(201).send(await d.help.createCategory(req.agent.acc, b.data.name));
  });

  r.patch<{ Params: { id: string } }>('/help/categories/:id', async (req, reply) => {
    const b = helpCategorySchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
    const row = await d.help.updateCategory(req.agent.acc, req.params.id, b.data);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  r.delete<{ Params: { id: string } }>('/help/categories/:id', async (req, reply) => {
    if (!(await d.help.deleteCategory(req.agent.acc, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  r.get('/help/articles', async (req) => d.help.list(req.agent.acc));

  r.get<{ Params: { id: string } }>('/help/articles/:id', async (req, reply) => {
    const a = await d.help.get(req.agent.acc, req.params.id);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return a;
  });

  r.post('/help/articles', async (req, reply) => {
    const b = helpArticleSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
    if (!(await d.help.validCategory(req.agent.acc, b.data.categoryId))) return reply.code(400).send({ error: 'That category doesn’t exist' });
    return reply.code(201).send(await d.help.create(req.agent.acc, req.agent.sub, b.data));
  });

  r.patch<{ Params: { id: string } }>('/help/articles/:id', async (req, reply) => {
    const b = helpArticlePatchSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: firstIssue(b.error) });
    if (!(await d.help.validCategory(req.agent.acc, b.data.categoryId))) return reply.code(400).send({ error: 'That category doesn’t exist' });
    const a = await d.help.update(req.agent.acc, req.params.id, req.agent.sub, b.data);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    return a;
  });

  r.delete<{ Params: { id: string } }>('/help/articles/:id', async (req, reply) => {
    if (!(await d.help.remove(req.agent.acc, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}

/**
 * The public help center: published articles only, no sign-in. Under /widget/ so any website
 * (and the widget) can call it.
 */
export async function helpPublicRoutes(
  app: FastifyInstance,
  d: {
    help: HelpService;
    widgetSettings: WidgetSettingsService;
    accountExists: (id: string) => Promise<{ id: string; name: string } | null>;
    redis: Redis;
    limit: (name: string, max: number, windowSec: number) => preHandlerHookHandler[];
  },
) {
  type P = { Params: { acc: string; slug?: string } };
  const account = async (req: FastifyRequest<P>) => d.accountExists(req.params.acc);
  const reads = d.limit('help-read', 300, 60);

  app.get<P>('/widget/help/:acc', { preHandler: reads }, async (req, reply) => {
    const a = await account(req);
    if (!a) return reply.code(404).send({ error: 'unknown_account' });
    const s = await d.widgetSettings.get(a.id);
    return d.help.center(a.id, { name: a.name, color: s.color });
  });

  app.get<P>('/widget/help/:acc/search', { preHandler: reads }, async (req, reply) => {
    const q = helpSearchSchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await account(req))) return reply.code(404).send({ error: 'unknown_account' });
    return d.help.search(req.params.acc, q.data.q);
  });

  app.get<P>('/widget/help/:acc/articles/:slug', { preHandler: reads }, async (req, reply) => {
    const article = await d.help.article(req.params.acc, req.params.slug!);
    if (!article) return reply.code(404).send({ error: 'not_found' });
    // One view per reader per hour.
    const seen = await d.redis.set(`help-view:${req.params.acc}:${req.params.slug}:${req.ip}`, '1', 'EX', 3600, 'NX').catch(() => null);
    if (seen === 'OK') await d.help.countView(req.params.acc, req.params.slug!);
    return article;
  });

  app.post<P>('/widget/help/:acc/articles/:slug/feedback', { preHandler: d.limit('help-feedback', 20, 600) }, async (req, reply) => {
    const b = helpFeedbackSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await d.help.feedback(req.params.acc, req.params.slug!, b.data.helpful))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
