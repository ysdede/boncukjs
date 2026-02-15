import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { appStore } from './stores/appStore';
import { CompactWaveform, ModelLoadingOverlay, DebugPanel, TranscriptionDisplay, SettingsContent } from './components';
import { getModelDisplayName, MODELS } from './components/ModelLoadingOverlay';
import { AudioEngine } from './lib/audio';
import { MelWorkerClient } from './lib/audio/MelWorkerClient';
import { TranscriptionWorkerClient } from './lib/transcription';
import { HybridVAD } from './lib/vad';
import { WindowBuilder } from './lib/transcription/WindowBuilder';
import { BufferWorkerClient } from './lib/buffer';
import { TenVADWorkerClient } from './lib/vad/TenVADWorkerClient';
import type { V4ProcessResult, StreamStateResult } from './lib/transcription/TranscriptionWorkerClient';
import type { BufferWorkerConfig, TenVADResult } from './lib/buffer/types';
import { formatDuration } from './utils/time';

// Singleton instances
let audioEngine: AudioEngine | null = null;
export const [audioEngineSignal, setAudioEngineSignal] = createSignal<AudioEngine | null>(null);

let workerClient: TranscriptionWorkerClient | null = null;
let melClient: MelWorkerClient | null = null;
export const [melClientSignal, setMelClientSignal] = createSignal<MelWorkerClient | null>(null);
let segmentUnsubscribe: (() => void) | null = null;
let windowUnsubscribe: (() => void) | null = null;
let melChunkUnsubscribe: (() => void) | null = null;
let visualizationUnsubscribe: (() => void) | undefined;
// v4 pipeline instances
let hybridVAD: HybridVAD | null = null;
let bufferClient: BufferWorkerClient | null = null;
let tenVADClient: TenVADWorkerClient | null = null;
let windowBuilder: WindowBuilder | null = null;
let v4TickTimeout: number | undefined;
let v4TickRunning = false;
let v4AudioChunkUnsubscribe: (() => void) | null = null;
let v4MelChunkUnsubscribe: (() => void) | null = null;
let v4InferenceBusy = false;
let v4LastInferenceTime = 0;
// Track last word timestamp for word-timeout finalization
let lastWordEndTime = 0;
let lastImmatureText = '';
// Track word-timeout finalization to prevent flash from immediate re-processing
let justFinalizedByTimeout = false;
// Incremented whenever we finalize/flush live text to drop stale in-flight inference results.
let v4StateEpoch = 0;
// Global sample counter for audio chunks (tracks total samples written to BufferWorker)
let v4GlobalSampleOffset = 0;
let v4LastGateChunkSample = 0;
// v5 pipeline runtime
let v5TickTimeout: number | undefined;
let v5TickRunning = false;
let v5AudioChunkUnsubscribe: (() => void) | null = null;
let v5InferenceBusy = false;
let v5LastFastInferenceTime = 0;
let v5LastCorrectionInferenceTime = 0;
let v5GlobalSampleOffset = 0;
let v5LastGateChunkSample = 0;
let v5FastCursorSample = 0;
let v5LastCorrectionEndSample = 0;
let v5GateState: 'idle' | 'candidate' | 'active' = 'idle';
let v5GateReason = 'idle';
let v5PendingFastRange: { startSample: number; endSample: number } | null = null;
let v5TickCount = 0;
let v5ModelNotReadyLogged = false;
let v5ServiceInitialized = false;
const V4_CHUNK_MIN_SPEECH_SEC = 0.20;
const V4_CHUNK_MIN_SPEECH_RATIO = 0.40;
const V4_SAMPLE_RATE = 16000;

type ChunkSpeechStats = {
  entryCount: number;
  speechEntryCount: number;
  speechRatio: number;
  speechDurationSec: number;
  maxProb: number;
};

const computeChunkSpeechStats = async (
  client: BufferWorkerClient,
  layer: 'energyVad' | 'inferenceVad',
  startSample: number,
  endSample: number,
  threshold: number,
): Promise<ChunkSpeechStats> => {
  if (endSample <= startSample) {
    return {
      entryCount: 0,
      speechEntryCount: 0,
      speechRatio: 0,
      speechDurationSec: 0,
      maxProb: 0,
    };
  }

  const range = await client.queryRange(startSample, endSample, [layer]);
  const slice = range.layers[layer];
  if (!slice || slice.entryCount <= 0 || !slice.data) {
    return {
      entryCount: 0,
      speechEntryCount: 0,
      speechRatio: 0,
      speechDurationSec: 0,
      maxProb: 0,
    };
  }

  const data = slice.data;
  let speechEntryCount = 0;
  let maxProb = 0;
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    if (p >= threshold) speechEntryCount++;
    if (p > maxProb) maxProb = p;
  }

  const entryCount = slice.entryCount;
  const speechRatio = entryCount > 0 ? speechEntryCount / entryCount : 0;
  const speechDurationSec = (speechEntryCount * slice.hopSamples) / V4_SAMPLE_RATE;
  return {
    entryCount,
    speechEntryCount,
    speechRatio,
    speechDurationSec,
    maxProb,
  };
};

const refineCursorByVadMinProb = async (
  client: BufferWorkerClient | null,
  prevCursorSec: number,
  candidateCursorSec: number,
): Promise<{ refinedSec: number; source: 'inferenceVad' | 'energyVad' | 'none'; minProb: number; baseProb: number }> => {
  if (!client) {
    return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
  }

  const minAdvanceSec = 0.03;
  const searchBeforeSec = 0.26;
  const searchAfterSec = 0.16;
  const maxBackwardShiftSec = 0.20;
  const maxForwardShiftSec = 0.02;

  if (!Number.isFinite(candidateCursorSec) || candidateCursorSec <= 0) {
    return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
  }
  if (candidateCursorSec <= prevCursorSec + minAdvanceSec) {
    return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
  }

  const searchStartSec = Math.max(prevCursorSec + minAdvanceSec, candidateCursorSec - searchBeforeSec);
  const searchEndSec = candidateCursorSec + searchAfterSec;
  const startSample = Math.round(searchStartSec * V4_SAMPLE_RATE);
  const endSample = Math.round(searchEndSec * V4_SAMPLE_RATE);

  if (endSample <= startSample) {
    return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
  }

  try {
    const range = await client.queryRange(startSample, endSample, ['inferenceVad', 'energyVad']);
    const inferenceSlice = range.layers.inferenceVad;
    const energySlice = range.layers.energyVad;

    const slice =
      inferenceSlice && inferenceSlice.entryCount > 0
        ? inferenceSlice
        : energySlice && energySlice.entryCount > 0
          ? energySlice
          : null;

    if (!slice || !slice.data || slice.data.length === 0) {
      return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
    }

    const source: 'inferenceVad' | 'energyVad' =
      slice === inferenceSlice ? 'inferenceVad' : 'energyVad';
    const scoreDistanceWeight = 0.04;

    const sampleToNearestProb = (
      targetSample: number,
      layerSlice: { data: Float32Array; firstEntrySample: number; hopSamples: number } | undefined,
    ): number => {
      if (!layerSlice || !layerSlice.data || layerSlice.data.length === 0) return Number.NaN;
      const idxFloat = (targetSample - layerSlice.firstEntrySample) / layerSlice.hopSamples;
      const idx = Math.max(0, Math.min(layerSlice.data.length - 1, Math.round(idxFloat)));
      return layerSlice.data[idx];
    };

    const candidateSample = Math.round(candidateCursorSec * V4_SAMPLE_RATE);
    const baseProbRaw = sampleToNearestProb(candidateSample, {
      data: slice.data,
      firstEntrySample: slice.firstEntrySample,
      hopSamples: slice.hopSamples,
    });
    const baseProb = Number.isFinite(baseProbRaw) ? baseProbRaw : 1;

    let bestScore = Number.POSITIVE_INFINITY;
    let bestSample = candidateSample;
    let bestProb = baseProb;

    for (let i = 0; i < slice.data.length; i++) {
      const prob = slice.data[i];
      const sample = slice.firstEntrySample + i * slice.hopSamples;
      const tSec = sample / V4_SAMPLE_RATE;
      const distNorm = Math.min(1, Math.abs(tSec - candidateCursorSec) / Math.max(0.001, searchBeforeSec));

      let energyProb = prob;
      if (energySlice && energySlice.data.length > 0) {
        const e = sampleToNearestProb(sample, {
          data: energySlice.data,
          firstEntrySample: energySlice.firstEntrySample,
          hopSamples: energySlice.hopSamples,
        });
        if (Number.isFinite(e)) energyProb = e;
      }

      const score = (0.85 * prob) + (0.15 * energyProb) + (scoreDistanceWeight * distNorm);
      if (score < bestScore) {
        bestScore = score;
        bestSample = sample;
        bestProb = prob;
      }
    }

    let refinedSec = bestSample / V4_SAMPLE_RATE;
    const lower = Math.max(prevCursorSec + minAdvanceSec, candidateCursorSec - maxBackwardShiftSec);
    const upper = candidateCursorSec + maxForwardShiftSec;
    refinedSec = Math.max(lower, Math.min(upper, refinedSec));

    // Keep stable if improvement is negligible.
    const deltaProb = baseProb - bestProb;
    if (Math.abs(refinedSec - candidateCursorSec) < 0.01 || deltaProb < 0.02) {
      refinedSec = candidateCursorSec;
    }

    return { refinedSec, source, minProb: bestProb, baseProb };
  } catch {
    return { refinedSec: candidateCursorSec, source: 'none', minProb: Number.NaN, baseProb: Number.NaN };
  }
};
// Throttle UI updates from TEN-VAD to at most once per frame
let pendingSileroProb: number | null = null;
let sileroUpdateScheduled = false;
let pendingVadState: {
  isSpeech: boolean;
  energy: number;
  snr: number;
  hybridState: string;
  sileroProbability?: number;
} | null = null;
let vadUpdateScheduled = false;

