import { expect, test } from '@playwright/test';
import { loginAgent, openStore, uid, widget } from './helpers';

test('with nobody online, a visitor leaves a message; an agent finds it in the Inbox and handles it', async ({ browser }) => {
  // Sign every agent out (earlier tests leave their browsers open), so the account is offline.
  for (const ctx of browser.contexts()) await ctx.close();

  const name = `Ingrid ${uid()}`;
  const email = `${name.split(' ')[1]}@example.com`;
  const visitor = await openStore(browser);
  const w = widget(visitor);
  await expect(async () => {
    await visitor.reload();
    await w.locator('button.launcher').click();
    await expect(w.getByText("We're not online right now", { exact: false })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await w.locator('input[name=name]').fill(name);
  await w.locator('input[name=email]').fill(email);
  await w.locator('select[name=department]').selectOption('Billing');
  await w.locator('textarea[name=message]').fill('Can I change the delivery address on my order?');
  await w.getByRole('button', { name: 'Send message' }).click();
  await expect(w.getByText(`Thanks, ${name.split(' ')[0]}!`)).toBeVisible();
  await expect(w.getByText(email)).toBeVisible();

  // An agent signs in: the widget switches back to live chat without a reload.
  const agent = await loginAgent(browser);
  await expect(w.getByText('We typically reply in a few minutes')).toBeVisible();
  await w.getByRole('button', { name: 'Send another message' }).click();
  await expect(w.getByRole('button', { name: 'Start chat' })).toBeVisible();

  // Inbox shows it, with a badge in the sidebar.
  const inboxLink = agent.getByRole('link', { name: 'Inbox' });
  await expect(inboxLink).toContainText(/\d+/);
  await inboxLink.click();
  const row = agent.getByTestId('offline-list').getByRole('button', { name: new RegExp(name) });
  await row.click();
  const detail = agent.getByTestId('offline-detail');
  await expect(detail).toContainText('Can I change the delivery address on my order?');
  await expect(detail).toContainText('Billing');
  await expect(detail).toContainText('On your website now');
  await expect(detail.getByRole('link', { name: 'Open in my email app' })).toHaveAttribute(
    'href',
    new RegExp(`^mailto:${encodeURIComponent(email)}\\?subject=`),
  );

  // Reply from Replyfinch: it's emailed, shown in the thread, and the message is marked handled.
  await detail.getByLabel('Reply').fill('Yes — just reply with the new address and we’ll update it.');
  await detail.getByRole('button', { name: 'Send reply' }).click();
  await expect(detail.getByTestId('offline-reply')).toContainText('just reply with the new address');
  await expect(detail).toContainText('Marked handled by Maya Chen');
  const outbox = (await (await agent.request.get('http://localhost:4000/dev/outbox')).json()) as { to: string; subject: string; text: string }[];
  expect(outbox[0]).toMatchObject({ to: email, subject: 'Re: your message to Acme Books' });
  expect(outbox[0]!.text).toContain('Can I change the delivery address on my order?');
  await expect(row).toHaveCount(0); // gone from "New"
  await agent.getByRole('tab', { name: 'Handled' }).click();
  await expect(agent.getByTestId('offline-list').getByRole('button', { name: new RegExp(name) })).toBeVisible();
});
