import type { Task, User } from '../../shared/types';

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(`${status} ${code}`);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new HttpError(res.status, (body as { error?: string }).error ?? 'error');
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  me: () => req<{ user: User | null; devLogin: boolean }>('/api/me'),
  sync: (ops: Task[]) => req<{ tasks: Task[] }>('/api/sync', json({ ops })),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  split: (text: string) => req<{ tasks: string[] }>('/api/ai/split', json({ text })),
  transcribe: (audio: Blob) =>
    req<{ text: string }>('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': audio.type || 'application/octet-stream' },
      body: audio,
    }),
};
