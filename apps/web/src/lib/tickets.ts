import { useQuery } from '@tanstack/react-query';
import type { TicketCounts, TicketPriority, TicketStatus } from '@replyfinch/shared';
import { api } from './api';

export const STATUS: Record<TicketStatus, { label: string; tone: 'danger' | 'primary' | 'warning' | 'muted' | 'success'; hint: string }> = {
  open: { label: 'Open', tone: 'danger', hint: 'Waiting on your team' },
  pending: { label: 'Pending', tone: 'primary', hint: 'Waiting on the customer' },
  solved: { label: 'Solved', tone: 'success', hint: 'Done' },
};

export const PRIORITY: Record<TicketPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'text-ink-2' },
  normal: { label: 'Normal', className: 'text-ink' },
  high: { label: 'High', className: 'font-semibold text-warning' },
  urgent: { label: 'Urgent', className: 'font-bold text-danger' },
};

export function useTicketCounts() {
  return useQuery({ queryKey: ['tickets', 'counts'], queryFn: () => api<TicketCounts>('/tickets/counts') });
}
