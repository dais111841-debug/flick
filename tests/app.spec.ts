import { test, expect } from '@playwright/test';
import { addMemo, card, count, devLogin, open, tab, touchSwipe } from './helpers';

// フリックのヒント演出は初回だけ。ヒント自体を検証するテスト以外では既読にしておく
test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes('ヒント')) {
    await page.addInitScript(() => localStorage.setItem('flick.v1.hint', 'true'));
  }
});

test.describe('起動とメモ', () => {
  test('全画面スケルトンが表示され、データ到着後に消える', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/me', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/');
    const boot = page.locator('#boot');
    await expect(boot).toBeVisible();
    // 画面全体を覆っている
    const box = (await boot.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(vp.width);
    expect(box.height).toBeGreaterThanOrEqual(vp.height);
    // タブ・アバター・カード 6 枚分のシマー
    await expect(page.locator('#boot .sk')).toHaveCount(8);
    const anim = await page.locator('#boot .b-card').first().evaluate((el) => getComputedStyle(el, '::after').animationName);
    expect(anim).toBe('sk');
    // スケルトン表示中でもメモ欄は本物で、入力できる
    await expect(page.getByTestId('composer')).toBeVisible();
    await expect(page.getByTestId('composer')).toBeFocused();
    release();
    await expect(boot).toHaveCount(0);
    await expect(page.getByText('下の欄にメモを書くとここに並びます')).toBeVisible();
  });

  test('JS 読み込み前に打った文字とフォーカスがアプリへ引き継がれる', async ({ page }) => {
    await page.route('**/assets/*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'commit' });
    const boot = page.locator('#boot-memo');
    await expect(boot).toBeFocused();
    await page.keyboard.type('早押しメモ');
    await expect(boot).toHaveValue('早押しメモ');
    const composer = page.getByTestId('composer');
    await expect(composer).toHaveValue('早押しメモ', { timeout: 8000 });
    await expect(composer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page, '早押しメモ')).toBeVisible();
  });

  test('開いた瞬間メモ欄にフォーカスがあり、Enter で追加・リロード後も残る', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('composer')).toBeFocused();
    await page.keyboard.type('見積書を送る');
    await page.keyboard.press('Enter');
    await expect(card(page, '見積書を送る')).toBeVisible();
    await expect(count(page, 'todo')).toHaveText('1');
    await page.reload();
    await expect(card(page, '見積書を送る')).toBeVisible();
  });

  test('2 行目以降は詳細メモになる・空入力は追加されない', async ({ page }) => {
    await open(page);
    const c = page.getByTestId('composer');
    await c.press('Enter');
    await expect(count(page, 'todo')).toHaveText('0');
    await c.fill('契約書レビュー\n第5条の表明保証を確認');
    await c.press('Enter');
    await expect(card(page, '契約書レビュー')).toContainText('第5条の表明保証を確認');
  });

  test('書きかけのメモは閉じても下書きとして残る', async ({ page }) => {
    await open(page);
    await page.getByTestId('composer').fill('書きかけ');
    await page.reload();
    await expect(page.getByTestId('composer')).toHaveValue('書きかけ');
  });

  test('IME 変換確定の Enter ではタスクが追加されない', async ({ page }) => {
    await open(page);
    const c = page.getByTestId('composer');
    await c.fill('へんかんちゅう');
    await c.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
    await expect(c).toHaveValue('へんかんちゅう');
    await expect(count(page, 'todo')).toHaveText('0');
  });
});

