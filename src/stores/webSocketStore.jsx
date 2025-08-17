import { createSignal, createContext, useContext, onMount, createMemo } from 'solid-js';
import { useLogs } from './logStore';

const WebSocketContext = createContext();

export function WebSocketProvider(props) {
  const [, { addLog }] = useLogs();

  const [wsUrl, setWsUrl] = createSignal('');
  const [customWsUrl, setCustomWsUrl] = createSignal('');
  const [showWsConfig, setShowWsConfig] = createSignal(false);
  const [isPotentiallyUntrustedWss, setIsPotentiallyUntrustedWss] = createSignal(false);

  const getWebSocketUrl = () => {
    setIsPotentiallyUntrustedWss(false);
    try {
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const backendPort = 8000;
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
        const isLocalNetworkIP = /^(192\\.168\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)/.test(hostname);
        let url;

        if (isLocalhost || isLocalNetworkIP) {
          url = `${protocol}${hostname}:${backendPort}/ws/audio`;
          if (protocol === 'wss://') {
            setIsPotentiallyUntrustedWss(true);
            addLog('Using secure WebSocket (WSS) with localhost/local IP. Ensure the self-signed certificate is trusted.', 'warning');
          }
        } else {
          url = `${protocol}${hostname}/ws/audio`;
        }
        return url;
      }
    } catch (error) {
      addLog(`Error getting WebSocket URL: ${error}`, 'error');
    }
    const fallbackProtocol = window?.location?.protocol === 'https:' ? 'wss://' : 'ws://';
    return `${fallbackProtocol}localhost:8000/ws/audio`;
  };

  const resetToDefault = () => {
    const initialWsUrl = getWebSocketUrl();
    setWsUrl(initialWsUrl);
    setCustomWsUrl(initialWsUrl);
  };

  onMount(() => {
    resetToDefault();
  });
  
  const iconColorClass = createMemo(() => {
    const url = wsUrl();
    if (url.startsWith('wss://')) {
      return isPotentiallyUntrustedWss() ? 'text-yellow-500' : 'text-green-400';
    } else if (url.startsWith('ws://')) {
      return 'text-orange-500';
    }
    return 'text-gray-500';
  });

  const iconTitle = createMemo(() => {
    const url = wsUrl();
    if (url.startsWith('wss://')) {
      return isPotentiallyUntrustedWss()
        ? 'Potentially untrusted SSL (WSS). Click to configure.'
        : 'Secure WebSocket connection (WSS). Click to configure.';
    } else if (url.startsWith('ws://')) {
      return 'Unencrypted WebSocket connection (WS). Click to configure.';
    }
    return 'Server connection settings. Click to configure.';
  });

  const store = [
    { 
      wsUrl, 
      customWsUrl, 
      showWsConfig, 
      isPotentiallyUntrustedWss,
      iconColorClass,
      iconTitle
    },
    { 
      setWsUrl, 
      setCustomWsUrl, 
      setShowWsConfig,
      resetToDefault
    }
  ];

  return (
    <WebSocketContext.Provider value={store}>
      {props.children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
} 