import { expect, test } from '@playwright/test';
import { AGENT_URL, openStore, startChat, uid, visitorSays } from './helpers';

test('new chats and messages chime, pop up when in another tab, and count in the tab title', async ({ browser }) => {
  const ctx = await browser.newContext();
  // Record chimes and desktop notifications instead of making noise; pretend the tab is in the background.
  await ctx.addInitScript(() => {
    const w = window as unknown as { __chimes: number; __notes: string[]; __background: boolean };
    w.__chimes = 0;
    w.__notes = [];
    w.__background = false;
    class FakeAudio {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: (g: unknown) => g, start: () => (w.__chimes += 0.5), stop() {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = () => Promise.resolve('granted');
      onclick: null | (() => void) = null;
      constructor(title: string) {
        w.__notes.push(title);
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    document.hasFocus = () => !w.__background;
  });
  const agent = await ctx.newPage();
  await agent.goto(`${AGENT_URL}/login`);
  await agent.getByLabel('Email').fill('maya@replyfinch.dev');
  await agent.getByLabel('Password').fill('replyfinch');
  await agent.getByRole('button', { name: 'Sign in' }).click();
  await expect(agent.getByRole('heading', { name: /Good/ })).toBeVisible();
  const before = await agent.evaluate(() => (window as unknown as { __chimes: number }).__chimes);

  // Agent switches to another tab; a visitor starts a chat.
  await agent.evaluate(() => ((window as unknown as { __background: boolean }).__background = true));
  const name = `Iris ${uid()}`;
  const visitor = await openStore(browser, 'pricing.html');
  await startChat(visitor, name, 'Do you offer discounts?');

  await expect.poll(() => agent.evaluate(() => (window as unknown as { __notes: string[] }).__notes)).toContain(`New chat from ${name}`);
  expect(await agent.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBeGreaterThan(before);
  await expect(agent).toHaveTitle(/^\(\d+\) Replyfinch$/);

  // Agent joins; later the visitor writes while the agent is in another tab → message alert.
  await agent.evaluate(() => ((window as unknown as { __background: boolean }).__background = false));
  await agent.getByTestId('queue-row').filter({ hasText: name }).getByRole('button', { name: 'Accept' }).click();
  await agent.keyboard.type('Hi! Yes we do.');
  await agent.keyboard.press('Enter');
  await agent.keyboard.press('Escape');
  await agent.waitForTimeout(3100); // past the "new chat" grace period
  await agent.evaluate(() => ((window as unknown as { __background: boolean }).__background = true));
  await visitorSays(visitor, 'Great, how much?');
  await expect.poll(() => agent.evaluate(() => (window as unknown as { __notes: string[] }).__notes)).toContain(name);
});

test('profile has notification settings with a test button', async ({ browser }) => {
  const ctx = await browser.newContext();
  const agent = await ctx.newPage();
  await agent.goto(`${AGENT_URL}/login`);
  await agent.getByLabel('Email').fill('maya@replyfinch.dev');
  await agent.getByLabel('Password').fill('replyfinch');
  await agent.getByRole('button', { name: 'Sign in' }).click();
  await expect(agent.getByRole('heading', { name: /Good/ })).toBeVisible();
  await agent.goto(`${AGENT_URL}/settings/profile`);
  const sound = agent.getByLabel('Play a sound');
  await expect(sound).toBeChecked();
  await sound.uncheck();
  await agent.reload();
  await expect(agent.getByLabel('Play a sound')).not.toBeChecked();
  await agent.getByLabel('Play a sound').check();
  await expect(agent.getByRole('button', { name: 'Test notification' })).toBeVisible();
});
