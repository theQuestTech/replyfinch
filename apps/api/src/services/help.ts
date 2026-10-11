import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  HelpArticle,
  HelpArticleSummary,
  HelpCategory,
  PublicHelpArticle,
  PublicHelpArticleSummary,
  PublicHelpCenter,
} from '@replyfinch/shared';
import { excerpt } from '@replyfinch/shared/markdown';
import type { Db } from '../db/client';
import { helpArticles, helpCategories, users } from '../db/schema';
import { newId } from '../ids';
import { isUniqueViolation } from './conversations';

type Row = typeof helpArticles.$inferSelect;

/** "How do I return a book?" → "how-do-i-return-a-book" */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || 'article';
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createHelpService(db: Db) {
  async function summaries(rows: Row[]): Promise<HelpArticleSummary[]> {
    const ids = [...new Set(rows.map((r) => r.updatedBy).filter((x): x is string => !!x))];
    const names = new Map(
      ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      categoryId: r.categoryId,
      status: r.status,
      views: r.views,
      helpful: r.helpful,
      notHelpful: r.notHelpful,
      updatedAt: r.updatedAt.getTime(),
      updatedByName: (r.updatedBy && names.get(r.updatedBy)) || null,
      publishedAt: r.publishedAt?.getTime() ?? null,
    }));
  }
  const full = async (r: Row): Promise<HelpArticle> => ({ ...(await summaries([r]))[0]!, body: r.body });

  async function categoryNames(accountId: string) {
    const rows = await db.select({ id: helpCategories.id, name: helpCategories.name }).from(helpCategories).where(eq(helpCategories.accountId, accountId));
    return new Map(rows.map((c) => [c.id, c.name]));
  }
  const publicSummary = (r: Row, cats: Map<string, string>): PublicHelpArticleSummary => ({
    slug: r.slug,
    title: r.title,
    excerpt: excerpt(r.body),
    categoryName: (r.categoryId && cats.get(r.categoryId)) || null,
  });
  const published = (accountId: string) => and(eq(helpArticles.accountId, accountId), eq(helpArticles.status, 'published'));

  /** A free slug: the title's, or with -2, -3… when another article has it. */
  async function freeSlug(accountId: string, title: string, exceptId?: string) {
    const base = slugify(title);
    const taken = new Set(
      (
        await db
          .select({ slug: helpArticles.slug, id: helpArticles.id })
          .from(helpArticles)
          .where(and(eq(helpArticles.accountId, accountId), sql`(${helpArticles.slug} = ${base} or ${helpArticles.slug} like ${`${base}-%`})`))
      )
        .filter((r) => r.id !== exceptId)
        .map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  async function validCategory(accountId: string, categoryId: string | null | undefined) {
    if (!categoryId) return true;
    const [c] = await db.select({ id: helpCategories.id }).from(helpCategories).where(and(eq(helpCategories.id, categoryId), eq(helpCategories.accountId, accountId)));
    return !!c;
  }

  return {
    validCategory,

    // ------------------------------------------------------------ categories
    async categories(accountId: string): Promise<HelpCategory[]> {
      const rows = await db
        .select({
          id: helpCategories.id,
          name: helpCategories.name,
          position: helpCategories.position,
          // Fully qualified: a bare "id" inside the subquery would mean the article's own id.
          articles: sql<number>`(select count(*) from ${helpArticles} a where a.category_id = ${sql.raw('"help_categories"."id"')})`,
        })
        .from(helpCategories)
        .where(eq(helpCategories.accountId, accountId))
        .orderBy(asc(helpCategories.position), asc(helpCategories.createdAt));
      return rows.map((r) => ({ ...r, articles: Number(r.articles) }));
    },

    async createCategory(accountId: string, name: string) {
      const [max] = await db
        .select({ p: sql<number>`coalesce(max(${helpCategories.position}), -1)` })
        .from(helpCategories)
        .where(eq(helpCategories.accountId, accountId));
      const [row] = await db
        .insert(helpCategories)
        .values({ id: newId.helpCategory(), accountId, name, position: Number(max?.p ?? -1) + 1 })
        .returning();
      return { id: row!.id, name: row!.name, position: row!.position, articles: 0 } satisfies HelpCategory;
    },

    async updateCategory(accountId: string, id: string, patch: { name?: string; position?: number }) {
      const [row] = await db
        .update(helpCategories)
        .set(patch)
        .where(and(eq(helpCategories.id, id), eq(helpCategories.accountId, accountId)))
        .returning();
      return row ?? null;
    },

    /** Its articles stay, without a category. */
    async deleteCategory(accountId: string, id: string) {
      return db.transaction(async (tx) => {
        await tx
          .update(helpArticles)
          .set({ categoryId: null })
          .where(and(eq(helpArticles.categoryId, id), eq(helpArticles.accountId, accountId)));
        const [row] = await tx
          .delete(helpCategories)
          .where(and(eq(helpCategories.id, id), eq(helpCategories.accountId, accountId)))
          .returning();
        return !!row;
      });
    },

    // ------------------------------------------------------------ articles (agents)
    async list(accountId: string) {
      const rows = await db
        .select()
        .from(helpArticles)
        .where(eq(helpArticles.accountId, accountId))
        .orderBy(desc(helpArticles.updatedAt))
        .limit(1000);
      return summaries(rows);
    },

    async get(accountId: string, id: string) {
      const [row] = await db.select().from(helpArticles).where(and(eq(helpArticles.id, id), eq(helpArticles.accountId, accountId)));
      return row ? full(row) : null;
    },

    async create(accountId: string, userId: string, a: { title: string; body: string; categoryId: string | null; status: 'draft' | 'published' }) {
      for (let attempt = 0; ; attempt++) {
        try {
          const [row] = await db
            .insert(helpArticles)
            .values({
              id: newId.helpArticle(),
              accountId,
              ...a,
              slug: await freeSlug(accountId, a.title),
              createdBy: userId,
              updatedBy: userId,
              publishedAt: a.status === 'published' ? new Date() : null,
            })
            .returning();
          return full(row!);
        } catch (err) {
          if (attempt < 3 && isUniqueViolation(err)) continue; // two articles with the same title at once
          throw err;
        }
      }
    },

    async update(
      accountId: string,
      id: string,
      userId: string,
      patch: { title?: string; body?: string; categoryId?: string | null; status?: 'draft' | 'published' },
    ) {
      const [cur] = await db.select().from(helpArticles).where(and(eq(helpArticles.id, id), eq(helpArticles.accountId, accountId)));
      if (!cur) return null;
      const set: Partial<typeof helpArticles.$inferInsert> = { ...patch, updatedBy: userId, updatedAt: new Date() };
      // The address follows the title until the article is first published; after that, links must keep working.
      if (patch.title && patch.title !== cur.title && !cur.publishedAt) set.slug = await freeSlug(accountId, patch.title, id);
      if (patch.status === 'published' && !cur.publishedAt) set.publishedAt = new Date();
      const [row] = await db.update(helpArticles).set(set).where(eq(helpArticles.id, id)).returning();
      return full(row!);
    },

    async remove(accountId: string, id: string) {
      const [row] = await db
        .delete(helpArticles)
        .where(and(eq(helpArticles.id, id), eq(helpArticles.accountId, accountId)))
        .returning({ id: helpArticles.id });
      return !!row;
    },

    async publishedCount(accountId: string) {
      const [r] = await db.select({ n: sql<number>`count(*)` }).from(helpArticles).where(published(accountId));
      return Number(r?.n ?? 0);
    },

    // ------------------------------------------------------------ public (customers)
    async center(accountId: string, account: { name: string; color: string | null }): Promise<PublicHelpCenter> {
      const [cats, rows] = await Promise.all([
        db.select().from(helpCategories).where(eq(helpCategories.accountId, accountId)).orderBy(asc(helpCategories.position), asc(helpCategories.createdAt)),
        db.select().from(helpArticles).where(published(accountId)).orderBy(asc(helpArticles.title)),
      ]);
      const names = new Map(cats.map((c) => [c.id, c.name]));
      const groups = [...cats.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: cats.length ? 'More articles' : 'Articles' }]
        .map((g) => ({ ...g, articles: rows.filter((r) => (r.categoryId ?? null) === g.id).map((r) => publicSummary(r, names)) }))
        .filter((g) => g.articles.length);
      const popular = [...rows]
        .sort((a, b) => b.views - a.views)
        .slice(0, 5)
        .map((r) => publicSummary(r, names));
      return { accountName: account.name, color: account.color, categories: groups, popular };
    },

    /** Words anywhere in the title or text; title matches first. Empty query: the most read. */
    async search(accountId: string, q: string, limit = 8): Promise<PublicHelpArticleSummary[]> {
      const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
      const names = await categoryNames(accountId);
      if (!words.length) {
        const rows = await db.select().from(helpArticles).where(published(accountId)).orderBy(desc(helpArticles.views), asc(helpArticles.title)).limit(limit);
        return rows.map((r) => publicSummary(r, names));
      }
      // Every word must appear (title or body); rank by how many words are in the title, then reads.
      const all = words.map((w) => sql`(${helpArticles.title} ilike ${likePattern(w)} or ${helpArticles.body} ilike ${likePattern(w)})`);
      const inTitle = sql.join(
        words.map((w) => sql`(case when ${helpArticles.title} ilike ${likePattern(w)} then 1 else 0 end)`),
        sql` + `,
      );
      const rows = await db
        .select()
        .from(helpArticles)
        .where(and(published(accountId), ...all))
        .orderBy(desc(inTitle), desc(helpArticles.views))
        .limit(limit);
      return rows.map((r) => publicSummary(r, names));
    },

    async article(accountId: string, slug: string): Promise<PublicHelpArticle | null> {
      const [row] = await db.select().from(helpArticles).where(and(published(accountId), eq(helpArticles.slug, slug)));
      if (!row) return null;
      const names = await categoryNames(accountId);
      const related = row.categoryId
        ? await db
            .select()
            .from(helpArticles)
            .where(and(published(accountId), eq(helpArticles.categoryId, row.categoryId), sql`${helpArticles.id} <> ${row.id}`))
            .orderBy(desc(helpArticles.views))
            .limit(5)
        : [];
      return {
        slug: row.slug,
        title: row.title,
        body: row.body,
        categoryName: (row.categoryId && names.get(row.categoryId)) || null,
        updatedAt: row.updatedAt.getTime(),
        related: related.map((r) => publicSummary(r, names)),
      };
    },

    async countView(accountId: string, slug: string) {
      await db.update(helpArticles).set({ views: sql`${helpArticles.views} + 1` }).where(and(published(accountId), eq(helpArticles.slug, slug)));
    },

    async feedback(accountId: string, slug: string, helpful: boolean) {
      const [row] = await db
        .update(helpArticles)
        .set(helpful ? { helpful: sql`${helpArticles.helpful} + 1` } : { notHelpful: sql`${helpArticles.notHelpful} + 1` })
        .where(and(published(accountId), eq(helpArticles.slug, slug)))
        .returning({ id: helpArticles.id });
      return !!row;
    },
  };
}
export type HelpService = ReturnType<typeof createHelpService>;
