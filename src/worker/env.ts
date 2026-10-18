import type { User } from '../shared/types';

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AI_MODEL: string;
  STT_MODEL: string;
  AI_DAILY_LIMIT: string;
  /** ローカル開発専用。"1" のとき localhost に限り開発用ログインと AI モックを有効化 */
  DEV_MODE?: string;
}

export interface AppVars {
  user: User | null;
}

export function isDev(env: Env, url: string): boolean {
  if (env.DEV_MODE !== '1') return false;
  const h = new URL(url).hostname;
  return h === 'localhost' || h === '127.0.0.1';
}