test.describe('フリックでステータス管理', () => {
  test('右フリックで 未着手 → 進行中 → 完了、左で戻る', async ({ page }) => {
    await open(page);
    await addMemo(page, 'タスクA');
    await touchSwipe(page, card(page, 'タスクA'), 220);
    await expect(count(page, 'doing')).toHaveText('1');
    await expect(count(page, 'todo')).toHaveText('0');
    await expect(page.getByRole('status')).toHaveText(/進行中にしました/);

    await tab(page, 'doing').tap();
    await expect(tab(page, 'doing')).toHaveAttribute('aria-selected', 'true');
    await touchSwipe(page, card(page, 'タスクA'), 220);
    await expect(count(page, 'done')).toHaveText('1');

    await tab(page, 'done').tap();
    await expect(card(page, 'タスクA').locator('.check')).toBeVisible();
    await touchSwipe(page, card(page, 'タスクA'), -220);
    await expect(count(page, 'doing')).toHaveText('1');
    await expect(count(page, 'done')).toHaveText('0');
  });

  test('素早いフリック（短い距離・高速）でも確定する', async ({ page }) => {
    await open(page);
    await addMemo(page, '速いフリック');
    // CDP 経由だとイベント間隔が実機より粗くなるため、指の速度を正確に再現できるページ内のポインタイベントで検証
    await card(page, '速いフリック').evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const fire = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire('pointerdown', r.left + 40);
      for (let i = 1; i <= 5; i++) {
        await new Promise((res) => setTimeout(res, 12));
        fire('pointermove', r.left + 40 + i * 16);
      }
      fire('pointerup', r.left + 120);
    });
    await expect(count(page, 'doing')).toHaveText('1');
  });

  test('しきい値未満のドラッグは元の位置へ戻り、状態は変わらない', async ({ page }) => {
    await open(page);
    await addMemo(page, '戻るカード');
    const c = card(page, '戻るカード');
    // 追加時の登場アニメーション（拡大）が終わってから基準位置を測る
    await page.waitForFunction(() => document.getAnimations().filter((a) => a.playState === 'running' && !(a.effect as KeyframeEffect)?.target?.closest?.('.field')).length === 0);
    const before = (await c.boundingBox())!;
    await touchSwipe(page, c, 50, { steps: 10, duration: 400 });
    await page.waitForTimeout(700);
    const after = (await c.boundingBox())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    await expect(count(page, 'todo')).toHaveText('1');
    await expect(count(page, 'doing')).toHaveText('0');
  });

  test('ドラッグ中に行き先のステータスが背面に現れる', async ({ page }) => {
    await open(page);
    await addMemo(page, '背面ラベル');
    const c = card(page, '背面ラベル');
    const box = (await c.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const p = (x: number) => [{ x, y: box.y + box.height / 2, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p(box.x + 40) });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: p(box.x + 40 + i * 18) });
    const row = page.locator('.row', { has: c });
    await expect(row.locator('.cue')).toHaveText('進行中');
    await expect(row.locator('.track')).toHaveClass(/armed/);
    // 指に追従して動いている
    const moved = (await c.boundingBox())!;
    expect(moved.x - box.x).toBeGreaterThan(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(count(page, 'doing')).toHaveText('1');
  });

  test('未着手で左フリックすると削除、元に戻すで復元', async ({ page }) => {
    await open(page);
    await addMemo(page, '消すタスク');
    await touchSwipe(page, card(page, '消すタスク'), -220);
    await expect(card(page, '消すタスク')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(/削除しました/);
    await page.getByRole('button', { name: '元に戻す' }).tap();
    await expect(card(page, '消すタスク')).toBeVisible();
  });

  test('完了で右フリックは無効（動かない）', async ({ page }) => {
    await open(page);
    await addMemo(page, '完了済み');
    await touchSwipe(page, card(page, '完了済み'), 220);
    await tab(page, 'doing').tap();
    await touchSwipe(page, card(page, '完了済み'), 220);
    await tab(page, 'done').tap();
    await touchSwipe(page, card(page, '完了済み'), 240);
    await page.waitForTimeout(700);
    await expect(count(page, 'done')).toHaveText('1');
    await expect(card(page, '完了済み')).toBeVisible();
  });

  test('縦スクロールではフリックが発動しない', async ({ page }) => {
    await open(page);
    for (let i = 1; i <= 12; i++) await addMemo(page, `縦スクロール${i}`);
    await touchSwipe(page, card(page, '縦スクロール6'), 30, { dy: -300, steps: 12 });
    await page.waitForTimeout(600);
    await expect(count(page, 'todo')).toHaveText('12');
    await expect(count(page, 'doing')).toHaveText('0');
  });

  test('移動の元に戻す', async ({ page }) => {
    await open(page);
    await addMemo(page, '戻したい');
    await touchSwipe(page, card(page, '戻したい'), 220);
    await expect(count(page, 'doing')).toHaveText('1');
    await page.getByRole('button', { name: '元に戻す' }).tap();
    await expect(count(page, 'todo')).toHaveText('1');
    await expect(card(page, '戻したい')).toBeVisible();
  });

  test('初回だけフリックのヒントでカードが揺れる', async ({ page }) => {
    await open(page);
    await addMemo(page, 'ヒント');
    const c = card(page, 'ヒント');
    await page.waitForTimeout(1500);
    const n = await c.evaluate((el) => el.getAnimations().length);
    expect(n).toBeGreaterThan(0);
    await touchSwipe(page, c, 220);
    const seen = await page.evaluate(() => localStorage.getItem('flick.v1.hint'));
    expect(seen).toBe('true');
  });
});

