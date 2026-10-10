import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 5000;

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const widgetSessionSchema = z.object({
  accountId: z.string().min(1),
  visitorToken: z.string().optional(),
  newSession: z.boolean().default(false),
  timezone: z.string().max(64).optional(),
});

export const pageSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(512),
  referrer: z.string().max(2048).nullish(),
});

export const chatStartSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.union([z.email(), z.literal('')]).optional(),
  department: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  clientId: z.string().min(1).max(64),
});

export const messageSendSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  clientId: z.string().min(1).max(64),
  internal: z.boolean().optional(),
});

export const visitorPatchSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  email: z.union([z.email(), z.literal('')]).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});

export const chatInitiateSchema = z.object({
  visitorId: z.string().min(1),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  clientId: z.string().min(1).max(64),
});

export const chatTransferSchema = z
  .object({
    conversationId: z.string().min(1),
    toAgentId: z.string().min(1).optional(),
    department: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((t) => !!t.toAgentId !== !!t.department, 'Pick an agent or a department');

export const widgetSettingsSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a color like #2F5BEA')
    .transform((c) => c.toUpperCase())
    .nullable(),
  position: z.enum(['right', 'left']),
  greeting: z.string().trim().min(1, 'Add a greeting').max(300),
  offlineGreeting: z.string().trim().min(1, 'Add a message').max(300),
  departments: z
    .array(z.string().trim().min(1).max(60))
    .max(20, 'Up to 20 departments')
    .refine((d) => new Set(d.map((x) => x.toLowerCase())).size === d.length, 'Each department needs a different name'),
  emailField: z.enum(['optional', 'required', 'hidden']),
  ratings: z.boolean(),
});

export const chatRateSchema = z.object({
  conversationId: z.string().min(1),
  rating: z.enum(['good', 'bad']),
  comment: z.string().trim().max(1000).optional(),
});

export const reportQuerySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Use 7, 30 or 90').default(7),
  tz: z.string().max(64).default('UTC'),
});

export const MIN_PASSWORD_LENGTH = 10;
const password = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(200);

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(['admin', 'agent']).default('agent'),
  maxChats: z.number().int().min(1).max(20).default(4),
  password,
});

export const teamUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['admin', 'agent']).optional(),
  maxChats: z.number().int().min(1).max(20).optional(),
});

export const passwordResetSchema = z.object({ password });

/** Shortcut names are typed after "/", so keep them simple: lowercase, digits, - and _. */
export const SHORTCUT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const shortcutSchema = z.object({
  name: z
    .string()
    .trim()
    .transform((s) => s.toLowerCase().replace(/^\//, '').replace(/\s+/g, '-'))
    .pipe(z.string().regex(SHORTCUT_NAME_PATTERN, 'Use letters, numbers, - or _ (max 40)')),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]),
});

export const offlineMessageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  department: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  pageUrl: z.string().max(2048).optional(),
});

export const offlineStatusSchema = z.object({ status: z.enum(['new', 'handled']) });

export const historyQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  agentId: z.string().max(64).optional(),
  status: z.enum(['all', 'open', 'ended']).default('all'),
  rating: z.enum(['good', 'bad', 'any']).optional(),
  /** Only chats started in the last N days. */
  days: z.coerce.number().int().min(1).max(3650).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
