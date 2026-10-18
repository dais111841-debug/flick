import { expect, type Page, type BrowserContext, type Locator } from '@playwright/test';

/** 開発用ログイン（DEV_MODE=1 かつ localhost のときだけ存在するエンドポイント） */
export async function devLogin(context: BrowserContext, baseURL: string, email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`) {
  const res = await context.request.post('/auth/dev-login', {
    headers: { Origin: baseURL, 'Content-Type': 'application/json' },
    data: { email },
  });
  expect(res.ok()).toBeTruthy();
  return email;
}

export async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId('composer')).toBeVisible();
}

export async function addMemo(page: Page, text: string) {
  const c = page.getByTestId('composer');
  await c.fill(text);
  await c.press('Enter');
  await expect(c).toHaveValue('');
}

export const card = (page: Page, title: string) => page.locator('[data-task]', { hasText: title });
export const count = (page: Page, s: 'todo' | 'doing' | 'done') => page.locator(`[data-count="${s}"]`);
export const tab = (page: Page, s: 'todo' | 'doing' | 'done') => page.locator(`[data-tab="${s}"]`);

/**
 * 実機の指操作と同じく CDP のタッチイベントで横フリックする。
 * Chrome がこれをポインタイベントに変換するので、アプリ側は実際のスマホと同じ経路を通る。
 */
export async function touchSwipe(page: Page, target: Locator, dx: number, opts: { steps?: number; duration?: number; dy?: number } = {}) {
  const { steps = 12, duration = 240, dy = 0 } = opts;
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const pt = (px: number, py: number) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(duration / steps);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(x + (dx * i) / steps, y + (dy * i) / steps),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** マウスでドラッグ（デスクトップ） */
export async function mouseSwipe(page: Page, target: Locator, dx: number, steps = 14) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
