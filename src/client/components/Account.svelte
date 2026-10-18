<script lang="ts">
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { store } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
  let root: HTMLElement;

  function outside(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  const initial = $derived((store.user?.name || store.user?.email || '?').slice(0, 1).toUpperCase());
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="acct" bind:this={root}>
  {#if store.user}
    <button class="avatar glass" aria-label="アカウント" aria-expanded={open} onclick={() => (open = !open)}>
      {#if store.user.picture}
        <img src={store.user.picture} alt="" referrerpolicy="no-referrer" width="40" height="40" />
      {:else}
        <span>{initial}</span>
      {/if}
      {#if !store.online}<span class="off" title="オフライン"></span>{/if}
    </button>
  {:else}
    <button class="login glass" onclick={() => store.login()} data-testid="login" aria-label="Google でログイン" title="Google でログイン">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    </button>
  {/if}

  {#if open && store.user}
    <div class="menu glass" transition:scale={{ start: 0.85, duration: 300, easing: backOut }} role="menu">
      <p class="who">
        <span class="name">{store.user.name}</span>
        <span class="mail">{store.user.email}</span>
      </p>
      <p class="sync">
        {#if !store.online}<Icon name="cloud-off" size={14} /> オフライン（再接続時に同期）{:else if store.syncing}同期中…{:else}同期済み{/if}
      </p>
      <button role="menuitem" onclick={() => store.logout()}><Icon name="logout" size={18} />ログアウト</button>
    </div>
  {/if}
</div>

<style>
  .acct {
    position: relative;
    display: flex;
    gap: 6px;
    flex: none;
  }
  .avatar {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    padding: 3px;
    font-weight: 650;
    color: var(--doing);
  }
  .avatar img {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: block;
  }
  .off {
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--faint);
    border: 2px solid #fff;
  }
  .login {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 50%;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 56px;
    z-index: 30;
    width: min(280px, calc(100vw - 32px));
    padding: 14px 8px 8px;
    border-radius: 22px;
    transform-origin: top right;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.78));
  }
  .who {
    margin: 0 10px;
    display: grid;
  }
  .name {
    font-weight: 650;
  }
  .mail,
  .sync {
    font-size: 13px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sync {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 6px 10px 8px;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 44px;
    padding: 0 10px;
    border-radius: 14px;
    font-size: 15px;
  }
  .menu button:hover {
    background: rgba(28, 34, 48, 0.05);
  }
</style>
