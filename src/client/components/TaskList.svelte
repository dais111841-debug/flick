<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { cubicOut, backOut } from 'svelte/easing';
  import { STATUSES } from '../../shared/types';
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui.svelte';
  import TaskCard from './TaskCard.svelte';

  let prevIndex = STATUSES.indexOf(store.tab);
  let slide = $state(0);
  $effect.pre(() => {
    const i = STATUSES.indexOf(store.tab);
    slide = Math.sign(i - prevIndex);
    prevIndex = i;
  });

  function enter(node: Element, { i }: { i: number }) {
    return {
      delay: Math.min(i, 8) * 38,
      duration: 520,
      easing: backOut,
      css: (t: number, u: number) =>
        `transform: translate3d(${slide * 28 * u}px, ${slide === 0 ? 18 * u : 0}px, 0) scale(${0.96 + 0.04 * t}); opacity: ${Math.min(1, t * 1.6)}; filter: blur(${Math.max(0, u) * 6}px)`,
    };
  }

  function leave(node: HTMLElement, { id }: { id: string }) {
    if (ui.skipOut.delete(id)) return { duration: 0 };
    const h = node.offsetHeight;
    return {
      duration: 320,
      easing: cubicOut,
      css: (t: number) =>
        `height: ${h * t}px; margin-bottom: ${10 * t}px; opacity: ${t}; transform: scale(${0.94 + 0.06 * t}); overflow: hidden`,
    };
  }

  const EMPTY: Record<string, string> = {
    todo: '下の欄にメモを書くとここに並びます',
    doing: '未着手のタスクを右へフリックするとここに移ります',
    done: '進行中のタスクを右へフリックすると完了になります',
  };
</script>

{#key store.tab}
  <div class="list" role="tabpanel" aria-label="タスク一覧" in:fly|global={{ x: slide * 24, duration: 260, opacity: 0 }}>
    {#each store.inTab as task, i (task.id)}
      <div class="item" animate:flip={{ duration: 420, easing: backOut }} in:enter|global={{ i }} out:leave={{ id: task.id }}>
        <TaskCard {task} hint={i === 0 && store.tab === 'todo' && !store.hintSeen} />
      </div>
    {:else}
      <p class="empty" in:fly|global={{ y: 10, duration: 400, delay: 120 }}>{EMPTY[store.tab]}</p>
    {/each}
  </div>
{/key}

<style>
  .list {
    padding: 4px 0 0;
  }
  .empty {
    margin: 48px auto 0;
    max-width: 22em;
    text-align: center;
    font-size: 14px;
    line-height: 22px;
    color: var(--faint);
  }
</style>
