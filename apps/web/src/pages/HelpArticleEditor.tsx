import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bold, ExternalLink, Heading2, Italic, Link2, List, ListOrdered, Trash2 } from 'lucide-react';
import type { HelpArticle } from '@replyfinch/shared';
import { renderMarkdown } from '@replyfinch/shared/markdown';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { queryClient } from '../lib/query';
import { dateTime } from '../lib/format';
import { Button, Card, Pill, SectionLabel, inputClass } from '../components/ui';
import { publicHelpUrl, useHelpCategories } from './HelpCenter';

type Draft = { title: string; body: string; categoryId: string | null };

export function HelpArticleEditor() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { data, isError } = useQuery({
    queryKey: ['help', 'article', id],
    queryFn: () => api<HelpArticle>(`/help/articles/${id}`),
    enabled: !isNew,
    // Views and votes change while nobody is looking: always fetch fresh numbers when opened.
    refetchOnMount: 'always',
  });
  if (isError) return <div className="p-10 text-center text-sm text-danger">Couldn’t load this article.</div>;
  if (!isNew && !data) return <div className="p-10 text-sm text-ink-2">Loading…</div>;
  // Keyed so switching articles starts from that article's saved text.
  return <Editor key={data?.id ?? 'new'} article={data ?? null} />;
}