const scheduleSileroUpdate = (prob: number) => {
  pendingSileroProb = prob;
  if (sileroUpdateScheduled) return;
  sileroUpdateScheduled = true;
  requestAnimationFrame(() => {
    sileroUpdateScheduled = false;
    if (pendingSileroProb === null) return;
    const currentState = appStore.vadState();
    appStore.setVadState({
      ...currentState,
      sileroProbability: pendingSileroProb,
    });
  });
};

const scheduleVadStateUpdate = (next: {
  isSpeech: boolean;
  energy: number;
  snr: number;
  hybridState: string;
  sileroProbability?: number;
}) => {
  pendingVadState = next;
  if (vadUpdateScheduled) return;
  vadUpdateScheduled = true;
  requestAnimationFrame(() => {
    vadUpdateScheduled = false;
    if (!pendingVadState) return;
    const currentState = appStore.vadState();
    const sileroProbability =
      pendingVadState.sileroProbability !== undefined
        ? pendingVadState.sileroProbability
        : currentState.sileroProbability;
    appStore.setVadState({
      ...currentState,
      ...pendingVadState,
      sileroProbability,
    });
    appStore.setIsSpeechDetected(pendingVadState.isSpeech);
    pendingVadState = null;
  });
};

const applyV5StateToStore = (state: StreamStateResult | null | undefined) => {
  if (!state) return;

  const tokenConfidence = (t: any): number | undefined => {
    if (typeof t?.confidence === 'number' && Number.isFinite(t.confidence)) {
      return Math.min(1, Math.max(0, t.confidence));
    }
    if (typeof t?.logProb === 'number' && Number.isFinite(t.logProb)) {
      return Math.min(1, Math.max(0, Math.exp(Math.max(-20, Math.min(0, t.logProb)))));
    }
    return undefined;
  };

  const stableTokens = (state.stableTokens || []).map((t: any) => ({
    id: t.id,
    text: t.text || '',
    startTime: t.startTime || 0,
    endTime: t.endTime || 0,
    logProb: t.logProb,
    confidence: tokenConfidence(t),
    finalized: true,
  }));
  const draftTokens = (state.draftTokens || []).map((t: any) => ({
    id: t.id,
    text: t.text || '',
    startTime: t.startTime || 0,
    endTime: t.endTime || 0,
    logProb: t.logProb,
    confidence: tokenConfidence(t),
    finalized: false,
  }));
  const sentences = (state.sentences || []).map((s: any) => ({
    text: s.text || '',
    startTime: s.startTime || 0,
    endTime: s.endTime || 0,
    confidence: s.confidence || 0,
  }));

  appStore.setV5StableTokens(stableTokens);
  appStore.setV5DraftTokens(draftTokens);
  appStore.setV5StableText(state.stableText || '');
  appStore.setV5DraftText(state.draftText || '');
  appStore.setV5FullText(state.fullText || '');
  appStore.setV5CommitCursorTime(state.commitCursorTime || 0);
  appStore.setV5Sentences(sentences);
  appStore.setV5TimelineStats((prev) => ({
    ...prev,
    rewriteCount: state.stats?.rewriteCount || 0,
    stableLagSec: state.stats?.stableLagSec || 0,
    correctionHitRatio: state.stats?.correctionHitRatio || 0,
    cacheHitRatio: state.stats?.cacheHitRatio || 0,
    commitCursorTime: state.stats?.commitCursorTime || 0,
    sentenceBoundaryConfidence: state.stats?.sentenceBoundaryConfidence || 0,
    gateState: v5GateState,
    gateReason: v5GateReason,
  }));

  // Legacy adapter fields for migration compatibility
  appStore.setMatureText(state.stableText || '');
  appStore.setImmatureText(state.draftText || '');
  appStore.setMatureCursorTime(state.commitCursorTime || 0);
  appStore.setTranscript(state.fullText || '');
  appStore.setPendingText(state.draftText || '');
};

const Header: Component<{
  onToggleDebug: () => void;
}> = (props) => {
  const sessionLabel = () =>
    appStore.modelState() === 'ready' ? getModelDisplayName(appStore.selectedModelId()) : 'Session';
  return (
    <header class="h-20 flex items-center justify-between px-8 bg-[var(--color-earthy-bg)]/80 backdrop-blur-sm z-30 shrink-0">
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-[var(--color-earthy-muted-green)] flex items-center justify-center text-white">
            <span class="material-symbols-outlined text-xl">auto_awesome</span>
          </div>
          <div>
            <h1 class="text-lg font-semibold tracking-tight text-[var(--color-earthy-dark-brown)]">keet</h1>
            <p class="text-[10px] uppercase tracking-[0.2em] text-[var(--color-earthy-soft-brown)] font-medium">{sessionLabel()}</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <button
          type="button"
          onClick={props.onToggleDebug}
          class={`p-2 rounded-full transition-colors ${appStore.showDebugPanel() ? 'bg-[var(--color-earthy-muted-green)] text-white' : 'text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-sage)]/30'}`}
          title={appStore.showDebugPanel() ? 'Hide debug panel' : 'Show debug panel'}
          aria-label="Toggle debug panel"
        >
          <span class="material-symbols-outlined">bug_report</span>
        </button>
        <button
          type="button"
          class="p-2 text-[var(--color-earthy-muted-green)] hover:scale-110 transition-transform"
          aria-label="More options"
        >
          <span class="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    </header>
  );
};

const WIDGET_STORAGE_KEY = 'boncukjs-control-widget-pos';
const WIDGET_MAX_W = 672;
const WIDGET_MIN_H = 80;