test.describe('編集シート', () => {
  test('タップで開き、タイトル・詳細・ステータスを編集、Esc で閉じる', async ({ page }) => {
    await open(page);
    await addMemo(page, '編集前');
    await card(page, '編集前').tap();
    const sheet = page.getByRole('dialog', { name: 'タスクを編集' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('タイトル').fill('編集後');
    await sheet.getByLabel('詳細').fill('メモ詳細');
    await sheet.getByRole('radio', { name: '進行中' }).tap();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await tab(page, 'doing').tap();
    await expect(card(page, '編集後')).toContainText('メモ詳細');
  });

  test('シートから削除できる', async ({ page }) => {
    await open(page);
    await addMemo(page, 'シート削除');
    await card(page, 'シート削除').tap();
    await page.getByRole('dialog').getByRole('button', { name: '削除' }).tap();
    await expect(card(page, 'シート削除')).toHaveCount(0);
  });
});

test.describe('ログインと同期', () => {
  test('Google ログインボタンは /auth/google へ遷移する', async ({ page }) => {
    await open(page);
    const req = page.waitForRequest((r) => new URL(r.url()).pathname === '/auth/google');
    await page.getByTestId('login').tap();
    await req;
  });

  test('Google の認可画面へ PKCE 付きでリダイレクトする', async ({ request }) => {
    const res = await request.get('/auth/google', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const url = new URL(res.headers()['location']);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/auth\/callback$/);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
    expect(cookies.some((c) => c.startsWith('g_state=') && /HttpOnly/i.test(c))).toBeTruthy();
  });

  test('OAuth の state 不一致はエラー表示で戻る', async ({ page }) => {
    await page.goto('/auth/callback?code=x&state=forged');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status')).toHaveText(/ログインできませんでした/);
  });

  test('ゲストのメモはログイン時にアカウントへ引き継がれ、別端末でも見える', async ({ page, context, baseURL, browser }) => {
    await open(page);
    await addMemo(page, 'ゲストで書いた');
    const email = await devLogin(context, baseURL!);
    await page.reload();
    await expect(page.getByRole('button', { name: 'アカウント' })).toBeVisible();
    await expect(card(page, 'ゲストで書いた')).toBeVisible();
    await addMemo(page, 'ログイン後に書いた');
    await touchSwipe(page, card(page, 'ログイン後に書いた'), 220);
    await expect(count(page, 'doing')).toHaveText('1');
    await page.waitForTimeout(800);

    // 別端末（別コンテキスト）で同じアカウント
    const other = await browser.newContext({ ...test.info().project.use, baseURL });
    await devLogin(other, baseURL!, email);
    const p2 = await other.newPage();
    await open(p2);
    await expect(card(p2, 'ゲストで書いた')).toBeVisible();
    await expect(count(p2, 'doing')).toHaveText('1');
    await other.close();
  });

  test('オフライン中の変更は再接続時に同期される', async ({ page, context, baseURL }) => {
    await devLogin(context, baseURL!);
    await open(page);
    await context.setOffline(true);
    await addMemo(page, 'オフラインで書いた');
    await page.waitForTimeout(500);
    let server = await page.request.get('/api/tasks').then((r) => r.json());
    await context.setOffline(false);
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expect
      .poll(async () => {
        server = await page.request.get('/api/tasks').then((r) => r.json());
        return server.tasks.map((t: { title: string }) => t.title);
      })
      .toContain('オフラインで書いた');
  });

  test('ログアウトで端末のデータが消える', async ({ page, context, baseURL }) => {
    await devLogin(context, baseURL!);
    await open(page);
    await addMemo(page, '機密メモ');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'アカウント' }).tap();
    await page.getByRole('menuitem', { name: 'ログアウト' }).tap();
    await expect(page.getByTestId('login')).toBeVisible();
    await expect(card(page, '機密メモ')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('flick.v1.tasks'));
    expect(stored).toBe('{}');
  });

  test('API は未ログインと別オリジンを拒否する', async ({ request, baseURL }) => {
    expect((await request.get('/api/tasks')).status()).toBe(401);
    const r = await request.post('/api/sync', { headers: { Origin: 'https://evil.example' }, data: { ops: [] } });
    expect(r.status()).toBe(403);
    expect(baseURL).toBeTruthy();
  });

  test('他人のタスクは見えない', async ({ browser, baseURL }) => {
    const a = await browser.newContext({ baseURL });
    await devLogin(a, baseURL!);
    await a.request.post('/api/sync', {
      headers: { Origin: baseURL! },
      data: { ops: [{ id: 'secretsecret01', title: 'Aの秘密', status: 'todo', position: 1, createdAt: 1, updatedAt: 1 }] },
    });
    const b = await browser.newContext({ baseURL });
    await devLogin(b, baseURL!);
    const res = await b.request.get('/api/tasks').then((r) => r.json());
    expect(res.tasks).toHaveLength(0);
    // 同じ id を上書きしようとしても A のデータは変わらない
    await b.request.post('/api/sync', {
      headers: { Origin: baseURL! },
      data: { ops: [{ id: 'secretsecret01', title: 'Bが上書き', status: 'done', position: 1, createdAt: 1, updatedAt: 9e12 }] },
    });
    const ra = await a.request.get('/api/tasks').then((r) => r.json());
    expect(ra.tasks[0].title).toBe('Aの秘密');
    await a.close();
    await b.close();
  });
});

