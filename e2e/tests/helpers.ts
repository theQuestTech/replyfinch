import { expect, type Browser, type Page } from '@playwright/test';

export const AGENT_URL = 'http://localhost:5173';
export const STORE_URL = 'http://localhost:5174';

/** A short random suffix so each test's visitors are easy to find. */
export const uid = () => Math.random().toString(36).slice(2, 7);

export async function loginAgent(browser: Browser, email = 'maya@replyfinch.dev'): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${AGENT_URL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('replyfinch');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  return page;
}

/** A visitor on the demo store; each call is a separate browser (separate visitor). */
export async function openStore(browser: Browser, path = ''): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${STORE_URL}/${path}`);
  await expect(page.locator('#replyfinch-widget button.launcher')).toBeVisible();
  return page;
}

export function widget(page: Page) {
  return page.locator('#replyfinch-widget');
}

export async function startChat(page: Page, name: string, message: string, department = 'Orders & shipping') {
  const w = widget(page);
  await w.locator('button.launcher').click();
  await w.locator('input[name=name]').fill(name);
  await w.locator('select[name=department]').selectOption(department);
  await w.locator('textarea[name=message]').fill(message);
  await w.getByRole('button', { name: 'Start chat' }).click();
  await expect(w.locator('.msg.bot')).toBeVisible();
}

export async function visitorSays(page: Page, text: string) {
  const box = widget(page).getByLabel('Message');
  await box.fill(text);
  await box.press('Enter');
}
