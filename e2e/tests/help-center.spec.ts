import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, openStore, uid, widget } from './helpers';

test('help center: write and publish an article; customers find it on the help site and in the widget', async ({ browser }) => {
  const agent = await loginAgent(browser);
  const id = uid();
  const title = `How long does delivery take ${id}?`;

  await agent.getByRole('link', { name: 'Help center' }).click();
  await agent.getByRole('button', { name: 'Add category' }).click();
  await agent.getByLabel('New category name').fill(`Shipping ${id}`);
  await agent.getByRole('button', { name: 'Add', exact: true }).click();
  await agent.getByRole('button', { name: new RegExp(`Shipping ${id}`) }).click();

  await agent.getByRole('link', { name: 'New article' }).click();
  const editor = agent.getByTestId('article-editor');
  await editor.getByLabel('Title').fill(title);
  await expect(editor.getByLabel('Category')).toHaveValue(/hc_/); // the category we were looking at
  await editor.getByLabel('Article text').fill(`Most orders arrive in **3–5 days**.\n\n- Europe: 3–5 days\n- Elsewhere: 7–10 days`);
  await editor.getByRole('tab', { name: 'preview' }).click();
  await expect(editor.getByTestId('article-preview').locator('strong')).toHaveText('3–5 days');
  await editor.getByRole('button', { name: 'Publish' }).click();
  await expect(editor.getByRole('status')).toHaveText('Published — it’s live on your help site.');
  await expect(editor.getByText('Published', { exact: true })).toBeVisible();

  await agent.getByRole('link', { name: 'Help center' }).first().click();
  await expect(agent.getByTestId('article-list').getByRole('button', { name: new RegExp(title.replace('?', '\\?')) })).toContainText('Published');
  const helpUrl = (await agent.getByTestId('help-url').textContent())!;
  expect(helpUrl).toBe(`${AGENT_URL}/help/acc_demo`);

  // The public help site, signed out.
  const reader = await (await browser.newContext()).newPage();
  await reader.goto(helpUrl);
  await expect(reader.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  await reader.getByLabel('Search help articles').fill(`delivery ${id}`);
  await reader.getByTestId('help-results').getByRole('link', { name: new RegExp(id) }).click();
  const article = reader.getByTestId('help-article');
  await expect(article.getByRole('heading', { name: title })).toBeVisible();
  await expect(article.locator('li')).toHaveText(['Europe: 3–5 days', 'Elsewhere: 7–10 days']);
  await article.getByRole('button', { name: 'Yes' }).click();
  await expect(article.getByRole('status')).toContainText('Thanks for letting us know!');

  // In the chat widget, before chatting.
  const visitor = await openStore(browser);
  const w = widget(visitor);
  await w.locator('button.launcher').click();
  await w.getByLabel('Search help articles').fill(`delivery ${id}`);
  await w.locator('.help-item', { hasText: id }).click();
  await expect(w.locator('.article-title')).toHaveText(title);
  await expect(w.locator('.article-body strong')).toHaveText('3–5 days');
  await w.getByRole('button', { name: 'No' }).click();
  await expect(w.getByText('Sorry about that')).toBeVisible();
  await w.getByRole('button', { name: 'Chat with us' }).click();
  await expect(w.getByRole('button', { name: 'Start chat' })).toBeVisible();
  await expect(w.getByLabel('Search help articles')).toHaveValue(`delivery ${id}`); // kept, to look again

  // The agent sees how it's doing.
  await agent.getByTestId('article-list').getByRole('button', { name: new RegExp(id) }).click();
  await expect(agent.getByTestId('article-editor')).toContainText('50% found it helpful (2 votes)');
});