function Editor({ article }: { article: HelpArticle | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const accountId = useAuth((s) => s.agent?.accountId ?? '');
  const { data: categories = [] } = useHelpCategories();
  const saved: Draft = article
    ? { title: article.title, body: article.body, categoryId: article.categoryId }
    : { title: '', body: '', categoryId: params.get('c') };
  const [draft, setDraft] = useState<Draft>(saved);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A brand-new article moves to its own address after the first save; the message comes along.
  const [notice, setNotice] = useState<string | null>((useLocation().state as { notice?: string } | null)?.notice ?? null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft.title !== saved.title || draft.body !== saved.body || draft.categoryId !== saved.categoryId;
  const published = article?.status === 'published';

  // Don't lose writing to an accidental tab close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async (status?: 'draft' | 'published') => {
    if (!draft.title.trim()) return setError('Add a title');
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = JSON.stringify({ ...draft, title: draft.title.trim(), ...(status ? { status } : {}) });
      const res = article
        ? await api<HelpArticle>(`/help/articles/${article.id}`, { method: 'PATCH', body })
        : await api<HelpArticle>('/help/articles', { method: 'POST', body });
      queryClient.setQueryData(['help', 'article', res.id], res);
      void queryClient.invalidateQueries({ queryKey: ['help'] });
      const msg = status === 'published' && !published ? 'Published — it’s live on your help site.' : status === 'draft' && published ? 'Unpublished.' : 'Saved.';
      setNotice(msg);
      if (!article) navigate(`/help-center/articles/${res.id}`, { replace: true, state: { notice: msg } });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? e.message : 'Couldn’t save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!article || !window.confirm(`Delete “${article.title}”? This can’t be undone.`)) return;
    await api(`/help/articles/${article.id}`, { method: 'DELETE' });
    void queryClient.invalidateQueries({ queryKey: ['help'] });
    navigate('/help-center');
  };

  /** Wrap the selection in Markdown (or insert a sample); list and heading marks go at the start of each line. */
  const format = (before: string, after = '', sample = 'text', linePrefix = false) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    let next: string;
    let selStart: number;
    let selEnd: number;
    if (linePrefix) {
      const start = value.lastIndexOf('\n', a - 1) + 1;
      const endAt = value.indexOf('\n', b);
      const end = endAt === -1 ? value.length : endAt;
      const block = value.slice(start, end).trim() ? value.slice(start, end) : sample;
      const prefixed = block
        .split('\n')
        .map((l) => before + l)
        .join('\n');
      next = value.slice(0, start) + prefixed + value.slice(end);
      selStart = start;
      selEnd = start + prefixed.length;
    } else {
      const sel = value.slice(a, b) || sample;
      next = value.slice(0, a) + before + sel + after + value.slice(b);
      selStart = a + before.length;
      selEnd = selStart + sel.length;
    }
    setDraft((d) => ({ ...d, body: next }));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const html = useMemo(() => (tab === 'preview' ? renderMarkdown(draft.body) : ''), [tab, draft.body]);
  const votes = (article?.helpful ?? 0) + (article?.notHelpful ?? 0);

  return (
    <div className="flex min-h-full flex-col gap-4 px-8 py-6" data-testid="article-editor">
      <Link to="/help-center" className="flex w-fit items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Help center
      </Link>

      <div className="flex items-start gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <input
            aria-label="Title"
            value={draft.title}
            maxLength={200}
            autoFocus={!article}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Article title, e.g. How long does delivery take?"
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[24px] font-bold outline-none placeholder:text-ink-2/60 hover:border-line focus:border-primary focus:bg-surface"
          />
          <Card className="flex flex-col">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
              {(['write', 'preview'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={clsx('cursor-pointer rounded-md px-3 py-1 text-[13px] font-semibold capitalize', tab === t ? 'bg-muted text-ink' : 'text-ink-2 hover:bg-muted')}
                >
                  {t}
                </button>
              ))}
              {tab === 'write' && (
                <div className="ml-3 flex items-center gap-0.5 border-l border-line pl-3 text-ink-2">
                  <Tool label="Heading" onClick={() => format('## ', '', 'Heading', true)} icon={Heading2} />
                  <Tool label="Bold" onClick={() => format('**', '**')} icon={Bold} />
                  <Tool label="Italic" onClick={() => format('*', '*')} icon={Italic} />
                  <Tool label="Link" onClick={() => format('[', '](https://)', 'link text')} icon={Link2} />
                  <Tool label="Bulleted list" onClick={() => format('- ', '', 'Item', true)} icon={List} />
                  <Tool label="Numbered list" onClick={() => format('1. ', '', 'Step', true)} icon={ListOrdered} />
                </div>
              )}
            </div>
            {tab === 'write' ? (
              <textarea
                ref={bodyRef}
                aria-label="Article text"
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={22}
                placeholder={'Write the answer here.\n\n## A heading\nShort paragraphs work best.\n\n- A list item\n- Another one\n\n**Bold**, *italic* and [links](https://example.com) work too.'}
                className="min-h-[420px] w-full resize-y bg-surface px-5 py-4 font-mono text-[13px] leading-relaxed outline-none placeholder:text-ink-2/70"
              />
            ) : (
              <div className="min-h-[420px] px-6 py-5">
                <h1 className="mb-4 text-2xl font-bold">{draft.title || 'Untitled'}</h1>
                {draft.body.trim() ? (
                  <div className="article-body" data-testid="article-preview" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <p className="text-sm text-ink-2">Nothing written yet.</p>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="flex w-[280px] shrink-0 flex-col gap-4 pt-14">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <SectionLabel>Status</SectionLabel>
              {published ? <Pill tone="success">Published</Pill> : <Pill>{article ? 'Draft' : 'New'}</Pill>}
              {dirty && <span className="ml-auto text-xs text-warning">Unsaved changes</span>}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-2">Category</span>
              <select
                aria-label="Category"
                className={clsx(inputClass, 'h-9 cursor-pointer')}
                value={draft.categoryId ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value || null }))}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {published ? (
              <div className="flex flex-col gap-2">
                <Button variant="primary" disabled={busy || !dirty} onClick={() => save()}>
                  {busy ? 'Saving…' : 'Update'}
                </Button>
                <Button disabled={busy} onClick={() => save('draft')}>
                  Unpublish
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="primary" disabled={busy} onClick={() => save('published')}>
                  {busy ? 'Saving…' : 'Publish'}
                </Button>
                <Button disabled={busy || (!!article && !dirty)} onClick={() => save('draft')}>
                  Save draft
                </Button>
              </div>
            )}
            {error && (
              <span role="alert" className="text-xs font-medium text-danger">
                {error}
              </span>
            )}
            {notice && !error && (
              <span role="status" className="text-xs font-medium text-success">
                {notice}
              </span>
            )}
          </Card>

          {article && (
            <Card className="flex flex-col gap-1.5 p-5 text-xs text-ink-2">
              <SectionLabel>Details</SectionLabel>
              {published && accountId && (
                <a href={publicHelpUrl(accountId, article.slug)} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-primary hover:underline">
                  <ExternalLink className="size-3.5" /> View on your help site
                </a>
              )}
              <div>
                {article.views.toLocaleString()} view{article.views === 1 ? '' : 's'}
                {votes > 0 && ` · ${Math.round((article.helpful / votes) * 100)}% found it helpful (${votes} vote${votes === 1 ? '' : 's'})`}
              </div>
              <div>
                Updated {dateTime(article.updatedAt)}
                {article.updatedByName ? ` by ${article.updatedByName}` : ''}
              </div>
              {article.publishedAt && <div>First published {dateTime(article.publishedAt)}</div>}
              <button onClick={remove} className="mt-2 flex w-fit cursor-pointer items-center gap-1 font-medium text-danger hover:underline">
                <Trash2 className="size-3.5" /> Delete article
              </button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Tool({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: typeof Bold }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="cursor-pointer rounded p-1.5 hover:bg-muted hover:text-ink">
      <Icon className="size-4" />
    </button>
  );
}
