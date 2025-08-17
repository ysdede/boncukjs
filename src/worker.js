let isProcessing = false;
let transcriptionQueue = new Map();
let sequenceId = 0;
let sessionDataStore = new Map(); // Store segment data and results

// Import WebSocket manager
let wsManager = null;
let transcriptionMerger = null; // Instance of the NEW TimeBin merger
let pendingConfigUpdates = []; // Queue config updates until merger is ready

self.onmessage = async (e) => {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            if (!wsManager) {
                const { WebSocketManager } = await import('./WebSocketManager.js');
                wsManager = new WebSocketManager(data.wsUrl);
                
                wsManager.subscribe('transcriptionComplete', (transcriptionData) => {
                    // console.log('Worker received transcription result:', transcriptionData.segmentId);
                    handleTranscriptionComplete(transcriptionData);
                });

                wsManager.subscribe('error', (error) => {
                    console.error('WebSocket error in worker:', error);
                    // Optionally inform the main thread
                    self.postMessage({ type: 'websocket_error', data: { error: error.message } });
                });

                wsManager.subscribe('vad_classification', (vadData) => {
                    console.log('Worker received VAD classification:', vadData);
                    self.postMessage({
                        type: 'vad_feedback',
                        data: {
                            segmentId: `segment_${vadData.sequence_num}`, // Construct the full segment ID
                            isSpeech: vadData.is_speech,
                            status: vadData.status
                        }
                    });
                });

                try {
                    await wsManager.connect();
                    console.log('Worker: WebSocket connection established');
                    wsManager.startHealthCheck();
                    
                    // Initialize the NEW transcription merger
                    const TranscriptionMerger = (await import('./TranscriptionMerger.js')).default;
                    // Pass initial empty config, UI will send updates
                    // TEMPORARY: Force debug true for live testing
                    transcriptionMerger = new TranscriptionMerger({ debug: true }); 
                    console.log('Worker: SegmentAlign TranscriptionMerger initialized (DEBUG FORCED ON).');
                    
                    // Process any pending config updates
                    if (pendingConfigUpdates.length > 0) {
                        console.log(`Worker: Processing ${pendingConfigUpdates.length} pending config updates`);
                        pendingConfigUpdates.forEach(config => {
                            transcriptionMerger.updateConfig(config);
                        });
                        pendingConfigUpdates = []; // Clear the queue
                        console.log('Worker: All pending config updates processed');
                    }
                    
                    // Signal to the main thread that initialization is complete
                    self.postMessage({ type: 'init_complete' });

                } catch (error) {
                    console.error('Worker: Failed to connect WebSocket or init merger:', error);
                    self.postMessage({ type: 'init_error', data: { error: error.message } });
                }
            }
            break;

        case 'reset':
            console.log('Worker: Received reset request.');
            transcriptionQueue.clear();
            sessionDataStore.clear(); 
            isProcessing = false; 
            pendingConfigUpdates = []; // Clear any queued config updates
            if (transcriptionMerger) {
                // Reset merger with its default config
                transcriptionMerger.reset(); 
                console.log('Worker: Transcription merger reset to defaults.');
            } else {
                console.warn('Worker: Reset called but merger not initialized.');
            }
            break;

        case 'transcribe':
            if (!wsManager || !wsManager.isConnected) {
                console.error('Worker: WebSocket not initialized or connected for transcribe.');
                self.postMessage({
                    type: 'error',
                    data: {
                        status: 'error',
                        segmentId: data.segmentId,
                        error: 'WebSocket not connected'
                    }
                });
                return;
            }
             if (!transcriptionMerger) {
                 console.error('Worker: Merger not initialized for transcribe.');
                self.postMessage({
                    type: 'error',
                    data: {
                        status: 'error',
                        segmentId: data.segmentId,
                        error: 'Merger not initialized'
                    }
                });
                return;
            }

            if (!transcriptionQueue.has(data.segmentId)) {
                // console.log('Worker received transcribe task:', { segmentId: data.segmentId, /* other meta */ });

                if (!data.audioData || data.audioData.length === 0) {
                    console.error('Worker: Invalid audio data received for segment:', data.segmentId);
                    // Optionally send error back
                    return;
                }

                // Store incoming data (excluding potentially large audioData for session export)
                const inputMeta = { ...data };
                delete inputMeta.audioData; // Remove audio buffer from stored metadata
                sessionDataStore.set(data.segmentId, { 
                    inputData: inputMeta, 
                    result: null 
                });
                // console.log(`Stored input metadata for segment ${data.segmentId}`);

                transcriptionQueue.set(data.segmentId, { 
                    type, 
                    // Pass all necessary data for the ASR request
                    data: { 
                        ...data 
                        // audioData is already included in data
                    } 
                });
                // console.log('Added to queue:', { segmentId: data.segmentId, /* other meta */ });
                
                processQueue(); // Start processing if not already active
            } else {
                // console.log('Segment already in queue:', data.segmentId);
            }
            break;
            
        // Handler for merged transcription requests
        case 'get_merged_transcription':
            // console.log('Worker received get_merged_transcription request');
            if (transcriptionMerger) {
                const currentState = transcriptionMerger.getCurrentState();
                
                // console.log('Sending current merged state:', { wordCount: currentState.words.length });
                self.postMessage({
                    type: 'merged_transcription', // Use this type for polled/initial data
                    data: {
                        mergedText: currentState.text, // Use text from state
                        mergedWords: currentState.words,
                        stats: currentState.stats,
                        matureCursorTime: currentState.matureCursorTime
                    }
                });
            } else {
                console.error('Worker: Merger not initialized for get_merged_transcription');
                self.postMessage({ type: 'error', data: { message: 'Merger not initialized' } });
            }
            break;
            
        // Handler for updating merger configuration
        case 'update_merger_config':
            console.log('Worker received config update:', data.config);
            if (transcriptionMerger) {
                // Merger is ready, apply config immediately
                transcriptionMerger.updateConfig(data.config);
                // Send back the effective config (optional confirmation)
                self.postMessage({
                    type: 'config_updated',
                    data: {
                        config: transcriptionMerger.config // Send the config currently held by the merger
                    }
                });
                console.log('Worker: Merger config updated.');
            } else {
                // Merger not ready yet, queue the config update
                console.log('Worker: Merger not ready yet, queuing config update');
                pendingConfigUpdates.push(data.config);
                // Still send a response to avoid hanging the UI
                self.postMessage({
                    type: 'config_updated',
                    data: {
                        config: data.config, // Echo back the config that was queued
                        queued: true // Indicate it was queued
                    }
                });
            }
            break;

        // Handler for Session Data (remains largely the same, relies on stored data)
        case 'get_session_data':
            console.log('Worker: Received get_session_data request.');
            const serializableSessionData = [];
            // Iterate directly over the stored raw results
            for (const [segmentId, rawResult] of sessionDataStore.entries()) {
                try {
                    // Create a serializable copy of the raw result
                    const serializableEntry = rawResult ? JSON.parse(JSON.stringify(rawResult)) : { segmentId, error: 'No result stored' };
                    // Add segmentId for safety, although it should be in rawResult
                    if (rawResult) serializableEntry.segmentId = segmentId;
                    serializableSessionData.push(serializableEntry);
                } catch (error) {
                    console.error(`Worker: Error preparing raw session data for segment ${segmentId}:`, error);
                    // Push a placeholder or skip
                     serializableSessionData.push({ segmentId, error: `Serialization error: ${error.message}` });
                }
            }
            
            // Also get the current merger configuration
            let currentConfig = null;
            if (transcriptionMerger) {
                try {
                    currentConfig = JSON.parse(JSON.stringify(transcriptionMerger.config));
                    console.log('Worker: Including current merger config in session data response.');
                } catch (error) {
                    console.error('Worker: Error serializing merger config:', error);
                    currentConfig = { error: `Config serialization error: ${error.message}` };
                }
            } else {
                console.warn('Worker: Merger not initialized when trying to get config for session data.');
                 currentConfig = { error: 'Merger not initialized' };
            }
            
            console.log(`Worker: Sending ${serializableSessionData.length} raw session data entries along with config.`);
            self.postMessage({
                type: 'session_data',
                data: {
                    config: currentConfig, // Send the config object
                    data: serializableSessionData // Send the array of raw results
                }
            });
            break;

        // Handler for user updates to specific words (locking/selection)
        case 'update_word_lock':
            console.log(`Worker: Received word lock update for ID: ${data.wordId}`);
            if (transcriptionMerger && data.wordId && transcriptionMerger.mergedTranscript) {
                const wordIndex = transcriptionMerger.mergedTranscript.findIndex(w => w.id === data.wordId);
                if (wordIndex !== -1) {
                    // Update the word directly in the merger's internal state
                    transcriptionMerger.mergedTranscript[wordIndex].lockedByUser = data.locked;
                    if (data.newText != null) { // Check if newText was provided
                        transcriptionMerger.mergedTranscript[wordIndex].text = data.newText;
                    }
                    if (data.newHistory != null && Array.isArray(data.newHistory)) { // Check if newHistory was provided
                        transcriptionMerger.mergedTranscript[wordIndex].history = data.newHistory;
                    }
                    // Optional: Update other fields like confidence if needed/provided
                    console.log(`Worker: Updated word ID ${data.wordId}. Locked: ${data.locked}, Text: ${data.newText ?? '(no change)'}, History Length: ${data.newHistory?.length ?? 'N/A'}`);
                    
                    // Optional: Immediately send back the updated full state? 
                    // Or wait for next natural update? Let's wait for now to avoid extra messages.
                    // const currentState = transcriptionMerger.getCurrentState();
                    // self.postMessage({...currentState});
                    
                } else {
                    console.warn(`Worker: Word ID ${data.wordId} not found in merger transcript for lock update.`);
                }
            } else {
                console.error('Worker: Cannot update word lock - Merger not ready or wordId missing.');
            }
            break;
    }
};

