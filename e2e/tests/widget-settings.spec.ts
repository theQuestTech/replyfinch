import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, widget } from './helpers';

test('admin customizes the chat widget; the website shows it', async ({ browser }) => {
  const admin = await loginAgent(browser);
  await admin.goto(`${AGENT_URL}/settings/widget`);
  await expect(admin.getByRole('heading', { name: 'Chat widget', exact: true })).toBeVisible();
  const before = await admin.evaluate(async () => {
    const { token } = JSON.parse(localStorage.getItem('rf_agent_session')!);
    return (await fetch('http://localhost:4000/settings/widget', { headers: { authorization: `Bearer ${token}` } })).json();
  });

  try {
    await admin.getByRole('radio', { name: '#0F766E' }).click();
    await admin.getByText('Bottom left').click();
    await admin.getByLabel('Greeting').fill('Hey! Questions about a book? Ask away.');
    await admin.getByLabel('Email address').selectOption('required');
    for (const d of before.departments as string[]) await admin.getByRole('button', { name: `Remove ${d}` }).click();
    await admin.getByLabel('New department').fill('Orders');
    await admin.getByLabel('New department').press('Enter');
    await admin.getByLabel('New department').fill('orders');
    await admin.getByRole('button', { name: 'Add' }).click();
    await expect(admin.getByRole('alert')).toContainText('already a department');
    await expect(admin.getByTestId('widget-preview')).toContainText('Hey! Questions about a book?');
    await admin.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByText('Saved', { exact: true })).toBeVisible();

    const visitor = await openStore(browser);
    const w = widget(visitor);
    await w.locator('button.launcher').click();
    await expect(w.getByText('Hey! Questions about a book? Ask away.')).toBeVisible();
    await expect(w.locator('.rf')).toHaveClass(/left/);
    await expect(w.locator('.header')).toHaveCSS('background-color', 'rgb(15, 118, 110)');
    await expect(w.locator('input[name=email]')).toHaveAttribute('required', '');
    await expect(w.locator('select[name=department]')).toHaveCount(1);
    await expect(w.locator('select[name=department] option')).toHaveText(['Orders']);
  } finally {
    // Put the demo account back for the other tests.
    await admin.evaluate(async (s) => {
      const { token } = JSON.parse(localStorage.getItem('rf_agent_session')!);
      const { accountName: _, ...settings } = s;
      await fetch('http://localhost:4000/settings/widget', {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
    }, before);
  }
});
