import { buildApp } from './app';
import { env } from './env';
import { prepareDatabase } from './startup';

// Log instead of crashing on a stray async error; one failed background task shouldn't drop every chat.
process.on('unhandledRejection', (err) => console.error('[api] unhandled rejection', err));

await prepareDatabase(env);
const { app } = await buildApp(env);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Replyfinch API listening on port ${env.PORT} — allowed agent app origins: ${env.corsOrigins.join(', ')}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
