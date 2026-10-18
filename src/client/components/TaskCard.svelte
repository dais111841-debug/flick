<script lang="ts">
  import type { Task, Status } from '../../shared/types';
  import { store, nextStatus, prevStatus, STATUS_LABEL } from '../lib/store.svelte';
  import { ui, ago } from '../lib/ui.svelte';
  import { swipe, vibrate, type Dir } from '../lib/swipe';
  import Icon from './Icon.svelte';

  let { task, hint = false }: { task: Task; hint?: boolean } = $props();

  let card: HTMLElement;
  let dir = $state<Dir | null>(null);
  let progress = $state(0);
  let flying = $state(false);

  const next = $derived(nextStatus(task.status));
  const prev = $derived(prevStatus(task.status));
  // 右 = 次のステータスへ / 左 = 前に戻す（未着手なら削除）
  const target = (d: Dir): Status | 'delete' | null => (d === 'right' ? next : (prev ?? 'delete'));

  async function commit(d: Dir) {
    const t = target(d);
    if (!t) return;
    flying = true;
    store.markHintSeen();
    const rect = card.getBoundingClientRect();
    const from = card.style.transform || 'translate3d(0,0,0)';

    if (t === 'delete') {
      await card.animate(
        [
          { transform: from, opacity: 1 },
          { transform: `translate3d(${-rect.width * 1.15}px,0,0) rotate(-6deg)`, opacity: 0 },
        ],
        { duration: 300, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
      ).finished;
      ui.skipOut.add(task.id);
      const removed = store.remove(task.id);
      ui.show('削除しました', removed ? { label: '元に戻す', run: () => store.restore(removed) } : undefined);
      return;
    }

    // 行き先のタブへ吸い込まれるように飛ばす
    const dot = document.querySelector(`[data-tab="${t}"] .dot`)?.getBoundingClientRect();
    const tx = dot ? dot.left + dot.width / 2 - (rect.left + rect.width / 2) : d === 'right' ? 400 : -400;
    const ty = dot ? dot.top + dot.height / 2 - (rect.top + rect.height / 2) : 0;
    const cur = new DOMMatrix(getComputedStyle(card).transform);
    await card.animate(
      [
        { transform: from, opacity: 1, borderRadius: '22px', offset: 0 },
        {
          transform: `translate3d(${cur.e + (tx - cur.e) * 0.35}px, ${ty * 0.2 + 6}px, 0) scale(.82)`,
          opacity: 1,
          borderRadius: '30px',
          offset: 0.35,
        },
        { transform: `translate3d(${tx}px, ${ty}px, 0) scale(.04)`, opacity: 0.2, borderRadius: '999px', offset: 1 },
      ],
      { duration: 560, easing: 'cubic-bezier(.55,.05,.35,1)', fill: 'forwards' },
    ).finished;
    ui.skipOut.add(task.id);
    const before = task.status;
    store.move(task.id, t);
    vibrate(6);
    dispatchEvent(new CustomEvent('flick:arrive', { detail: t }));
    ui.show(`${STATUS_LABEL[t]}にしました`, {
      label: '元に戻す',
      run: () => store.update(task.id, { status: before }),
    });
  }

  function onKey(e: KeyboardEvent) {
    if (flying) return;
    if (e.key === 'ArrowRight' && next) commit('right');
    else if (e.key === 'ArrowLeft') commit('left');
    else if (e.key === 'Enter' || e.key === ' ') ui.editing = task.id;
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const removed = store.remove(task.id);
      if (removed) ui.show('削除しました', { label: '元に戻す', run: () => store.restore(removed) });
    } else return;
    e.preventDefault();
  }

  // 初回のみ：カードを少しだけ右へ揺らしてフリックできることを示す
  $effect(() => {
    if (!hint || !card) return;
    let touched = false;
    const mark = () => (touched = true);
    card.addEventListener('pointerdown', mark);
    const id = setTimeout(() => {
      if (touched) return;
      if (flying || card.classList.contains('dragging')) return;
      dir = 'right';
      const a = card.animate(
        [
          { transform: 'translate3d(0,0,0)' },
          { transform: 'translate3d(64px,0,0) rotate(.6deg)', offset: 0.45 },
          { transform: 'translate3d(0,0,0)' },
        ],
        { duration: 1300, easing: 'cubic-bezier(.45,0,.25,1)' },
      );
      progress = 0.5;
      a.finished.then(() => {
        progress = 0;
        dir = null;
      }).catch(() => {});
    }, 1100);
    return () => {
      clearTimeout(id);
      card.removeEventListener('pointerdown', mark);
    };
  });

  const reveal = $derived(dir ? target(dir) : null);
