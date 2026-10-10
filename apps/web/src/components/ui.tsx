import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { AgentStatus, VisitorState } from '@replyfinch/shared';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'muted' | 'gold';

const toneBg: Record<Tone, string> = {
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  muted: 'bg-muted text-ink-2',
  gold: 'bg-gold text-navy',
};

export function Avatar({ text, size = 36, tone = 'primary', className }: { text: string; size?: number; tone?: Tone; className?: string }) {
  return (
    <span
      className={clsx('inline-grid shrink-0 place-items-center rounded-full font-semibold', toneBg[tone], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {text}
    </span>
  );
}

export function Pill({ children, tone = 'muted', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', toneBg[tone], className)}>
      {children}
    </span>
  );
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-default disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary/90',
        variant === 'success' && 'bg-success text-white hover:bg-success/90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-muted',
        variant === 'danger' && 'border border-danger bg-surface text-danger hover:bg-danger-subtle',
        variant === 'ghost' && 'text-ink-2 hover:bg-muted',
        className,
      )}
    />
  );
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid size-8 cursor-pointer place-items-center rounded-lg border border-line text-ink-2 hover:bg-muted hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 👍 Good / 👎 Bad, as the visitor rated a chat. */
export function RatingPill({ rating }: { rating: 'good' | 'bad' | null }) {
  if (!rating) return null;
  return (
    <Pill tone={rating === 'good' ? 'success' : 'danger'}>
      {rating === 'good' ? '👍 Good' : '👎 Bad'}
    </Pill>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-muted px-1.5 py-px font-sans text-[10px] font-semibold text-ink-2">{children}</kbd>;
}

export function CountryCode({ code }: { code: string | null }) {
  if (!code) return null;
  return <span className="rounded-[3px] bg-muted px-1 text-[9px] font-bold text-ink-2">{code}</span>;
}

const statusColor: Record<AgentStatus, string> = { online: 'bg-success', away: 'bg-away', offline: 'bg-offline' };
export function StatusDot({ status, ring = 'ring-surface', className }: { status: AgentStatus; ring?: string; className?: string }) {
  return <span className={clsx('inline-block size-2.5 rounded-full ring-2', statusColor[status], ring, className)} />;
}

export const stateTone: Record<VisitorState, Tone> = { chatting: 'success', browsing: 'primary', idle: 'muted' };

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('overflow-hidden rounded-xl border border-line bg-surface', className)}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  // Hint and error sit outside <label> so the field's accessible name is just the label.
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        {children}
      </label>
      {hint && !error && <span className="text-xs text-ink-2">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-2 focus:border-primary focus:ring-2 focus:ring-primary-subtle disabled:bg-muted';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div role="dialog" aria-label={title} className="w-full max-w-lg rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-center border-b border-line px-6 py-4">
          <h2 className="flex-1 text-base font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md px-2 text-xl leading-none text-ink-2 hover:bg-muted">
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
