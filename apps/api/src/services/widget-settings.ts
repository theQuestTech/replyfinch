import { eq } from 'drizzle-orm';
import { DEFAULT_WIDGET_SETTINGS, type WidgetSettings } from '@replyfinch/shared';
import type { Db } from '../db/client';
import { accounts } from '../db/schema';

export function createWidgetSettingsService(db: Db) {
  return {
    async get(accountId: string): Promise<WidgetSettings> {
      const [row] = await db.select({ s: accounts.widgetSettings }).from(accounts).where(eq(accounts.id, accountId));
      // Saved values over the defaults, so settings added later get their default.
      return { ...DEFAULT_WIDGET_SETTINGS, ...(row?.s ?? {}) };
    },

    /** Settings plus the company name, for the preview in the agent app. */
    async withName(accountId: string): Promise<WidgetSettings & { accountName: string }> {
      const [row] = await db.select({ name: accounts.name, s: accounts.widgetSettings }).from(accounts).where(eq(accounts.id, accountId));
      return { ...DEFAULT_WIDGET_SETTINGS, ...(row?.s ?? {}), accountName: row?.name ?? '' };
    },

    async set(accountId: string, settings: WidgetSettings): Promise<WidgetSettings> {
      await db.update(accounts).set({ widgetSettings: settings }).where(eq(accounts.id, accountId));
      return settings;
    },
  };
}
export type WidgetSettingsService = ReturnType<typeof createWidgetSettingsService>;