test.describe('AI 機能（Workers AI・ローカルではモック）', () => {
  test('ゲストが AI を使おうとするとログインを促す', async ({ page }) => {
    await open(page);
    await page.getByTestId('composer').fill('A して B する');
    await page.getByRole('button', { name: 'AI でタスクに分ける' }).tap();
    await expect(page.getByRole('status')).toHaveText(/Google でログインすると使えます/);
  });

  test('メモを AI でタスクに分解できる・元に戻せる', async ({ page, context, baseURL }) => {
    await devLogin(context, baseURL!);
    await open(page);
    await page.getByTestId('composer').fill('牛乳を買う。企画書を確認、田中さんに電話');
    await page.getByRole('button', { name: 'AI でタスクに分ける' }).tap();
    await expect(count(page, 'todo')).toHaveText('3');
    const titles = await page.locator('[data-task] .title').allTextContents();
    expect(titles).toEqual(['牛乳を買う', '企画書を確認', '田中さんに電話']);
    await expect(page.getByRole('status')).toHaveText(/3件のタスクに分けました/);
    await page.getByRole('button', { name: '元に戻す' }).tap();
    await expect(count(page, 'todo')).toHaveText('0');
    await expect(page.getByTestId('composer')).toHaveValue('牛乳を買う。企画書を確認、田中さんに電話');
  });

  test('音声メモ：録音して文字起こしがメモ欄に入る', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['microphone']);
    await devLogin(context, baseURL!);
    await open(page);
    await page.getByRole('button', { name: '音声でメモ' }).tap();
    await expect(page.getByRole('button', { name: '録音を止める' })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '録音を止める' }).tap();
    await expect(page.getByTestId('composer')).toHaveValue('牛乳を買う、それから企画書を確認する');
  });
});

test.describe('品質', () => {
  test('320px 幅でも横スクロールが出ない・タップ領域が 44px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    await addMemo(page, 'とても長いタイトルのタスクで折り返しが正しく機能するかを確認するためのテキストです');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const b of await page.locator('button:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(38);
    }
  });

  test('アニメーション：タブのピルがばねで移動し、件数が回転表示される', async ({ page }) => {
    await open(page);
    const pill = page.locator('.pill');
    const x0 = (await pill.boundingBox())!.x;
    await tab(page, 'done').tap();
    const samples: number[] = [];
    for (let i = 0; i < 12; i++) {
      samples.push((await pill.boundingBox())!.x);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(900);
    const target = (await pill.boundingBox())!.x;
    expect(target).toBeGreaterThan(x0 + 100);
    // 途中経過の値がある（瞬間移動ではない）
    expect(samples.some((x) => x > x0 + 5 && Math.abs(x - target) > 5)).toBeTruthy();
  });

  test('コンソールエラーが出ない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await open(page);
    await addMemo(page, 'エラーなし');
    await touchSwipe(page, card(page, 'エラーなし'), 220);
    await card(page, 'エラーなし').waitFor({ state: 'detached' });
    expect(errors).toEqual([]);
  });
});
