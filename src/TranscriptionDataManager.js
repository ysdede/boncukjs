/**
 * TranscriptionDataManager - Pure data layer for transcription state management
 * 
 * Responsibilities:
 * - Process worker messages and maintain transcription state
 * - Dispatch events for UI components and other subscribers
 * - Handle word locking and user interactions
 * - Manage mature cursor and stats
 * - Provide clean API for data access
 */

export class TranscriptionDataManager {
    constructor() {
        this.mergedWords = [];
        this.stats = {
            totalSegmentsProcessed: 0,
            totalWordsProcessed: 0,
            segmentsDiscarded: 0,
            wordsAdded: 0,
            wordsReplaced: 0, 
            wordsKeptStable: 0, 
            wordsFinalized: 0,
            lastMetrics: null,
        };
        this.lastPayloadId = null;
        this.lastUtteranceText = null;
        this.lastIsFinal = false;
        this.lastUpdateTime = null;
        this.matureCursorTime = 0;
        
        // Event subscribers
        this.subscribers = new Map();
        this.eventIdCounter = 0;
        
        // Worker reference
        this.worker = null;
        
        // Configuration - FIXED TO MATCH WORKING SVELTE VERSION
        this.mergerConfig = {
            stabilityThreshold: 3,
            confidenceBias: 1.15,
            lengthBiasFactor: 0.01,
            finalizationStabilityThreshold: 2,  // FIXED: Was 5, should be 2 like Svelte
            useAgeFinalization: false,  // CORRECT: Matches Svelte
            finalizationAgeThreshold: 10.0,
            segmentFilterMinAbsoluteConfidence: 0.20,
            segmentFilterStdDevThresholdFactor: 2.0,
            useSentenceBoundaries: true,
            minPauseDurationForCursor: 0.1,  // FIXED: Was 0.4, should be 0.1 like Svelte
            minInitialContextTime: 3.0,
            cursorBehaviorMode: 'sentenceBased',  // ADDED: Missing from original
            useNLPSentenceDetection: true,  // ADDED: Missing from original
            nlpSentenceDetectionDebug: false,  // ADDED: Missing from original
            debug: false,
        };
        
        this.nextSubscriberId = 0;
        this.isWorkerReady = false;
        this.queuedConfig = null;
        
        console.log('[TranscriptionDataManager] Initialized');
    }
    
    /**
     * Set the worker instance and start listening to messages
     */
    setWorker(worker) {
        if (this.worker) {
            this.worker.removeEventListener('message', this._handleWorkerMessage.bind(this));
        }
        this.worker = worker;
        this.worker.addEventListener('message', this._handleWorkerMessage.bind(this));
        console.log('[DataManager] Worker set.');
    }
    
