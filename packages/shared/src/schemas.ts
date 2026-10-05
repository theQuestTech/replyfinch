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
