import { and, asc, eq } from 'drizzle-orm';
import type { Shortcut } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { shortcuts } from '../db/schema';
import { newId } from '../ids';

type Row = typeof shortcuts.$inferSelect;

export const toShortcut = (r: Row): Shortcut => ({
  id: r.id,
  name: r.name,
  message: r.message,
  tags: r.tags,
  updatedAt: r.updatedAt.getTime(),
});

/** A starter set every new account gets, so "/" is useful on day one. */
export const DEFAULT_SHORTCUTS = [
  { name: 'hi', message: 'Hi {{visitor.name}}, thanks for reaching out! How can I help you today?', tags: ['greeting', 'hello', 'welcome'] },
  { name: 'one-moment', message: 'Thanks for waiting — let me look into that for you. It’ll just take a moment.', tags: ['wait', 'checking', 'hold'] },
  { name: 'refund', message: 'I’m sorry about that! I’ve started a refund for you. You’ll see it on your original payment method within 5–7 business days.', tags: ['money', 'return', 'charge'] },
  { name: 'shipping', message: 'Orders usually ship within 1–2 business days, and delivery takes 3–5 business days. You’ll get a tracking link by email as soon as it ships.', tags: ['delivery', 'tracking', 'order'] },
  { name: 'thanks', message: 'You’re welcome, {{visitor.name}}! Is there anything else I can help you with today?', tags: ['bye', 'closing', 'thank you'] },
];

export function createShortcutService(db: Db) {
  return {
    async list(accountId: string): Promise<Shortcut[]> {
      const rows = await db.select().from(shortcuts).where(eq(shortcuts.accountId, accountId)).orderBy(asc(shortcuts.name));
      return rows.map(toShortcut);
    },

    async create(accountId: string, userId: string | null, input: { name: string; message: string; tags: string[] }) {
      const [row] = await db
        .insert(shortcuts)
        .values({ id: newId.shortcut(), accountId, createdBy: userId, ...input })
        .onConflictDoNothing()
        .returning();
      return row ? toShortcut(row) : null; // null = name already taken
    },

    async update(accountId: string, id: string, input: { name: string; message: string; tags: string[] }) {
      try {
        const [row] = await db
          .update(shortcuts)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(shortcuts.id, id), eq(shortcuts.accountId, accountId)))
          .returning();
        return row ? toShortcut(row) : undefined; // undefined = not found
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === '23505') return null; // name taken
        throw err;
      }
    },

    async remove(accountId: string, id: string) {
      const rows = await db
        .delete(shortcuts)
        .where(and(eq(shortcuts.id, id), eq(shortcuts.accountId, accountId)))
        .returning({ id: shortcuts.id });
      return rows.length > 0;
    },

    async addDefaults(accountId: string) {
      await db
        .insert(shortcuts)
        .values(DEFAULT_SHORTCUTS.map((s) => ({ id: newId.shortcut(), accountId, ...s })))
        .onConflictDoNothing();
    },
  };
}
export type ShortcutService = ReturnType<typeof createShortcutService>;
