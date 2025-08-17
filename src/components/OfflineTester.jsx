import { createSignal, createEffect, Show } from 'solid-js';
import TranscriptionMerger from '../TranscriptionMerger.js';
import MergedTranscriptionWidget from './MergedTranscriptionWidget.jsx';

export default function OfflineTester() {
  const [loadedSessionData, setLoadedSessionData] = createSignal(null);
  const [loadedConfig, setLoadedConfig] = createSignal(null);
  const [replayInProgress, setReplayInProgress] = createSignal(false);
  const [fileName, setFileName] = createSignal('');
  const [errorMessage, setErrorMessage] = createSignal('');
  const [replayResults, setReplayResults] = createSignal({
    mergedText: '',
    mergedWords: [],
    stats: {},
    matureCursorTime: 0,
    lastSegmentId: null,
    timestamp: null,
  });

  let fileInputRef;
  let offlineMerger = new TranscriptionMerger();

  const addLog = (message, level = 'info') => {
    console.log(`[OfflineTester][${level}] ${message}`);
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setErrorMessage('No file selected.');
      return;
    }

    setFileName(file.name);
    setErrorMessage('');
    setLoadedSessionData(null);
    setReplayResults({
      mergedText: '',
      mergedWords: [],
      stats: {},
      matureCursorTime: 0,
      lastSegmentId: null,
      timestamp: Date.now()
    });

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const jsonData = JSON.parse(content);

        // Basic validation for the structure: { config: {}, sessionEntries: [] }
        if (!jsonData || typeof jsonData !== 'object' || Array.isArray(jsonData)) {
          throw new Error('Invalid JSON format: Expected an object at the root.');
        }
        if (!jsonData.config || typeof jsonData.config !== 'object') {
          throw new Error('Invalid JSON structure: Missing or invalid \'config\' object.');
        }
        if (!jsonData.sessionEntries || !Array.isArray(jsonData.sessionEntries)) {
          throw new Error('Invalid JSON structure: Missing or invalid \'sessionEntries\' array.');
        }
        if (jsonData.sessionEntries.length === 0) {
          throw new Error('Session entries array is empty.');
        }
        
        const firstEntry = jsonData.sessionEntries[0];
        if (!firstEntry || !firstEntry.segmentId || !firstEntry.segments || typeof firstEntry.sequence !== 'number') {
          throw new Error('Invalid JSON structure: Entries in sessionEntries must be raw result objects with segmentId, sequence, and segments.');
        }

        setLoadedConfig(jsonData.config);
        setLoadedSessionData(jsonData.sessionEntries);
        addLog(`Successfully loaded config and ${jsonData.sessionEntries.length} entries from ${file.name}.`);
      } catch (error) {
        const message = `Error parsing JSON file: ${error.message}`;
        setErrorMessage(message);
        addLog(message, 'error');
        setLoadedSessionData(null);
        setFileName('');
      }
    };

    reader.onerror = (e) => {
      const message = `Error reading file: ${e.target.error}`;
      setErrorMessage(message);
      addLog(message, 'error');
      setLoadedSessionData(null);
      setFileName('');
    };

    reader.readAsText(file);
  };

  const handleReplay = async () => {
    if (!loadedSessionData()) {
      setErrorMessage('Load a session file first.');
      return;
    }
    if (replayInProgress()) return;

    setReplayInProgress(true);
    setErrorMessage('');
    addLog('Starting offline replay...');

    // Reset the offline merger instance for a clean replay
    const configToUse = loadedConfig() && !loadedConfig().error ? loadedConfig() : {};
    if (loadedConfig()?.error) {
      addLog(`Warning: Loaded config contained an error: ${loadedConfig().error}. Using default merger config.`, 'warn');
    } else if (!loadedConfig()) {
      addLog(`Warning: No config found in session file. Using default merger config.`, 'warn');
    }
    
    offlineMerger = new TranscriptionMerger(configToUse);
    setReplayResults({
      mergedText: '',
      mergedWords: [],
      stats: {},
      matureCursorTime: 0,
      lastSegmentId: null,
      timestamp: Date.now()
    });

    // Filter and sort results by sequence number
    const resultsToProcess = loadedSessionData()
      .filter(entry => entry && typeof entry.sequence === 'number')
      .sort((a, b) => a.sequence - b.sequence);

    if (resultsToProcess.length === 0) {
      const message = 'No valid results with sequence numbers found in the loaded data.';
      setErrorMessage(message);
      addLog(message, 'warn');
      setReplayInProgress(false);
      return;
    }

    addLog(`Processing ${resultsToProcess.length} results in sequence order.`);

    try {
      for (const entry of resultsToProcess) {
        const result = entry;
        addLog(`Merging segment ${result.segmentId} (Seq: ${result.sequence})...`);
        
        // Perform the merge using the offline instance
        const currentMergeResult = offlineMerger.merge(result);

        // Update the reactive state after the merge call
        if (currentMergeResult) {
          setReplayResults({
            mergedText: currentMergeResult.text || '',
            mergedWords: currentMergeResult.words || [],
            stats: currentMergeResult.stats || {},
            matureCursorTime: currentMergeResult.matureCursorTime || 0,
            lastSegmentId: result.segmentId,
            timestamp: Date.now()
          });
        } else {
          addLog(`Warning: Merger returned null/undefined for segment ${result.segmentId}`, 'warn');
          setReplayResults(prev => ({ ...prev, timestamp: Date.now() }));
        }

        // Optional delay for visualization
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const results = replayResults();
      addLog(`Replay finished. Final text length: ${results.mergedText.length}, Words: ${results.mergedWords.length}`);

    } catch (error) {
      const message = `Error during replay: ${error.message}`;
      setErrorMessage(message);
      addLog(message, 'error');
      console.error(error);
    } finally {
      setReplayInProgress(false);
    }
  };

  return (
    <div class="offline-tester p-4 bg-gray-50 dark:bg-gray-900 rounded-lg shadow">
      <h2 class="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
        Offline Transcription Merger Tester
      </h2>

      <div class="mb-4">
        <label for="sessionFile" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Load Session JSON File:
        </label>
        <div class="flex items-center space-x-2">
          <input
            type="file"
            id="sessionFile"
            accept=".json,application/json"
            onChange={handleFileChange}
            ref={fileInputRef}
            class="hidden"
          />
          <button
            type="button"
            class="btn btn-md btn-secondary"
            onClick={() => fileInputRef?.click()}
          >
            Choose File
          </button>
          <Show when={fileName()} fallback={
            <span class="text-sm text-gray-500 dark:text-gray-400">No file chosen</span>
          }>
            <span class="text-sm text-gray-600 dark:text-gray-400 truncate" title={fileName()}>
              {fileName()}
            </span>
          </Show>
        </div>
      </div>

      <Show when={errorMessage()}>
        <div class="my-3 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 rounded-md text-sm">
          {errorMessage()}
        </div>
      </Show>

      <div class="mb-4">
        <button
          type="button"
          class={`btn btn-md transition-colors duration-200 ${
            loadedSessionData() && !replayInProgress() ? 'btn-success' : 'btn-secondary'
          }`}
          onClick={handleReplay}
          disabled={!loadedSessionData() || replayInProgress()}
        >
          <Show when={replayInProgress()} fallback="Replay Session">
            <span class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Replaying...
            </span>
          </Show>
        </button>
      </div>

      <Show when={loadedSessionData() && (replayResults().mergedWords.length > 0 || replayInProgress())}>
        <div class="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 class="text-lg font-medium mb-2 text-gray-800 dark:text-gray-200">Replay Results</h3>
          <MergedTranscriptionWidget
            showWordDetails={true}
            colorByConfidence={true}
            showFinalizedWords={true}
            initialData={replayResults()}
            isOfflineMode={true}
          />
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Displayed using MergedTranscriptionWidget in offline mode.
            <Show when={replayResults().stats}>
              {` Stats: Segments Processed: ${replayResults().stats.totalSegmentsProcessed || 0}, Words: ${replayResults().stats.totalWordsProcessed || 0}, Conflicts: ${replayResults().stats.conflictsResolved || 0}, Replacements: ${replayResults().stats.replacementsMade || 0}`}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
} 