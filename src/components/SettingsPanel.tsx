import { Component, For, Show } from 'solid-js';
import { appStore } from '../stores/appStore';
import { getModelDisplayName, MODELS } from './ModelLoadingOverlay';
import type { AudioEngine } from '../lib/audio/types';

const formatInterval = (ms: number) => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

export type SettingsPanelSection = 'full' | 'audio' | 'model';

export interface SettingsContentProps {
  /** When 'audio' or 'model', only that section is shown (e.g. hover on mic or load button). */
  section?: SettingsPanelSection;
  onClose: () => void;
  onLoadModel: () => void;
  onLocalLoad?: (files: FileList) => void;
  onOpenDebug: () => void;
  onDeviceSelect?: (id: string) => void;
  audioEngine?: AudioEngine | null;
  /** When true, panel expands upward (bar in lower half); content order is reversed so ASR model stays adjacent to the bar. */
  expandUp?: () => boolean;
}

/** Embeddable settings form (e.g. inside floating bar expansion). */
export const SettingsContent: Component<SettingsContentProps> = (props) => {
  const isV4 = () => appStore.transcriptionMode() === 'v4-utterance';
  const isV3 = () => appStore.transcriptionMode() === 'v3-streaming';

  const expandUp = () => props.expandUp?.() ?? false;
  const section = () => props.section ?? 'full';

  const showAsr = () => section() === 'full' || section() === 'model';
  const showAudio = () => section() === 'full' || section() === 'audio';
  const showSliders = () => section() === 'full';
  const showDebug = () => section() === 'full';

  return (
    <div class="flex flex-col min-h-0">
      <div
        class="flex flex-col flex-1 min-h-0 overflow-y-auto p-3 gap-4 custom-scrollbar"
        classList={{ 'flex-col-reverse': expandUp() }}
      >
        <Show when={showAsr()}>
          <section class="space-y-2">
            <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">ASR model</h3>
            <div class="flex items-center gap-2 flex-wrap">
            <select
              class="flex-1 min-w-0 text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
              value={appStore.selectedModelId()}
              onInput={(e) => appStore.setSelectedModelId((e.target as HTMLSelectElement).value)}
              disabled={appStore.modelState() === 'loading'}
            >
              <For each={MODELS}>
                {(m) => <option value={m.id}>{m.name}</option>}
              </For>
            </select>
            <button
              type="button"
              onClick={props.onLoadModel}
              disabled={appStore.modelState() === 'ready' || appStore.modelState() === 'loading'}
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-earthy-muted-green)] hover:bg-[var(--color-earthy-sage)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <span class="material-symbols-outlined text-lg">power_settings_new</span>
              {appStore.modelState() === 'ready' ? 'Loaded' : appStore.modelState() === 'loading' ? '...' : 'Load'}
            </button>
            <Show when={props.onLocalLoad}>
              <label class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--color-earthy-soft-brown)] hover:bg-[var(--color-earthy-sage)]/20 transition-colors cursor-pointer shrink-0">
                <span class="material-symbols-outlined text-lg">folder_open</span>
                Load from file
                <input
                  type="file"
                  multiple
                  class="hidden"
                  accept=".onnx,.bin"
                  onChange={(e) => {
                    const files = e.currentTarget.files;
                    if (files && files.length > 0) props.onLocalLoad?.(files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </Show>
          </div>
          <p class="text-xs text-[var(--color-earthy-soft-brown)]">
            {appStore.modelState() === 'ready' ? getModelDisplayName(appStore.selectedModelId()) : appStore.modelState()}
          </p>
          <Show when={appStore.modelState() === 'loading'}>
            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span>{appStore.modelMessage()}</span>
                <span class="font-mono text-[var(--color-earthy-muted-green)]">{Math.round(appStore.modelProgress())}%</span>
              </div>
              <div class="h-1.5 rounded-full overflow-hidden bg-[var(--color-earthy-sage)]/20">
                <div
                  class="h-full bg-[var(--color-earthy-muted-green)] rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, appStore.modelProgress()))}%` }}
                />
              </div>
            </div>
          </Show>
          </section>
        </Show>

        <Show when={showAudio()}>
          <section class="space-y-2">
          <h3 class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Audio input</h3>
          <select
            class="w-full text-sm bg-transparent border-b border-[var(--color-earthy-sage)]/40 px-0 py-1.5 text-[var(--color-earthy-dark-brown)] focus:outline-none focus:border-[var(--color-earthy-muted-green)]"
            value={appStore.selectedDeviceId()}
            onInput={(e) => {
              const id = (e.target as HTMLSelectElement).value;
              appStore.setSelectedDeviceId(id);
              props.onDeviceSelect?.(id);
            }}
          >
            <For each={appStore.availableDevices()}>
              {(device) => (
                <option value={device.deviceId}>
                  {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                </option>
              )}
            </For>
          </select>
          </section>
        </Show>

        <Show when={showSliders()}>
          <section class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="space-y-1.5 min-w-0">
            <div class="flex justify-between items-center gap-2">
              <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Energy threshold</span>
              <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{(appStore.energyThreshold() * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range" min="0.005" max="0.3" step="0.005"
              value={appStore.energyThreshold()}
              onInput={(e) => {
                const val = parseFloat(e.currentTarget.value);
                appStore.setEnergyThreshold(val);
                props.audioEngine?.updateConfig({ energyThreshold: val });
              }}
              class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
            />
          </div>

          <Show when={isV4()}>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">VAD threshold</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{(appStore.sileroThreshold() * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min="0.1" max="0.9" step="0.05"
                value={appStore.sileroThreshold()}
                onInput={(e) => appStore.setSileroThreshold(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Tick interval</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{formatInterval(appStore.v4InferenceIntervalMs())}</span>
              </div>
              <input
                type="range" min="320" max="8000" step="80"
                value={appStore.v4InferenceIntervalMs()}
                onInput={(e) => appStore.setV4InferenceIntervalMs(parseInt(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
              <div class="flex justify-between text-[9px] text-[var(--color-earthy-soft-brown)]">
                <span>320ms</span>
                <span>8.0s</span>
              </div>
            </div>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Silence flush</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{appStore.v4SilenceFlushSec().toFixed(1)}s</span>
              </div>
              <input
                type="range" min="0.3" max="5.0" step="0.1"
                value={appStore.v4SilenceFlushSec()}
                onInput={(e) => appStore.setV4SilenceFlushSec(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
          </Show>

          <Show when={isV3()}>
            <div class="space-y-1.5 min-w-0">
              <div class="flex justify-between items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-[var(--color-earthy-soft-brown)]">Window</span>
                <span class="text-sm text-[var(--color-earthy-dark-brown)] tabular-nums shrink-0">{appStore.streamingWindow().toFixed(1)}s</span>
              </div>
              <input
                type="range" min="2.0" max="15.0" step="0.5"
                value={appStore.streamingWindow()}
                onInput={(e) => appStore.setStreamingWindow(parseFloat(e.currentTarget.value))}
                class="debug-slider w-full h-2 rounded-full appearance-none cursor-pointer bg-[var(--color-earthy-sage)]/30"
              />
            </div>
          </Show>
          </section>
        </Show>

        <Show when={showDebug()}>
          <div class="pt-2">
            <button
              type="button"
              onClick={() => {
                props.onOpenDebug();
                props.onClose();
              }}
              class="flex items-center gap-2 px-0 py-2 text-sm font-medium text-[var(--color-earthy-muted-green)] hover:opacity-80 transition-opacity w-full"
            >
              <span class="material-symbols-outlined text-lg">bug_report</span>
              Open Debug panel
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
