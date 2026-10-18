<script lang="ts">
  import { Spring } from 'svelte/motion';
  import { fly } from 'svelte/transition';
  import { onMount } from 'svelte';
  import { STATUSES, type Status } from '../../shared/types';
  import { store, STATUS_LABEL } from '../lib/store.svelte';

  let wrap: HTMLDivElement;
  const btns: Record<string, HTMLButtonElement> = {};
  const pill = new Spring({ x: 0, w: 0 }, { stiffness: 0.16, damping: 0.62 });
  let pulse = $state<Record<string, number>>({});
  let ready = $state(false);

  function measure(instant = false) {
    const b = btns[store.tab];
    if (!b || !wrap) return;
    const r = b.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    pill.set({ x: r.left - w.left, w: r.width }, { instant });
  }

  $effect(() => {
    store.tab;
    store.counts; // 件数で幅が変わるので追従
    queueMicrotask(() => measure(!ready));
    ready = true;
  });

  onMount(() => {
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(wrap);
    const onArrive = (e: Event) => {
      const s = (e as CustomEvent<Status>).detail;
      pulse = { ...pulse, [s]: (pulse[s] ?? 0) + 1 };
    };
    addEventListener('flick:arrive', onArrive);
    return () => {
      ro.disconnect();
      removeEventListener('flick:arrive', onArrive);
    };
  });

  function onKey(e: KeyboardEvent) {
    const i = STATUSES.indexOf(store.tab);
    if (e.key === 'ArrowRight' && i < 2) store.setTab(STATUSES[i + 1]);
    else if (e.key === 'ArrowLeft' && i > 0) store.setTab(STATUSES[i - 1]);
    else return;
    e.preventDefault();
    btns[store.tab]?.focus();
  }
</script>

<div class="tabs glass" role="tablist" aria-label="ステータス" bind:this={wrap} tabindex="-1" onkeydown={onKey}>
  <span
    class="pill"
    style="transform: translateX({pill.current.x}px); width: {pill.current.w}px; --c: var(--{store.tab})"
    aria-hidden="true"
  ></span>
  {#each STATUSES as s (s)}
    {@const active = store.tab === s}
    <button
      bind:this={btns[s]}
      role="tab"
      data-tab={s}
      aria-selected={active}
      tabindex={active ? 0 : -1}
      class:active
      onclick={() => store.setTab(s)}
    >
      {#key pulse[s]}
        <span class="dot" class:ping={!!pulse[s]} style="--c: var(--{s})"></span>
      {/key}
      <span class="label">{STATUS_LABEL[s]}</span>
      <span class="count tnum" data-count={s}>
        {#key store.counts[s]}
          <span in:fly={{ y: 10, duration: 380, opacity: 0 }}>{store.counts[s]}</span>
        {/key}
      </span>
    </button>
  {/each}
</div>

<style>
  .tabs {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    height: 46px;
    padding: 3px;
    border-radius: 999px;
    outline: none;
  }
  .pill {
    position: absolute;
    top: 3px;
    left: 0;
    height: 38px;
    border-radius: 999px;
    background: linear-gradient(180deg, #fff, rgba(255, 255, 255, 0.86));
    box-shadow:
      0 6px 16px -6px color-mix(in srgb, var(--c) 45%, transparent),
      0 1px 2px rgba(31, 45, 80, 0.1),
      inset 0 0 0 1px color-mix(in srgb, var(--c) 18%, white);
    transition: box-shadow 0.4s;
  }
  button {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 38px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  button.active {
    color: var(--ink);
  }
  .dot {
    position: relative;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }
  .dot.ping::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 2px solid var(--c);
    animation: ping 0.7s var(--out) forwards;
  }
  .dot.ping {
    animation: pop 0.5s var(--spring);
  }
  @keyframes ping {
    from { transform: scale(1); opacity: 0.9; }
    to { transform: scale(3.4); opacity: 0; }
  }
  @keyframes pop {
    40% { transform: scale(1.9); }
  }
  .count {
    display: inline-grid;
    min-width: 1ch;
    margin-left: 1px;
    font-size: 13px;
    font-weight: 500;
    color: var(--faint);
    overflow: hidden;
  }
  .count > :global(span) {
    grid-area: 1 / 1;
  }
  @media (max-width: 360px) {
    button { gap: 4px; font-size: 13px; }
  }
</style>
