import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Eye, Globe, House, Link2, Monitor, Smartphone, Tablet, X } from 'lucide-react';
import { api } from '../../lib/api';
import { duration, initials, localTime, referrerHost, visitorLabel } from '../../lib/format';
import type { DeskVisitor } from '../../lib/store';
import { Avatar, SectionLabel } from '../ui';

type Patch = Partial<Pick<DeskVisitor, 'name' | 'email' | 'phone' | 'notes' | 'tags'>>;

export function VisitorInfo({ visitor, width }: { visitor: DeskVisitor; width: number }) {
  const save = (p: Patch) => api(`/visitors/${visitor.id}`, { method: 'PATCH', body: JSON.stringify(p) }).catch(() => {});
  const local = localTime(visitor.timezone);
  const DeviceIcon = visitor.device === 'mobile' ? Smartphone : visitor.device === 'tablet' ? Tablet : Monitor;
  const now = Date.now();

  return (
    <aside className="flex shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4" style={{ width }}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <Avatar text={initials(visitor.name)} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{visitorLabel(visitor)}</div>
            <div className="truncate text-[11px] text-ink-2">
              {[visitor.timezone?.split('/').pop()?.replace(/_/g, ' '), visitor.country, local && `${local} local`].filter(Boolean).join(' · ') ||
                'Location unknown'}
            </div>
          </div>
        </div>
        <Field value={visitor.name} placeholder="Add name" onSave={(name) => save({ name })} />
        <Field value={visitor.email} placeholder="Add email" type="email" onSave={(email) => save({ email })} />
        <Field value={visitor.phone} placeholder="Add phone number" onSave={(phone) => save({ phone })} />
        <Field value={visitor.notes} placeholder="Add visitor notes" multiline onSave={(notes) => save({ notes })} />
      </div>

      <Tags tags={visitor.tags} onChange={(tags) => save({ tags })} />

      <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-line">
        {[
          [String(visitor.visits), 'Visits'],
          [String(visitor.pastChats), 'Chats'],
          [duration(now - visitor.onlineSince), 'On site'],
        ].map(([v, l], i) => (
          <div key={l} className={clsx('px-3 py-2.5', i > 0 && 'border-l border-line')}>
            <div className="text-[17px] font-bold">{v}</div>
            <div className="text-[11px] text-ink-2">{l}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Visitor path</SectionLabel>
        <PathRow icon={Globe} text={visitor.referrer ? `Came from ${referrerHost(visitor.referrer)}` : 'Direct traffic'} />
        {visitor.path.map((p, i) => {
          const last = i === visitor.path.length - 1;
          return <PathRow key={`${p.at}-${i}`} icon={last ? Eye : i === 0 ? House : Link2} text={p.title || p.url} current={last} />;
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Device</SectionLabel>
        <div className="flex items-center gap-2 text-xs">
          <DeviceIcon className="size-3.5 text-ink-2" /> {visitor.browser} · {visitor.os}
        </div>
      </div>
    </aside>
  );
}

function PathRow({ icon: Icon, text, current }: { icon: typeof Eye; text: string; current?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-2 text-xs', current ? 'font-semibold text-primary' : 'text-ink')}>
      <Icon className={clsx('size-3.5 shrink-0', current ? 'text-primary' : 'text-ink-2')} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function Field({
  value,
  placeholder,
  onSave,
  multiline,
  type,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string | null) => void;
  multiline?: boolean;
  type?: string;
}) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    const next = v.trim() || null;
    if (next !== (value ?? null)) onSave(next);
  };
  const cls =
    'w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] outline-none placeholder:text-ink-2 focus:border-primary focus:ring-2 focus:ring-primary-subtle';
  return multiline ? (
    <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} placeholder={placeholder} rows={3} className={clsx(cls, 'resize-none py-2')} />
  ) : (
    <input
      value={v}
      type={type}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      placeholder={placeholder}
      aria-label={placeholder}
      className={clsx(cls, 'h-[34px] font-medium')}
    />
  );
}

function Tags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim().toLowerCase();
    setText('');
    setAdding(false);
    if (t && !tags.includes(t)) onChange([...tags, t]);
  };
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Tags</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1.5 pl-2 text-xs font-medium text-ink-2">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="cursor-pointer">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="w-24 rounded-full border border-primary px-2 py-0.5 text-xs outline-none"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary-subtle"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}