</script>

<div class="row" data-dir={dir} class:flying style="--p: {Math.min(progress, 1)}">
  <div
    class="track"
    class:armed={progress >= 1}
    style="--c: var(--{reveal === 'delete' ? 'danger' : (reveal ?? 'todo')})"
    aria-hidden="true"
  >
    {#if reveal}
      <span class="cue {dir}">
        <Icon name={reveal === 'delete' ? 'trash' : reveal === 'done' ? 'check' : dir === 'right' ? 'next' : 'prev'} size={18} stroke={2.4} />
        {reveal === 'delete' ? '削除' : STATUS_LABEL[reveal]}
      </span>
    {/if}
  </div>
  <div
    bind:this={card}
    class="card glass"
    class:done={task.status === 'done'}
    tabindex="0"
    role="button"
    aria-roledescription="タスク"
    data-task={task.id}
    aria-label={`${task.title}（${STATUS_LABEL[task.status]}）`}
    aria-keyshortcuts="ArrowRight ArrowLeft Enter Delete"
    onkeydown={onKey}
    use:swipe={{
      allowed: (d) => !flying && !!target(d),
      onProgress: (d, p) => {
        dir = d;
        progress = p;
      },
      onCommit: (d) => commit(d),
      onTap: () => (ui.editing = task.id),
    }}
  >
    {#if task.status === 'done'}
      <span class="check"><Icon name="check" size={14} stroke={3} /></span>
    {:else}
      <span class="ring" style="--c: var(--{task.status})"></span>
    {/if}
    <div class="body">
      <p class="title">{task.title}</p>
      {#if task.note}<p class="note">{task.note}</p>{/if}
      <time class="time tnum" datetime={new Date(task.updatedAt).toISOString()}>{ago(task.updatedAt)}</time>
    </div>
  </div>
</div>

<style>
  .row {
    position: relative;
    margin-bottom: 10px;
  }
  .track {
    position: absolute;
    inset: 1px;
    border-radius: 22px;
    display: flex;
    align-items: center;
    background: color-mix(in srgb, var(--c) calc(8% + var(--p) * 22%), rgba(255, 255, 255, 0.3));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 25%, transparent);
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .row[data-dir] .track {
    opacity: 1;
  }
  .row.flying .track {
    opacity: 0;
    transition-duration: 0.35s;
  }
  .track.armed {
    background: var(--c);
  }
  .cue {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 650;
    color: var(--c);
    transform: scale(calc(0.7 + var(--p) * 0.3));
    opacity: calc(0.35 + var(--p) * 0.65);
    transition: color 0.2s, transform 0.35s var(--spring);
  }
  .cue.right {
    left: 18px;
  }
  .cue.left {
    right: 18px;
  }
  .track.armed .cue {
    color: #fff;
    transform: scale(1.08);
  }
  .card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 12px;
    border-radius: 22px;
    min-height: 60px;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    will-change: transform;
    outline-offset: 3px;
  }
  .card:global(.dragging) {
    cursor: grabbing;
    box-shadow: var(--glass-shadow), 0 18px 40px -12px rgba(31, 45, 80, 0.22);
  }
  .ring {
    flex: none;
    width: 20px;
    height: 20px;
    margin-top: 2px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--c) 70%, white);
    background: rgba(255, 255, 255, 0.6);
  }
  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-top: 2px;
    border-radius: 50%;
    background: var(--done);
    color: #fff;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 500;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .done .title {
    color: var(--muted);
  }
  .note {
    margin: 2px 0 0;
    font-size: 13px;
    line-height: 19px;
    color: var(--muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-line;
  }
  .time {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    line-height: 16px;
    color: var(--faint);
  }
</style>
