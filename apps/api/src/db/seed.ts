import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth';
import { env } from '../env';
import { createDb } from './client';
import { accounts, users } from './schema';

// Creates a demo account and two agents for local development.
// Fixed account id so the widget snippet in README works out of the box.
export const DEMO_ACCOUNT_ID = 'acc_demo';
export const DEMO_AGENTS = [
  { id: 'usr_demo_maya', name: 'Maya Chen', email: 'maya@replyfinch.dev', role: 'admin' as const },
  { id: 'usr_demo_daniel', name: 'Daniel Brooks', email: 'daniel@replyfinch.dev', role: 'agent' as const },
];
export const DEMO_PASSWORD = 'replyfinch';

export async function seed(url = env.DATABASE_URL) {
  const { db, sql } = createDb(url);
  try {
    const [existing] = await db.select().from(accounts).where(eq(accounts.id, DEMO_ACCOUNT_ID));
    if (!existing) await db.insert(accounts).values({ id: DEMO_ACCOUNT_ID, name: 'Acme Books' });
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const a of DEMO_AGENTS) {
      await db
        .insert(users)
        .values({ ...a, accountId: DEMO_ACCOUNT_ID, passwordHash })
        .onConflictDoNothing();
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .then(() => console.log(`seeded: log in as ${DEMO_AGENTS[0]!.email} / ${DEMO_PASSWORD}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