async function processQueue() {
    if (isProcessing || transcriptionQueue.size === 0 || !wsManager || !wsManager.isConnected || !transcriptionMerger) {
        if (transcriptionQueue.size > 0 && (!wsManager || !wsManager.isConnected)) {
             console.warn('Worker: Queue has items, but WS not ready. Waiting...');
        }
        if (transcriptionQueue.size > 0 && !transcriptionMerger) {
             console.warn('Worker: Queue has items, but Merger not ready. Waiting...');
        }
        return; // Exit if busy, queue empty, or WS/Merger not ready
    }
    
    isProcessing = true;
    const [segmentId, task] = transcriptionQueue.entries().next().value;
    
    try {
        // Get current mature cursor time from transcription merger
        const matureCursorTime = transcriptionMerger.matureCursorTime || 0;
        // console.log(`Including mature cursor time: ${matureCursorTime.toFixed(2)}s for segment ${segmentId}`);
        
        // Send audio data to WebSocket server with necessary metadata
        await wsManager.sendAudioSegment({ 
            audioData: task.data.audioData,  
            segmentId: segmentId,
            language: task.data.language,
            model: task.data.model,
            sessionId: task.data.sessionId,
            inputSampleRate: task.data.inputSampleRate,
            startTime: task.data.startTime,
            endTime: task.data.endTime,
            matureCursorTime: matureCursorTime // Still potentially useful for backend VAD/context
        });
        
    } catch (error) {
        console.error(`Worker: Failed to send segment ${segmentId} to WebSocket:`, error);
        self.postMessage({
            type: 'error',
            data: {
                status: 'error',
                segmentId: segmentId,
                error: `WebSocket send failed: ${error.message}`
            }
        });
        // Note: We keep processing the queue even if one segment fails to send
    } 
    
    // Always remove the processed/attempted task and continue
    transcriptionQueue.delete(segmentId);
    isProcessing = false;
    
    if (transcriptionQueue.size > 0) {
        setTimeout(processQueue, 0); 
    }
}

