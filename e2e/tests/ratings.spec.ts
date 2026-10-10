import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('visitor rates the chat when it ends; agents see it in the chat and History', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Nina ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'Is the hardcover in stock?');
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('Yes, ships today!');
  await agent.keyboard.press('Enter');

  const w = widget(visitor);
  await w.getByRole('button', { name: 'End chat' }).click();
  await expect(w.getByText('How was your chat?')).toBeVisible();
  await w.getByRole('button', { name: 'Rate Good' }).click();
  await w.getByLabel('Comment').fill('Fast and friendly');
  await w.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(w.getByText('Thanks for your feedback!')).toBeVisible();
  await expect(w.getByRole('button', { name: 'Start a new chat' })).toBeVisible();

  // The agent sees the rating in the open chat window, as a note only agents see.
  await expect(agent.getByTestId('transcript')).toContainText(`${name} rated the chat 👍 Good`);
  await expect(agent.getByTestId('transcript')).toContainText(`${name} added a comment: “Fast and friendly”`);
  await expect(agent.getByText('👍 Good').first()).toBeVisible();
  await expect(w.getByText('rated the chat')).toHaveCount(0);

  // History: filter by rating and read the comment.
  await agent.keyboard.press('Escape');
  await agent.getByRole('link', { name: 'History' }).click();
  await agent.getByLabel('Rating').selectOption('good');
  await agent.getByLabel('Search chats').fill(name);
  const row = agent.getByTestId('history-list').getByRole('button', { name: new RegExp(name) });
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel('Rated good')).toBeVisible();
  await row.click();
  await expect(agent.getByTestId('rating-comment')).toHaveText('“Fast and friendly”');
  await agent.getByLabel('Rating').selectOption('bad');
  await expect(agent.getByText('No chats match these filters.')).toBeVisible();
});