const App: Component = () => {
  const [showModelOverlay, setShowModelOverlay] = createSignal(false);
  const [showContextPanel, setShowContextPanel] = createSignal(false);
  type SettingsPanelSection = 'full' | 'audio' | 'model';
  const [settingsPanelSection, setSettingsPanelSection] = createSignal<SettingsPanelSection>('full');
  let panelHoverCloseTimeout: number | undefined;
  const [workerReady, setWorkerReady] = createSignal(false);
  const [widgetPos, setWidgetPos] = createSignal<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);

  const isRecording = () => appStore.recordingState() === 'recording';
  const isModelReady = () => appStore.modelState() === 'ready';

  let dragStart = { x: 0, y: 0 };
  let posStart = { x: 0, y: 0 };

  const [windowHeight, setWindowHeight] = createSignal(typeof window !== 'undefined' ? window.innerHeight : 600);
  const settingsExpandUp = () => {
    const pos = widgetPos();
    if (!pos) return true;
    return pos.y >= windowHeight() / 2;
  };

  const handleWidgetDragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    e.preventDefault();
    const pos = widgetPos();
    if (!pos) return;
    setIsDragging(true);
    dragStart = { x: e.clientX, y: e.clientY };
    posStart = { ...pos };
    const onMove = (e2: MouseEvent) => {
      const dx = e2.clientX - dragStart.x;
      const dy = e2.clientY - dragStart.y;
      const w = typeof window !== 'undefined' ? window.innerWidth : 800;
      const h = typeof window !== 'undefined' ? window.innerHeight : 600;
      const newX = Math.max(0, Math.min(w - WIDGET_MAX_W, posStart.x + dx));
      const newY = Math.max(0, Math.min(h - WIDGET_MIN_H, posStart.y + dy));
      setWidgetPos({ x: newX, y: newY });
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const p = widgetPos();
      if (p && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(p));
        } catch (_) {}
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  createEffect(() => {
    if (!showContextPanel()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowContextPanel(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  createEffect(() => {
    if (appStore.modelState() === 'ready' && showContextPanel() && settingsPanelSection() === 'model') {
      setShowContextPanel(false);
    }
  });

  onMount(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);

    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(WIDGET_STORAGE_KEY) : null;
    let posRestored = false;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { x: number; y: number };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          setWidgetPos({ x: parsed.x, y: parsed.y });
          posRestored = true;
        }
      } catch (_) {}
    }
    if (!posRestored) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setWidgetPos({
        x: Math.max(0, (w - WIDGET_MAX_W) / 2),
        y: h - 140,
      });
    }

    workerClient = new TranscriptionWorkerClient();

    workerClient.onModelProgress = (p) => {
      appStore.setModelProgress(p.progress);
      appStore.setModelMessage(p.message || '');
      if (p.file) appStore.setModelFile(p.file);
    };

    workerClient.onModelStateChange = (s) => {
      appStore.setModelState(s);
    };

    workerClient.onV3Confirmed = (text) => {
      appStore.setTranscript(text);
    };

    workerClient.onV3Pending = (text) => {
      appStore.setPendingText(text);
    };

    workerClient.onError = (msg) => {
      appStore.setErrorMessage(msg);
    };

    appStore.refreshDevices();
    setWorkerReady(true);

    return () => window.removeEventListener('resize', onResize);
  });

  // No longer auto-show blocking model overlay; model selection is in the settings panel.
  // createEffect(() => { ... setShowModelOverlay(true); });

  onCleanup(() => {
    clearTimeout(panelHoverCloseTimeout);
    visualizationUnsubscribe?.();
    cleanupV4Pipeline();
    cleanupV5Pipeline();
    melClient?.dispose();
    workerClient?.dispose();
  });

  // ---- v4 pipeline tick: periodic window building + inference ----
  let v4TickCount = 0;
  let v4ModelNotReadyLogged = false;
  const v4Tick = async () => {
    if (!workerClient || !windowBuilder || !audioEngine || !bufferClient) return;

    // Skip inference if model is not ready (but still allow audio/mel/VAD to process)
    if (appStore.modelState() !== 'ready') {
      if (!v4ModelNotReadyLogged) {
        console.log('[v4Tick] Model not ready yet - audio is being captured and preprocessed');
        v4ModelNotReadyLogged = true;
      }
      return;
    }
    // Reset the flag once model becomes ready
    if (v4ModelNotReadyLogged) {
      console.log('[v4Tick] Model is now ready - starting inference');
      v4ModelNotReadyLogged = false;
      // Initialize the v4 service now that model is ready
      await workerClient.initV4Service({ debug: false });
    }

    v4TickCount++;
    const now = performance.now();
    // Use the store's configurable inference interval (minus a small margin for the tick jitter)
    const minInterval = Math.max(200, appStore.v4InferenceIntervalMs() - 100);
    if (now - v4LastInferenceTime < minInterval) return;

    // Evaluate only the latest untranscribed chunk, not full history.
    // This prevents old speech from keeping gate=true during long silence/noise tails.
    const ringBaseSample = audioEngine.getRingBuffer().getBaseFrameOffset();
    const currentSample = v4GlobalSampleOffset;
    const chunkStart = Math.max(v4LastGateChunkSample, ringBaseSample);
    const chunkEnd = currentSample;
    let hasSpeech = false;
    let energyStats: ChunkSpeechStats | null = null;
    let inferenceStats: ChunkSpeechStats | null = null;
    if (chunkEnd > chunkStart) {
      energyStats = await computeChunkSpeechStats(bufferClient, 'energyVad', chunkStart, chunkEnd, 0.3);
      const energyValid =
        energyStats.speechDurationSec >= V4_CHUNK_MIN_SPEECH_SEC ||
        energyStats.speechRatio >= V4_CHUNK_MIN_SPEECH_RATIO;

      if (tenVADClient?.isReady()) {
        inferenceStats = await computeChunkSpeechStats(
          bufferClient,
          'inferenceVad',
          chunkStart,
          chunkEnd,
          appStore.sileroThreshold(),
        );
        const inferenceValid =
          inferenceStats.speechDurationSec >= V4_CHUNK_MIN_SPEECH_SEC ||
          inferenceStats.speechRatio >= V4_CHUNK_MIN_SPEECH_RATIO;
        hasSpeech = energyValid && inferenceValid;
      } else {
        hasSpeech = energyValid;
      }
    }
    v4LastGateChunkSample = chunkEnd;

    if (v4TickCount <= 5 || v4TickCount % 20 === 0) {
      const vadState = appStore.vadState();
      const rb = audioEngine.getRingBuffer();
      const rbFrame = rb.getCurrentFrame();
      const rbBase = rb.getBaseFrameOffset();
      const energyRatio = energyStats ? energyStats.speechRatio : 0;
      const energyDur = energyStats ? energyStats.speechDurationSec : 0;
      const infRatio = inferenceStats ? inferenceStats.speechRatio : 0;
      const infDur = inferenceStats ? inferenceStats.speechDurationSec : 0;
      console.log(
        `[v4Tick #${v4TickCount}] hasSpeech=${hasSpeech}, vadState=${vadState.hybridState}, ` +
        `energy=${vadState.energy.toFixed(4)}, inferenceVAD=${(vadState.sileroProbability || 0).toFixed(2)}, ` +
        `chunk=[${chunkStart}:${chunkEnd}], energyChunk={dur=${energyDur.toFixed(2)}s, ratio=${(energyRatio * 100).toFixed(0)}%}, ` +
        `inferenceChunk={dur=${infDur.toFixed(2)}s, ratio=${(infRatio * 100).toFixed(0)}%}, ` +
        `ringBuf=[base=${rbBase}, head=${rbFrame}, avail=${rbFrame - rbBase}]`
      );
    }

    // Periodic buffer worker state dump (every 40 ticks)
    if (v4TickCount % 40 === 0 && bufferClient) {
      try {
        const state = await bufferClient.getState();
        const layerSummary = Object.entries(state.layers)
          .map(([id, l]) => `${id}:${l.fillCount}/${l.maxEntries}@${l.currentSample}`)
          .join(', ');
        console.log(`[v4Tick #${v4TickCount}] BufferState: ${layerSummary}`);
      } catch (_) { /* ignore state query errors */ }
    }

    // Check for silence-based flush FIRST (regardless of hasSpeech)
    // This ensures pending sentences get finalized when user stops speaking
    const silenceDuration = await bufferClient.getSilenceTailDuration('energyVad', 0.3);
    const hasPendingText = windowBuilder.getMatureCursorFrame() > 0;
    
    if (silenceDuration >= appStore.v4SilenceFlushSec() && hasPendingText) {
      // Flush pending sentence via timeout finalization
      if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
        console.log(`[v4Tick #${v4TickCount}] Silence flush: ${silenceDuration.toFixed(2)}s >= ${appStore.v4SilenceFlushSec()}s`);
      }
      try {
        const flushResult = await workerClient.v4FinalizeTimeout();
        if (flushResult) {
          const remainingImmature = flushResult.immatureText || '';
          v4StateEpoch++;
          appStore.setMatureText(flushResult.matureText);
          appStore.setImmatureText(remainingImmature);
          appStore.setPendingText(remainingImmature);
          const prevCursorSec = windowBuilder.getMatureCursorTime();
          const refined = await refineCursorByVadMinProb(bufferClient, prevCursorSec, flushResult.matureCursorTime);
          appStore.setMatureCursorTime(refined.refinedSec);
          appStore.setTranscript(flushResult.fullText || flushResult.matureText);
          // Advance window builder cursor
          windowBuilder.advanceMatureCursorByTime(refined.refinedSec);
          windowBuilder.markSentenceEnd(Math.round(refined.refinedSec * V4_SAMPLE_RATE));
          lastWordEndTime = performance.now();
          lastImmatureText = remainingImmature;
          justFinalizedByTimeout = true;
          if (flushResult.debug && (appStore.showDebugPanel() || v4TickCount <= 10 || v4TickCount % 20 === 0)) {
            console.groupCollapsed(`[v4Merge #${v4TickCount}] Finalize(silence)`);
            console.log('Finalize debug:', flushResult.debug);
            console.log('Post-finalize state:', {
              matureCursorTime: flushResult.matureCursorTime,
              matureTextTail: (flushResult.matureText || '').slice(-220),
              immatureText: flushResult.immatureText || '',
            });
            console.groupEnd();
          }
        }
      } catch (err) {
        console.error('[v4Tick] Flush error:', err);
      }
    }

    // Check for word-timeout finalization: if no new words for > threshold, finalize pending text.
    // This prevents repeated transient pending text updates from being re-merged as duplicates.
    const wordTimeoutSec = appStore.v4WordTimeoutSec();
    const timeSinceLastWord = (performance.now() - lastWordEndTime) / 1000;
    const hasImmatureText = appStore.immatureText().length > 0;

    if (timeSinceLastWord >= wordTimeoutSec && hasImmatureText && lastWordEndTime > 0) {
      if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
        console.log(
          `[v4Tick #${v4TickCount}] Word timeout: ${timeSinceLastWord.toFixed(2)}s >= ${wordTimeoutSec}s, finalizing pending text`
        );
      }
      try {
        const flushResult = await workerClient.v4FinalizeTimeout();
        if (flushResult) {
          const remainingImmature = flushResult.immatureText || '';
          v4StateEpoch++;
          appStore.setMatureText(flushResult.matureText);
          appStore.setImmatureText(remainingImmature);
          appStore.setPendingText(remainingImmature);
          const prevCursorSec = windowBuilder.getMatureCursorTime();
          const refined = await refineCursorByVadMinProb(bufferClient, prevCursorSec, flushResult.matureCursorTime);
          appStore.setMatureCursorTime(refined.refinedSec);
          appStore.setTranscript(flushResult.fullText || flushResult.matureText);
          windowBuilder.advanceMatureCursorByTime(refined.refinedSec);
          windowBuilder.markSentenceEnd(Math.round(refined.refinedSec * V4_SAMPLE_RATE));
          lastWordEndTime = performance.now();
          lastImmatureText = remainingImmature;
          justFinalizedByTimeout = true;
          if (flushResult.debug && (appStore.showDebugPanel() || v4TickCount <= 10 || v4TickCount % 20 === 0)) {
            console.groupCollapsed(`[v4Merge #${v4TickCount}] Finalize(word-timeout)`);
            console.log('Finalize debug:', flushResult.debug);
            console.log('Post-finalize state:', {
              matureCursorTime: flushResult.matureCursorTime,
              matureTextTail: (flushResult.matureText || '').slice(-220),
              immatureText: flushResult.immatureText || '',
            });
            console.groupEnd();
          }
        }
      } catch (err) {
        console.error('[v4Tick] Word timeout finalize error:', err);
      }
    }

    // After flush attempt, check if we should continue with transcription
    if (!hasSpeech || justFinalizedByTimeout) {
      if (justFinalizedByTimeout) {
        justFinalizedByTimeout = false;
      }
      // No speech detected - return early to avoid unnecessary transcription
      if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
        const reason = !hasSpeech ? 'No speech' : 'Just finalized by timeout';
        console.log(`[v4Tick #${v4TickCount}] ${reason}, skipping transcription`);
      }
      return;
    }

    // Keep evaluating gate while an inference is in flight, but don't launch another.
    if (v4InferenceBusy) return;

    // Build window from cursor to current position
    const window = windowBuilder.buildWindow();
    if (!window) {
      if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
        const rb = audioEngine.getRingBuffer();
        const rbHead = rb.getCurrentFrame();
        const rbBase = rb.getBaseFrameOffset();
        console.log(
          `[v4Tick #${v4TickCount}] buildWindow=null, ` +
          `ringBuf=[base=${rbBase}, head=${rbHead}, avail=${rbHead - rbBase}], ` +
          `cursor=${windowBuilder.getMatureCursorFrame()}`
        );
      }
      return;
    }

    console.log(`[v4Tick #${v4TickCount}] Window [${window.startFrame}:${window.endFrame}] ${window.durationSeconds.toFixed(2)}s (initial=${window.isInitial})`);

    v4InferenceBusy = true;
    v4LastInferenceTime = now;
    const requestEpoch = v4StateEpoch;

    try {
      const inferenceStart = performance.now();

      // Get mel features for the window
      let features: { features: Float32Array; T: number; melBins: number } | null = null;
      if (melClient) {
        features = await melClient.getFeatures(window.startFrame, window.endFrame);
      }

      if (!features) {
        v4InferenceBusy = false;
        return;
      }

      // Calculate time offset for absolute timestamps
      const timeOffset = window.startFrame / 16000;

      // Calculate incremental cache parameters
      const cursorFrame = windowBuilder.getMatureCursorFrame();
      const prefixSeconds = cursorFrame > 0 ? (window.startFrame - cursorFrame) / 16000 : 0;

      const result: V4ProcessResult = await workerClient.processV4ChunkWithFeatures({
        features: features.features,
        T: features.T,
        melBins: features.melBins,
        timeOffset,
        endTime: window.endFrame / 16000,
        segmentId: `v4_${Date.now()}`,
        incrementalCache: prefixSeconds > 0 ? {
          cacheKey: 'v4-stream',
          prefixSeconds,
        } : undefined,
      });

      const inferenceMs = performance.now() - inferenceStart;

      // Ignore stale results that started before a finalize/flush event.
      if (requestEpoch !== v4StateEpoch) {
        if (v4TickCount <= 10 || v4TickCount % 20 === 0) {
          console.log(`[v4Tick #${v4TickCount}] Dropping stale inference result (epoch ${requestEpoch} -> ${v4StateEpoch})`);
        }
        return;
      }

      // Update UI state
      appStore.setMatureText(result.matureText);
      appStore.setImmatureText(result.immatureText);
      appStore.setTranscript(result.fullText);
      appStore.setPendingText(result.immatureText);
      appStore.setInferenceLatency(inferenceMs);

      // Track when we receive new pending words for timeout-based finalization.
      if (result.immatureText !== lastImmatureText && result.immatureText.length > 0) {
        lastWordEndTime = performance.now();
        lastImmatureText = result.immatureText;
      }

      if (result.debug && (appStore.showDebugPanel() || v4TickCount <= 10 || v4TickCount % 12 === 0)) {
        console.groupCollapsed(
          `[v4Merge #${v4TickCount}] win=[${(result.debug.windowStartSec || 0).toFixed(2)}-${(result.debug.windowEndSec || 0).toFixed(2)}] ` +
          `cursor=${result.matureCursorTime.toFixed(2)} totalSent=${result.totalSentences} mature=${result.matureSentenceCount}`
        );
        console.log('ASR:', {
          text: result.debug.asrText,
          wordCount: result.debug.asrWordCount,
          startSec: result.debug.asrStartSec,
          endSec: result.debug.asrEndSec,
          segmentId: result.debug.segmentId,
        });
        console.log('Merge decision:', result.debug.merge);
        console.log('Output:', {
          matureTextTail: (result.matureText || '').slice(-220),
          immatureText: result.immatureText || '',
          fullTextTail: (result.fullText || '').slice(-260),
          pendingSentence: result.pendingSentence,
        });
        console.groupEnd();
      }

      // Update RTF
      const audioDurationMs = window.durationSeconds * 1000;
      appStore.setRtf(inferenceMs / audioDurationMs);

      // Advance cursor if merger advanced it
      if (result.matureCursorTime > windowBuilder.getMatureCursorTime()) {
        const prevCursorSec = windowBuilder.getMatureCursorTime();
        const refined = await refineCursorByVadMinProb(bufferClient, prevCursorSec, result.matureCursorTime);
        appStore.setMatureCursorTime(refined.refinedSec);
        windowBuilder.advanceMatureCursorByTime(refined.refinedSec);
        windowBuilder.markSentenceEnd(Math.round(refined.refinedSec * V4_SAMPLE_RATE));
        if (
          Math.abs(refined.refinedSec - result.matureCursorTime) >= 0.02 &&
          (v4TickCount <= 10 || v4TickCount % 20 === 0)
        ) {
          console.log(
            `[v4CursorRefine #${v4TickCount}] ${result.matureCursorTime.toFixed(3)}s -> ${refined.refinedSec.toFixed(3)}s ` +
            `(source=${refined.source}, baseProb=${Number.isFinite(refined.baseProb) ? refined.baseProb.toFixed(3) : 'n/a'}, ` +
            `minProb=${Number.isFinite(refined.minProb) ? refined.minProb.toFixed(3) : 'n/a'})`
          );
        }
      }

      // Update stats
      appStore.setV4MergerStats({
        sentencesFinalized: result.matureSentenceCount,
        cursorUpdates: result.stats?.matureCursorUpdates || 0,
        utterancesProcessed: result.stats?.utterancesProcessed || 0,
      });

      // Update buffer metrics
      const ring = audioEngine.getRingBuffer();
      appStore.setBufferMetrics({
        fillRatio: ring.getFillCount() / ring.getSize(),
        latencyMs: (ring.getFillCount() / 16000) * 1000,
      });

      // Update metrics
      if (result.metrics) {
        appStore.setSystemMetrics({
          throughput: 0,
          modelConfidence: 0,
        });
      }
    } catch (err: any) {
      console.error('[v4Tick] Inference error:', err);
    } finally {
      v4InferenceBusy = false;
    }
  };

  const runV5Fast = async (startSample: number, endSample: number, immediate = false) => {
    if (!workerClient || !melClient || !audioEngine) return;
    if (endSample <= startSample) return;
    if (v5InferenceBusy) {
      v5PendingFastRange = { startSample, endSample };
      return;
    }

    v5InferenceBusy = true;
    v5LastFastInferenceTime = performance.now();

    try {
      const inferenceStart = performance.now();
      const features = await melClient.getFeatures(startSample, endSample);
      if (!features) return;

      const result = await workerClient.processV5Fast({
        features: features.features,
        T: features.T,
        melBins: features.melBins,
        timeOffset: startSample / 16000,
        endTime: endSample / 16000,
        allowDecoderContinuation: !immediate,
      });

      applyV5StateToStore(result);
      v5FastCursorSample = Math.max(v5FastCursorSample, endSample);

      const inferenceMs = performance.now() - inferenceStart;
      const audioDurationMs = ((endSample - startSample) / 16000) * 1000;
      if (audioDurationMs > 0) {
        appStore.setRtf(inferenceMs / audioDurationMs);
      }
      appStore.setInferenceLatency(inferenceMs);

      const ring = audioEngine.getRingBuffer();
      appStore.setBufferMetrics({
        fillRatio: ring.getFillCount() / ring.getSize(),
        latencyMs: (ring.getFillCount() / 16000) * 1000,
      });
    } catch (err) {
      console.error('[v5Fast] Inference error:', err);
    } finally {
      v5InferenceBusy = false;
      if (v5PendingFastRange && appStore.recordingState() === 'recording') {
        const pending = v5PendingFastRange;
        v5PendingFastRange = null;
        queueMicrotask(() => {
          runV5Fast(pending.startSample, pending.endSample);
        });
      }
    }
  };

  const runV5Correction = async (startSample: number, endSample: number, overlapSec: number) => {
    if (!workerClient || !melClient) return;
    if (endSample <= startSample) return;
    if (v5InferenceBusy) return;

    v5InferenceBusy = true;
    v5LastCorrectionInferenceTime = performance.now();

    try {
      const features = await melClient.getFeatures(startSample, endSample);
      if (!features) return;

      const result = await workerClient.processV5Correction({
        features: features.features,
        T: features.T,
        melBins: features.melBins,
        timeOffset: startSample / 16000,
        endTime: endSample / 16000,
        incrementalCache: overlapSec > 0 ? {
          cacheKey: 'v5-correction',
          prefixSeconds: overlapSec,
        } : undefined,
      });

      applyV5StateToStore(result);
      v5LastCorrectionEndSample = Math.max(v5LastCorrectionEndSample, endSample);
    } catch (err) {
      console.error('[v5Correction] Inference error:', err);
    } finally {
      v5InferenceBusy = false;
    }
  };

  const v5Tick = async () => {
    if (!workerClient || !audioEngine || !bufferClient || !melClient) return;

    if (appStore.modelState() !== 'ready') {
      if (!v5ModelNotReadyLogged) {
        console.log('[v5Tick] Model not ready yet - collecting audio/mel/VAD');
        v5ModelNotReadyLogged = true;
      }
      return;
    }
    if (v5ModelNotReadyLogged) {
      v5ModelNotReadyLogged = false;
      console.log('[v5Tick] Model ready - starting v5 stream');
    }
    if (!v5ServiceInitialized) {
      await workerClient.initV5Stream({
        stabilityLagSec: appStore.v5StabilityLagSec(),
        correctionConfirmations: 2,
        debug: false,
      });
      v5ServiceInitialized = true;
    }

    v5TickCount += 1;
    const now = performance.now();
    const currentSample = v5GlobalSampleOffset;
    const ringBaseSample = audioEngine.getRingBuffer().getBaseFrameOffset();

    const chunkStart = Math.max(v5LastGateChunkSample, ringBaseSample);
    const chunkEnd = currentSample;
    if (chunkEnd <= chunkStart) {
      return;
    }

    const energyResult = await bufferClient.hasSpeech('energyVad', chunkStart, chunkEnd, 0.3);
    const inferenceResult = tenVADClient?.isReady()
      ? await bufferClient.hasSpeech('inferenceVad', chunkStart, chunkEnd, appStore.sileroThreshold())
      : null;

    const energyValid = energyResult.hasSpeech;
    const inferenceValid = inferenceResult ? inferenceResult.hasSpeech : true;
    const chunkValid = tenVADClient?.isReady() ? (energyValid && inferenceValid) : energyValid;

    const prevGate = v5GateState;
    if (chunkValid) {
      if (v5GateState === 'idle') {
        v5GateState = 'candidate';
        v5GateReason = tenVADClient?.isReady() ? 'chunk valid (energy+inference)' : 'chunk valid (energy)';
      } else {
        v5GateState = 'active';
        v5GateReason = 'gate active';
      }
    } else {
      const silenceDuration = await bufferClient.getSilenceTailDuration('energyVad', 0.3);
      if (silenceDuration >= appStore.v4SilenceFlushSec()) {
        if (v5GateState !== 'idle') {
          const correctionWindowSamples = Math.max(
            Math.round(appStore.v5CorrectionWindowSec() * 16000),
            Math.round(appStore.v5CorrectionOverlapSec() * 16000),
          );
          const correctionStart = Math.max(ringBaseSample, currentSample - correctionWindowSamples);
          const correctionOverlapSec = Math.min(
            appStore.v5CorrectionOverlapSec(),
            (currentSample - correctionStart) / 16000,
          );
          if (!v5InferenceBusy && currentSample > correctionStart) {
            await runV5Correction(correctionStart, currentSample, correctionOverlapSec);
          }
          const finalState = await workerClient.v5FinalizeSilence(currentSample / 16000);
          applyV5StateToStore(finalState);
        }
        v5GateState = 'idle';
        v5GateReason = `silence flush (${silenceDuration.toFixed(2)}s)`;
      } else if (v5GateState === 'active') {
        v5GateState = 'candidate';
        v5GateReason = 'awaiting speech confirmation';
      } else {
        v5GateState = 'idle';
        v5GateReason = 'chunk invalid';
      }
    }

    v5LastGateChunkSample = chunkEnd;
    appStore.setV5TimelineStats((prev) => ({
      ...prev,
      gateState: v5GateState,
      gateReason: v5GateReason,
    }));

    if (v5TickCount <= 5 || v5TickCount % 20 === 0) {
      console.log(
        `[v5Tick #${v5TickCount}] gate=${v5GateState}, chunkValid=${chunkValid}, ` +
        `energy=${energyValid}, inference=${inferenceResult ? inferenceValid : 'n/a'}, ` +
        `chunk=[${chunkStart}:${chunkEnd}], fastCursor=${v5FastCursorSample}`
      );
    }

    const activatedNow = prevGate !== 'active' && v5GateState === 'active';
    const gateAllowsInference = v5GateState === 'active';
    if (!gateAllowsInference) return;

    const fastIntervalMs = Math.max(240, appStore.v4InferenceIntervalMs());
    const hasNewFastAudio = chunkEnd > Math.max(v5FastCursorSample, ringBaseSample);
    const fastDue = activatedNow || (now - v5LastFastInferenceTime >= fastIntervalMs);

    if (hasNewFastAudio && fastDue) {
      const fastStart = Math.max(v5FastCursorSample, ringBaseSample);
      const fastEnd = chunkEnd;
      if (v5InferenceBusy) {
        v5PendingFastRange = { startSample: fastStart, endSample: fastEnd };
      } else {
        await runV5Fast(fastStart, fastEnd, activatedNow);
      }
    }

    const correctionIntervalMs = Math.max(480, appStore.v5CorrectionIntervalMs());
    const correctionDue = now - v5LastCorrectionInferenceTime >= correctionIntervalMs;
    const hasNewCorrectionAudio = chunkEnd > Math.max(v5LastCorrectionEndSample, ringBaseSample);

    if (!v5InferenceBusy && correctionDue && hasNewCorrectionAudio) {
      const correctionWindowSamples = Math.max(
        Math.round(appStore.v5CorrectionWindowSec() * 16000),
        Math.round(appStore.v5CorrectionOverlapSec() * 16000),
      );
      const correctionEnd = chunkEnd;
      const correctionStart = Math.max(ringBaseSample, correctionEnd - correctionWindowSamples);
      const overlapSec = Math.min(
        appStore.v5CorrectionOverlapSec(),
        (correctionEnd - correctionStart) / 16000,
      );
      await runV5Correction(correctionStart, correctionEnd, overlapSec);
    }
  };

  // ---- Cleanup v4 pipeline resources ----
  const cleanupV4Pipeline = () => {
    v4TickRunning = false;
    if (v4TickTimeout) {
      clearTimeout(v4TickTimeout);
      v4TickTimeout = undefined;
    }
    if (v4AudioChunkUnsubscribe) {
      v4AudioChunkUnsubscribe();
      v4AudioChunkUnsubscribe = null;
    }
    if (v4MelChunkUnsubscribe) {
      v4MelChunkUnsubscribe();
      v4MelChunkUnsubscribe = null;
    }
    hybridVAD = null;
    if (tenVADClient) {
      tenVADClient.dispose();
      tenVADClient = null;
    }
    if (bufferClient) {
      bufferClient.dispose();
      bufferClient = null;
    }
    windowBuilder = null;
    v4InferenceBusy = false;
    v4LastInferenceTime = 0;
    v4GlobalSampleOffset = 0;
    v4LastGateChunkSample = 0;
    lastWordEndTime = 0;
    lastImmatureText = '';
    justFinalizedByTimeout = false;
    v4StateEpoch = 0;
  };

  const cleanupV5Pipeline = () => {
    v5TickRunning = false;
    if (v5TickTimeout) {
      clearTimeout(v5TickTimeout);
      v5TickTimeout = undefined;
    }
    if (v5AudioChunkUnsubscribe) {
      v5AudioChunkUnsubscribe();
      v5AudioChunkUnsubscribe = null;
    }
    hybridVAD = null;
    if (tenVADClient) {
      tenVADClient.dispose();
      tenVADClient = null;
    }
    if (bufferClient) {
      bufferClient.dispose();
      bufferClient = null;
    }
    v5InferenceBusy = false;
    v5LastFastInferenceTime = 0;
    v5LastCorrectionInferenceTime = 0;
    v5GlobalSampleOffset = 0;
    v5LastGateChunkSample = 0;
    v5FastCursorSample = 0;
    v5LastCorrectionEndSample = 0;
    v5GateState = 'idle';
    v5GateReason = 'idle';
    v5PendingFastRange = null;
    v5TickCount = 0;
    v5ModelNotReadyLogged = false;
    v5ServiceInitialized = false;
    appStore.setV5TimelineStats((prev) => ({
      ...prev,
      gateState: 'idle',
      gateReason: 'idle',
    }));
  };

  const toggleRecording = async () => {
    if (isRecording()) {
      // Update UI immediately so the stop button always takes effect even if cleanup throws
      visualizationUnsubscribe?.();
      visualizationUnsubscribe = undefined;
      appStore.stopRecording();
      appStore.setAudioLevel(0);
      appStore.setBarLevels(new Float32Array(0));

      try {
        audioEngine?.stop();

        if (segmentUnsubscribe) segmentUnsubscribe();
        if (windowUnsubscribe) windowUnsubscribe();
        if (melChunkUnsubscribe) melChunkUnsubscribe();
        cleanupV4Pipeline();
        cleanupV5Pipeline();

        if (workerClient) {
          const final = await workerClient.finalize();
          let text = '';
          if ('text' in final && typeof final.text === 'string') {
            text = final.text;
          } else if ('fullText' in final && typeof final.fullText === 'string') {
            text = final.fullText;
          }
          appStore.setTranscript(text);
          appStore.setPendingText('');
        }

        melClient?.reset();
        audioEngine?.reset();
      } catch (err) {
        console.warn('[App] Error during stop recording cleanup:', err);
      }
    } else {
      try {
        if (!audioEngine) {
          audioEngine = new AudioEngine({
            sampleRate: 16000,
            deviceId: appStore.selectedDeviceId(),
          });
          setAudioEngineSignal(audioEngine);
        } else {
          audioEngine.updateConfig({ deviceId: appStore.selectedDeviceId() });
          audioEngine.reset();
        }

        const mode = appStore.transcriptionMode();
        // v5 path was retired; keep startup on v4-only flow.
        const isV5Mode = false;

        // v4 mode: always start audio capture, mel preprocessing, and VAD.
        // Inference starts when the model is ready.
        if (mode === 'v4-utterance') {
          // ---- v4: shared capture + VAD stack ----

          if (isModelReady() && workerClient) {
            await workerClient.initV4Service({ debug: false });
          }

          // Initialize mel worker (always needed for preprocessing)
          if (!melClient) {
            melClient = new MelWorkerClient();
            setMelClientSignal(melClient);
          }
          try {
            await melClient.init({ nMels: 128 });
          } catch (e) {
            melClient.dispose();
            melClient = null;
            setMelClientSignal(null);
          }

          // Initialize BufferWorker (centralized multi-layer data store)
          bufferClient = new BufferWorkerClient();
          const bufferConfig: BufferWorkerConfig = {
            sampleRate: 16000,
            layers: {
              audio: { hopSamples: 1, entryDimension: 1, maxDurationSec: 120 },
              mel: { hopSamples: 160, entryDimension: 128, maxDurationSec: 120 },
              energyVad: { hopSamples: 1280, entryDimension: 1, maxDurationSec: 120 },
              inferenceVad: { hopSamples: 256, entryDimension: 1, maxDurationSec: 120 },
            },
          };
          await bufferClient.init(bufferConfig);

          // Initialize TEN-VAD worker (inference-based VAD)
          tenVADClient = new TenVADWorkerClient();
          tenVADClient.onResult((result: TenVADResult) => {
            if (!bufferClient) return;
            // Batch-write hop probabilities to inferenceVad (single worker message)
            if (result.hopCount > 0) {
              const lastProb = result.probabilities[result.hopCount - 1];
              if (bufferClient.writeBatchTransfer) {
                bufferClient.writeBatchTransfer('inferenceVad', result.probabilities, result.globalSampleOffset);
              } else {
                bufferClient.writeBatch('inferenceVad', result.probabilities, result.globalSampleOffset);
              }

              // Update UI at most once per frame with the latest probability
              scheduleSileroUpdate(lastProb);
            }
          });
          // TEN-VAD init is non-blocking; falls back gracefully if WASM fails
          const wasmPath = `${import.meta.env.BASE_URL}wasm/`;
          tenVADClient.init({ hopSize: 256, threshold: 0.5, wasmPath }).catch((err) => {
            console.warn('[v4] TEN-VAD init failed, using energy-only:', err);
          });

          // Initialize hybrid VAD for energy-based detection (always runs, fast)
          hybridVAD = new HybridVAD({
            sileroThreshold: 0.5,
            onsetConfirmations: 2,
            offsetConfirmations: 3,
            sampleRate: 16000,
          });
          // Do NOT init Silero in HybridVAD (TEN-VAD replaces it)

          // NOTE: WindowBuilder is created AFTER audioEngine.start() below,
          // because start() may re-create the internal RingBuffer.

          // Reset v4 sample/inference counters
          v4GlobalSampleOffset = 0;
          v4LastGateChunkSample = 0;
          lastWordEndTime = 0;
          lastImmatureText = '';
          justFinalizedByTimeout = false;
          v4StateEpoch = 0;

          // Feed audio chunks to mel worker from the main audio handler below
          v4MelChunkUnsubscribe = null;

          // Process each audio chunk: energy VAD + write to BufferWorker + forward to TEN-VAD
          const audioChunkHandler = (chunk: Float32Array) => {
            if (!hybridVAD || !bufferClient) return;

            const chunkOffset = isV5Mode ? v5GlobalSampleOffset : v4GlobalSampleOffset;
            if (isV5Mode) {
              v5GlobalSampleOffset += chunk.length;
            } else {
              v4GlobalSampleOffset += chunk.length;
            }

            // 1. Run energy VAD (synchronous, fast) and write to BufferWorker
            const vadResult = hybridVAD.processEnergyOnly(chunk);
            const energyProb = vadResult.isSpeech ? 0.9 : 0.1;
            bufferClient.writeScalar('energyVad', energyProb);

            // 2. Forward audio to mel worker (copy, keep chunk for TEN-VAD transfer)
            melClient?.pushAudioCopy(chunk);

            // 3. Forward audio to TEN-VAD worker for inference-based VAD (transfer, no copy)
            if (tenVADClient?.isReady()) {
              tenVADClient.processTransfer(chunk, chunkOffset);
            }

            // 4. Update VAD state for UI
            const sileroProbability = tenVADClient?.isReady()
              ? undefined
              : (vadResult.sileroProbability || 0);
            scheduleVadStateUpdate({
              isSpeech: vadResult.isSpeech,
              energy: vadResult.energy,
              snr: vadResult.snr || 0,
              hybridState: vadResult.state,
              ...(sileroProbability !== undefined ? { sileroProbability } : {}),
            });
          };
          if (isV5Mode) {
            v5AudioChunkUnsubscribe = audioEngine.onAudioChunk(audioChunkHandler);
          } else {
            v4AudioChunkUnsubscribe = audioEngine.onAudioChunk(audioChunkHandler);
          }

          // Start adaptive inference tick loop (reads interval from appStore)
          if (isV5Mode) {
            v5TickRunning = true;
            const scheduleNextTick = () => {
              if (!v5TickRunning) return;
              v5TickTimeout = window.setTimeout(async () => {
                if (!v5TickRunning) return;
                await v5Tick();
                scheduleNextTick();
              }, appStore.v4InferenceIntervalMs());
            };
            scheduleNextTick();
          } else {
            // Note: v4Tick internally checks if model is ready before running inference
            v4TickRunning = true;
            const scheduleNextTick = () => {
              if (!v4TickRunning) return;
              v4TickTimeout = window.setTimeout(async () => {
                if (!v4TickRunning) return;
                await v4Tick();
                scheduleNextTick();
              }, appStore.v4InferenceIntervalMs());
            };
            scheduleNextTick();
          }

        } else if (isModelReady() && workerClient) {
          // v3 and v2 modes still require model to be ready
          if (mode === 'v3-streaming') {
            // ---- v3: Fixed-window token streaming (existing) ----
            const windowDur = appStore.streamingWindow();
            const triggerInt = appStore.triggerInterval();
            const overlapDur = Math.max(1.0, windowDur - triggerInt);

            await workerClient.initV3Service({
              windowDuration: windowDur,
              overlapDuration: overlapDur,
              sampleRate: 16000,
              frameStride: appStore.frameStride(),
            });

            if (!melClient) {
              melClient = new MelWorkerClient();
              setMelClientSignal(melClient);
            }
            try {
              await melClient.init({ nMels: 128 });
            } catch (e) {
              melClient.dispose();
              melClient = null;
              setMelClientSignal(null);
            }

            melChunkUnsubscribe = audioEngine.onAudioChunk((chunk) => {
              melClient?.pushAudioCopy(chunk);
            });

            windowUnsubscribe = audioEngine.onWindowChunk(
              windowDur,
              overlapDur,
              triggerInt,
              async (audio, startTime) => {
                if (!workerClient) return;
                const start = performance.now();

                let result;
                if (melClient) {
                  const startSample = Math.round(startTime * 16000);
                  const endSample = startSample + audio.length;
                  const melFeatures = await melClient.getFeatures(startSample, endSample);

                  if (melFeatures) {
                    result = await workerClient.processV3ChunkWithFeatures(
                      melFeatures.features,
                      melFeatures.T,
                      melFeatures.melBins,
                      startTime,
                      overlapDur,
                    );
                  } else {
                    result = await workerClient.processV3Chunk(audio, startTime);
                  }
                } else {
                  result = await workerClient.processV3Chunk(audio, startTime);
                }

                const duration = performance.now() - start;
                const stride = appStore.triggerInterval();
                appStore.setRtf(duration / (stride * 1000));
                appStore.setInferenceLatency(duration);

                if (audioEngine) {
                  const ring = audioEngine.getRingBuffer();
                  appStore.setBufferMetrics({
                    fillRatio: ring.getFillCount() / ring.getSize(),
                    latencyMs: (ring.getFillCount() / 16000) * 1000,
                  });
                }

                appStore.setMergeInfo({
                  lcsLength: result.lcsLength,
                  anchorValid: result.anchorValid,
                  chunkCount: result.chunkCount,
                  anchorTokens: result.anchorTokens
                });
              }
            );
          } else {
            // ---- v2: Per-utterance (existing) ----
            await workerClient.initService({ sampleRate: 16000 });
            segmentUnsubscribe = audioEngine.onSpeechSegment(async (segment) => {
              if (workerClient) {
                const start = Date.now();
                const samples = audioEngine!.getRingBuffer().read(segment.startFrame, segment.endFrame);
                const result = await workerClient.transcribeSegment(samples);
                if (result.text) appStore.appendTranscript(result.text + ' ');
                appStore.setInferenceLatency(Date.now() - start);
              }
            });
          }
        }

        await audioEngine.start();

        // Create WindowBuilder AFTER start() so we get the final RingBuffer reference
        // (AudioEngine.init() re-creates the RingBuffer internally)
        if (mode === 'v4-utterance') {
          windowBuilder = new WindowBuilder(
            audioEngine.getRingBuffer(),
            null, // No VADRingBuffer; hasSpeech now goes through BufferWorker
            {
              sampleRate: 16000,
              minDurationSec: 3.0,
              maxDurationSec: 30.0,
              minInitialDurationSec: 1.5,
              useVadBoundaries: false, // VAD boundaries now managed by BufferWorker
              vadSilenceThreshold: 0.3,
              debug: true, // Enable debug logging for diagnostics
            }
          );
        }

        appStore.startRecording();

        // Use same 30fps tick (onVisualizationUpdate throttled to 33ms).
        // Bar levels from AnalyserNode (native FFT, low CPU) instead of mel worker.
        visualizationUnsubscribe = audioEngine.onVisualizationUpdate((_data, metrics) => {
          appStore.setAudioLevel(metrics.currentEnergy);
          if (appStore.transcriptionMode() !== 'v4-utterance') {
            appStore.setIsSpeechDetected(audioEngine?.isSpeechActive() ?? false);
          }
          appStore.setBarLevels(audioEngine!.getBarLevels());
        });
      } catch (err: any) {
        console.error('[App] Failed to start recording:', err);
        appStore.setErrorMessage(err?.message ?? String(err));
      }
    }
  };

  const loadSelectedModel = async () => {
    if (!workerClient) return;
    if (appStore.modelState() === 'ready') return;
    if (appStore.modelState() === 'loading') return;
    setShowContextPanel(true);
    try {
      await workerClient.initModel(appStore.selectedModelId());
    } catch (e) {
      console.error('Failed to load model:', e);
      appStore.setModelState('error');
      appStore.setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const openPanelForAudio = () => {
    clearTimeout(panelHoverCloseTimeout);
    setSettingsPanelSection('audio');
    setShowContextPanel(true);
  };
  const openPanelForModel = () => {
    clearTimeout(panelHoverCloseTimeout);
    setSettingsPanelSection('model');
    setShowContextPanel(true);
  };
  const schedulePanelCloseIfHover = () => {
    panelHoverCloseTimeout = window.setTimeout(() => {
      if (settingsPanelSection() !== 'full' && appStore.modelState() !== 'loading') {
        setShowContextPanel(false);
      }
    }, 250);
  };
  const cancelPanelClose = () => clearTimeout(panelHoverCloseTimeout);
  const panelMouseLeave = () => {
    if (settingsPanelSection() !== 'full') schedulePanelCloseIfHover();
  };

  const handleLocalLoad = async (files: FileList) => {
    if (!workerClient) return;
    setShowContextPanel(true);
    try {
      await workerClient.initLocalModel(files);
    } catch (e) {
      console.error('Failed to load local model:', e);
    }
  };

  return (
    <div class="h-screen flex flex-col overflow-hidden bg-[var(--color-earthy-bg)] selection:bg-[var(--color-earthy-coral)] selection:text-white">
      <ModelLoadingOverlay
        isVisible={showModelOverlay()}
        state={appStore.modelState()}
        progress={appStore.modelProgress()}
        message={appStore.modelMessage()}
        file={appStore.modelFile()}
        backend={appStore.backend()}
        selectedModelId={appStore.selectedModelId()}
        onModelSelect={(id: string) => appStore.setSelectedModelId(id)}
        onStart={() => loadSelectedModel()}
        onLocalLoad={handleLocalLoad}
        onClose={() => setShowModelOverlay(false)}
      />

      <Header
        onToggleDebug={() => appStore.setShowDebugPanel(!appStore.showDebugPanel())}
      />

      <div class="flex-1 flex overflow-hidden relative">
        <main class="flex-1 overflow-y-auto custom-scrollbar px-6 flex flex-col items-center">
          <div class="max-w-3xl w-full py-12 lg:py-20">
            <TranscriptionDisplay
              confirmedText={appStore.transcriptionMode() === 'v4-utterance'
                ? appStore.matureText()
                : appStore.transcript()}
              pendingText={appStore.transcriptionMode() === 'v4-utterance'
                ? appStore.immatureText()
                : appStore.pendingText()}
              isRecording={isRecording()}
              lcsLength={appStore.mergeInfo().lcsLength}
              anchorValid={appStore.mergeInfo().anchorValid}
              showConfidence={appStore.transcriptionMode() === 'v3-streaming'}
              class="min-h-[40vh]"
            />
          </div>
        </main>
      </div>

      {/* Draggable floating control widget */}
      <div
        class={widgetPos() !== null ? 'fixed z-30 w-full max-w-2xl px-6 select-none' : 'absolute bottom-8 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-6'}
        style={widgetPos() ? { left: `${widgetPos()!.x}px`, top: `${widgetPos()!.y}px` } : {}}
      >
        <div class="relative">
          {/* Settings panel: expands up or down depending on bar position vs half screen height */}
          <div
            class="absolute left-0 right-0 overflow-hidden transition-[max-height] duration-300 ease-out border border-[var(--color-earthy-sage)]/30 bg-[var(--color-earthy-bg)]/95 backdrop-blur-sm shadow-lg"
            classList={{
              'max-h-0': !showContextPanel(),
              'max-h-[70vh]': showContextPanel(),
              'bottom-full rounded-t-2xl border-b-0': settingsExpandUp(),
              'top-full rounded-b-2xl border-t-0': !settingsExpandUp(),
            }}
            onMouseEnter={cancelPanelClose}
            onMouseLeave={panelMouseLeave}
          >
            <div class="max-h-[70vh] min-h-0 flex flex-col overflow-y-auto custom-scrollbar">
              <SettingsContent
                section={settingsPanelSection()}
                onClose={() => setShowContextPanel(false)}
                onLoadModel={() => loadSelectedModel()}
                onLocalLoad={handleLocalLoad}
                onOpenDebug={() => appStore.setShowDebugPanel(true)}
                onDeviceSelect={(id) => {
                  if (audioEngine) audioEngine.updateConfig({ deviceId: id });
                }}
                audioEngine={audioEngineSignal() ?? undefined}
                expandUp={settingsExpandUp}
              />
            </div>
          </div>

          {/* Control bar: steady, fixed position; never moves when settings open */}
          <div
            class="bg-white/90 backdrop-blur-md shadow-lg border border-[var(--color-earthy-sage)]/30 rounded-2xl overflow-hidden"
            onMouseDown={handleWidgetDragStart}
            role="presentation"
          >
            <div class="p-4 flex items-center justify-between gap-6 cursor-grab active:cursor-grabbing">
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="material-symbols-outlined text-[var(--color-earthy-soft-brown)] text-lg opacity-60" aria-hidden="true">drag_indicator</span>
              <div class="flex flex-col min-w-[60px]">
                <span class="text-[10px] uppercase tracking-wider text-[var(--color-earthy-soft-brown)] font-bold">Rec</span>
                <span class="font-mono text-sm text-[var(--color-earthy-dark-brown)]">{formatDuration(appStore.sessionDuration())}</span>
              </div>
            </div>
            <div class="flex-1 min-w-0 flex flex-col justify-center gap-1">
              <div class="h-8 flex items-center justify-center gap-1 overflow-hidden opacity-80 abstract-wave">
                <CompactWaveform audioLevel={appStore.audioLevel()} barLevels={appStore.barLevels()} isRecording={isRecording()} />
              </div>
              <Show when={appStore.modelState() === 'loading'}>
                <div class="flex items-center gap-2 px-1">
                  <div class="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--color-earthy-sage)]/20">
                    <div
                      class="h-full bg-[var(--color-earthy-muted-green)] rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, appStore.modelProgress()))}%` }}
                    />
                  </div>
                  <span class="text-[10px] font-mono text-[var(--color-earthy-soft-brown)] tabular-nums">{Math.round(appStore.modelProgress())}%</span>
                </div>
              </Show>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={toggleRecording}
                onMouseEnter={openPanelForAudio}
                onMouseLeave={schedulePanelCloseIfHover}
                class={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${isRecording() ? 'bg-[var(--color-earthy-coral)] text-white border-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] border-transparent hover:border-[var(--color-earthy-sage)]/30'}`}
                title={isRecording() ? 'Stop recording' : 'Start recording'}
              >
                <span class="material-symbols-outlined">mic</span>
              </button>
              <button
                type="button"
                onClick={() => loadSelectedModel()}
                onMouseEnter={openPanelForModel}
                onMouseLeave={schedulePanelCloseIfHover}
                disabled={appStore.modelState() === 'loading' || appStore.modelState() === 'ready'}
                class="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] transition-colors border border-transparent hover:border-[var(--color-earthy-sage)]/30 disabled:opacity-40 disabled:cursor-not-allowed relative"
                title={appStore.modelState() === 'ready' ? 'Model loaded' : appStore.modelState() === 'loading' ? 'Loading...' : 'Load model'}
              >
                <Show when={appStore.modelState() === 'loading'} fallback={<span class="material-symbols-outlined">power_settings_new</span>}>
                  <span class="material-symbols-outlined load-btn-spin">progress_activity</span>
                </Show>
              </button>
              <button
                type="button"
                onClick={() => { setSettingsPanelSection('full'); setShowContextPanel((v) => !v); }}
                class={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${showContextPanel() ? 'bg-[var(--color-earthy-sage)]/30 text-[var(--color-earthy-muted-green)] border-[var(--color-earthy-sage)]/50' : 'text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] border-transparent hover:border-[var(--color-earthy-sage)]/30'}`}
                title="Settings"
              >
                <span class="material-symbols-outlined">tune</span>
              </button>
              <button
                type="button"
                onClick={() => isRecording() && toggleRecording()}
                disabled={!isRecording()}
                class="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] transition-colors border border-transparent hover:border-[var(--color-earthy-sage)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Pause"
              >
                <span class="material-symbols-outlined">pause</span>
              </button>
              <button
                type="button"
                onClick={() => appStore.copyTranscript()}
                class="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] transition-colors border border-transparent hover:border-[var(--color-earthy-sage)]/30"
                title="Copy transcript"
              >
                <span class="material-symbols-outlined">content_copy</span>
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Foldable debug panel (bottom drawer) */}
      <Show when={appStore.showDebugPanel()}>
        <div class="absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-[var(--color-earthy-bg)] border-t border-[var(--color-earthy-sage)]/30 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] max-h-[70vh] overflow-hidden transition-all">
          <DebugPanel
            audioEngine={audioEngineSignal() ?? undefined}
            melClient={melClientSignal() ?? undefined}
          />
        </div>
      </Show>
    </div>
  );
};

export default App;

