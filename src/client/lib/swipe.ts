export type Dir = 'left' | 'right';

export interface SwipeOptions {
  /** その方向へのフリックが有効か */
  allowed: (dir: Dir) => boolean;
  /** ドラッグ中の進捗（0 = 中立, 1 = 確定しきい値） */
  onProgress: (dir: Dir | null, progress: number) => void;
  /** 確定時。dx は離した時点の移動量。Promise 解決までカードは現在位置に留まる */
  onCommit: (dir: Dir, dx: number) => void | Promise<void>;
  onTap: () => void;
}

const LOCK = 8;
const SPRING_BACK = 'cubic-bezier(.34,1.56,.64,1)';

export function vibrate(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS Safari などは非対応 */
  }
}

/**
 * 横方向のフリック操作。縦スクロールはブラウザに任せ（touch-action: pan-y）、
 * 横方向にロックした時だけポインタをキャプチャしてカードを追従させる。
 */
export function swipe(node: HTMLElement, opts: SwipeOptions) {
  let o = opts;
  let id: number | null = null;
  let x0 = 0, y0 = 0, dx = 0;
  let locked: 'x' | 'y' | null = null;
  let crossed = false;
  let samples: { x: number; t: number }[] = [];
  let busy = false;
  let suppressClick = false;

  const width = () => node.getBoundingClientRect().width || 320;
  const threshold = () => Math.min(140, width() * 0.32);

  function render(x: number) {
    const w = width();
    node.style.transform = `translate3d(${x}px,0,0) rotate(${(x / w) * 2.2}deg)`;
  }

  function effective(raw: number) {
    const dir: Dir = raw > 0 ? 'right' : 'left';
    if (!o.allowed(dir)) return raw * 0.18; // 無効方向はゴムのように重く
    const t = threshold();
    const a = Math.abs(raw);
    if (a <= t * 1.6) return raw;
    return Math.sign(raw) * (t * 1.6 + (a - t * 1.6) * 0.35);
  }

  function down(e: PointerEvent) {
    if (busy || id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest('[data-noswipe]')) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    locked = null;
    crossed = false;
    suppressClick = false;
    samples = [{ x: e.clientX, t: e.timeStamp }];
  }

  function move(e: PointerEvent) {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;
    if (!locked) {
      if (Math.abs(mx) < LOCK && Math.abs(my) < LOCK) return;
      locked = Math.abs(mx) > Math.abs(my) * 1.15 ? 'x' : 'y';
      if (locked === 'x') {
        suppressClick = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          /* 合成イベントなど */
        }
        node.classList.add('dragging');
        node.getAnimations().forEach((a) => a.cancel());
      }
    }
    if (locked !== 'x') return;
    e.preventDefault();
    dx = effective(mx);
    render(dx);
    // 速度はイベント発生時刻で測る（処理が遅れても実際の指の速さを反映）
    const now = e.timeStamp;
    samples.push({ x: e.clientX, t: now });
    while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
    const dir: Dir | null = dx === 0 ? null : dx > 0 ? 'right' : 'left';
    const allowed = dir ? o.allowed(dir) : false;
    const p = allowed ? Math.abs(dx) / threshold() : 0;
    o.onProgress(dir, p);
    if (allowed && p >= 1 !== crossed) {
      crossed = p >= 1;
      if (crossed) vibrate(10);
    }
  }

  async function up(e: PointerEvent) {
    if (e.pointerId !== id) return;
    id = null;
    node.classList.remove('dragging');
    if (locked !== 'x') return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const v = (last.x - first.x) / Math.max(1, last.t - first.t); // px/ms
    const dir: Dir = dx > 0 ? 'right' : 'left';
    const flicked = Math.abs(v) > 0.55 && Math.sign(v) === Math.sign(dx) && Math.abs(dx) > 28;
    if (o.allowed(dir) && (Math.abs(dx) >= threshold() || flicked)) {
      if (!crossed) vibrate(10);
      busy = true;
      try {
        await o.onCommit(dir, dx);
      } finally {
        busy = false;
      }
      return;
    }
    // しきい値未満：バネで元の位置へ戻す
    const from = node.style.transform;
    node.style.transform = '';
    o.onProgress(null, 0);
    node.animate([{ transform: from }, { transform: 'translate3d(0,0,0) rotate(0)' }], {
      duration: 520,
      easing: SPRING_BACK,
    });
  }

  // タップは click で判定する（pointerup で開くと、直後の click が開いたシートの背景に当たって閉じてしまう）
  const click = (e: MouseEvent) => {
    if (suppressClick || busy) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    o.onTap();
  };
  node.addEventListener('click', click);
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  // 横ドラッグ中にブラウザのスクロール・戻るジェスチャーが割り込まないように
  const touchmove = (e: TouchEvent) => {
    if (locked === 'x' && e.cancelable) e.preventDefault();
  };
  node.addEventListener('touchmove', touchmove, { passive: false });

  return {
    update(next: SwipeOptions) {
      o = next;
    },
    destroy() {
      node.removeEventListener('click', click);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('touchmove', touchmove);
    },
  };
}
