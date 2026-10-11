import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, startChat, uid } from './helpers';

type Sent = { to: string; subject: string; text: string };
const outbox = async (page: import('@playwright/test').Page) =>
  (await (await page.request.get('http://localhost:4000/dev/outbox')).json()) as Sent[];

test('tickets: create one from a chat, reply by email, assign, find it in the list', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  const name = `Tess ${id}`;
  const visitor = await openStore(browser);
  await startChat(visitor, name, `My e-book won't download ${id}`);
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();

  // From the chat window.
  await agent.getByRole('button', { name: 'Ticket', exact: true }).click();
  const dialog = agent.getByRole('dialog', { name: 'Create a ticket from this chat' });
  await expect(dialog.getByLabel('Subject')).toHaveValue(`My e-book won't download ${id}`);
  await dialog.getByLabel('Subject').fill(`E-book download ${id}`);
  await dialog.getByLabel('Customer email').fill(`tess-${id}@example.com`);
  await dialog.getByLabel('Description').fill('Needs a fresh download link');
  await dialog.getByLabel('Assign to').selectOption({ label: 'Unassigned' });
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  const created = agent.getByTestId('ticket-created');
  await expect(created).toContainText(/Ticket #\d+ created/);
  const number = (await created.textContent())!.match(/#(\d+)/)![1]!;
  await expect(agent.getByTestId('transcript')).toContainText(`Ticket #${number} created by Maya Chen`);

  await created.getByRole('button', { name: 'Open ticket' }).click();
  const page = agent.getByTestId('ticket-detail');
  await expect(page).toContainText(`#${number}`);
  await expect(page.getByRole('heading', { name: `E-book download ${id}` })).toBeVisible();
  await expect(page.getByTestId('ticket-note')).toContainText('Needs a fresh download link');
  await expect(page).toContainText(`tess-${id}@example.com`);

  // Reply by email: it goes out with the ticket number, and the ticket becomes pending and mine.
  await page.getByLabel('Reply', { exact: true }).fill('Here is a new link: example.com/dl');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByTestId('ticket-reply')).toContainText(`emailed to tess-${id}@example.com`);
  await expect(page.getByTestId('ticket-event').filter({ hasText: 'set status to Pending' })).toBeVisible();
  await expect(page.getByTestId('ticket-event').filter({ hasText: 'took the ticket' })).toBeVisible();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('pending');
  const mail = (await outbox(agent))[0]!;
  expect(mail).toMatchObject({ to: `tess-${id}@example.com`, subject: `[#${number}] E-book download ${id}` });
  expect(mail.text).toContain('Here is a new link');

  // An internal note, then hand it to Daniel.
  await page.getByRole('tab', { name: 'Internal note' }).click();
  await page.getByLabel('Internal note').fill('Customer bought it on 3 Oct');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('ticket-note').filter({ hasText: 'Customer bought it on 3 Oct' })).toBeVisible();
  await page.getByLabel('Assignee').selectOption({ label: 'Daniel Brooks' });
  await expect(page.getByTestId('ticket-event').filter({ hasText: 'assigned the ticket to Daniel Brooks' })).toBeVisible();

  // The list: search by number; it's not in "Assigned to me" any more.
  await agent.getByRole('link', { name: 'Tickets', exact: true }).first().click();
  await agent.getByRole('button', { name: /All tickets/ }).click();
  await agent.getByLabel('Search tickets').fill(`#${number}`);
  const list = agent.getByTestId('ticket-list');
  await expect(list.getByRole('button', { name: new RegExp(`E-book download ${id}`) })).toContainText('Daniel Brooks');
  await agent.getByRole('button', { name: /Assigned to me/ }).click();
  await expect(list).toContainText('No tickets match.');
});

test('tickets: create one by hand and see it on the customer profile', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  await agent.goto(`${AGENT_URL}/tickets`);
  await agent.getByRole('button', { name: 'New ticket' }).click();
  const dialog = agent.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Subject').fill(`Phone call ${id}`);
  await dialog.getByLabel('Customer name').fill(`Ravi ${id}`);
  await dialog.getByLabel('Customer email').fill(`ravi-${id}@example.com`);
  await dialog.getByLabel('Priority').selectOption('urgent');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await agent.getByTestId('ticket-created').getByRole('button', { name: 'Open ticket' }).click();

  const page = agent.getByTestId('ticket-detail');
  await expect(page.getByLabel('Priority')).toHaveValue('urgent');
  await expect(page.getByLabel('Assignee')).toHaveValue(/usr_/);
  await page.getByLabel('Status', { exact: true }).selectOption('solved');
  await expect(page.getByTestId('ticket-event').filter({ hasText: 'set status to Solved' })).toBeVisible();

  await page.getByRole('link', { name: 'View customer profile' }).click();
  const profile = agent.getByTestId('customer-profile');
  await expect(profile.getByRole('heading', { name: `Ravi ${id}` })).toBeVisible();
  await expect(profile.getByRole('link', { name: new RegExp(`Phone call ${id}`) })).toContainText('Solved');
});
