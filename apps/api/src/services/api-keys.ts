import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ApiKey } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { apiKeys, users } from '../db/schema';
import { newId } from '../ids';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

/** Keys for the public API (/v1). The full key is shown once; only its hash is kept. */
export function createApiKeyService(db: Db) {
  return {
    async list(accountId: string): Promise<ApiKey[]> {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt));
      const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
      const names = new Map(ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        createdAt: r.createdAt.getTime(),
        lastUsedAt: r.lastUsedAt?.getTime() ?? null,
        createdByName: (r.createdBy && names.get(r.createdBy)) || null,
      }));
    },

    async create(accountId: string, name: string, userId: string) {
      const key = `rf_live_${randomBytes(24).toString('base64url')}`;
      const [row] = await db
        .insert(apiKeys)
        .values({ id: newId.apiKey(), accountId, name, prefix: key.slice(0, 12), hash: hash(key), createdBy: userId })
        .returning();
      return { id: row!.id, name: row!.name, prefix: row!.prefix, key };
    },

    async revoke(accountId: string, id: string) {
      const [row] = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
      return !!row;
    },

    /** The key's account, or null. Records when it was last used (at most once a minute). */
    async verify(key: string | undefined) {
      if (!key || !key.startsWith('rf_') || key.length > 100) return null;
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.hash, hash(key)), isNull(apiKeys.revokedAt)));
      if (!row) return null;
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
        await db.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, row.id));
      }
      return { accountId: row.accountId, keyId: row.id, name: row.name };
    },
  };
}
export type ApiKeyService = ReturnType<typeof createApiKeyService>;
