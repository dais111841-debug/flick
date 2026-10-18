/**
 * デプロイ済みの本番環境に対するテスト。
 *   PROD_URL=https://flick.<subdomain>.workers.dev CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx playwright test
 *
 * 本番には開発用ログインが存在しないため、ログイン後の機能は
 * テスト用ユーザーとセッションを D1 に直接作成して検証し、終了時に削除する。
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addMemo, card, count, open, tab, touchSwipe } from './helpers';

const BASE = process.env.PROD_URL!;
const HOST = new URL(BASE).host;
const USER_ID = `e2e-${randomBytes(6).toString('hex')}`;
const TOKEN = randomBytes(32).toString('base64url');

function d1(sql: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'flick-db', '--remote', '--env=', '--command', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function signIn(context: BrowserContext) {
  await context.addCookies([
    { name: '__Host-sid', value: TOKEN, domain: HOST, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
}

test.beforeAll(() => {
  const hash = createHash('sha256').update(TOKEN).digest('hex');
  d1(
    `INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES ('${USER_ID}', 'e2e:${USER_ID}', '${USER_ID}@example.com', 'E2E', '', ${Date.now()});` +
      `INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ('${hash}', '${USER_ID}', ${Date.now() + 3_600_000});`,
  );
});

test.afterAll(() => {
  d1(
    `DELETE FROM tasks WHERE user_id = '${USER_ID}'; DELETE FROM sessions WHERE user_id = '${USER_ID}'; ` +
      `DELETE FROM ai_usage WHERE user_id = '${USER_ID}'; DELETE FROM users WHERE id = '${USER_ID}';`,
  );
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('flick.v1.hint', 'true'));
});

test.describe('本番：公開面', () => {
  test('HTTPS・セキュリティヘッダー・PWA', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect((await request.get('/manifest.webmanifest')).status()).toBe(200);
    expect((await request.get('/sw.js')).status()).toBe(200);
  });

  test('開発用ログインは本番に存在しない', async ({ request }) => {
    const r = await request.post('/auth/dev-login', { headers: { Origin: BASE }, data: {} });
    expect(r.status()).toBe(404);
    const me = await request.get('/api/me').then((x) => x.json());
    expect(me).toEqual({ user: null, devLogin: false });
  });

  test('未ログイン・別オリジンの API 呼び出しを拒否', async ({ request }) => {
    expect((await request.get('/api/tasks')).status()).toBe(401);
    expect((await request.post('/api/ai/split', { headers: { Origin: BASE }, data: { text: 'x' } })).status()).toBe(401);
    expect((await request.post('/api/sync', { headers: { Origin: 'https://evil.example' }, data: { ops: [] } })).status()).toBe(403);
  });

  test('Google の認可画面へ正しいリダイレクト URI・PKCE で遷移', async ({ request }) => {
    const res = await request.get('/auth/google', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const url = new URL(res.headers()['location']);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/callback`);
    expect(url.searchParams.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const cookies = res.headersArray().filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => x.value);
    expect(cookies.find((c) => c.startsWith('g_state='))).toMatch(/HttpOnly.*Secure|Secure.*HttpOnly/i);
  });

  test('改ざんされた state ではログインできない', async ({ page }) => {
    await page.goto('/auth/callback?code=forged&state=forged');
    await expect(page.getByRole('status')).toHaveText(/ログインできませんでした/);
  });

  test('スケルトン → メモ → フリック（未ログイン）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#boot .sk').first()).toBeAttached();
    await expect(page.getByTestId('composer')).toBeFocused();
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 10_000 });
    await addMemo(page, '本番で書いたメモ');
    await touchSwipe(page, card(page, '本番で書いたメモ'), 220);
    await expect(count(page, 'doing')).toHaveText('1');
    await tab(page, 'doing').tap();
    await touchSwipe(page, card(page, '本番で書いたメモ'), 220);
    await expect(count(page, 'done')).toHaveText('1');
  });
});

test.describe('本番：ログイン後（Workers AI は本物）', () => {
  test('同期：書いた内容がサーバ（D1）に保存され、別端末から見える', async ({ page, context, browser }) => {
    await signIn(context);
    await open(page);
    await expect(page.getByRole('button', { name: 'アカウント' })).toBeVisible();
    await addMemo(page, '本番同期テスト');
    await touchSwipe(page, card(page, '本番同期テスト'), 220);
    await expect
      .poll(async () => (await page.request.get('/api/tasks').then((r) => r.json())).tasks.map((t: { title: string; status: string }) => `${t.title}:${t.status}`), { timeout: 10_000 })
      .toContain('本番同期テスト:doing');

    const other = await browser.newContext({ ...test.info().project.use, baseURL: BASE });
    await signIn(other);
    const p2 = await other.newPage();
    await p2.addInitScript(() => localStorage.setItem('flick.v1.hint', 'true'));
    await open(p2);
    await tab(p2, 'doing').tap();
    await expect(card(p2, '本番同期テスト')).toBeVisible();
    await other.close();
  });

  test('AI：音声入力風のメモを Workers AI でタスクに分解', async ({ page, context }) => {
    await signIn(context);
    await open(page);
    const before = Number(await count(page, 'todo').textContent());
    await page.getByTestId('composer').fill('えーと明日までに意見書のドラフトを先方に送って それから田中さんにDDの日程確認の電話 あとクロージングのチェックリストも更新');
    await page.getByRole('button', { name: 'AI でタスクに分ける' }).tap();
    await expect(page.getByRole('status')).toHaveText(/件のタスクに分けました/, { timeout: 30_000 });
    const after = Number(await count(page, 'todo').textContent());
    expect(after - before).toBeGreaterThanOrEqual(2);
    const titles = await page.locator('[data-task] .title').allTextContents();
    expect(titles.join('|')).toMatch(/意見書/);
    expect(titles.join('|')).toMatch(/チェックリスト/);
    await expect(page.getByTestId('composer')).toHaveValue('');
  });

  test('AI：日本語の音声を Whisper で文字起こし', async ({ context }) => {
    await signIn(context);
    const audio = readFileSync(new URL('./fixtures/speech-ja.mp3', import.meta.url));
    const res = await context.request.post('/api/ai/transcribe', {
      headers: { Origin: BASE, 'Content-Type': 'audio/mpeg' },
      data: audio,
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).text).toMatch(/会議/);
  });

  test('AI：画面の録音ボタンから文字起こしまで通る', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await signIn(context);
    await open(page);
    await page.getByRole('button', { name: '音声でメモ' }).tap();
    await expect(page.getByRole('button', { name: '録音を止める' })).toBeVisible();
    await page.waitForTimeout(1500);
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/ai/transcribe'), { timeout: 30_000 });
    await page.getByRole('button', { name: '録音を止める' }).tap();
    expect((await resp).status()).toBe(200);
  });

  test('ログアウトでセッションが無効になる', async ({ page, context }) => {
    await signIn(context);
    await open(page);
    await page.getByRole('button', { name: 'アカウント' }).tap();
    await page.getByRole('menuitem', { name: 'ログアウト' }).tap();
    await expect(page.getByTestId('login')).toBeVisible();
    // ブラウザから Cookie が消えるだけでなく、同じトークンを付け直してもサーバ側で無効になっている
    await signIn(context);
    expect((await page.request.get('/api/tasks')).status()).toBe(401);
  });
});
