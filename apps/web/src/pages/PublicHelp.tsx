import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, MessageCircle, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { PublicHelpArticle, PublicHelpArticleSummary, PublicHelpCenter } from '@replyfinch/shared';
import { renderMarkdown } from '@replyfinch/shared/markdown';
import { API_URL } from '../lib/api';
import { useDebounced } from './Customers';

// The public help site: no sign-in, published articles only.

const WIDGET_URL = import.meta.env.VITE_WIDGET_URL?.replace(/\/$/, '');

class NotFound extends Error {}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/** Dark text on light brand colors, white on dark ones. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#121826' : '#FFFFFF';
}

function useCenter(acc: string) {
  return useQuery({ queryKey: ['public-help', acc], queryFn: () => get<PublicHelpCenter>(`/widget/help/${acc}`), retry: (n, e) => !(e instanceof NotFound) && n < 2 });
}

/** The company's chat widget, so readers who still need help can ask (production only). */
function useChatWidget(acc: string) {
  useEffect(() => {
    if (!WIDGET_URL || document.querySelector('script[data-rf-help]')) return;
    const s = document.createElement('script');
    s.src = `${WIDGET_URL}/widget.js`;
    s.async = true;
    s.dataset.account = acc;
    s.dataset.api = API_URL;
    s.dataset.rfHelp = '1';
    document.body.appendChild(s);
  }, [acc]);
}

function Frame({ center, acc, children }: { center: PublicHelpCenter | undefined; acc: string; children: ReactNode }) {
  useChatWidget(acc);
  const brand = center?.color ?? '#14213D';
  const on = textOn(brand);
  return (
    <div className="min-h-full bg-canvas" data-testid="public-help">
      <header style={{ background: brand, color: on }}>
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-4">
          <Link to={`/help/${acc}`} className="text-[17px] font-bold">
            {center?.accountName ?? '…'}
          </Link>
          <span className="opacity-75">Help center</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 pb-16">{children}</main>
    </div>
  );
}

