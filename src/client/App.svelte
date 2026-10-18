<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './lib/store.svelte';
  import { ui } from './lib/ui.svelte';
  import Background from './components/Background.svelte';
  import StatusTabs from './components/StatusTabs.svelte';
  import TaskList from './components/TaskList.svelte';
  import Composer from './components/Composer.svelte';
  import EditSheet from './components/EditSheet.svelte';
  import Toast from './components/Toast.svelte';
  import Account from './components/Account.svelte';

  // 起動用の素の入力欄から、入力中の文字とフォーカスを引き継ぐ
  const bootInput = document.getElementById('boot-memo') as HTMLTextAreaElement | null;
  const initial = bootInput?.value ?? store.draft;
  const hadFocus = !bootInput || document.activeElement === bootInput || !matchMedia('(pointer: coarse)').matches;
  bootInput?.closest('.b-dock')?.remove();

  onMount(() => {
    const p = new URLSearchParams(location.search);
    if (p.has('login_error')) {
      ui.show('ログインできませんでした。もう一度お試しください', undefined, 'error');
      history.replaceState(null, '', '/');
    }
  });

  // データが揃ったらスケルトンをぼかしながら溶かす
  $effect(() => {
    if (!store.ready) return;
    const boot = document.getElementById('boot');
    if (!boot) return;
    requestAnimationFrame(() => boot.classList.add('out'));
    setTimeout(() => boot.remove(), 500);
  });
</script>

<Background />

<div class="app" class:ready={store.ready} aria-busy={!store.ready}>
  <header>
    <StatusTabs />
    <Account />
  </header>
  <main>
    {#if store.ready}
      <TaskList />
    {/if}
  </main>
</div>

<Composer {initial} focus={hadFocus} />

{#if ui.editing}
  {#key ui.editing}
    <EditSheet id={ui.editing} />
  {/key}
{/if}

<Toast />

<style>
  .app {
    max-width: 640px;
    margin: 0 auto;
    padding: 0 16px calc(env(safe-area-inset-bottom) + 120px);
    min-height: 100dvh;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(env(safe-area-inset-top) + 14px) 0 14px;
  }
  header::before {
    content: '';
    position: absolute;
    inset: 0 -16px -10px;
    background: linear-gradient(180deg, rgba(251, 252, 254, 0.9) 40%, rgba(251, 252, 254, 0));
    pointer-events: none;
    z-index: -1;
  }
  main {
    padding-top: 4px;
  }
</style>
