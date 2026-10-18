<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import { STATUSES } from '../../shared/types';
  import { store, STATUS_LABEL } from '../lib/store.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let { id }: { id: string } = $props();

  const task = $derived(store.all[id]);
  // svelte-ignore state_referenced_locally
  let title = $state(store.all[id]?.title ?? '');
  // svelte-ignore state_referenced_locally
  let note = $state(store.all[id]?.note ?? '');
  let sheet: HTMLElement;
  let titleEl = $state<HTMLTextAreaElement>();
  let dragY = $state(0);
  let dragging = $state(false);

  function close() {
    save();
    ui.editing = null;
  }

  function save() {
    const t = store.all[id];
    if (!t || t.deleted) return;
    const nt = title.trim();
    if (!nt) return;
    if (nt !== t.title || note !== t.note) store.update(id, { title: nt, note });
  }

  function remove() {
    const removed = store.remove(id);
    ui.editing = null;
    if (removed) ui.show('削除しました', { label: '元に戻す', run: () => store.restore(removed) });
  }

  function setStatus(s: (typeof STATUSES)[number]) {
    if (!task || task.status === s) return;
    save();
    store.move(id, s);
    dispatchEvent(new CustomEvent('flick:arrive', { detail: s }));
  }

  function rise(node: Element) {
    return {
      duration: 460,
      easing: (t: number) => 1 - Math.pow(1 - t, 4) + Math.sin(t * Math.PI) * 0.04,
      css: (t: number, u: number) => `transform: translate3d(0, ${u * 105}%, 0)`,
    };
  }

  function grow(node: HTMLTextAreaElement) {
    const f = () => {
      node.style.height = '0px';
      node.style.height = node.scrollHeight + 'px';
    };
    f();
    node.addEventListener('input', f);
    return { destroy: () => node.removeEventListener('input', f) };
  }

  // つまみを下へドラッグして閉じる
  let y0 = 0;
  function handleDown(e: PointerEvent) {
    y0 = e.clientY;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function handleMove(e: PointerEvent) {
    if (!dragging) return;
    const d = e.clientY - y0;
    dragY = d > 0 ? d : d * 0.2;
  }
  function handleUp() {
    if (!dragging) return;
    dragging = false;
    if (dragY > 110) close();
    else dragY = 0;
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    setTimeout(() => titleEl?.focus({ preventScroll: true }), 280);
    return () => removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (!task || task.deleted) ui.editing = null;
  });
</script>

<div class="backdrop" transition:fade={{ duration: 260, easing: cubicOut }} onclick={close} aria-hidden="true"></div>
<div
  class="sheet glass"
  role="dialog"
  aria-modal="true"
  aria-label="タスクを編集"
  bind:this={sheet}
  transition:rise
  style="transform: translate3d(0, {dragY}px, 0); transition: {dragging ? 'none' : 'transform .45s var(--spring)'}"
>
  <div
    class="grab"
    onpointerdown={handleDown}
    onpointermove={handleMove}
    onpointerup={handleUp}
    onpointercancel={handleUp}
    aria-hidden="true"
  >
    <span></span>
  </div>

  {#if task}
    <textarea
      class="t"
      bind:this={titleEl}
      bind:value={title}
      use:grow
      rows="1"
      aria-label="タイトル"
      onblur={save}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          close();
        }
      }}
    ></textarea>
    <textarea class="n" bind:value={note} use:grow rows="2" placeholder="詳細" aria-label="詳細" onblur={save}></textarea>

    <div class="status" role="radiogroup" aria-label="ステータス">
      {#each STATUSES as s (s)}
        <button
          role="radio"
          aria-checked={task.status === s}
          class:on={task.status === s}
          style="--c: var(--{s})"
          onclick={() => setStatus(s)}
        >
          {STATUS_LABEL[s]}
        </button>
      {/each}
    </div>

    <div class="foot">
      <button class="del" onclick={remove}><Icon name="trash" size={18} />削除</button>
      <button class="done" onclick={close}>閉じる</button>
    </div>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(28, 34, 48, 0.12);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-width: 640px;
    margin: 0 auto;
    padding: 4px 20px calc(env(safe-area-inset-bottom) + 18px);
    border-radius: 30px 30px 0 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.8));
    max-height: 88vh;
    overflow-y: auto;
  }
  .grab {
    display: grid;
    place-items: center;
    height: 26px;
    margin: 0 -20px 4px;
    cursor: grab;
    touch-action: none;
  }
  .grab span {
    width: 38px;
    height: 5px;
    border-radius: 3px;
    background: rgba(28, 34, 48, 0.16);
  }
  textarea {
    display: block;
    width: 100%;
    border: 0;
    outline: 0;
    resize: none;
    background: transparent;
    font: inherit;
    color: var(--ink);
    padding: 0;
    overflow: hidden;
  }
  .t {
    font-size: 21px;
    line-height: 30px;
    font-weight: 600;
    letter-spacing: -0.005em;
  }
  .n {
    margin-top: 8px;
    font-size: 15px;
    line-height: 23px;
    color: var(--muted);
    min-height: 46px;
  }
  .n::placeholder {
    color: var(--faint);
  }
  .status {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-top: 18px;
  }
  .status button {
    height: 44px;
    border-radius: 14px;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    background: rgba(28, 34, 48, 0.04);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .status button.on {
    color: #fff;
    background: var(--c);
    box-shadow: 0 8px 18px -8px var(--c), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    margin-top: 18px;
  }
  .foot button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    font-size: 15px;
    font-weight: 600;
  }
  .del {
    color: var(--danger);
    margin-left: -12px;
  }
  .done {
    color: var(--ink);
    background: rgba(28, 34, 48, 0.06);
  }
</style>
