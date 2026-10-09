import { buildApp } from './app';
import { env } from './env';
import { prepareDatabase } from './startup';

await prepareDatabase(env);
const { app } = await buildApp(env);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
console.log(`Replyfinch API listening on port ${env.PORT} — allowed agent app origins: ${env.corsOrigins.join(', ')}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
