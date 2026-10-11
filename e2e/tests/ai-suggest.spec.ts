import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, startChat, uid, widget } from './helpers';

test('AI suggest (free mode) drafts the best saved reply; the agent edits and sends it', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Ola ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'When will my order be delivered? Is there tracking?');
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();

  const win = agent.getByTestId('chat-window-side');
  await win.getByRole('button', { name: 'AI suggest' }).click();
  const box = win.getByRole('textbox', { name: 'Message' });
  await expect(box).toHaveValue(/Orders usually ship/);
  await expect(win.getByTestId('ai-note')).toContainText('/shipping');
  // Nothing was sent yet: the agent reviews first.
  await expect(widget(visitor).locator('.msg.agent')).toHaveCount(0);
  await box.press('Enter');
  await expect(widget(visitor).locator('.msg.agent', { hasText: 'Orders usually ship' })).toBeVisible();
  await expect(win.getByTestId('ai-note')).toHaveCount(0);

  // Settings → AI assistant explains free mode and keeps the business info.
  await agent.keyboard.press('Escape');
  await agent.goto(`${AGENT_URL}/settings/ai`);
  await expect(agent.getByTestId('ai-status')).toContainText('Free mode');
  await agent.getByLabel('Business information for the AI').fill(`We ship across Europe in 3–5 days. (${name})`);
  await agent.getByRole('button', { name: 'Save' }).click();
  await expect(agent.getByText('Saved', { exact: true })).toBeVisible();
  await agent.reload();
  await expect(agent.getByLabel('Business information for the AI')).toHaveValue(`We ship across Europe in 3–5 days. (${name})`);
});
