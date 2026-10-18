<script lang="ts">
  import { onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui.svelte';
  import { api, HttpError } from '../lib/api';
  import { vibrate } from '../lib/swipe';
  import Icon from './Icon.svelte';

  let { initial = '', focus = true }: { initial?: string; focus?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(initial);
  let el: HTMLTextAreaElement;
  let busy = $state<null | 'split' | 'transcribe'>(null);
  let recording = $state(false);
  let level = $state(0);
  let kb = $state(0);
  let sent = $state(0);

  const has = $derived(text.trim().length > 0);

  function grow() {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, innerHeight * 0.4) + 'px';
  }

  $effect(() => {
    text;
    store.draft = text;
    grow();
  });

  onMount(() => {
    grow();
    if (focus) el.focus({ preventScroll: true });
    el.setSelectionRange(text.length, text.length);
    // iOS Safari ではキーボード表示時に固定要素が隠れるため、visualViewport で持ち上げる
    const vv = window.visualViewport;
    const onVV = () => {
      if (!vv) return;
      kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    };
    vv?.addEventListener('resize', onVV);
    vv?.addEventListener('scroll', onVV);
    const onFocusKey = (e: KeyboardEvent) => {
      // どこからでも「/」または「n」でメモ欄へ
      if ((e.key === '/' || e.key === 'n') && !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')) {
        e.preventDefault();
        el.focus();
      }
    };
    addEventListener('keydown', onFocusKey);
    return () => {
      vv?.removeEventListener('resize', onVV);
      vv?.removeEventListener('scroll', onVV);
      removeEventListener('keydown', onFocusKey);
    };
  });

  function submit() {
    const v = text.trim();
    if (!v) return;
    const [first, ...rest] = v.split('\n');
    store.add(first.trim(), rest.join('\n').trim());
    if (store.tab !== 'todo') store.setTab('todo');
    text = '';
    sent++;
    vibrate(6);
    el.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  }

  function needLogin(): boolean {
    if (store.auth === 'user') return false;
    ui.show('AI 機能は Google でログインすると使えます', { label: 'ログイン', run: () => store.login() });
    return true;
  }

  function aiError(e: unknown) {
    const code = e instanceof HttpError ? e.code : '';
    if (code === 'quota') ui.show('今日の AI 利用回数の上限に達しました', undefined, 'error');
    else if (!navigator.onLine) ui.show('オフラインのため AI を使えません', undefined, 'error');
    else ui.show('AI の処理に失敗しました。もう一度お試しください', undefined, 'error');
  }

  async function split() {
    const v = text.trim();
    if (!v || busy || needLogin()) return;
    busy = 'split';
    try {
      const { tasks } = await api.split(v);
      const n = tasks.length;
      const base = Date.now();
      const added = tasks.map((t, i) => store.add(t, '', 'todo', base + (n - i)));
      if (store.tab !== 'todo') store.setTab('todo');
      text = '';
      vibrate(12);
      ui.show(`${n}件のタスクに分けました`, {
        label: '元に戻す',
        run: () => {
          added.forEach((t) => store.remove(t.id));
          text = v;
        },
      });
    } catch (e) {
      aiError(e);
    } finally {
      busy = null;
    }
  }

  let recorder: MediaRecorder | null = null;
  let stopMeter: (() => void) | null = null;

  async function toggleMic() {
    if (busy) return;
    if (recording) {
      recorder?.stop();
      return;
    }
    if (needLogin()) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      ui.show('このブラウザは録音に対応していません', undefined, 'error');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      ui.show('マイクの使用が許可されていません', undefined, 'error');
      return;
    }
    const chunks: Blob[] = [];
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      recording = false;
      stopMeter?.();
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      if (!blob.size) return;
      busy = 'transcribe';
      try {
        const { text: heard } = await api.transcribe(blob);
        if (heard) text = text.trim() ? `${text.trim()}\n${heard}` : heard;
        el.focus();
      } catch (e) {
        aiError(e);
      } finally {
        busy = null;
      }
    };
    // 入力レベルでボタンの波紋を揺らす
    try {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
        level = level * 0.6 + (peak / 128) * 0.4;
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopMeter = () => {
        cancelAnimationFrame(raf);
        ctx.close();
        level = 0;
      };
    } catch {
      stopMeter = null;
    }
    recorder.start();
    recording = true;
    vibrate(10);
  }
</script>

