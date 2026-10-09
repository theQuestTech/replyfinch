import { expect, test } from '@playwright/test';
import { loginAgent } from './helpers';

test('sidebar expands and collapses, by button and ⌘/Ctrl+B, and remembers the choice', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const sidebar = agent.getByTestId('sidebar');

  // Expanded by default: labels are visible.
  await expect(sidebar).toHaveAttribute('data-expanded', 'true');
  await expect(sidebar.getByText('Visitors', { exact: true })).toBeVisible();

  await agent.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-expanded', 'false');
  await expect(sidebar.getByText('Visitors', { exact: true })).toHaveCount(0);
  // Navigation still works with icons only.
  await agent.getByRole('link', { name: 'Visitors' }).click();
  await expect(agent.getByRole('heading', { name: 'Visitors' })).toBeVisible();

  // Remembered after reload.
  await agent.reload();
  await expect(sidebar).toHaveAttribute('data-expanded', 'false');

  // Keyboard shortcut toggles it back.
  await agent.keyboard.press('ControlOrMeta+b');
  await expect(sidebar).toHaveAttribute('data-expanded', 'true');
});
