import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('ended chats are in History: search by what was said, open the transcript', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const word = `zebra${uid()}`;
  const name = `Hugo ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, `Do you sell ${word} print mugs?`);

  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('Yes, in two sizes!');
  await agent.keyboard.press('Enter');
  await expect(agent.getByTestId('transcript')).toContainText('Yes, in two sizes!');
  // The visitor ends the chat.
  await widget(visitor).getByRole('button', { name: 'End chat' }).click();
  await expect(agent.getByTestId('transcript')).toContainText('Chat ended by');
  await agent.keyboard.press('Escape');

  await agent.getByRole('link', { name: 'History' }).click();
  await expect(agent.getByRole('heading', { name: 'History' })).toBeVisible();
  await agent.getByLabel('Search chats').fill(word);
  const rows = agent.getByTestId('history-list').getByRole('button');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(name);
  await expect(rows.first()).toContainText('Maya Chen');

  await rows.first().click();
  const detail = agent.getByTestId('history-detail');
  await expect(detail).toContainText(name);
  await expect(detail).toContainText('Ended');
  await expect(agent.getByTestId('transcript')).toContainText('Yes, in two sizes!');
  await expect(agent).toHaveURL(/c=cnv_/); // shareable link to this chat

  // Filters: nothing open matches.
  await agent.getByLabel('Status').selectOption('open');
  await expect(agent.getByText('No chats match these filters.')).toBeVisible();
});
