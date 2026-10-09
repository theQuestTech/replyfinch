import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '../env';
import { createDb } from './client';

// The SQL migrations live in apps/api/drizzle. This module runs from src/db (dev),
// dist/ (bundled server) or dist/cli (bundled CLI), so look in each likely place.
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../drizzle'), path.resolve(here, '../../drizzle')];
  const found = candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function runMigrations(url = env.DATABASE_URL) {
  const { db, sql } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await sql.end();
  }
}
