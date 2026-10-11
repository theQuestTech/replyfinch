import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('agents see what the visitor is typing before they send it', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Pia ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'Hello!');
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();

  const box = widget(visitor).getByLabel('Message');
  await box.pressSequentially('Do you ship to Norw', { delay: 20 });
  const preview = agent.getByTestId('typing-preview');
  await expect(preview).toContainText('Do you ship to Norw');

  // Sending turns the preview into a real message.
  await box.pressSequentially('ay?', { delay: 20 });
  await box.press('Enter');
  await expect(agent.getByTestId('transcript')).toContainText('Do you ship to Norway?');
  await expect(preview).toHaveCount(0);

  // Clearing the box clears the preview.
  await box.pressSequentially('actually never', { delay: 20 });
  await expect(preview).toContainText('actually never');
  await box.fill('');
  await box.dispatchEvent('input');
  await expect(agent.getByText('actually never')).toHaveCount(0);
});
