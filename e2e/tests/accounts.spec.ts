import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, uid } from './helpers';

const API = 'http://localhost:4000';
type Sent = { to: string; subject: string; text: string };

test('accounts: early-access ticket → new account → welcome link → forgot password', async ({ browser }) => {
  const id = uid();
  const email = `fern-${id}@example.com`;
  const agent = await loginAgent(browser);

  // Someone asks for early access on the website…
  await agent.request.post(`${API}/widget/site/early-access`, { data: { name: `Fern Lee ${id}`, email, company: `Fern Co ${id}` } });
  await agent.goto(`${AGENT_URL}/tickets`);
  await agent.getByLabel('Search tickets').fill(`Fern Co ${id}`);
  await agent.getByTestId('ticket-list').getByRole('button', { name: new RegExp(`Early access: Fern Co ${id}`) }).click();

  // …and the platform admin creates their account from the ticket.
  await agent.getByRole('button', { name: 'Create their account' }).click();
  const dialog = agent.getByRole('dialog', { name: 'New customer account' });
  await expect(dialog.getByLabel('Company')).toHaveValue(`Fern Co ${id}`);
  await expect(dialog.getByLabel('Their email')).toHaveValue(email);
  await dialog.getByRole('button', { name: 'Create account' }).click();
  const created = agent.getByTestId('account-created');
  await expect(created).toContainText(`Fern Co ${id} is ready`);
  const link = (await created.getByTestId('set-password-url').textContent())!;
  expect(link).toContain(`${AGENT_URL}/reset-password?token=`);
  await created.getByRole('button', { name: 'Done' }).click();
  await expect(agent.getByTestId('ticket-note').last()).toContainText(`Created their Replyfinch account “Fern Co ${id}”`);

  await agent.getByRole('link', { name: 'Accounts' }).click();
  const row = agent.getByTestId('account-list').locator('div', { hasText: `Fern Co ${id}` }).first();
  await expect(row).toContainText('Hasn’t signed in yet');

  // The new admin follows the welcome link (also emailed).
  const outbox = async () => (await (await agent.request.get(`${API}/dev/outbox`)).json()) as Sent[];
  expect((await outbox()).find((m) => m.to === email)?.subject).toBe(`Your Replyfinch account for Fern Co ${id} is ready`);
  const fern = await (await browser.newContext()).newPage();
  await fern.goto(link);
  await expect(fern.getByText(`Welcome to Replyfinch, Fern!`)).toBeVisible();
  await fern.getByLabel('Password', { exact: true }).fill('ferns-are-great-1');
  await fern.getByLabel('Type it again').fill('ferns-are-great-2');
  await fern.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(fern.getByRole('alert')).toHaveText('The two passwords don’t match.');
  await fern.getByLabel('Type it again').fill('ferns-are-great-1');
  await fern.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(fern).toHaveURL(/\/settings\/widget/);
  await expect(fern.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(fern.getByRole('link', { name: 'Accounts' })).toHaveCount(0); // not a platform admin

  // Later, Fern forgets the password.
  await fern.context().clearCookies();
  await fern.evaluate(() => localStorage.clear());
  await fern.goto(`${AGENT_URL}/login`);
  await fern.getByRole('link', { name: 'Forgot password?' }).click();
  await fern.getByLabel('Email').fill(email);
  await fern.getByRole('button', { name: 'Send me a link' }).click();
  await expect(fern.getByRole('status')).toContainText(`If ${email} has a Replyfinch account`);
  const reset = (await outbox()).find((m) => m.to === email && m.subject === 'Reset your Replyfinch password')!;
  const resetLink = /(http\S+reset-password\?token=[\w-]+)/.exec(reset.text)![1]!;
  await fern.goto(resetLink);
  await fern.getByLabel('New password').fill('a-whole-new-password');
  await fern.getByLabel('Type it again').fill('a-whole-new-password');
  await fern.getByRole('button', { name: 'Save and sign in' }).click();
  await expect(fern.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

  // The link worked once.
  await fern.goto(resetLink);
  await expect(fern.getByRole('alert')).toContainText('This link has expired or was already used');
});
