import { Component, onCleanup, onMount } from 'solid-js';

interface WaveformProps {
  audioLevel: number;
  /** Per-bar levels in 0..1: mel spectrum or last N energy. When provided, bars use this. */
  barLevels?: Float32Array;
  isRecording: boolean;
  barCount?: number;
}

/** Fading gray by intensity: light gray (low energy) to dark gray (high energy). */
function grayForIntensity(intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const g = Math.round(220 - t * 150);
  return `rgb(${g},${g},${g})`;
}

/** Gamma for bar height so hot bins do not dominate; matches spectrogram perception. */
const BAR_HEIGHT_GAMMA = 0.65;

/** Blend factor for smooth transition to new mel data (0=no change, 1=instant). */
const MEL_SMOOTH_ALPHA = 0.35;

/**
 * Canvas-based waveform visualizer.
 *
 * Previous implementation used 32 DOM <div> elements with inline styles,
 * updated at 60fps via requestAnimationFrame + SolidJS signal. This caused
 * 32 style recalculations and layout passes per frame, contributing to the
 * layout-shift clusters seen in the performance profile.
 *
 * This canvas version renders all bars in a single draw call with zero DOM
 * updates, throttled to ~30fps which is perceptually smooth for this UI.
 */
export const Waveform: Component<WaveformProps> = (props) => {
  const count = () => props.barCount ?? 32;

  let canvasRef: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | undefined;
  let resizeObserver: ResizeObserver | null = null;

  // Persistent bar heights array (mutated in-place, no allocations per frame)
  let bars: Float32Array = new Float32Array(0);

  // Draw every frame for smooth mel transitions; no throttle
  let lastDrawTime = 0;
  const DRAW_INTERVAL_MS = 0;

  // Cache CSS color; refresh occasionally to avoid per-frame style recalcs
  let primaryColor = '#14b8a6';
  let lastColorCheck = 0;
  const COLOR_CHECK_INTERVAL_MS = 1000;

  const updateCanvasSize = () => {
    if (!canvasRef) return;
    const parent = canvasRef.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextW = Math.floor(rect.width * dpr);
    const nextH = Math.floor(rect.height * dpr);
    if (canvasRef.width !== nextW || canvasRef.height !== nextH) {
      canvasRef.width = nextW;
      canvasRef.height = nextH;
    }
  };

  const animate = (now: number) => {
    animationId = requestAnimationFrame(animate);

    if (now - lastDrawTime < DRAW_INTERVAL_MS) return;
    lastDrawTime = now;

    if (!ctx || !canvasRef) return;

    if (now - lastColorCheck > COLOR_CHECK_INTERVAL_MS) {
      lastColorCheck = now;
      primaryColor = getComputedStyle(canvasRef).getPropertyValue('--color-primary').trim() || '#14b8a6';
    }

    const n = count();

    // Lazily init or resize the bars array
    if (bars.length !== n) {
      bars = new Float32Array(n);
      bars.fill(0);
    }

    const levels = props.barLevels;
    const useRealLevels = levels && levels.length > 0;

    if (props.isRecording && useRealLevels) {
      const tail = levels.length >= n ? levels.subarray(levels.length - n) : levels;
      const offset = n - tail.length;
      for (let i = 0; i < n; i++) {
        const newVal = i < offset ? 0 : Math.min(1, Math.max(0, tail[i - offset]));
        bars[i] = bars[i] * (1 - MEL_SMOOTH_ALPHA) + newVal * MEL_SMOOTH_ALPHA;
      }
    } else if (props.isRecording) {
      const level = props.audioLevel;
      for (let i = 0; i < n; i++) {
        bars[i] = Math.min(1, Math.max(0, level));
      }
    } else {
      for (let i = 0; i < n; i++) {
        bars[i] = Math.max(0, bars[i] * 0.9);
      }
    }

    // Draw
    const w = canvasRef.width;
    const h = canvasRef.height;
    if (w === 0 || h === 0) return;

    const bg = getComputedStyle(canvasRef).getPropertyValue('--color-earthy-bg').trim() || '#faf8f5';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const barWidth = w / n;
    const recording = props.isRecording;
    const useGray = levels && levels.length > 0;
    const alphaBase = recording ? 0.5 : 0.15;
    const alphaRange = recording ? 0.45 : 0.1;

    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = useGray ? Math.pow(bars[i], BAR_HEIGHT_GAMMA) : bars[i];
      const barH = Math.max(1, v * h);
      ys.push(h - barH);
    }

    for (let i = 0; i < n; i++) {
      const x0 = i * barWidth;
      const x1 = (i + 1) * barWidth;
      const y0 = ys[i];
      const y1 = i + 1 < n ? ys[i + 1] : y0;
      const midX = (x0 + x1) * 0.5;
      const midY = (y0 + y1) * 0.5;

      ctx.globalAlpha = Math.min(1, (alphaBase + bars[i] * alphaRange) * 0.9);
      ctx.fillStyle = useGray ? grayForIntensity(bars[i]) : primaryColor;

      ctx.beginPath();
      ctx.moveTo(x0, h);
      ctx.lineTo(x0, y0);
      ctx.quadraticCurveTo(midX, midY, x1, y1);
      ctx.lineTo(x1, h);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  };

  onMount(() => {
    if (canvasRef) {
      updateCanvasSize();
      ctx = canvasRef.getContext('2d', { alpha: true });
      primaryColor = getComputedStyle(canvasRef).getPropertyValue('--color-primary').trim() || '#14b8a6';

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          updateCanvasSize();
          lastColorCheck = 0;
        });
        resizeObserver.observe(canvasRef.parentElement ?? canvasRef);
      }
    }
    animationId = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    if (animationId) cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return (
    <div class="h-12 w-full overflow-hidden">
      <canvas ref={canvasRef} class="w-full h-full block" />
    </div>
  );
};

/** Bar count: 1:1 with mel bins (128). */
export const SPECTRUM_BAR_COUNT = 128;

export const CompactWaveform: Component<WaveformProps> = (props) => {
  return <Waveform {...props} barCount={props.barCount ?? SPECTRUM_BAR_COUNT} />;
};

export default Waveform;
