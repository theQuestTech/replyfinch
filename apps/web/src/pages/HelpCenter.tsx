import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen, Check, Copy, ExternalLink, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import type { HelpArticleSummary, HelpCategory } from '@replyfinch/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { queryClient } from '../lib/query';
import { timeAgo } from '../lib/format';
import { Card, Pill, inputClass } from '../components/ui';

export const useHelpCategories = () => useQuery({ queryKey: ['help', 'categories'], queryFn: () => api<HelpCategory[]>('/help/categories') });

/** The public help site for this account (served by the agent app, no sign-in needed). */
export function publicHelpUrl(accountId: string, slug?: string) {
  return `${window.location.origin}/help/${accountId}${slug ? `/${slug}` : ''}`;
}

const COLS = 'grid-cols-[minmax(240px,1fr)_100px_70px_110px_110px]';

export function HelpCenter() {
  const accountId = useAuth((s) => s.agent?.accountId ?? '');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const category = params.get('c'); // id, 'none', or null for all
  const [q, setQ] = useState('');
  const { data: categories = [] } = useHelpCategories();
  const { data: articles, isLoading, isError } = useQuery({ queryKey: ['help', 'articles'], queryFn: () => api<HelpArticleSummary[]>('/help/articles') });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (articles ?? [])
      .filter((a) => !category || (category === 'none' ? !a.categoryId : a.categoryId === category))
      .filter((a) => !needle || a.title.toLowerCase().includes(needle));
  }, [articles, category, q]);
  const uncategorized = (articles ?? []).filter((a) => !a.categoryId).length;
  const published = (articles ?? []).filter((a) => a.status === 'published').length;
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="flex min-h-full flex-col gap-5 px-8 py-7">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-[26px] font-bold">Help center</h1>
          <p className="text-sm text-ink-2">Answers customers can find on their own — on your help site and in the chat widget.</p>
        </div>
        <Link
          to={`/help-center/articles/new${category && category !== 'none' ? `?c=${category}` : ''}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-primary/90"
        >
          <Plus className="size-4" /> New article
        </Link>
      </div>

      {accountId && <PublicLink url={publicHelpUrl(accountId)} published={published} />}

      <div className="flex items-start gap-5">
        <Card className="flex w-[230px] shrink-0 flex-col p-2">
          <nav aria-label="Categories" className="flex flex-col gap-0.5">
            <CategoryButton label="All articles" count={articles?.length} active={!category} onClick={() => setParams({})} />
            {categories.map((c) => (
              <CategoryRow key={c.id} c={c} active={category === c.id} onSelect={() => setParams({ c: c.id })} onDeleted={() => category === c.id && setParams({})} />
            ))}
            {uncategorized > 0 && categories.length > 0 && (
              <CategoryButton label="No category" count={uncategorized} active={category === 'none'} onClick={() => setParams({ c: 'none' })} />
            )}
          </nav>
          <AddCategory />
        </Card>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="flex h-9 w-[320px] items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-primary">
            <Search className="size-3.5 text-ink-2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles…"
              aria-label="Search articles"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-2"
            />
          </label>
          <Card>
            <div className={clsx('grid gap-3 border-b border-line bg-canvas px-5 py-2.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase', COLS)}>
              <span>Article</span>
              <span>Status</span>
              <span className="text-right">Views</span>
              <span className="text-right">Helpful</span>
              <span className="text-right">Updated</span>
            </div>
            <div data-testid="article-list">
              {isLoading && <div className="p-8 text-center text-sm text-ink-2">Loading…</div>}
              {isError && <div className="p-8 text-center text-sm text-danger">Couldn’t load articles.</div>}
              {articles && shown.length === 0 && (
                <div className="p-10 text-center text-sm text-ink-2">
                  <BookOpen className="mx-auto mb-2 size-7 text-ink-2/60" />
                  {articles.length === 0 ? (
                    <>
                      No articles yet. Start with the questions customers ask most —
                      <br />
                      delivery times, returns, payment, opening hours.
                    </>
                  ) : (
                    'No articles here.'
                  )}
                </div>
              )}
              {shown.map((a) => {
                const votes = a.helpful + a.notHelpful;
                return (
                  <button
                    key={a.id}
                    onClick={() => navigate(`/help-center/articles/${a.id}`)}
                    className={clsx('grid w-full cursor-pointer items-center gap-3 border-b border-line px-5 py-3 text-left text-[13px] last:border-b-0 hover:bg-muted', COLS)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{a.title}</span>
                      <span className="block truncate text-xs text-ink-2">{(a.categoryId && catName.get(a.categoryId)) || 'No category'}</span>
                    </span>
                    <span>{a.status === 'published' ? <Pill tone="success">Published</Pill> : <Pill>Draft</Pill>}</span>
                    <span className="text-right tabular-nums">{a.views.toLocaleString()}</span>
                    <span className="text-right text-xs text-ink-2 tabular-nums" title={`${a.helpful} 👍 · ${a.notHelpful} 👎`}>
                      {votes ? `${Math.round((a.helpful / votes) * 100)}% of ${votes}` : '—'}
                    </span>
                    <span className="text-right text-xs text-ink-2">{timeAgo(a.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PublicLink({ url, published }: { url: string; published: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-[13px]">
      <span className="font-semibold">Your help site</span>
      <code className="min-w-0 truncate rounded bg-muted px-2 py-1 text-xs" data-testid="help-url">
        {url}
      </code>
      <button
        onClick={() => navigator.clipboard?.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="flex cursor-pointer items-center gap-1 font-medium text-ink-2 hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy link'}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-primary hover:underline">
        <ExternalLink className="size-3.5" /> Open
      </a>
      <span className="ml-auto text-xs text-ink-2">
        {published === 0 ? 'Publish an article to put it online.' : `${published} published article${published === 1 ? '' : 's'}. Link to it from your website’s menu or footer.`}
      </span>
    </Card>
  );
}

function CategoryButton({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]',
        active ? 'bg-primary-subtle font-semibold text-primary' : 'text-ink hover:bg-muted',
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-ink-2 tabular-nums">{count}</span>}
    </button>
  );
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ['help'] });

function CategoryRow({ c, active, onSelect, onDeleted }: { c: HelpCategory; active: boolean; onSelect: () => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const rename = useMutation({
    mutationFn: () => api(`/help/categories/${c.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: () => (setEditing(false), refresh()),
  });
  const remove = useMutation({
    mutationFn: () => api(`/help/categories/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => (onDeleted(), refresh()),
  });
  if (editing) {
    return (
      <form
        className="flex items-center gap-1 px-1 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) rename.mutate();
        }}
      >
        <input autoFocus aria-label="Category name" className={clsx(inputClass, 'h-8 text-[13px]')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="submit" aria-label="Save" className="cursor-pointer rounded p-1 text-success hover:bg-muted">
          <Check className="size-4" />
        </button>
        <button type="button" aria-label="Cancel" onClick={() => (setEditing(false), setName(c.name))} className="cursor-pointer rounded p-1 text-ink-2 hover:bg-muted">
          <X className="size-4" />
        </button>
      </form>
    );
  }
  return (
    <div className="group flex items-center">
      <CategoryButton label={c.name} count={c.articles} active={active} onClick={onSelect} />
      <span className="hidden gap-0.5 pr-1 group-focus-within:flex group-hover:flex">
        <button aria-label={`Rename ${c.name}`} onClick={() => setEditing(true)} className="cursor-pointer rounded p-1 text-ink-2 hover:bg-muted hover:text-ink">
          <Pencil className="size-3.5" />
        </button>
        <button
          aria-label={`Delete ${c.name}`}
          onClick={() => {
            if (window.confirm(`Delete the category “${c.name}”? Its ${c.articles} article${c.articles === 1 ? '' : 's'} will be kept, without a category.`)) remove.mutate();
          }}
          className="cursor-pointer rounded p-1 text-ink-2 hover:bg-muted hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

function AddCategory() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api('/help/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: () => {
      setName('');
      setOpen(false);
      void refresh();
    },
  });
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-primary hover:bg-muted">
        <Plus className="size-3.5" /> Add category
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex flex-col gap-1.5 border-t border-line px-1 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) add.mutate();
      }}
    >
      <input autoFocus aria-label="New category name" placeholder="e.g. Shipping" className={clsx(inputClass, 'h-8 text-[13px]')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      {add.isError && <span className="text-xs text-danger">{add.error instanceof ApiError ? add.error.message : 'Couldn’t add it'}</span>}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!name.trim() || add.isPending} className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}
