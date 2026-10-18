import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { isDev, type Env, type AppVars } from './env';
import { authRoutes, requireUser, sessionMiddleware } from './auth';
import { taskRoutes } from './tasks';
import { aiRoutes } from './ai';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'", 'https://accounts.google.com'],
    },
    permissionsPolicy: { microphone: ['self'], camera: [], geolocation: [] },
    crossOriginEmbedderPolicy: false,
  }),
);

// 状態を変更するリクエストは同一オリジンからのみ受け付ける（CSRF対策）
app.use('*', async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    const self = new URL(c.req.url).origin;
    if (origin !== self) return c.json({ error: 'bad_origin' }, 403);
  }
  await next();
});

app.use('*', sessionMiddleware);

app.route('/auth', authRoutes);

app.get('/api/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null, devLogin: isDev(c.env, c.req.url) });
  return c.json({ user, devLogin: false });
});

app.use('/api/tasks/*', requireUser);
app.use('/api/tasks', requireUser);
app.use('/api/sync', requireUser);
app.use('/api/ai/*', requireUser);
app.route('/api', taskRoutes);
app.route('/api/ai', aiRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

export default app;
