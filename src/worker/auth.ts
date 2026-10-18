import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Google, generateCodeVerifier, generateState, decodeIdToken, OAuth2RequestError } from 'arctic';
import { isDev, type Env, type AppVars } from './env';
import type { User } from '../shared/types';

const SESSION_DAYS = 30;
const DAY = 86_400_000;

type C = { Bindings: Env; Variables: AppVars };

function isHttps(url: string) {
  return new URL(url).protocol === 'https:';
}
function cookieName(url: string, base: string) {
  // HTTPS では __Host- 接頭辞でドメイン/パスを固定し、サブドメインからの上書きを防ぐ
  return isHttps(url) ? `__Host-${base}` : base;
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const sessionMiddleware: MiddlewareHandler<C> = async (c, next) => {
  c.set('user', null);
  const token = getCookie(c, cookieName(c.req.url, 'sid'));
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.picture, s.expires_at, s.id_hash
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ?`,
    )
      .bind(await sha256(token))
      .first<{ id: string; email: string; name: string; picture: string; expires_at: number; id_hash: string }>();
    const now = Date.now();
    if (row && row.expires_at > now) {
      c.set('user', { id: row.id, email: row.email, name: row.name, picture: row.picture });
      // スライディング更新：残り半分を切ったら延長
      if (row.expires_at - now < (SESSION_DAYS / 2) * DAY) {
        const exp = now + SESSION_DAYS * DAY;
        await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(exp, row.id_hash).run();
        setSessionCookie(c, token, exp);
      }
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<C> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

function setSessionCookie(c: Parameters<MiddlewareHandler<C>>[0], token: string, exp: number) {
  setCookie(c, cookieName(c.req.url, 'sid'), token, {
    path: '/',
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: 'Lax',
    expires: new Date(exp),
  });
}

async function createSession(c: Parameters<MiddlewareHandler<C>>[0], userId: string) {
  const token = randomToken();
  const exp = Date.now() + SESSION_DAYS * DAY;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, Date.now()),
    c.env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256(token),
      userId,
      exp,
    ),
  ]);
  setSessionCookie(c, token, exp);
}

async function upsertUser(env: Env, sub: string, email: string, name: string, picture: string): Promise<User> {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(sub).first<{ id: string }>();
  if (existing) {
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?')
      .bind(email, name, picture, existing.id)
      .run();
    return { id: existing.id, email, name, picture };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, sub, email, name, picture, Date.now())
    .run();
  return { id, email, name, picture };
}

function google(c: Parameters<MiddlewareHandler<C>>[0]) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  // Google Cloud Console に登録したリダイレクト URI と完全一致させる（オリジン + /auth/callback）
  const redirect = new URL('/auth/callback', c.req.url).toString();
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirect);
}

export const authRoutes = new Hono<C>();

authRoutes.get('/google', (c) => {
  const g = google(c);
  if (!g) return c.text('Google OAuth is not configured', 503);
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = g.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
  url.searchParams.set('prompt', 'select_account');
  const opts = { path: '/', httpOnly: true, secure: isHttps(c.req.url), sameSite: 'Lax' as const, maxAge: 600 };
  setCookie(c, 'g_state', state, opts);
  setCookie(c, 'g_verifier', verifier, opts);
  return c.redirect(url.toString(), 302);
});

authRoutes.get('/callback', async (c) => {
  const g = google(c);
  if (!g) return c.text('Google OAuth is not configured', 503);
  const code = c.req.query('code');
  const state = c.req.query('state');
  const savedState = getCookie(c, 'g_state');
  const verifier = getCookie(c, 'g_verifier');
  deleteCookie(c, 'g_state', { path: '/' });
  deleteCookie(c, 'g_verifier', { path: '/' });
  if (!code || !state || !savedState || !verifier || state !== savedState) {
    return c.redirect('/?login_error=state', 302);
  }
  try {
    const tokens = await g.validateAuthorizationCode(code, verifier);
    // ID トークンは TLS 越しにトークンエンドポイントから直接受け取っているため、
    // OIDC Core 3.1.3.7 に従い署名検証は省略し、iss/aud/exp を検証する
    const claims = decodeIdToken(tokens.idToken()) as {
      iss: string; aud: string; exp: number; sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string;
    };
    if (
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
      claims.aud !== c.env.GOOGLE_CLIENT_ID ||
      claims.exp * 1000 < Date.now() ||
      !claims.email || claims.email_verified === false
    ) {
      return c.redirect('/?login_error=claims', 302);
    }
    const user = await upsertUser(c.env, claims.sub, claims.email, claims.name ?? '', claims.picture ?? '');
    await createSession(c, user.id);
    return c.redirect('/', 302);
  } catch (e) {
    console.error('oauth', e instanceof OAuth2RequestError ? e.code : e);
    return c.redirect('/?login_error=exchange', 302);
  }
});

authRoutes.post('/logout', async (c) => {
  const name = cookieName(c.req.url, 'sid');
  const token = getCookie(c, name);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, name, { path: '/', secure: isHttps(c.req.url) });
  return c.json({ ok: true });
});

/** ローカル開発・E2E テスト専用。DEV_MODE=1 かつ localhost のときのみ動作 */
authRoutes.post('/dev-login', async (c) => {
  if (!isDev(c.env, c.req.url)) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = body.email || 'tester@example.com';
  const user = await upsertUser(c.env, `dev:${email}`, email, email.split('@')[0], '');
  await createSession(c, user.id);
  return c.json({ user });
});
