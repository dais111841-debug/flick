import type { Task } from '../../shared/types';

interface Toast {
  key: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'normal' | 'error';
}

class UI {
  editing = $state<string | null>(null);
  toast = $state<Toast | null>(null);
  /** フリックで飛ばしたカードは一覧からの退場アニメーションを省略する */
  skipOut = new Set<string>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  show(text: string, action?: Toast['action'], tone: Toast['tone'] = 'normal', ms = 4200) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { key: Date.now(), text, action, tone };
    this.toastTimer = setTimeout(() => (this.toast = null), ms);
  }

  dismiss() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = null;
  }
}

export const ui = new UI();

const rtf = new Intl.RelativeTimeFormat('ja', { numeric: 'auto' });
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return 'たった今';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

export type { Task };
