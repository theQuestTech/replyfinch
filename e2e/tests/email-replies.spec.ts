import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, uid } from './helpers';

type Sent = { to: string; subject: string; text: string; replyTo?: string };
const API = 'http://localhost:4000';

test('email replies: a customer answers a ticket email and it shows up in the ticket, live', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();

  // The support address is shown in Settings → Email.
  await agent.goto(`${AGENT_URL}/settings/email`);
  await expect(agent.getByTestId('receiving-status')).toContainText('Customers’ replies come back into tickets');
  await expect(agent.getByTestId('support-address')).toHaveText(/^a-demo-[0-9a-f]{10}@/);

  await agent.goto(`${AGENT_URL}/tickets`);
  await agent.getByRole('button', { name: 'New ticket' }).click();
  const dialog = agent.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Subject').fill(`Wrong size ${id}`);
  await dialog.getByLabel('Customer name').fill(`Kai ${id}`);
  await dialog.getByLabel('Customer email').fill(`kai-${id}@example.com`);
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await agent.getByTestId('ticket-created').getByRole('button', { name: 'Open ticket' }).click();

  const page = agent.getByTestId('ticket-detail');
  await page.getByLabel('Reply', { exact: true }).fill('Please send a photo of the label.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('pending');

  const mail = ((await (await agent.request.get(`${API}/dev/outbox`)).json()) as Sent[])[0]!;
  expect(mail.to).toBe(`kai-${id}@example.com`);
  expect(mail.replyTo).toMatch(/^t-.+@/);

  // The customer hits "Reply" in their email app.
  const res = await agent.request.post(`${API}/dev/inbound`, {
    data: {
      from: `Kai ${id} <kai-${id}@example.com>`,
      to: mail.replyTo,
      subject: `Re: ${mail.subject}`,
      text: `Here it is: size M, order 5521.\n\nOn Mon, Acme Books wrote:\n> Please send a photo of the label.`,
    },
  });
  expect((await res.json()) as { action: string }).toMatchObject({ action: 'reply' });

  await expect(page.getByTestId('ticket-customer').filter({ hasText: 'Here it is: size M, order 5521.' })).toBeVisible();
  await expect(page.getByTestId('ticket-customer')).not.toContainText('Please send a photo');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('open');
});
