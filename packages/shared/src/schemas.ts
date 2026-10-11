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

/** Only web addresses: they're shown to agents as links. */
const webUrl = z.string().max(2048).regex(/^https?:\/\//i);

export const pageSchema = z.object({
  url: webUrl,
  title: z.string().max(512),
  referrer: z.string().max(2048).nullish(),
});

/** Lenient: digits, spaces, +, -, (, ), . — 6 to 30 characters. */
export const PHONE_PATTERN = /^\+?[0-9 ().-]{6,30}$/;
const phone = z.union([z.string().trim().regex(PHONE_PATTERN, 'Please check the phone number'), z.literal('')]).optional();

export const chatStartSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.union([z.email(), z.literal('')]).optional(),
  phone,
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
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
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
  phoneField: z.enum(['optional', 'required', 'hidden']),
  departmentField: z.enum(['shown', 'hidden']),
  ratings: z.boolean(),
  typingPreview: z.boolean(),
  // Optional: older agent apps (mid-deploy) don't send it.
  helpSearch: z.boolean().default(true),
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

export const customersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(['recent', 'chats', 'name']).default('recent'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const offlineReplySchema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

export const transcriptEmailSchema = z.object({ to: z.email().optional() });

export const transcriptRequestSchema = z.object({ conversationId: z.string().min(1), email: z.email() });

export const aiSettingsSchema = z.object({
  knowledge: z.string().max(8000, 'Keep it under 8,000 characters'),
  monthlyCapUsd: z.number().min(1).max(500),
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
  phone,
  department: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  pageUrl: webUrl.optional(),
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

export const TICKET_STATUSES = ['open', 'pending', 'solved'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(1, 'Add a subject').max(200),
  /** The request in the customer's words, or what the agent knows so far. */
  description: z.string().trim().max(MAX_MESSAGE_LENGTH).default(''),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  assigneeId: z.string().max(64).nullish(),
  /** Who it's for: a known customer, or a name and email typed in. */
  visitorId: z.string().max(64).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.union([z.email(), z.literal('')]).optional(),
  /** Make it from a chat or an offline message (the customer comes from there). */
  from: z.object({ type: z.enum(['chat', 'offline']), id: z.string().min(1).max(64) }).optional(),
});

export const ticketUpdateSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigneeId: z.string().max(64).nullable().optional(),
});

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** true: an agents-only note; false: a reply emailed to the customer. */
  internal: z.boolean().default(false),
  /** Change the status in the same step ("Send and mark pending"). */
  status: z.enum(TICKET_STATUSES).optional(),
});

export const ticketsQuerySchema = z.object({
  view: z.enum(['unsolved', 'mine', 'unassigned', 'open', 'pending', 'solved', 'all']).default('unsolved'),
  q: z.string().trim().max(200).optional(),
  visitorId: z.string().max(64).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const helpCategorySchema = z.object({
  name: z.string().trim().min(1, 'Add a name').max(80),
  position: z.number().int().min(0).max(10_000).optional(),
});

const articleTitle = z.string().trim().min(1, 'Add a title').max(200);
const articleBody = z.string().max(50_000, 'Keep articles under 50,000 characters');
const articleCategory = z.string().max(64).nullable();
const articleStatus = z.enum(['draft', 'published']);

export const helpArticleSchema = z.object({
  title: articleTitle,
  body: articleBody.default(''),
  categoryId: articleCategory.default(null),
  status: articleStatus.default('draft'),
});

/** Only the fields sent change. */
export const helpArticlePatchSchema = z.object({
  title: articleTitle.optional(),
  body: articleBody.optional(),
  categoryId: articleCategory.optional(),
  status: articleStatus.optional(),
});

export const helpSearchSchema = z.object({ q: z.string().trim().max(200).default('') });

export const helpFeedbackSchema = z.object({ helpful: z.boolean() });
