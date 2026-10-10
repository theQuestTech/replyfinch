import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, startChat, uid, widget } from './helpers';

type Sent = { to: string; subject: string; text: string };
const outbox = async (page: import('@playwright/test').Page) =>
  (await (await page.request.get('http://localhost:4000/dev/outbox')).json()) as Sent[];

test('email: settings test email, visitor asks for a transcript, agent emails one from History', async ({ browser }) => {
  const agent = await loginAgent(browser);
  await agent.goto(`${AGENT_URL}/settings/email`);
  await expect(agent.getByTestId('email-status')).toContainText('Email is set up');
  await agent.getByRole('button', { name: 'Send me a test email' }).click();
  await expect(agent.getByText('Sent to maya@replyfinch.dev')).toBeVisible();
  expect((await outbox(agent))[0]).toMatchObject({ to: 'maya@replyfinch.dev', subject: 'Replyfinch email is working' });

  // A chat, ended by the visitor, who asks for a copy.
  await agent.goto(AGENT_URL);
  const id = uid();
  const name = `Ivo ${id}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'Do you have the poetry box set?');
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('We do — 3 left!');
  await agent.keyboard.press('Enter');
  const w = widget(visitor);
  await w.getByRole('button', { name: 'End chat' }).click();
  await w.getByRole('button', { name: /Email me a copy/ }).click();
  await w.getByLabel('Your email').fill(`ivo-${id}@example.com`);
  await w.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(w.getByText(`ivo-${id}@example.com`)).toBeVisible();
  const copy = (await outbox(agent))[0]!;
  expect(copy).toMatchObject({ to: `ivo-${id}@example.com`, subject: 'Your chat with Acme Books' });
  expect(copy.text).toContain('We do — 3 left!');
  await expect(agent.getByTestId('transcript')).toContainText(`Transcript emailed to ivo-${id}@example.com`);

  // The agent sends one from History.
  await agent.keyboard.press('Escape');
  await agent.getByRole('link', { name: 'History' }).click();
  await agent.getByLabel('Search chats').fill(name);
  await agent.getByTestId('history-list').getByRole('button', { name: new RegExp(name) }).click();
  await agent.getByRole('button', { name: 'Email transcript' }).click();
  const dialog = agent.getByRole('dialog', { name: 'Email transcript' });
  await dialog.getByLabel('Send a copy of this chat to').fill(`team-${id}@example.com`);
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(agent.getByRole('status')).toHaveText(`Transcript sent to team-${id}@example.com`);
  expect((await outbox(agent))[0]).toMatchObject({ to: `team-${id}@example.com` });
});
