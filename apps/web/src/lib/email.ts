import { useQuery } from '@tanstack/react-query';
import type { EmailStatus } from '@replyfinch/shared';
import { api } from './api';

/** Whether the server can send email (Resend is set up on Railway). */
export function useEmailStatus() {
  return useQuery({ queryKey: ['email-status'], queryFn: () => api<EmailStatus>('/settings/email'), staleTime: 60_000 });
}
