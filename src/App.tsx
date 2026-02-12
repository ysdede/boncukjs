import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { appStore } from './stores/appStore';
import { CompactWaveform, SPECTRUM_BAR_COUNT, ModelLoadingOverlay, DebugPanel, TranscriptionDisplay, SettingsContent } from './components';
import { getModelDisplayName, MODELS } from './components/ModelLoadingOverlay';
import { AudioEngine } from './lib/audio';
import { MelWorkerClient } from './lib/audio/MelWorkerClient';
import { normalizeMelForDisplay } from './lib/audio/mel-display';
import { TranscriptionWorkerClient } from './lib/transcription';
import { HybridVAD } from './lib/vad';
import { WindowBuilder } from './lib/transcription/WindowBuilder';
import { BufferWorkerClient } from './lib/buffer';
import { TenVADWorkerClient } from './lib/vad/TenVADWorkerClient';
import type { V4ProcessResult } from './lib/transcription/TranscriptionWorkerClient';
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
// Global sample counter for audio chunks (tracks total samples written to BufferWorker)
let v4GlobalSampleOffset = 0;
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

  onMount(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);

    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(WIDGET_STORAGE_KEY) : null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { x: number; y: number };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          setWidgetPos({ x: parsed.x, y: parsed.y });
          return;
        }
      } catch (_) {}
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    setWidgetPos({
      x: Math.max(0, (w - WIDGET_MAX_W) / 2),
      y: h - 140,
    });
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

    return () => window.removeEventListener('resize', onResize);
  });

  onCleanup(() => {
    visualizationUnsubscribe?.();
    cleanupV4Pipeline();
    melClient?.dispose();
    workerClient?.dispose();
  });

  // ---- v4 pipeline tick: periodic window building + inference ----
  let v4TickCount = 0;
  let v4ModelNotReadyLogged = false;
  const v4Tick = async () => {
    if (!workerClient || !windowBuilder || !audioEngine || !bufferClient || v4InferenceBusy) return;

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

    // Check if there is speech via the BufferWorker (async query).
    // We check both energy and inference VAD layers; either one detecting speech triggers inference.
    const cursorSample = windowBuilder.getMatureCursorFrame(); // frame === sample in our pipeline
    const currentSample = v4GlobalSampleOffset;
    const startSample = cursorSample > 0 ? cursorSample : 0;

    let hasSpeech = false;
    if (currentSample > startSample) {
      // Check energy VAD first (always available, low latency)
      const energyResult = await bufferClient.hasSpeech('energyVad', startSample, currentSample, 0.3);

      // When inference VAD is ready, require BOTH energy AND inference to agree
      // This prevents false positives from music/noise that has high energy but no speech
      if (tenVADClient?.isReady()) {
        const inferenceResult = await bufferClient.hasSpeech('inferenceVad', startSample, currentSample, 0.5);
        // Require both energy and inference VAD to agree (AND logic)
        hasSpeech = energyResult.hasSpeech && inferenceResult.hasSpeech;
      } else {
        // Fall back to energy-only if inference VAD is not available
        hasSpeech = energyResult.hasSpeech;
      }
    }

    if (v4TickCount <= 5 || v4TickCount % 20 === 0) {
      const vadState = appStore.vadState();
      const rb = audioEngine.getRingBuffer();
      const rbFrame = rb.getCurrentFrame();
      const rbBase = rb.getBaseFrameOffset();
      console.log(
        `[v4Tick #${v4TickCount}] hasSpeech=${hasSpeech}, vadState=${vadState.hybridState}, ` +
        `energy=${vadState.energy.toFixed(4)}, inferenceVAD=${(vadState.sileroProbability || 0).toFixed(2)}, ` +
        `samples=[${startSample}:${currentSample}], ` +
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

    if (!hasSpeech) {
      // Check for silence-based flush using BufferWorker
      const silenceDuration = await bufferClient.getSilenceTailDuration('energyVad', 0.3);
      if (silenceDuration >= appStore.v4SilenceFlushSec()) {
        // Flush pending sentence via timeout finalization
        try {
          const flushResult = await workerClient.v4FinalizeTimeout();
          if (flushResult) {
            appStore.setMatureText(flushResult.matureText);
            appStore.setImmatureText(flushResult.immatureText);
            appStore.setMatureCursorTime(flushResult.matureCursorTime);
            appStore.setTranscript(flushResult.fullText);
            // Advance window builder cursor
            windowBuilder.advanceMatureCursorByTime(flushResult.matureCursorTime);
          }
        } catch (err) {
          console.error('[v4Tick] Flush error:', err);
        }
      }
      return;
    }

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

      // Update UI state
      appStore.setMatureText(result.matureText);
      appStore.setImmatureText(result.immatureText);
      appStore.setTranscript(result.fullText);
      appStore.setPendingText(result.immatureText);
      appStore.setInferenceLatency(inferenceMs);

      // Update RTF
      const audioDurationMs = window.durationSeconds * 1000;
      appStore.setRtf(inferenceMs / audioDurationMs);

      // Advance cursor if merger advanced it
      if (result.matureCursorTime > windowBuilder.getMatureCursorTime()) {
        appStore.setMatureCursorTime(result.matureCursorTime);
        windowBuilder.advanceMatureCursorByTime(result.matureCursorTime);
        windowBuilder.markSentenceEnd(Math.round(result.matureCursorTime * 16000));
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

        // v4 mode: Always start audio capture, mel preprocessing, and VAD
        // Inference only runs when model is ready (checked in v4Tick)
        if (mode === 'v4-utterance') {
          // ---- v4: Utterance-based pipeline with BufferWorker + TEN-VAD ----

          // Initialize merger in worker only if model is ready
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

          // Reset global sample counter
          v4GlobalSampleOffset = 0;

          // Feed audio chunks to mel worker from the main v4 audio handler below
          v4MelChunkUnsubscribe = null;

          // Process each audio chunk: energy VAD + write to BufferWorker + forward to TEN-VAD
          v4AudioChunkUnsubscribe = audioEngine.onAudioChunk((chunk) => {
            if (!hybridVAD || !bufferClient) return;

            const chunkOffset = v4GlobalSampleOffset;
            v4GlobalSampleOffset += chunk.length;

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
          });

          // Start adaptive inference tick loop (reads interval from appStore)
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

        // Use same 30fps tick as mel spectrogram (onVisualizationUpdate is throttled to 33ms)
        visualizationUnsubscribe = audioEngine.onVisualizationUpdate((_data, metrics) => {
          appStore.setAudioLevel(metrics.currentEnergy);
          if (appStore.transcriptionMode() !== 'v4-utterance') {
            appStore.setIsSpeechDetected(audioEngine?.isSpeechActive() ?? false);
          }
          if (melClient) {
            melClient.getLastMelFrame().then((frame) => {
              if (frame && frame.length >= SPECTRUM_BAR_COUNT) {
                const out = new Float32Array(SPECTRUM_BAR_COUNT);
                for (let m = 0; m < SPECTRUM_BAR_COUNT; m++) {
                  out[m] = normalizeMelForDisplay(frame[m]);
                }
                appStore.setBarLevels(out);
              } else if (audioEngine) {
                appStore.setBarLevels(audioEngine.getBarLevels());
              }
            });
          } else if (audioEngine) {
            appStore.setBarLevels(audioEngine.getBarLevels());
          }
        });
      } catch (err: any) {
        appStore.setErrorMessage(err.message);
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
    } catch (e) { }
  };

  const openModelSelection = () => {
    if (!workerClient) return;
    if (appStore.modelState() !== 'loading' && appStore.modelState() !== 'ready') {
      appStore.setModelState('unloaded');
    }
    setShowModelOverlay(true);
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
              confirmedText={appStore.transcriptionMode() === 'v4-utterance' ? appStore.matureText() : appStore.transcript()}
              pendingText={appStore.transcriptionMode() === 'v4-utterance' ? appStore.immatureText() : appStore.pendingText()}
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
          >
            <div class="max-h-[70vh] min-h-0 flex flex-col overflow-y-auto custom-scrollbar">
              <SettingsContent
                onClose={() => setShowContextPanel(false)}
                onLoadModel={() => loadSelectedModel()}
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
                class={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${isRecording() ? 'bg-[var(--color-earthy-coral)] text-white border-[var(--color-earthy-coral)]' : 'text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] border-transparent hover:border-[var(--color-earthy-sage)]/30'}`}
                title={isRecording() ? 'Stop recording' : 'Start recording'}
              >
                <span class="material-symbols-outlined">mic</span>
              </button>
              <button
                type="button"
                onClick={() => loadSelectedModel()}
                disabled={appStore.modelState() === 'loading' || appStore.modelState() === 'ready'}
                class="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-earthy-dark-brown)] hover:bg-[var(--color-earthy-bg)] transition-colors border border-transparent hover:border-[var(--color-earthy-sage)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                title={appStore.modelState() === 'ready' ? 'Model loaded' : appStore.modelState() === 'loading' ? 'Loading...' : 'Load model'}
              >
                <span class="material-symbols-outlined">power_settings_new</span>
              </button>
              <button
                type="button"
                onClick={() => setShowContextPanel((v) => !v)}
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

