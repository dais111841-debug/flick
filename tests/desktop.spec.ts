import { test, expect } from '@playwright/test';
import { addMemo, card, count, mouseSwipe, open } from './helpers';

test('デスクトップ：マウスドラッグでフリック', async ({ page }) => {
  await open(page);
  await addMemo(page, 'マウスで動かす');
  await mouseSwipe(page, card(page, 'マウスで動かす'), 260);
  await expect(count(page, 'doing')).toHaveText('1');
});

test('デスクトップ：キーボードだけで操作できる', async ({ page }) => {
  await open(page);
  await addMemo(page, 'キーボード');
  await card(page, 'キーボード').focus();
  await page.keyboard.press('ArrowRight');
  await expect(count(page, 'doing')).toHaveText('1');
  await page.keyboard.press('/');
  await expect(page.getByTestId('composer')).toBeFocused();
});
