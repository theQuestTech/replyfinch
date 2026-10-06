import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, visitorSays, widget } from './helpers';

test('Visitors page lists live visitors grouped by activity and follows navigation', async ({ browser }) => {
  const agent = await loginAgent(browser);
  await agent.getByRole('link', { name: 'Visitors' }).click();
  await expect(agent.getByRole('heading', { name: 'Visitors' })).toBeVisible();

  const visitor = await openStore(browser, 'pricing.html');
  const name = `Priya ${uid()}`;
  // Find the anonymous visitor by the page they're on, then identify them by starting a chat.
  await startChat(visitor, name, 'Question about annual billing', 'Billing');

  const row = agent.getByTestId('visitor-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Pricing — Plans & billing');
  await expect(row.getByRole('button', { name: /Join chat/ })).toBeVisible();

  // Navigating on the site updates the row live.
  await visitor.getByRole('link', { name: 'Checkout' }).click();
  await expect(row).toContainText('Checkout — Shipping details');
});

test('agent can start a chat with a browsing visitor by typing', async ({ browser }) => {
  const agent = await loginAgent(browser);
  await agent.getByRole('link', { name: 'Visitors' }).click();
  const visitor = await openStore(browser, 'index.html');
  // Give this visitor a unique page title via an in-page (SPA-style) navigation.
  const title = `Gift ideas ${uid()}`;
  await visitor.evaluate((t) => {
    document.title = t;
    history.pushState({}, '', `/index.html#${t}`);
  }, title);

  const row = agent.getByTestId('visitor-row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.click();
  const side = agent.getByTestId('chat-window-side');
  await expect(side.getByTestId('join-prompt')).toContainText('Start typing to start a chat');

  await agent.keyboard.type('Hi there! Can I help you find a book?');
  await agent.keyboard.press('Enter');

  // The widget opens by itself on the visitor's screen with the message.
  const w = widget(visitor);
  await expect(w.locator('.panel')).toBeVisible();
  await expect(w.locator('.msg.agent', { hasText: 'Can I help you find a book?' })).toBeVisible();

  await visitorSays(visitor, 'Yes please!');
  await expect(side.getByTestId('transcript')).toContainText('Yes please!');
});

test('side window ⇄ main window, dock, internal notes and ending a chat', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const name = `Lucas ${uid()}`;
  const visitor = await openStore(browser, 'checkout.html');
  await startChat(visitor, name, 'Do you ship to Austria?');

  await agent.getByRole('link', { name: 'Visitors' }).click();
  await agent.getByTestId('visitor-row').filter({ hasText: name }).click();
  await agent.keyboard.type('Yes, we do!');
  await agent.keyboard.press('Enter');

  // Expand to the main window.
  await agent.getByRole('button', { name: /Open in main window/ }).click();
  const main = agent.getByTestId('chat-window-main');
  await expect(main).toBeVisible();
  await expect(main.getByTestId('transcript')).toContainText('Yes, we do!');

  // Internal note: visible to agents, never to the visitor.
  await main.getByRole('button', { name: 'Internal note' }).click();
  await main.getByLabel('Message').fill('Ships via DHL, 3–5 days');
  await main.getByLabel('Message').press('Enter');
  await expect(main.getByTestId('transcript')).toContainText('Ships via DHL');
  await expect(widget(visitor).locator('.msg', { hasText: 'Ships via DHL' })).toHaveCount(0);
  await main.getByRole('button', { name: 'Internal note' }).click();

  // Back to the side window, then minimize to the dock; a new visitor message shows an unread count.
  await agent.getByRole('button', { name: /Pop out to side window/ }).click();
  await expect(agent.getByTestId('chat-window-side')).toBeVisible();
  await agent.getByRole('button', { name: /Minimize/ }).click();
  await expect(agent.getByTestId('chat-window-side')).toHaveCount(0);
  await visitorSays(visitor, 'Great, thanks!');
  const dockTab = agent.getByRole('button', { name: new RegExp(`${name}.*1`) });
  await expect(dockTab).toBeVisible();

  // Reopen and end the chat from the main window — the visitor is told.
  await dockTab.click();
  await agent.getByRole('button', { name: /Open in main window/ }).click();
  await agent.getByTestId('chat-window-main').getByRole('button', { name: 'End chat' }).click();
  await expect(widget(visitor).getByRole('button', { name: 'Start a new chat' })).toBeVisible();
});
