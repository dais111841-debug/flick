<script lang="ts">
  let { name, size = 20, stroke = 2 }: { name: string; size?: number; stroke?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'up'}
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  {:else if name === 'next'}
    <path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === 'prev'}
    <path d="M19 12H5M11 6l-6 6 6 6" />
  {:else if name === 'check'}
    <path d="M5 12.5 10 17.5 19 7" />
  {:else if name === 'trash'}
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  {:else if name === 'stop'}
    <rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />
  {:else if name === 'split'}
    <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5 6.8 15M17.2 9l2.6-1.5" /><circle cx="12" cy="12" r="3.2" />
  {:else if name === 'x'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'logout'}
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
  {:else if name === 'cloud-off'}
    <path d="M3 3l18 18M8 7.2A5.5 5.5 0 0 1 17.4 10H18a4 4 0 0 1 2.6 7M16 18H7a4 4 0 0 1-1.6-7.7" />
  {/if}
</svg>
