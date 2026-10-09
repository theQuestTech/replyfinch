import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth';
import { env } from '../env';
import { newId } from '../ids';
import { createDb } from './client';
import { accounts, users } from './schema';

// Development: creates a demo account ("Acme Books") with two agents.
// Production: never creates demo users. Instead, when ADMIN_EMAIL and
// ADMIN_PASSWORD are set, it creates the first account + admin once.
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

/** Create the first account and admin from env vars, if no user with that email exists. */
export async function bootstrapAdmin(
  input: { email: string; password: string; name: string; accountName: string },
  url = env.DATABASE_URL,
): Promise<{ created: boolean; accountId: string }> {
  const { db, sql } = createDb(url);
  try {
    const email = input.email.toLowerCase();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (user) return { created: false, accountId: user.accountId };
    if (input.password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
    const accountId = newId.account();
    await db.insert(accounts).values({ id: accountId, name: input.accountName });
    await db.insert(users).values({
      id: newId.user(),
      accountId,
      email,
      name: input.name,
      role: 'admin',
      passwordHash: await hashPassword(input.password),
    });
    return { created: true, accountId };
  } finally {
    await sql.end();
  }
}

/** Production: create the first account + admin from ADMIN_* env vars (once). */
export async function bootstrapFromEnv(log: (msg: string) => void = console.log) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ACCOUNT_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin bootstrap');
    return;
  }
  const res = await bootstrapAdmin({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: ADMIN_NAME ?? 'Admin',
    accountName: ACCOUNT_NAME ?? 'My company',
  });
  log(
    res.created
      ? `created admin ${ADMIN_EMAIL} — widget account id: ${res.accountId}`
      : `admin ${ADMIN_EMAIL} already exists — widget account id: ${res.accountId}`,
  );
}