function handleTranscriptionComplete(result) {
    // First, check if this is a misrouted VAD classification message
    if (result && result.type === 'vad_classification') {
        console.warn('Worker (handleTranscriptionComplete): Received a VAD classification message. This may indicate an issue with WebSocketManager event routing. Ignoring this message for transcription processing. VAD Data:', result);
        // This message should have been handled by the 'vad_classification' event subscriber.
        // We could optionally re-post it here if wsManager is unreliable, but it's cleaner if wsManager routes correctly.
        // Example: self.postMessage({ type: 'vad_feedback', segmentId: result.sequence_num, isSpeech: result.is_speech, status: result.status });
        return;
    }

    // Updated check for required fields in Parakeet transcription payload
    if (!result || !result.session_id || result.sequence_num === undefined || !result.words) {
        console.error('Worker (handleTranscriptionComplete): Missing required fields in Parakeet transcription payload or payload is not a transcription. Keys received:', 
            Object.keys(result || {}).join(', '));
        // console.error('Problematic payload:', result); // Optionally log the full payload
        return;
    }

    // Generate a composite ID for storage/reference since segmentId is no longer available
    const compositeId = `${result.session_id}_seq${result.sequence_num}`;

    // --- Store the RAW result in sessionDataStore --- 
    try {
        // Store the entire raw result object, ensuring deep copy
        sessionDataStore.set(compositeId, JSON.parse(JSON.stringify(result))); 
        console.debug(`Stored RAW result for payload: ${compositeId}`);

        // Prune the store to prevent memory leaks, keeping the last 20 entries
        if (sessionDataStore.size > 20) {
            // Convert map keys to an array, sort by sequence number, and delete the oldest
            const keys = Array.from(sessionDataStore.keys());
            // Sort keys based on sequence number (e.g., "session_seq123")
            keys.sort((a, b) => {
                const seqA = parseInt(a.substring(a.lastIndexOf('seq') + 3), 10);
                const seqB = parseInt(b.substring(b.lastIndexOf('seq') + 3), 10);
                return seqA - seqB;
            });
            // Delete the oldest entry
            const oldestKey = keys[0];
            sessionDataStore.delete(oldestKey);
            // console.debug(`Pruned sessionDataStore, removed oldest key: ${oldestKey}`);
        }
    } catch (e) {
        console.error(`Worker: Failed to deep copy or store raw result for ${compositeId}:`, e);
        // Avoid storing potentially corrupted data or incomplete data
        sessionDataStore.set(compositeId, { 
            session_id: result.session_id,
            sequence_num: result.sequence_num,
            error: `Storage error: ${e.message}`
        });
    }
    // --- End Store RAW Result ---

    // Process with the transcription merger
    let mergedResultState = null;
    if (transcriptionMerger) {
        try {
            // Merge function updates the merger's internal state and returns the latest state.
            mergedResultState = transcriptionMerger.merge(result); 

            if (mergedResultState && mergedResultState.words) {
                // Debugging log handled inside merger now
            } else {
                console.warn(`Merging produced null or empty word list for payload: ${compositeId}`);
            }
        } catch (error) {
            console.error(`Worker: Error merging transcription for payload ${compositeId}:`, error);
            mergedResultState = null; // Ensure we don't send partial/error state
        }
    } else {
        console.warn(`Worker: TranscriptionMerger not available when handling result for: ${compositeId}`);
    }
    
    // Send a dedicated message containing the *latest full state* from the merger
    if (mergedResultState) { 
        // console.log(`[Worker] Sending merged_transcription_update. Word count: ${mergedResultState.words?.length ?? 0}`); 
        self.postMessage({
            type: 'merged_transcription_update', // Consistent type for updates
            data: {
                mergedText: mergedResultState.text,     // Text from merger state
                mergedWords: mergedResultState.words,   // Words from merger state
                stats: mergedResultState.stats,         // Stats from merger state
                matureCursorTime: mergedResultState.matureCursorTime, // Cursor from merger state
                lastSegmentId: compositeId, // Now using composite ID 
                utterance_text: result.utterance_text, // Include the full utterance text
                is_final: result.is_final, // Include whether this is a final result
                metrics: result.metrics, // Include transcription metrics if available
                timestamp: Date.now()
            }
        });
    } else {
        // console.log(`Skipping merged_transcription_update for ${compositeId} due to null merge result state.`);
    }
}