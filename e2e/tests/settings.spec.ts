import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, startChat, uid, widget } from './helpers';

test('agent changes their own password', async ({ browser }) => {
  // Use a fresh agent so other tests keep the demo password.
  const admin = await loginAgent(browser);
  await admin.goto(`${AGENT_URL}/settings/team`);
  const email = `pw-${uid()}@example.com`;
  await admin.getByRole('button', { name: 'Add agent' }).click();
  await admin.getByLabel('Full name').fill('Tom Novak');
  await admin.getByLabel('Email').fill(email);
  await admin.getByLabel('Temporary password').fill('temporary-123');
  await admin.getByRole('button', { name: 'Add agent' }).last().click();
  await expect(admin.getByTestId('new-agent-credentials')).toContainText(email);

  const tom = await loginAgent(browser, email, 'temporary-123');
  await tom.goto(`${AGENT_URL}/settings/profile`);
  await tom.getByLabel('Current password').fill('temporary-123');
  await tom.getByLabel('New password', { exact: true }).fill('my-own-secret-9');
  await tom.getByLabel('Confirm new password').fill('my-own-secret-9');
  await tom.getByRole('button', { name: 'Change password' }).click();
  await expect(tom.getByText('Password changed')).toBeVisible();
  // Agents don't see the Team section.
  await expect(tom.getByRole('link', { name: 'Team' })).toHaveCount(0);

  // New password works.
  await loginAgent(browser, email, 'my-own-secret-9');
});

test('admin edits and removes an agent; removed agent is signed out', async ({ browser }) => {
  const admin = await loginAgent(browser);
  await admin.goto(`${AGENT_URL}/settings/team`);
  const email = `rm-${uid()}@example.com`;
  await admin.getByRole('button', { name: 'Add agent' }).click();
  await admin.getByLabel('Full name').fill('Elena Rossi');
  await admin.getByLabel('Email').fill(email);
  await admin.getByLabel('Temporary password').fill('temporary-123');
  await admin.getByRole('button', { name: 'Add agent' }).last().click();
  await admin.getByRole('button', { name: 'Done' }).click();

  const row = admin.getByTestId('team-row').filter({ hasText: email });
  await row.getByRole('button', { name: /Edit Elena Rossi/ }).click();
  await admin.getByLabel('Chat limit').fill('6');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('6 chats');

  const elena = await loginAgent(browser, email, 'temporary-123');
  await row.getByRole('button', { name: /Remove Elena Rossi/ }).click();
  await admin.getByRole('button', { name: 'Remove agent' }).click();
  await expect(row).toHaveCount(0);
  await elena.reload();
  await expect(elena.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('shortcuts: create in settings, then use with "/", typos and Tab suggestions in a live chat', async ({ browser }) => {
  const agent = await loginAgent(browser);
  await agent.goto(`${AGENT_URL}/settings/shortcuts`);
  const name = `track-${uid()}`;
  await agent.getByRole('button', { name: 'Add shortcut' }).click();
  await agent.getByLabel('Shortcut name').fill(name);
  await agent.getByLabel('Shortcut message').fill('Hi {{visitor.name}}, your parcel is with the courier and arrives tomorrow.');
  await agent.getByLabel('Shortcut keywords').fill('parcel, courier');
  await agent.getByRole('button', { name: 'Add shortcut' }).last().click();
  await expect(agent.getByTestId('shortcut-row').filter({ hasText: `/${name}` })).toBeVisible();

  // A visitor chats; the agent opens the chat from Home.
  const customer = `Nora ${uid()}`;
  const visitor = await openStore(browser, 'checkout.html');
  await startChat(visitor, customer, 'Where is my order?');
  await agent.getByRole('link', { name: 'Home' }).click();
  await agent.getByTestId('queue-row').filter({ hasText: customer }).getByRole('button', { name: 'Accept' }).click();

  // "/" opens the picker; typing narrows it — a keyword with a typo still finds it.
  await agent.keyboard.type('/');
  const box = agent.getByLabel('Message');
  await expect(agent.getByTestId('shortcut-picker')).toBeVisible();
  await box.pressSequentially('courer');
  const picker = agent.getByTestId('shortcut-picker');
  const option = picker.getByRole('option', { name: new RegExp(`/${name}`) });
  await expect(option).toBeVisible();
  // Move the highlight onto it with the arrow keys, then Enter inserts it.
  for (let i = 0; i < 8 && (await option.getAttribute('aria-selected')) !== 'true'; i++) await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue(`Hi ${customer.split(' ')[0]}, your parcel is with the courier and arrives tomorrow.`);
  await box.press('Enter');
  await expect(widget(visitor).locator('.msg.agent', { hasText: 'arrives tomorrow' })).toBeVisible();

  // Typing a word that matches a shortcut suggests it; Tab inserts it.
  await box.fill('');
  await box.pressSequentially('refund');
  await expect(agent.getByTestId('shortcut-suggestion')).toContainText('/refund');
  await box.press('Tab');
  await expect(box).toHaveValue(/started a refund/);

  // Esc closes the picker without closing the chat window.
  await box.fill('');
  await box.pressSequentially('/xyzzy');
  await expect(picker).toContainText('No shortcuts match');
  await box.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(agent.getByTestId('chat-window-side')).toBeVisible();
});