    /**
     * Subscribe to data events
     */
    subscribe(eventType, callback) {
        const id = this.eventIdCounter++;
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Map());
        }
        this.subscribers.get(eventType).set(id, callback);
        
        return () => {
            const typeSubscribers = this.subscribers.get(eventType);
            if (typeSubscribers) {
                typeSubscribers.delete(id);
            }
        };
    }
    
    /**
     * Emit events to subscribers
     */
    emit(eventType, data) {
        const typeSubscribers = this.subscribers.get(eventType);
        if (typeSubscribers) {
            typeSubscribers.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[TranscriptionDataManager] Error in ${eventType} subscriber:`, error);
                }
            });
        }
    }
    
    /**
     * Handle worker messages - core data processing
     */
    _handleWorkerMessage(event) {
        const { type, data } = event.data;
        
        if (type === 'merged_transcription_update' || type === 'merged_transcription') {
            const incomingWords = data.mergedWords || [];
            
            console.log(`[DataManager] Processing ${type} with ${incomingWords.length} words`);
            
            // Process word updates
            const changesMade = this.processWordUpdates(incomingWords);
            
            // Update stats and state variables
            this.stats = data.stats || this.stats;
            this.lastPayloadId = data.lastSegmentId || this.lastPayloadId;
            this.lastUpdateTime = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : this.lastUpdateTime;
            
            // Handle mature cursor updates
            if (typeof data.matureCursorTime === 'number' && data.matureCursorTime > this.matureCursorTime) {
                const previousTime = this.matureCursorTime;
                this.matureCursorTime = data.matureCursorTime;
                
                // Emit mature cursor update event
                this.emit('matureCursorUpdate', { 
                    time: this.matureCursorTime, 
                    previousTime 
                });
            }
            
            // Update Parakeet-specific state
            if (data.utterance_text) {
                this.lastUtteranceText = data.utterance_text;
            }
            if (data.is_final !== undefined) {
                this.lastIsFinal = data.is_final;
            }
            if (data.metrics) {
                this.stats.lastMetrics = data.metrics;
            }
            
            // Emit data update event for UI components
            this.emit('dataUpdate', {
                mergedWords: this.mergedWords,
                stats: this.stats,
                matureCursorTime: this.matureCursorTime,
                lastUtteranceText: this.lastUtteranceText,
                lastIsFinal: this.lastIsFinal,
                lastUpdateTime: this.lastUpdateTime,
                changesMade
            });
            
            if (type === 'merged_transcription') {
                console.log(`[DataManager] Initial data loaded: ${this.mergedWords.length} words`);
            }
        }
        else if (type === 'config_updated') {
            console.log('[DataManager] Received config update confirmation:', data.config);
            this.emit('configUpdate', data.config);
        }
        else if (type === 'init_complete') {
            this.isWorkerReady = true;
            console.log('[DataManager] Worker is ready. Processing queued config.');
            if (this.queuedConfig) {
                this.updateMergerConfig(this.queuedConfig);
                this.queuedConfig = null;
            }
        }
    }
    
    /**
     * Process word updates - core business logic
     */
    processWordUpdates(incomingWords) {
        const updatedWords = [...this.mergedWords];
        let changesMade = false;

        // Compare and update words
        for (let i = 0; i < Math.max(updatedWords.length, incomingWords.length); i++) {
            const localWord = updatedWords[i];
            const incomingWord = incomingWords[i];

            if (localWord && localWord.lockedByUser) {
                // Check if the incoming word reverts the locked word
                if (!incomingWord || 
                    incomingWord.text !== localWord.text || 
                    !incomingWord.lockedByUser ||
                    JSON.stringify(incomingWord.history) !== JSON.stringify(localWord.history)) {
                    
                    console.warn(`[DataManager] Worker update reverted locked word at index ${i}. Re-sending lock.`);
                    
                    if (this.worker && localWord.id) {
                        this.worker.postMessage({
                            type: 'update_word_lock',
                            data: {
                                wordId: localWord.id,
                                locked: true,
                                newText: localWord.text, 
                                newHistory: localWord.history 
                            }
                        });
                    }
                    changesMade = true;
                    continue;
                }
            }

            // Update local state from incoming word if not locked or lock is consistent
            if (JSON.stringify(localWord) !== JSON.stringify(incomingWord)) {
               if (i < updatedWords.length) {
                   updatedWords[i] = incomingWord;
               } else {
                   updatedWords.push(incomingWord);
               }
               changesMade = true;
            }
        }

        // Handle cases where worker has fewer words than UI
        if (incomingWords.length < updatedWords.length) {
            updatedWords.length = incomingWords.length;
            changesMade = true;
        }
        
        // Update state
        if (changesMade || this.mergedWords.length !== updatedWords.length) {
           this.mergedWords = updatedWords;
        }
        
        return changesMade;
    }
    
    /**
     * Lock/unlock a word
     */
    updateWordLock(wordId, locked, newText = null, newHistory = null) {
        const wordIndex = this.mergedWords.findIndex(w => w.id === wordId);
        if (wordIndex !== -1) {
            const word = { ...this.mergedWords[wordIndex] };
            word.lockedByUser = locked;
            
            if (newText != null) {
                word.text = newText;
            }
            if (newHistory != null) {
                word.history = newHistory;
            }
            
            this.mergedWords[wordIndex] = word;
            
            // Send to worker
            if (this.worker && wordId) {
                this.worker.postMessage({
                    type: 'update_word_lock',
                    data: {
                        wordId: wordId,
                        locked: locked,
                        newText: newText,
                        newHistory: newHistory
                    }
                });
            }
            
            // Emit update
            this.emit('wordLockUpdate', { wordId, locked, newText, newHistory, wordIndex });
            
            return true;
        }
        return false;
    }
    
    /**
     * Update merger configuration
     */
    updateMergerConfig(configChanges = {}) {
        if (!this.worker) {
            console.error('[DataManager] Worker not set. Cannot send config.');
            return;
        }

        // If worker is not ready, queue the config. Otherwise, send it.
        if (!this.isWorkerReady) {
            console.log('[DataManager] Worker not ready. Queuing config update.');
            this.queuedConfig = { ...this.mergerConfig, ...configChanges };
        } else {
            console.log('[DataManager] Sending configuration update to worker:', { ...this.mergerConfig, ...configChanges });
            this.worker.postMessage({
                type: 'update_merger_config',
                data: { config: { ...this.mergerConfig, ...configChanges } }
            });
        }
    }
    
    /**
     * Request initial data from worker
     */
    requestInitialData() {
        if (this.worker) {
            console.log('[DataManager] Requesting initial merged transcription state');
            this.worker.postMessage({ type: 'get_merged_transcription' });
        }
    }
    
    /**
     * Reset all data
     */
    reset() {
        this.mergedWords = [];
        this.stats = {
            totalSegmentsProcessed: 0,
            totalWordsProcessed: 0,
            segmentsDiscarded: 0,
            wordsAdded: 0,
            wordsReplaced: 0, 
            wordsKeptStable: 0, 
            wordsFinalized: 0,
            lastMetrics: null,
        };
        this.lastPayloadId = null;
        this.lastUtteranceText = null;
        this.lastIsFinal = false;
        this.lastUpdateTime = null;
        this.matureCursorTime = 0;
        
        this.isWorkerReady = false;
        this.queuedConfig = null;
        
        this.emit('dataReset', {});
        console.log('[DataManager] State reset');
    }
    
    /**
     * Get current state snapshot
     */
    getCurrentState() {
        return {
            mergedWords: [...this.mergedWords],
            stats: { ...this.stats },
            matureCursorTime: this.matureCursorTime,
            lastUtteranceText: this.lastUtteranceText,
            lastIsFinal: this.lastIsFinal,
            lastUpdateTime: this.lastUpdateTime,
            lastPayloadId: this.lastPayloadId
        };
    }
    
    /**
     * Get plain text representation
     */
    getPlainText() {
        return this.mergedWords.map(w => w.text).join(' ');
    }
}

// Create singleton instance
export const transcriptionDataManager = new TranscriptionDataManager(); 