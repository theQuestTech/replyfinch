import postgres from 'postgres';
import { runMigrations } from './db/migrate';
import { bootstrapFromEnv } from './db/seed';
import type { Env } from './env';

/**
 * Bring the database up to date before serving traffic: apply migrations and, in
 * production, create the first admin from ADMIN_* variables. Safe to run on every
 * start and on several instances at once (a Postgres advisory lock serialises it).
 */
export async function prepareDatabase(env: Env) {
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(727274)`;
    try {
      await runMigrations(env.DATABASE_URL);
      console.log('database migrations applied');
      if (env.NODE_ENV === 'production') await bootstrapFromEnv();
    } finally {
      await sql`select pg_advisory_unlock(727274)`;
    }
  } catch (err) {
    throw new Error(`Could not prepare the database (check DATABASE_URL): ${(err as Error).message}`, { cause: err });
  } finally {
    await sql.end();
  }
}
