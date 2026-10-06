import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('a new chat appears in the Home live queue; Accept + typing joins it', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Sofia ${uid()}`;
  const visitor = await openStore(browser, 'checkout.html');
  await startChat(visitor, name, 'My order #4821 never arrived');

  // Appears instantly with the visitor's message and a reply countdown.
  const row = agent.getByTestId('queue-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('My order #4821 never arrived');
  await expect(row).toContainText(/Reply in/);

  // Accept opens the side window in "viewing" mode — the visitor sees nothing yet.
  await row.getByRole('button', { name: 'Accept' }).click();
  const side = agent.getByTestId('chat-window-side');
  await expect(side.getByTestId('join-prompt')).toBeVisible();
  await expect(side.getByTestId('transcript')).toContainText('My order #4821 never arrived');
  await expect(widget(visitor).locator('.system')).toHaveCount(0);

  // Pressing any key starts typing; sending joins the chat.
  await agent.keyboard.type('Hi! Let me check that for you.');
  await agent.keyboard.press('Enter');
  await expect(widget(visitor).locator('.system', { hasText: 'Maya Chen joined the chat' })).toBeVisible();
  await expect(widget(visitor).locator('.msg.agent', { hasText: 'Let me check that for you' })).toBeVisible();

  // Joined chats leave the queue.
  await agent.keyboard.press('Escape');
  await expect(row).toHaveCount(0);
});
