import { QueryClient } from '@tanstack/react-query';

/** Shared so realtime events can refresh cached lists (e.g. the Inbox). */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });
