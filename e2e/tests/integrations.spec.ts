import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { AGENT_URL, loginAgent, uid } from './helpers';

const API = 'http://localhost:4000';

test('integrations: add a webhook, test it, create an API key and use it', async ({ browser }) => {
  // A tiny receiver standing in for Make / Zapier.
  const got: { type: string; body: Record<string, unknown> }[] = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      got.push({ type: String(req.headers['replyfinch-event']), body: JSON.parse(b) });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook-${uid()}`;

  const agent = await loginAgent(browser);
  await agent.goto(`${AGENT_URL}/settings/integrations`);
  await expect(agent.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await agent.getByRole('button', { name: 'Add webhook' }).click();
  await agent.getByLabel('Address (URL)').fill(url);
  await agent.getByLabel('Description (optional)').fill('My test receiver');
  await agent.getByRole('checkbox', { name: /A ticket was created/ }).check();
  await agent.getByRole('button', { name: 'Add webhook', exact: true }).last().click();

  const card = agent.getByTestId('webhook').filter({ hasText: url });
  await expect(card).toContainText('Nothing sent yet');
  await card.getByRole('button', { name: 'Send test' }).click();
  await expect(card.getByRole('status')).toHaveText('Test sent — your address answered 200.');
  await expect(card).toContainText('Working');
  expect(got.at(-1)).toMatchObject({ type: 'ping' });

  // An API key, shown once.
  await agent.getByLabel('New key name').fill(`E2E ${uid()}`);
  await agent.getByRole('button', { name: 'Create key' }).click();
  const key = (await agent.getByTestId('new-api-key').locator('code').textContent())!;
  expect(key).toMatch(/^rf_live_/);
  await agent.getByRole('button', { name: 'Done' }).click();

  // Another app creates a ticket with the key → the webhook hears about it.
  const res = await agent.request.post(`${API}/v1/tickets`, { headers: { authorization: `Bearer ${key}` }, data: { subject: `Via API ${uid()}` } });
  expect(res.status()).toBe(201);
  await expect.poll(() => got.some((g) => g.type === 'ticket.created'), { timeout: 10_000 }).toBe(true);
  await card.getByRole('button', { name: /Recent deliveries/ }).click();
  await expect(card.getByTestId('deliveries')).toContainText('ticket.created');
  await expect(card.getByTestId('deliveries')).toContainText('Sent · 200');

  // Clean up: the webhook goes, so later runs don't post to a closed port.
  agent.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Delete webhook' }).click();
  await expect(card).toHaveCount(0);
  srv.close();
});
