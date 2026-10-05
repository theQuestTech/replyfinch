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
