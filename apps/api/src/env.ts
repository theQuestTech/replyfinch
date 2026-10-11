import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://replyfinch:replyfinch@localhost:5432/replyfinch'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  // Email through Resend (optional). Without these, email features stay hidden.
  RESEND_API_KEY: z.string().trim().optional(),
  /** e.g. "Quest Tech <support@quscer.com>" — the domain must be verified in Resend. */
  EMAIL_FROM: z.string().trim().optional(),
  /** Where customers' replies go; defaults to EMAIL_FROM. Must be a real mailbox. */
  EMAIL_REPLY_TO: z.string().trim().optional(),
  /** Development/tests only: "log" keeps emails in memory (GET /dev/outbox) instead of sending them. */
  EMAIL_TRANSPORT: z.enum(['resend', 'log']).default('resend'),
  // Receiving email (optional): customers' replies to ticket emails come back into the ticket.
  /** The domain Resend receives mail for, e.g. "abc123.resend.app" (Resend → Receiving) or a subdomain with Resend's MX record. */
  INBOUND_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => d.replace(/^.*@/, '').replace(/^\.+|\.+$/g, ''))
    .optional(),
  /** The signing secret ("whsec_…") of the Resend webhook for received emails. */
  RESEND_WEBHOOK_SECRET: z.string().trim().optional(),
  // AI suggest (optional). Without a key, AI suggest uses free mode (best matching saved reply).
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  AI_MODEL: z.string().trim().default('claude-haiku-5-5'),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === 'dev-only-secret-change-me-please') {
  throw new Error('JWT_SECRET must be set in production');
}

export const env = {
  ...parsed,
  corsOrigins: parseOrigins(parsed.CORS_ORIGINS),
};
export type Env = typeof env;

/**
 * Accepts forgiving input from a hosting dashboard: commas or spaces between entries,
 * surrounding quotes, trailing slashes or paths ("https://app.example.com/login").
 */
export function parseOrigins(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s.includes('://') ? s : `https://${s}`).origin;
      } catch {
        return s.replace(/\/+$/, '');
      }
    });
}
