import { createSignal, createContext, useContext } from 'solid-js';

const LogContext = createContext();

const MAX_LOGS = 100;

export function LogProvider(props) {
  let logId = 0;
  const [logs, setLogs] = createSignal([]);
  
  const addLog = (message, level = 'info') => {
      const timestamp = new Date();
      const newLogEntry = { id: logId++, message, level, timestamp };
      setLogs(prevLogs => {
        const updatedLogs = [...prevLogs, newLogEntry];
        return updatedLogs.length > MAX_LOGS ? updatedLogs.slice(-MAX_LOGS) : updatedLogs;
      });
      console.log(`[${level.toUpperCase()}] ${message}`);
  };

  const store = [
    logs,
    { addLog }
  ];

  return (
    <LogContext.Provider value={store}>
      {props.children}
    </LogContext.Provider>
  );
}

export function useLogs() {
  const context = useContext(LogContext);
  if (!context) {
    throw new Error('useLogs must be used within a LogProvider');
  }
  return context;
} 