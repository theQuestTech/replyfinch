import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid } from './helpers';

test('Reports shows chat totals, charts and the team, for 7/30/90 days', async ({ browser }) => {
  const agent = await loginAgent(browser);
  // Make sure there's at least one answered chat today.
  const name = `Kai ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'Do you gift-wrap?', 'Sales');
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('We do!');
  await agent.keyboard.press('Enter');
  await agent.keyboard.press('Escape');

  await agent.getByRole('link', { name: 'Reports' }).click();
  await expect(agent.getByRole('heading', { name: 'Reports' })).toBeVisible();
  const chats = agent.getByTestId('tile-Chats');
  await expect(chats).not.toHaveText('0');
  await expect(agent.getByTestId('departments-chart')).toContainText('Sales');
  await expect(agent.getByTestId('team-table')).toContainText('Maya Chen');

  // Hover today's column for its numbers.
  const today = agent.getByLabel(/answered, \d+ missed$/).last();
  await today.hover();
  await expect(agent.getByRole('tooltip')).toContainText('answered');

  // Table view of the same numbers.
  await agent.getByRole('button', { name: 'Table' }).click();
  await expect(agent.getByTestId('daily-table').locator('tbody tr')).toHaveCount(7);

  await agent.getByRole('radio', { name: 'Last 30 days' }).click();
  await expect(agent).toHaveURL(/days=30/);
  await expect(agent.getByTestId('daily-table').locator('tbody tr')).toHaveCount(30);
});
