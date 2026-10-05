import { buildApp } from './app';
import { env } from './env';

const { app } = await buildApp(env);
await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
