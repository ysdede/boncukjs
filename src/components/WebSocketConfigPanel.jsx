import { Show } from 'solid-js';
import { useWebSocket } from '../stores/webSocketStore';

export default function WebSocketConfigPanel(props) {
  const [
    { customWsUrl, wsUrl, showWsConfig },
    { setCustomWsUrl, setShowWsConfig }
  ] = useWebSocket();

  return (
    <Show when={showWsConfig()}>
      <div class="fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg z-50 max-w-md">
        <div class="flex flex-col space-y-2">
          <div class="flex justify-between items-center">
            <h3 class="text-sm font-semibold">Server Connection</h3>
            <button 
              onClick={() => setShowWsConfig(false)}
              class="btn btn-icon-xs btn-ghost"
              title="Close"
            >
              <span class="material-icons">close</span>
            </button>
          </div>
          <div class="text-xs text-gray-500 mb-2">
            Current: {wsUrl()}
          </div>
          <input
            type="text"
            value={customWsUrl()}
            onInput={(e) => setCustomWsUrl(e.currentTarget.value)}
            class="form-control form-control-sm"
            placeholder="WebSocket URL"
          />
          <div class="flex space-x-2">
            <button
              onClick={props.onApply}
              class="btn btn-sm btn-primary"
            >
              Apply & Connect
            </button>
            <button
              onClick={props.onReset}
              class="btn btn-sm btn-secondary"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
} 