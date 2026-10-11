import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, uid } from './helpers';

const SITE = 'http://localhost:5175';

test('website: the early-access form becomes a ticket for the team', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  const page = await (await browser.newContext()).newPage();
  await page.goto(SITE);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Talk to your customers');
  await expect(page.locator('#replyfinch-widget button.launcher')).toBeVisible(); // our own chat
  await page.getByRole('link', { name: 'Get early access', exact: true }).first().click();

  await expect(page).toHaveURL(/early-access/);
  await page.getByRole('button', { name: 'Request early access' }).click();
  await expect(page.getByRole('alert')).toHaveText('Please add your name.');
  await page.getByLabel('Your name').fill(`Rosa ${id}`);
  await page.getByLabel('Work email').fill(`rosa-${id}@shop.example`);
  await page.getByRole('textbox', { name: 'Company' }).fill(`Rosa’s Plants ${id}`);
  await page.getByLabel('How many people will answer chats?').selectOption('2-5');
  await page.getByLabel(/Anything we should know/).fill('Lots of questions about plant care.');
  await page.getByRole('button', { name: 'Request early access' }).click();
  await expect(page.getByRole('status')).toContainText(`rosa-${id}@shop.example`);

  await agent.goto(`${AGENT_URL}/tickets`);
  await agent.getByRole('button', { name: /All unsolved/ }).click();
  await agent.getByLabel('Search tickets').fill(`Rosa’s Plants ${id}`);
  await agent.getByTestId('ticket-list').getByRole('button', { name: new RegExp(`Early access: Rosa’s Plants ${id}`) }).click();
  const ticket = agent.getByTestId('ticket-detail');
  await expect(ticket.getByTestId('ticket-customer')).toContainText('Team size: 2-5');
  await expect(ticket).toContainText('From a form on your website');
});

test('website: pages link up, and the contact form becomes a ticket', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  const page = await (await browser.newContext()).newPage();
  await page.goto(SITE);
  for (const [link, heading] of [
    ['Features', 'Everything you need to help customers'],
    ['Pricing', 'Simple: it’s free right now'],
    ['Compare', 'How Replyfinch compares'],
    ['About', 'Customer support that feels human again'],
    ['Contact', 'We’d love to hear from you'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  const form = page.locator('form[data-site-form=contact]');
  await form.getByLabel('Your name').fill(`Ken ${id}`);
  await form.getByLabel('Email').fill(`ken-${id}@example.com`);
  await form.getByLabel('What’s it about?').selectOption('Feature idea');
  await form.getByLabel('Message').fill(`Could you add WhatsApp ${id}?`);
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks — message sent!');

  await agent.goto(`${AGENT_URL}/tickets`);
  await agent.getByLabel('Search tickets').fill(`WhatsApp ${id}`);
  await expect(agent.getByTestId('ticket-list')).toContainText(`Feature idea: Could you add WhatsApp ${id}?`);
});
