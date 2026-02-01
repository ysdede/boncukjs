import { Component, For, Show } from 'solid-js';

interface DebugPanelProps {
  isVisible: boolean;
  onClose: () => void;
  latency?: number;
  bufferSize?: number;
  tokens?: Array<{ id: string; text: string; confidence: number }>;
}

export const DebugPanel: Component<DebugPanelProps> = (props) => {
  return (
    <div 
      class={`h-64 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-panel-dark transition-all duration-300 flex-col font-mono text-xs overflow-hidden ${
        props.isVisible ? 'flex' : 'hidden'
      }`}
    >
      <div class="flex items-center justify-between px-4 py-2 bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
        <div class="flex items-center gap-4">
          <span class="font-bold text-primary">DEVELOPER DEBUG</span>
          <span class="text-gray-500">Session ID: <span class="text-gray-700 dark:text-gray-300">#8291-ALPHA</span></span>
          <span class="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400">WebSocket: Connected</span>
        </div>
        <div class="flex gap-4 text-gray-500">
          <span>Latency: {props.latency ?? 42}ms</span>
          <span>Buffer: {props.bufferSize ?? 1024}b</span>
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
            <For each={props.tokens ?? [
              { id: 'TOK_402', text: 'Voters', confidence: 0.98 },
              { id: 'TOK_403', text: 'ed', confidence: 0.45 },
              { id: 'TOK_404', text: 'a', confidence: 0.99 },
              { id: 'TOK_405', text: 'pattern', confidence: 0.92 },
              { id: 'TOK_406', text: 'that', confidence: 0.95 },
            ]}>
              {(token) => (
                <div class={`flex justify-between hover:bg-white dark:hover:bg-gray-800 px-1 rounded cursor-pointer ${token.confidence < 0.5 ? 'bg-yellow-100 dark:bg-yellow-900/20 border-l-2 border-yellow-500' : ''}`}>
                  <span class="text-blue-600 dark:text-blue-400">{token.id}</span>
                  <span class="text-gray-600 dark:text-gray-300">"{token.text}"</span>
                  <span class="text-gray-400">{token.confidence.toFixed(2)}conf</span>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Node Properties */}
        <div class="w-1/3 border-r border-gray-200 dark:border-gray-700 p-4 overflow-y-auto bg-gray-100 dark:bg-[#0d1117]">
          <h3 class="text-gray-400 uppercase tracking-wider mb-2 font-bold">Node Properties</h3>
          <pre class="text-green-600 dark:text-green-400 text-xs">{JSON.stringify({
            "entity_id": "pol_power_01",
            "surface_form": "political power",
            "category": "ABSTRACT_CONCEPT",
            "sentiment_score": -0.1,
            "timing": {
              "start_ms": 14502,
              "end_ms": 15200,
              "duration": 698
            },
            "alternatives": [
              {"word": "political tower", "p": 0.02}
            ]
          }, null, 2)}</pre>
        </div>

        {/* System Metrics */}
        <div class="w-1/3 p-4 flex flex-col">
          <h3 class="text-gray-400 uppercase tracking-wider mb-2 font-bold">System Metrics</h3>
          <div class="space-y-4">
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-500">Token Throughput</span>
                <span class="text-gray-800 dark:text-gray-200">45 t/s</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div class="bg-primary h-2 rounded-full" style="width: 70%"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-500">Model Confidence</span>
                <span class="text-gray-800 dark:text-gray-200">88.5%</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div class="bg-green-500 h-2 rounded-full" style="width: 88%"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-500">VRAM Usage</span>
                <span class="text-gray-800 dark:text-gray-200">4.2GB / 8GB</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div class="bg-yellow-500 h-2 rounded-full" style="width: 52%"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
