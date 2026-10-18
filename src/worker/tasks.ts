import { Hono } from 'hono';
import type { Env, AppVars } from './env';
import { LIMITS, STATUSES, type Status, type Task } from '../shared/types';

type C = { Bindings: Env; Variables: AppVars };

interface Row {
  id: string; title: string; note: string; status: Status; position: number;
  created_at: number; updated_at: number; deleted: number;
}

const toTask = (r: Row): Task => ({
  id: r.id, title: r.title, note: r.note, status: r.status, position: r.position,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** クライアントから来たタスクを検証・正規化。不正なら null */
export function sanitize(input: unknown): (Task & { deleted: boolean }) | null {
  if (!input || typeof input !== 'object') return null;
  const t = input as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) return null;
  if (typeof t.title !== 'string') return null;
  const title = t.title.trim().slice(0, LIMITS.title);
  const deleted = t.deleted === true;
  if (!title && !deleted) return null;
  const status = STATUSES.includes(t.status as Status) ? (t.status as Status) : 'todo';
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const now = Date.now();
  // 端末時計のずれで未来の値が勝ち続けないよう、サーバ時刻 + 1 分で頭打ちにする
  const updatedAt = Math.min(num(t.updatedAt, now), now + 60_000);
  return {
    id: t.id,
    title: title || '(deleted)',
    note: typeof t.note === 'string' ? t.note.slice(0, LIMITS.note) : '',
    status,
    position: num(t.position, now),
    createdAt: Math.min(num(t.createdAt, now), now + 60_000),
    updatedAt,
    deleted,
  };
}

async function listTasks(env: Env, userId: string): Promise<Task[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0 ORDER BY position DESC',
  )
    .bind(userId)
    .all<Row>();
  return results.map(toTask);
}

export const taskRoutes = new Hono<C>();

taskRoutes.get('/tasks', async (c) => {
  return c.json({ tasks: await listTasks(c.env, c.get('user')!.id) });
});

/**
 * 端末側に溜まった変更（オフライン中のものも含む）を一括で反映し、最新の一覧を返す。
 * updatedAt が新しい方を採用する Last-Write-Wins。削除は tombstone として保持。
 */
taskRoutes.post('/sync', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json<{ ops?: unknown[] }>().catch(() => null);
  if (!body || !Array.isArray(body.ops)) return c.json({ error: 'bad_request' }, 400);
  if (body.ops.length > LIMITS.syncOps) return c.json({ error: 'too_many' }, 413);

  const ops = body.ops.map(sanitize).filter((t): t is NonNullable<typeof t> => !!t);
  if (ops.length) {
    const stmt = c.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, note, status, position, created_at, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET
         title = excluded.title, note = excluded.note, status = excluded.status,
         position = excluded.position, updated_at = excluded.updated_at, deleted = excluded.deleted
       WHERE excluded.updated_at >= tasks.updated_at`,
    );
    await c.env.DB.batch(
      ops.map((t) =>
        stmt.bind(t.id, user.id, t.title, t.note, t.status, t.position, t.createdAt, t.updatedAt, t.deleted ? 1 : 0),
      ),
    );
  }
  return c.json({ tasks: await listTasks(c.env, user.id), applied: ops.length });
});
