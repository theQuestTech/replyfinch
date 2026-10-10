import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('visitor pops the chat out into its own window and keeps chatting', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Omar ${uid()}`;
  const visitor = await openStore(browser, 'checkout.html');
  await startChat(visitor, name, 'Is express shipping available?');

  // Pop out.
  const [popup] = await Promise.all([
    visitor.context().waitForEvent('page'),
    widget(visitor).getByRole('button', { name: 'Open chat in a new window' }).click(),
  ]);
  await popup.waitForLoadState();
  const pw = popup.locator('#replyfinch-widget');
  await expect(pw.locator('.msg.visitor', { hasText: 'Is express shipping available?' })).toBeVisible();
  await expect(popup).not.toHaveURL(/#t=/); // token removed from the address bar
  await expect(widget(visitor).getByText('Your chat is open in a separate window')).toBeVisible();

  // The agent replies — it shows in the pop-out; the visitor answers from the pop-out.
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('Yes — next-day delivery.');
  await agent.keyboard.press('Enter');
  await expect(pw.locator('.msg.agent', { hasText: 'next-day delivery' })).toBeVisible();
  await pw.getByLabel('Message').fill('Perfect, thanks!');
  await pw.getByLabel('Message').press('Enter');
  await expect(agent.getByTestId('transcript')).toContainText('Perfect, thanks!');

  // The pop-out isn't a website page: the visitor's current page stays "Checkout".
  await agent.keyboard.press('Escape');
  await agent.getByRole('link', { name: 'Visitors' }).click();
  await expect(agent.getByTestId('visitor-row').filter({ hasText: name })).toContainText('Checkout — Shipping details');

  // Closing the pop-out brings the chat back into the page.
  await popup.close();
  await expect(widget(visitor).locator('.msg.visitor', { hasText: 'Perfect, thanks!' })).toBeVisible();
});