function SearchBox({ acc, autoFocus }: { acc: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const { data: results, isFetching } = useQuery({
    queryKey: ['public-help', acc, 'search', query],
    queryFn: () => get<PublicHelpArticleSummary[]>(`/widget/help/${acc}/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 1,
  });
  return (
    <div className="relative">
      <label className="flex h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-subtle">
        <Search className="size-5 text-ink-2" />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search for answers…"
          aria-label="Search help articles"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-2"
        />
      </label>
      {query.length > 1 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface" data-testid="help-results">
          {!results && isFetching && <div className="px-4 py-3 text-sm text-ink-2">Searching…</div>}
          {results?.length === 0 && <div className="px-4 py-3 text-sm text-ink-2">No articles match “{query}”. Try other words, or ask us in the chat.</div>}
          {results?.map((r) => <ArticleRow key={r.slug} acc={acc} a={r} />)}
        </div>
      )}
    </div>
  );
}

function ArticleRow({ acc, a, compact }: { acc: string; a: PublicHelpArticleSummary; compact?: boolean }) {
  return (
    <Link to={`/help/${acc}/${a.slug}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-muted">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{a.title}</span>
        {!compact && a.excerpt && <span className="block truncate text-[13px] text-ink-2">{a.excerpt}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-2" />
    </Link>
  );
}

function Missing({ what }: { what: string }) {
  return <div className="py-24 text-center text-ink-2">{what}</div>;
}

export function PublicHelpHome() {
  const { acc = '' } = useParams();
  const { data, error } = useCenter(acc);
  useEffect(() => {
    if (data) document.title = `${data.accountName} Help center`;
  }, [data]);
  if (error instanceof NotFound) return <Missing what="This help center doesn’t exist." />;
  return (
    <Frame center={data} acc={acc}>
      <section className="py-10 text-center">
        <h1 className="mb-5 text-[28px] font-bold">How can we help?</h1>
        <div className="mx-auto max-w-xl text-left">
          <SearchBox acc={acc} autoFocus />
        </div>
      </section>
      {error && !(error instanceof NotFound) && <Missing what="Couldn’t load the help center. Please try again." />}
      {data && data.categories.length === 0 && <Missing what="No articles yet — check back soon." />}
      {data && data.popular.length > 2 && data.categories.length > 1 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Popular articles</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {data.popular.map((a) => (
              <ArticleRow key={a.slug} acc={acc} a={a} compact />
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {data?.categories.map((c) => (
          <section key={c.id ?? 'none'} className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="help-category">
            <h2 className="border-b border-line px-4 py-3 text-base font-bold">{c.name}</h2>
            {c.articles.map((a) => (
              <ArticleRow key={a.slug} acc={acc} a={a} compact />
            ))}
          </section>
        ))}
      </div>
    </Frame>
  );
}

export function PublicHelpArticlePage() {
  const { acc = '', slug = '' } = useParams();
  const { data: center } = useCenter(acc);
  const { data: a, error } = useQuery({
    queryKey: ['public-help', acc, 'article', slug],
    queryFn: () => get<PublicHelpArticle>(`/widget/help/${acc}/articles/${encodeURIComponent(slug)}`),
    retry: (n, e) => !(e instanceof NotFound) && n < 2,
  });
  const html = useMemo(() => (a ? renderMarkdown(a.body) : ''), [a]);
  useEffect(() => {
    if (a) document.title = `${a.title} — ${center?.accountName ?? 'Help center'}`;
    window.scrollTo(0, 0);
  }, [a, center]);

  return (
    <Frame center={center} acc={acc}>
      <div className="py-6">
        <SearchBox acc={acc} />
      </div>
      <Link to={`/help/${acc}`} className="mb-4 flex w-fit items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> All articles
      </Link>
      {error instanceof NotFound && <Missing what="This article isn’t available. It may have been moved or removed." />}
      {a && (
        <article className="rounded-2xl border border-line bg-surface px-6 py-7 md:px-10" data-testid="help-article">
          {a.categoryName && <div className="mb-1 text-[13px] font-semibold text-ink-2">{a.categoryName}</div>}
          <h1 className="mb-1 text-[28px] leading-tight font-bold">{a.title}</h1>
          <div className="mb-6 text-xs text-ink-2">Updated {new Date(a.updatedAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} />
          <Feedback key={a.slug} acc={acc} slug={a.slug} />
        </article>
      )}
      {a && a.related.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Related articles</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {a.related.map((r) => (
              <ArticleRow key={r.slug} acc={acc} a={r} compact />
            ))}
          </div>
        </section>
      )}
    </Frame>
  );
}

function Feedback({ acc, slug }: { acc: string; slug: string }) {
  const [sent, setSent] = useState<boolean | null>(null);
  const vote = (helpful: boolean) => {
    setSent(helpful);
    void fetch(`${API_URL}/widget/help/${acc}/articles/${encodeURIComponent(slug)}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful }),
    }).catch(() => {});
  };
  return (
    <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-5 text-sm" data-testid="help-feedback">
      {sent === null ? (
        <>
          <span className="font-semibold">Was this article helpful?</span>
          <button onClick={() => vote(true)} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-muted">
            <ThumbsUp className="size-4" /> Yes
          </button>
          <button onClick={() => vote(false)} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-muted">
            <ThumbsDown className="size-4" /> No
          </button>
        </>
      ) : (
        <span role="status" className="flex items-center gap-2 text-ink-2">
          {sent ? 'Thanks for letting us know!' : 'Thanks — we’ll work on making this clearer.'}
          {WIDGET_URL && (
            <span className="flex items-center gap-1">
              <MessageCircle className="size-4" /> Still need help? Use the chat button in the corner.
            </span>
          )}
        </span>
      )}
    </div>
  );
}