<div class="dock" style="--kb: {kb}px">
  <form
    class="composer glass"
    class:busy={!!busy}
    class:recording
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    {#key sent}
      <span class="flash" class:go={sent > 0} aria-hidden="true"></span>
    {/key}
    <textarea
      bind:this={el}
      bind:value={text}
      rows="1"
      placeholder={busy === 'transcribe' ? '文字起こし中…' : busy === 'split' ? 'AI が整理しています…' : recording ? '録音中…' : 'メモ'}
      aria-label="メモ"
      enterkeyhint="send"
      onkeydown={onKey}
      disabled={busy === 'split'}
      data-testid="composer"
    ></textarea>

    <div class="actions">
      {#if has && !recording}
        <button
          type="button"
          class="icon split"
          aria-label="AI でタスクに分ける"
          title="AI でタスクに分ける"
          onclick={split}
          disabled={!!busy}
          in:scale={{ duration: 360, start: 0.5, easing: backOut }}
        >
          <Icon name="split" />
        </button>
      {/if}
      {#if has && !recording}
        <button
          type="submit"
          class="icon send"
          aria-label="追加"
          disabled={!!busy}
          in:scale={{ duration: 380, start: 0.4, easing: backOut }}
        >
          <Icon name="up" stroke={2.4} />
        </button>
      {:else}
        <button
          type="button"
          class="icon mic"
          class:on={recording}
          style="--lv: {level}"
          aria-label={recording ? '録音を止める' : '音声でメモ'}
          aria-pressed={recording}
          onclick={toggleMic}
          disabled={busy === 'transcribe'}
          in:scale={{ duration: 360, start: 0.5, easing: backOut }}
        >
          <Icon name={recording ? 'stop' : 'mic'} />
        </button>
      {/if}
    </div>
  </form>
</div>

<style>
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--kb);
    z-index: 20;
    padding: 0 12px calc(env(safe-area-inset-bottom) + 12px);
    transition: bottom 0.25s var(--out);
    pointer-events: none;
  }
  .dock::before {
    /* 一覧がドックの下に潜るときのフェード */
    content: '';
    position: absolute;
    inset: -28px 0 0;
    background: linear-gradient(180deg, rgba(251, 252, 254, 0), rgba(251, 252, 254, 0.85) 60%);
    pointer-events: none;
    z-index: -1;
  }
  .composer {
    pointer-events: auto;
    max-width: 616px;
    margin: 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 6px 6px 6px 18px;
    border-radius: 28px;
    transition: box-shadow 0.4s var(--out), transform 0.4s var(--spring);
  }
  .composer:focus-within {
    box-shadow: var(--glass-shadow), 0 0 0 4px rgba(47, 107, 255, 0.08), 0 16px 40px -14px rgba(47, 107, 255, 0.28);
  }
  /* AI 処理中：縁を液体のような光が流れる */
  .composer.busy::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1.5px;
    background: conic-gradient(from var(--a, 0deg), #7aa2ff, #b79cff, #6fd6b0, #7aa2ff);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    animation: spin 1.6s linear infinite;
    pointer-events: none;
  }
  @property --a {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }
  @keyframes spin {
    to { --a: 360deg; }
  }
  .flash {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: radial-gradient(60% 120% at 90% 50%, rgba(47, 107, 255, 0.18), transparent 70%);
    opacity: 0;
  }
  .flash.go {
    animation: flash 0.6s var(--out);
  }
  @keyframes flash {
    20% { opacity: 1; }
  }
  textarea {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    resize: none;
    background: transparent;
    font: inherit;
    font-size: 17px;
    line-height: 24px;
    padding: 10px 0;
    height: 44px;
    max-height: 40vh;
    color: var(--ink);
  }
  textarea::placeholder {
    color: var(--faint);
    transition: color 0.3s;
  }
  .busy textarea::placeholder {
    color: var(--doing);
  }
  .actions {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .icon {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--muted);
    isolation: isolate;
  }
  .icon:disabled {
    opacity: 0.4;
  }
  .split {
    color: var(--doing);
    background: rgba(47, 107, 255, 0.08);
  }
  .send {
    color: #fff;
    background: linear-gradient(180deg, #4b80ff, var(--doing));
    box-shadow: 0 6px 16px -6px rgba(47, 107, 255, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .mic {
    background: rgba(28, 34, 48, 0.05);
  }
  .mic.on {
    color: #fff;
    background: var(--danger);
  }
  .mic.on::before,
  .mic.on::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--danger);
    opacity: 0.22;
    transform: scale(calc(1 + var(--lv) * 1.4));
    transition: transform 0.08s linear;
    z-index: -1;
  }
  .mic.on::after {
    opacity: 0.12;
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% { transform: scale(1.6); opacity: 0; }
  }
</style>
