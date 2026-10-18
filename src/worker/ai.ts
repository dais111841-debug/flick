import { Hono } from 'hono';
import { isDev, type Env, type AppVars } from './env';
import { LIMITS } from '../shared/types';

type C = { Bindings: Env; Variables: AppVars };

export const aiRoutes = new Hono<C>();

/** 1 ユーザーあたりの 1 日の AI 呼び出し回数を制限（Workers AI の課金暴走を防ぐ） */
async function consumeQuota(env: Env, userId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const limit = Number(env.AI_DAILY_LIMIT) || 60;
  const row = await env.DB.prepare(
    `INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(userId, day)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

const SPLIT_SYSTEM = `あなたはタスク整理アシスタントです。ユーザーの雑多なメモ（音声入力由来で句読点や誤変換を含むことがあります）を読み、
実行可能なタスクに分解してください。
規則:
- 1 タスク = 1 つの具体的な行動。動詞で終わる短い日本語（例「見積書を田中さんに送る」）。
- 30 文字以内を目安に簡潔に。敬語・前置き・番号は付けない。
- メモに含まれない内容を創作しない。重複はまとめる。
- 最大 12 件。メモが 1 つの行動だけなら 1 件で良い。
- 誤変換と思われる語は文脈から自然な表記に直す。`;

const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    tasks: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasks'],
};

export function mockSplit(text: string): string[] {
  return text
    .split(/[\n。、,]|それから|あと/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => (typeof t === 'string' ? t : typeof t === 'object' && t && 'title' in t ? String((t as { title: unknown }).title) : ''))
    .map((t) => t.replace(/^\s*(?:[-*・•]|\d+[.)．])\s*/, '').trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 12);
}

aiRoutes.post('/split', async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, LIMITS.aiText) : '';
  if (!text) return c.json({ error: 'empty' }, 400);

  if (isDev(c.env, c.req.url)) return c.json({ tasks: mockSplit(text), mock: true });
  if (!(await consumeQuota(c.env, c.get('user')!.id))) return c.json({ error: 'quota' }, 429);

  const messages = [
    { role: 'system', content: SPLIT_SYSTEM },
    { role: 'user', content: text },
  ];
  try {
    const res = (await c.env.AI.run(c.env.AI_MODEL as keyof AiModels, {
      messages,
      response_format: { type: 'json_schema', json_schema: SPLIT_SCHEMA },
      max_tokens: 800,
      temperature: 0.2,
    } as never)) as { response?: unknown };
    const r = res.response;
    const parsed = typeof r === 'string' ? JSON.parse(r) : r;
    const tasks = cleanList((parsed as { tasks?: unknown })?.tasks);
    if (tasks.length) return c.json({ tasks });
  } catch (e) {
    console.warn('json mode failed, falling back', e);
  }
  // JSON モードが満たせなかった場合は行区切りで再要求
  const res = (await c.env.AI.run(c.env.AI_MODEL as keyof AiModels, {
    messages: [
      { role: 'system', content: SPLIT_SYSTEM + '\n出力はタスクを 1 行に 1 つずつ。それ以外は書かない。' },
      { role: 'user', content: text },
    ],
    max_tokens: 800,
    temperature: 0.2,
  } as never)) as { response?: string };
  const tasks = cleanList(String(res.response ?? '').split('\n'));
  return c.json({ tasks: tasks.length ? tasks : [text.slice(0, 120)] });
});

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

aiRoutes.post('/transcribe', async (c) => {
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > LIMITS.audioBytes) return c.json({ error: 'too_large' }, 413);
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) return c.json({ error: 'empty' }, 400);
  if (buf.byteLength > LIMITS.audioBytes) return c.json({ error: 'too_large' }, 413);

  if (isDev(c.env, c.req.url)) return c.json({ text: '牛乳を買う、それから企画書を確認する', mock: true });
  if (!(await consumeQuota(c.env, c.get('user')!.id))) return c.json({ error: 'quota' }, 429);

  const res = (await c.env.AI.run(c.env.STT_MODEL as keyof AiModels, {
    audio: toBase64(buf),
    language: 'ja',
    vad_filter: true,
  } as never)) as { text?: string };
  return c.json({ text: (res.text ?? '').trim() });
});
