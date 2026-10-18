<script lang="ts">
  import { ui } from '../lib/ui.svelte';

  function pop(node: Element) {
    return {
      duration: 420,
      css: (t: number, u: number) => {
        const e = 1 - Math.pow(1 - t, 3);
        return `transform: translate3d(-50%, ${u * 24}px, 0) scale(${0.9 + 0.1 * e}); opacity: ${t}; filter: blur(${u * 4}px)`;
      },
    };
  }
</script>

<div class="slot" aria-live="polite">
  {#if ui.toast}
    {#key ui.toast.key}
      <div class="toast glass" class:error={ui.toast.tone === 'error'} role="status" transition:pop>
        <span class="text">{ui.toast.text}</span>
        {#if ui.toast.action}
          {@const a = ui.toast.action}
          <button
            onclick={() => {
              a.run();
              ui.dismiss();
            }}>{a.label}</button
          >
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .slot {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(env(safe-area-inset-bottom) + 84px);
    z-index: 30;
    pointer-events: none;
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translate3d(-50%, 0, 0);
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100vw - 32px);
    padding: 6px 6px 6px 16px;
    min-height: 44px;
    border-radius: 999px;
    background: linear-gradient(180deg, rgba(36, 42, 58, 0.86), rgba(28, 34, 48, 0.82));
    border-color: rgba(255, 255, 255, 0.14);
    color: #fff;
    font-size: 14px;
    white-space: nowrap;
    pointer-events: auto;
  }
  .toast::before {
    opacity: 0.25;
  }
  .toast.error {
    background: linear-gradient(180deg, rgba(229, 72, 77, 0.92), rgba(205, 55, 60, 0.9));
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 6px;
  }
  .toast:not(:has(button)) {
    padding-right: 16px;
  }
  button {
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font-weight: 600;
    font-size: 14px;
  }
</style>
