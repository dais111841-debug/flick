import { defineConfig, devices } from '@playwright/test';

// CI では Playwright 同梱の Chromium、このサンドボックスのように CDN から取得できない環境では
// npm 経由の @sparticuz/chromium を使う
async function chromePath(): Promise<string | undefined> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CI) return undefined;
  try {
    const c = (await import('@sparticuz/chromium')).default;
    return await c.executablePath();
  } catch {
    return undefined;
  }
}

const executablePath = await chromePath();
const PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'],
    },
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' }, testIgnore: /desktop\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testMatch: /desktop\.spec/ },
  ],
  webServer: {
    command: `npx vite build && npx wrangler d1 migrations apply flick-db --local --env e2e && npx wrangler dev --env e2e --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/me`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
