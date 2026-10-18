export type Status = 'todo' | 'doing' | 'done';

export const STATUSES: readonly Status[] = ['todo', 'doing', 'done'] as const;

export interface Task {
  id: string;
  title: string;
  note: string;
  status: Status;
  position: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export const LIMITS = {
  title: 500,
  note: 5000,
  syncOps: 500,
  aiText: 4000,
  audioBytes: 8 * 1024 * 1024,
} as const;
