import { Component, For, Show } from 'solid-js';
import { appStore } from '../stores/appStore';

interface DebugPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export const DebugPanel: Component<DebugPanelProps> = (props) => {
  return (
    <div
      class={`h-64 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-panel-dark transition-all duration-300 flex-col font-mono text-xs overflow-hidden ${props.isVisible ? 'flex' : 'hidden'
        }`}
    >
      <div class="flex items-center justify-between px-4 py-2 bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
        <div class="flex items-center gap-4">
          <span class="font-bold text-primary italic">BONCUK DEBUG</span>
          <span class="text-gray-500">ENGINE: <span class="text-gray-700 dark:text-gray-300">{appStore.backend().toUpperCase()}</span></span>
          <span class="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400">
            Local Inference: Active
          </span>
        </div>
        <div class="flex gap-4 text-gray-500">
          <span>Latency: <span class="text-gray-900 dark:text-gray-100">{appStore.inferenceLatency()}ms</span></span>
          <button class="hover:text-red-500 transition-colors" onClick={() => props.onClose()}>
            <span class="material-icons-round text-base align-middle">close</span>
          </button>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden">
        {/* Token Stream */}
        <div class="w-1/3 border-r border-gray-200 dark:border-gray-700 p-4 overflow-y-auto">
          <h3 class="text-gray-400 uppercase tracking-wider mb-2 font-bold">Token Stream</h3>
          <div class="space-y-1 font-mono">
            <For each={appStore.debugTokens()}
              fallback={<div class="text-gray-500 italic">Waiting for speech...</div>}>
              {(token) => (
                <div class={`flex justify-between hover:bg-white dark:hover:bg-gray-800 px-1 rounded cursor-pointer ${token.confidence < 0.5 ? 'bg-yellow-100 dark:bg-yellow-900/20 border-l-2 border-yellow-500' : ''}`}>
                  <span class="text-blue-600 dark:text-blue-400">ID_{token.id.slice(-3)}</span>
                  <span class="text-gray-600 dark:text-gray-300">"{token.text}"</span>
                  <span class="text-gray-400">{token.confidence.toFixed(2)}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Inference State */}
        <div class="w-1/3 border-r border-gray-200 dark:border-gray-700 p-4 overflow-y-auto bg-gray-100 dark:bg-[#0d1117]">
          <h3 class="text-gray-400 uppercase tracking-wider mb-2 font-bold">Parakeet State</h3>
          <pre class="text-green-600 dark:text-green-400 text-[10px]">{JSON.stringify({
            "backend": appStore.backend(),
            "model_ready": appStore.isOfflineReady(),
            "selected_id": appStore.selectedModelId(),
            "audio_level": appStore.audioLevel().toFixed(4),
            "speech_active": appStore.isSpeechDetected(),
            "last_latency": appStore.inferenceLatency() + "ms"
          }, null, 2)}</pre>
        </div>

        {/* System Metrics */}
        <div class="w-1/3 p-4 flex flex-col">
          <h3 class="text-gray-400 uppercase tracking-wider mb-2 font-bold">Metrics</h3>
          <div class="space-y-4">
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-500">Throughput</span>
                <span class="text-gray-800 dark:text-gray-200">{appStore.systemMetrics().throughput.toFixed(1)} t/s</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div class="bg-primary h-full transition-all duration-500" style={{ width: `${Math.min(100, appStore.systemMetrics().throughput * 2)}%` }}></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-500">Avg Confidence</span>
                <span class="text-gray-800 dark:text-gray-200">{(appStore.systemMetrics().modelConfidence * 100).toFixed(1)}%</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div class="bg-green-500 h-full transition-all duration-500" style={{ width: `${appStore.systemMetrics().modelConfidence * 100}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
