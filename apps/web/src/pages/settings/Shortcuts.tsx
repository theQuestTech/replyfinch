import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Shortcut } from '@replyfinch/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fillShortcut, searchShortcuts } from '../../lib/shortcuts';
import { Button, Card, Field, IconButton, inputClass, Kbd, Modal } from '../../components/ui';

export const useShortcuts = () => useQuery({ queryKey: ['shortcuts'], queryFn: () => api<Shortcut[]>('/shortcuts'), staleTime: 60_000 });

export function Shortcuts() {
  const { data = [], isLoading } = useShortcuts();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null);
  const [removing, setRemoving] = useState<Shortcut | null>(null);
  const results = searchShortcuts(data, query);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-bold">Shortcuts</h2>
          <p className="text-sm text-ink-2">
            Saved replies for common questions. In a chat, type <Kbd>/</Kbd> and start typing a name or any word from the reply.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Add shortcut
        </Button>
      </div>

      <label className="flex h-10 w-80 items-center gap-2 rounded-lg border border-line bg-surface px-3">
        <Search className="size-4 text-ink-2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-2"
        />
      </label>

      <Card>
        {isLoading && <div className="px-5 py-8 text-sm text-ink-2">Loading…</div>}
        {!isLoading && results.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-ink-2">
            {data.length ? 'No shortcuts match your search.' : 'No shortcuts yet — add your first one.'}
          </div>
        )}
        {results.map((s) => (
          <div key={s.id} data-testid="shortcut-row" className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
            <span className="mt-0.5 w-40 shrink-0 font-mono text-sm font-semibold text-primary">/{s.name}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm whitespace-pre-wrap">{s.message}</div>
              {s.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-px text-[11px] font-medium text-ink-2">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <IconButton label={`Edit /${s.name}`} onClick={() => setEditing(s)}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label={`Delete /${s.name}`} onClick={() => setRemoving(s)} className="hover:text-danger">
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          </div>
        ))}
      </Card>

      {editing && <EditShortcut shortcut={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && <DeleteShortcut shortcut={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function EditShortcut({ shortcut, onClose }: { shortcut: Shortcut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const agentName = useAuth((s) => s.agent?.name ?? '');
  const [name, setName] = useState(shortcut?.name ?? '');
  const [message, setMessage] = useState(shortcut?.message ?? '');
  const [tags, setTags] = useState(shortcut?.tags.join(', ') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ name, message, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
    try {
      await api(shortcut ? `/shortcuts/${shortcut.id}` : '/shortcuts', { method: shortcut ? 'PUT' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['shortcuts'] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const insertPlaceholder = (p: string) => setMessage((m) => `${m}${m && !m.endsWith(' ') ? ' ' : ''}${p}`);

  return (
    <Modal title={shortcut ? `Edit /${shortcut.name}` : 'Add shortcut'} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Name" hint="What agents type after /. Letters, numbers, - and _.">
          <div className="flex items-center rounded-lg border border-line focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-subtle">
            <span className="pl-3 font-mono text-sm text-ink-2">/</span>
            <input
              className="h-10 flex-1 bg-transparent px-1 font-mono text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="refund"
              required
              autoFocus
              aria-label="Shortcut name"
            />
          </div>
        </Field>
        <Field label="Message">
          <textarea
            className={`${inputClass} h-auto resize-none py-2`}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            aria-label="Shortcut message"
          />
        </Field>
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
          Insert:
          {['{{visitor.name}}', '{{agent.name}}'].map((p) => (
            <button key={p} type="button" onClick={() => insertPlaceholder(p)} className="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-primary-subtle hover:text-primary">
              {p}
            </button>
          ))}
        </div>
        <Field label="Keywords (optional)" hint="Other words agents might search for, separated by commas — e.g. money, return.">
          <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="money, return" aria-label="Shortcut keywords" />
        </Field>
        {message.trim() && (
          <div className="rounded-lg bg-canvas p-3">
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Preview</div>
            <div className="text-sm whitespace-pre-wrap">{fillShortcut(message, { visitorName: 'Sofia Martínez', agentName })}</div>
          </div>
        )}
        {error && <div className="text-sm font-medium text-danger">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {shortcut ? 'Save' : 'Add shortcut'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteShortcut({ shortcut, onClose }: { shortcut: Shortcut; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Delete /${shortcut.name}?`} onClose={onClose}>
      <p className="text-sm">This removes the shortcut for everyone on your team.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api(`/shortcuts/${shortcut.id}`, { method: 'DELETE' }).catch(() => {});
            await qc.invalidateQueries({ queryKey: ['shortcuts'] });
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}
