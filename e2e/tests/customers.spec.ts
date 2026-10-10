import { expect, test } from '@playwright/test';
import { loginAgent, openStore, uid, widget } from './helpers';

test('Customers lists people who chatted; the profile shows their chats and can be edited', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  const name = `Lena ${id}`;
  const email = `lena-${id}@example.com`;
  const visitor = await openStore(browser);
  const w = widget(visitor);
  await w.locator('button.launcher').click();
  await w.locator('input[name=name]').fill(name);
  await w.locator('input[name=email]').fill(email);
  await w.locator('textarea[name=message]').fill('Do you ship to Norway?');
  await w.getByRole('button', { name: 'Start chat' }).click();
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('Yes, in 3–5 days.');
  await agent.keyboard.press('Enter');

  // From the chat window's visitor panel to the profile.
  await agent.getByRole('link', { name: 'View customer profile →' }).click();
  const profile = agent.getByTestId('customer-profile');
  await expect(profile.getByRole('heading', { name })).toBeVisible();
  await expect(profile).toContainText('On your website now');

  // Edit: phone and a tag.
  await profile.getByLabel('Add phone number').fill('+47 555 0100');
  await profile.getByLabel('Add phone number').press('Enter');
  await profile.getByRole('button', { name: '+ Add' }).click();
  await agent.keyboard.type(`nordic-${id}`);
  await agent.keyboard.press('Enter');
  await expect(profile.getByRole('button', { name: `Remove nordic-${id}` })).toBeVisible();

  // The conversation opens in place.
  await profile.getByRole('button', { name: /Do you ship to Norway\?/ }).click();
  await expect(profile.getByTestId('transcript')).toContainText('Yes, in 3–5 days.');

  // The list: search by email, filter by the new tag.
  await profile.getByRole('link', { name: 'Customers' }).click();
  await agent.getByLabel('Search customers').fill(email);
  const row = agent.getByTestId('customer-list').getByRole('button', { name: new RegExp(name) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Online now');
  await agent.getByLabel('Search customers').fill('');
  await agent.getByLabel('Tag').selectOption(`nordic-${id}`);
  await expect(agent.getByTestId('customer-list').getByRole('button')).toHaveCount(1);
  await expect(agent.getByTestId('customer-list')).toContainText(name);
});
