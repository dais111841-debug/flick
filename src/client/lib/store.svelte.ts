import { api, HttpError } from './api';
import type { Status, Task, User } from '../../shared/types';
import { STATUSES } from '../../shared/types';

const K = {
  tasks: 'flick.v1.tasks',
  dirty: 'flick.v1.dirty',
  user: 'flick.v1.user',
  draft: 'flick.v1.draft',
  tab: 'flick.v1.tab',
  hint: 'flick.v1.hint',
};

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 容量超過やプライベートモードでも動作は継続 */
  }
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function nextStatus(s: Status): Status | null {
  const i = STATUSES.indexOf(s);
  return i < STATUSES.length - 1 ? STATUSES[i + 1] : null;
}
export function prevStatus(s: Status): Status | null {
  const i = STATUSES.indexOf(s);
  return i > 0 ? STATUSES[i - 1] : null;
}

export const STATUS_LABEL: Record<Status, string> = { todo: '未着手', doing: '進行中', done: '完了' };

class Store {
  /** id → task（同期前の削除 tombstone を含む） */
  all = $state<Record<string, Task>>(load(K.tasks, {}));
  dirty = $state<Record<string, number>>(load(K.dirty, {}));
  user = $state<User | null>(load(K.user, null));
  /** 'unknown' = サーバ確認前（キャッシュで仮表示中） */
  auth = $state<'unknown' | 'user' | 'guest'>('unknown');
  /** 初回データ取得が完了したか（スケルトン表示の判定） */
  ready = $state(false);
  syncing = $state(false);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  tab = $state<Status>(load<Status>(K.tab, 'todo'));
  hintSeen = $state<boolean>(load(K.hint, false));

  visible = $derived(
    Object.values(this.all)
      .filter((t) => !t.deleted)
      .sort((a, b) => b.position - a.position),
  );
  counts = $derived(
    STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: this.visible.filter((t) => t.status === s).length }),
      {} as Record<Status, number>,
    ),
  );
  inTab = $derived(this.visible.filter((t) => t.status === this.tab));

  private timer: ReturnType<typeof setTimeout> | null = null;

  private persist() {
    save(K.tasks, this.all);
    save(K.dirty, this.dirty);
  }

  setTab(s: Status) {
    this.tab = s;
    save(K.tab, s);
  }

  markHintSeen() {
    this.hintSeen = true;
    save(K.hint, true);
  }

  put(task: Task) {
    const t = { ...task, updatedAt: Math.max(Date.now(), (this.all[task.id]?.updatedAt ?? 0) + 1) };
    this.all[t.id] = t;
    this.dirty[t.id] = t.updatedAt;
    this.persist();
    this.scheduleSync();
    return t;
  }

  add(title: string, note = '', status: Status = 'todo', position = Date.now()): Task {
    const now = Date.now();
    return this.put({ id: newId(), title, note, status, position, createdAt: now, updatedAt: now });
  }

  move(id: string, status: Status) {
    const t = this.all[id];
    if (!t) return;
    this.put({ ...t, status, position: Date.now() });
  }

  update(id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'status'>>) {
    const t = this.all[id];
    if (!t) return;
    this.put({ ...t, ...patch });
  }

  remove(id: string): Task | undefined {
    const t = this.all[id];
    if (!t) return;
    this.put({ ...t, deleted: true });
    return t;
  }

  restore(task: Task) {
    this.put({ ...task, deleted: false });
  }

  get draft(): string {
    try {
      return localStorage.getItem(K.draft) ?? '';
    } catch {
      return '';
    }
  }
  set draft(v: string) {
    try {
      if (v) localStorage.setItem(K.draft, v);
      else localStorage.removeItem(K.draft);
    } catch {
      /* noop */
    }
  }

  scheduleSync(delay = 350) {
    if (this.auth !== 'user') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  async sync() {
    if (this.auth !== 'user' || !this.online || this.syncing) return;
    this.syncing = true;
    const sent = { ...this.dirty };
    const ops = Object.keys(sent)
      .map((id) => this.all[id])
      .filter(Boolean)
      .map((t) => $state.snapshot(t));
    try {
      const { tasks } = await api.sync(ops);
      // 送信中に再編集されていないものだけ dirty を解除
      for (const id of Object.keys(sent)) {
        if (this.dirty[id] === sent[id]) delete this.dirty[id];
      }
      const next: Record<string, Task> = {};
      for (const t of tasks) next[t.id] = t;
      // まだ未送信の手元の変更はサーバの値より優先
      for (const id of Object.keys(this.dirty)) if (this.all[id]) next[id] = this.all[id];
      this.all = next;
      this.persist();
      this.ready = true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) this.setGuest();
    } finally {
      this.syncing = false;
      if (Object.keys(this.dirty).length && this.auth === 'user') {
        const pending = Object.entries(this.dirty).some(([id, v]) => sent[id] !== v);
        if (pending) this.scheduleSync(50);
      }
    }
  }

  private setGuest() {
    this.auth = 'guest';
    this.user = null;
    save(K.user, null);
    this.ready = true;
  }

  async init() {
    addEventListener('online', () => {
      this.online = true;
      void this.sync();
    });
    addEventListener('offline', () => (this.online = false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
    });

    // キャッシュがあれば即座に表示（サーバ応答を待たない）
    if (this.user || Object.keys(this.all).length) this.ready = true;

    try {
      const me = await api.me();
      if (me.user) {
        const switched = this.user && this.user.id !== me.user.id;
        if (switched) {
          this.all = {};
          this.dirty = {};
        } else if (!this.user) {
          // ゲスト時に書いたメモをアカウントへ引き継ぐ
          for (const id of Object.keys(this.all)) this.dirty[id] = this.all[id].updatedAt;
        }
        this.user = me.user;
        save(K.user, me.user);
        this.auth = 'user';
        await this.sync();
      } else {
        if (this.user) {
          // セッション切れ：アカウントのデータは端末から消す
          this.all = {};
          this.dirty = {};
          this.persist();
        }
        this.setGuest();
      }
    } catch {
      // オフライン：キャッシュのまま続行
      this.auth = this.user ? 'user' : 'guest';
      this.ready = true;
    }
  }

  login() {
    location.href = '/auth/google';
  }

  async logout() {
    await this.sync().catch(() => {});
    await api.logout().catch(() => {});
    this.all = {};
    this.dirty = {};
    this.persist();
    this.setGuest();
  }
}

export const store = new Store();
