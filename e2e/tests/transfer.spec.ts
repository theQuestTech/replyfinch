import { expect, test } from '@playwright/test';
import { loginAgent, openStore, startChat, uid, widget } from './helpers';

test('an agent transfers a chat to a teammate with a private note', async ({ browser }) => {
  const maya = await loginAgent(browser);
  const daniel = await loginAgent(browser, 'daniel@replyfinch.dev');
  const name = `Rosa ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'I was charged twice for one order');

  // Maya joins, then hands it to Daniel.
  await maya.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await maya.keyboard.type('Let me get our billing expert.');
  await maya.keyboard.press('Enter');
  await maya.getByRole('button', { name: 'Transfer' }).click();
  const dialog = maya.getByRole('dialog', { name: 'Transfer chat' });
  await dialog.getByRole('radio', { name: /Daniel Brooks/ }).click();
  await dialog.getByPlaceholder('What have you tried so far?').fill('Double charge on order 4821 — please refund one.');
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(maya.getByTestId('transcript')).toContainText('Maya Chen transferred the chat to Daniel Brooks');

  // The visitor is told; the note stays private.
  const w = widget(visitor);
  await expect(w.getByText('Maya Chen transferred the chat to Daniel Brooks')).toBeVisible();
  await expect(w.getByText('Double charge on order 4821')).toHaveCount(0);

  // Daniel gets it in his dock, sees the note, and joins by typing.
  const tab = daniel.getByRole('button', { name: new RegExp(name) }).first();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(daniel.getByTestId('transcript')).toContainText('Double charge on order 4821 — please refund one.');
  await daniel.keyboard.type('Hi Rosa, Daniel here — refunding the duplicate now.');
  await daniel.keyboard.press('Enter');
  await expect(w.getByText('Daniel Brooks joined the chat')).toBeVisible();
  await expect(w.locator('.msg.agent', { hasText: 'refunding the duplicate' })).toBeVisible();
});

test('an agent sends a chat back to the queue for another department', async ({ browser }) => {
  const maya = await loginAgent(browser);
  const name = `Theo ${uid()}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, 'Can I pay by invoice?', 'Sales');
  await maya.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await maya.keyboard.type('One moment.');
  await maya.keyboard.press('Enter');
  await maya.getByRole('button', { name: 'Transfer' }).click();
  const dialog = maya.getByRole('dialog', { name: 'Transfer chat' });
  await dialog.getByRole('radio', { name: 'Billing' }).click();
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(widget(visitor).getByText('Maya Chen transferred the chat to the Billing team')).toBeVisible();

  await maya.keyboard.press('Escape');
  const row = maya.getByTestId('queue-row').filter({ hasText: name });
  await expect(row).toBeVisible(); // back in the queue
  await expect(row).toContainText('Billing');
});
