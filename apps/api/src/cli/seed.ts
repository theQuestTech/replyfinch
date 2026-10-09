// CLI: pnpm db:seed — demo data in development, ADMIN_* bootstrap in production.
import { env } from '../env';
import { bootstrapFromEnv, DEMO_AGENTS, DEMO_PASSWORD, seed } from '../db/seed';

async function main() {
  if (env.NODE_ENV !== 'production') {
    await seed();
    console.log(`seeded demo account: log in as ${DEMO_AGENTS[0]!.email} / ${DEMO_PASSWORD}`);
    return;
  }
  await bootstrapFromEnv();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
