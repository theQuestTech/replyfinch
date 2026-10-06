import { defineConfig } from '@playwright/test';

// Browser tests of the agent app + website widget against a real API.
// Needs Postgres + Redis running and the demo seed (pnpm db:migrate && pnpm db:seed).
// Starts the three dev servers unless they are already running.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: 'pnpm --filter @replyfinch/api dev', url: 'http://localhost:4000/health', reuseExistingServer: true, timeout: 60_000, cwd: '..' },
    { command: 'pnpm --filter @replyfinch/web dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000, cwd: '..' },
    { command: 'pnpm --filter @replyfinch/widget dev', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60_000, cwd: '..' },
  ],
});
