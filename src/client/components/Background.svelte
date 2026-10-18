<script lang="ts"></script>

<!-- ガラスが屈折させる「光」。白ベースを保つため彩度はごく淡く、ゆっくり漂わせる -->
<div class="field" aria-hidden="true">
  <span class="blob a"></span>
  <span class="blob b"></span>
  <span class="blob c"></span>
</div>

<style>
  .field {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    background: var(--paper);
  }
  .blob {
    position: absolute;
    width: 62vmax;
    height: 62vmax;
    border-radius: 50%;
    filter: blur(48px);
    opacity: 1;
    will-change: transform;
  }
  .a {
    background: radial-gradient(circle, var(--ice) 0%, color-mix(in srgb, var(--ice) 70%, transparent) 30%, transparent 66%);
    left: -25vmax;
    top: -30vmax;
    animation: drift-a 38s ease-in-out infinite alternate;
  }
  .b {
    background: radial-gradient(circle, var(--lilac) 0%, color-mix(in srgb, var(--lilac) 70%, transparent) 30%, transparent 66%);
    right: -30vmax;
    top: 10vh;
    animation: drift-b 46s ease-in-out infinite alternate;
  }
  .c {
    background: radial-gradient(circle, var(--mint) 0%, color-mix(in srgb, var(--mint) 70%, transparent) 30%, transparent 66%);
    left: -10vmax;
    bottom: -35vmax;
    animation: drift-c 52s ease-in-out infinite alternate;
  }
  @keyframes drift-a {
    to { transform: translate(18vw, 22vh) scale(1.15); }
  }
  @keyframes drift-b {
    to { transform: translate(-22vw, 18vh) scale(0.9); }
  }
  @keyframes drift-c {
    to { transform: translate(25vw, -15vh) scale(1.1); }
  }
</style>
