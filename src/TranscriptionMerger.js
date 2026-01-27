/**
 * TranscriptionMerger.js
 * 
 * Handles the merging of overlapping transcription segments using a 
 * Segment Alignment & Reconciliation approach. It maintains a single
 * canonical transcript and updates it based on incoming segments,
 * prioritizing stability and confidence.
 */

import SentenceBoundaryDetector from './utils/SentenceBoundaryDetector.js';

// --- Interfaces (for clarity, not enforced in JS) ---
/*
interface MergedWord {
    id: string; // Unique ID (e.g., segmentId_wordIndex)
    text: string;
    start: number;
    end: number;
    confidence: number; // Confidence score of this specific word instance
    finalized: boolean; // Is this word considered final?
    sourceSegmentId: string; // ID of the segment this word originally came from
    stabilityCounter: number; // How many subsequent overlapping segments has this word survived?
    lastModifiedSequence: number; // Sequence number of the segment that last placed/confirmed this word
}

interface IncomingWord { // Temporary structure during processing
    id: string; 
    text: string;
    start: number; 
    end: number;   
    confidence: number; 
    sourceSegmentId: string;
    sequence: number;
}
*/


class TranscriptionMerger {
    constructor(config = {}) {
        // --- Core Data Structures ---
        this.mergedTranscript = []; // Array<MergedWord> - Kept sorted by start time

        // --- State ---
        // this.mergedWords is now this.mergedTranscript
        this.matureCursorTime = 0; 
        
        this.stats = this.getInitialStats();

        // --- Configuration ---
        // Default configuration for Segment Alignment
        this.defaultConfig = {
            // --- Segment Comparison & Reconciliation ---
            stabilityThreshold: 3,          // Min stability count to resist replacement by similar confidence
            confidenceBias: 1.15,           // Factor (e.g., 1.15 = 15%) higher avg confidence needed in new segment to override stable existing words
            lengthBiasFactor: 0.01,         // Slight bias towards longer sequence if confidence is very close
            wordConfidenceReplaceThreshold: 0.15, // New: Min confidence superiority for an overlapping same-text word to replace the existing one
            minOverlapDurationForRedundancy: 0.05,  // New: Min temporal overlap for same-text words for redundancy check
            
            // --- Finalization ---
            finalizationStabilityThreshold: 2, // How many confirmations needed for a word to be final.
            finalizationAgeThreshold: 10.0,  // Alternative: Max age (seconds) of a word before it's forced final.
            useAgeFinalization: true,        // Enable age-based finalization so words finalize even if not repeated.
            
            // --- Segment Filtering (Kept from previous) ---
            segmentFilterMinAbsoluteConfidence: 0.20,
            segmentFilterStdDevThresholdFactor: 2.0,
            
            // --- Mature Cursor (Mostly unchanged logic, new params) ---
            useSentenceBoundaries: true,       // OBSOLETE: Replaced by cursorBehaviorMode
            minPauseDurationForCursor: 0.1,    // FIXED: Was 0.4. Min pause (s) after sentence end punctuation (used by 'sentenceBased')
            minInitialContextTime: 3.0,        // Initial wait time before cursor can advance from 0
            cursorBehaviorMode: 'sentenceBased', // 'sentenceBased' or 'lastFinalized'
            
            // --- Sentence Boundary Detection ---
            useNLPSentenceDetection: true,     // Use winkNLP for sentence detection instead of heuristic
            nlpSentenceDetectionDebug: false,  // Enable debug logging for sentence detection
            
            // --- Veto Logic (New) ---
            stabilityThresholdForVeto: 1,         // New: Min stability for an existing word to veto its replacement
            wordMinConfidenceSuperiorityForVeto: 0.20, // New: How much an existing word's confidence must exceed incoming's to veto
            
            // --- WPM Calculation ---
            wpmCalculationWindowSeconds: 60, // Window in seconds for rolling WPM calculation (now 1 minute)
            
            // --- Debugging ---
            debug: false,                   // Enable verbose logging for debugging
        };

        this.config = {
            ...this.defaultConfig,
            ...config,
            debug: config.debug || false // Restore normal debug behavior
        };

        // --- Initialize Sentence Boundary Detector ---
        this.sentenceDetector = new SentenceBoundaryDetector({
            useNLP: this.config.useNLPSentenceDetection,
            debug: this.config.nlpSentenceDetectionDebug || this.config.debug,
            cacheSize: 100
        });

        console.log("SegmentAlign TranscriptionMerger initialized with config:", this.config);

        // Rolling token tail for DP alignment
        this.tokenTail = [];
        this.maxTokenTailSeconds = 10.0;
    }
    
    getInitialStats() {
        return {
            totalSegmentsProcessed: 0,
            totalWordsProcessed: 0,
            segmentsDiscarded: 0,
            wordsAdded: 0,
            wordsReplaced: 0, 
            wordsKeptStable: 0, // Count how many times existing words were kept over new ones
            wordsFinalized: 0,
            lastMetrics: null, // For storing TranscriptionMetrics
            wpmOverall: 0, // WPM for the entire transcription
            wpmRolling: 0 // Rolling WPM for the configured window
            // Add other relevant stats as needed
        };
    }

    /**
     * Process a new transcription response using Segment Alignment.
     * @param {Object} response - The transcription response.
     * @returns {Object} The updated transcript information.
     */
    merge(response) {
        const mergeStartTime = performance.now();
        
        // --- Step 1: Initial checks and flexible data extraction (new vs. legacy schema) ---
        if (!response) {
            if (this.config.debug) console.warn('[Merger] merge() called with null/undefined response.');
            return this.getCurrentState();
        }

        // Normalise commonly-used fields so later code doesn't have to branch.
        const currentSequence = response.sequence_num ?? response.sequence ?? 0;
        const sessionId      = response.session_id  ?? response.segmentId ?? 'unknown_session';
        const isFinalPayload = response.is_final    ?? response.isFinal  ?? false;

        let incomingWords = [];

        if (Array.isArray(response.words) && response.words.length > 0) {
            // --- New Parakeet schema ---
            incomingWords = this.extractWordsFromPayload(response.words, sessionId, currentSequence, isFinalPayload);
            // Capture tokens for DP alignment when available
            if (Array.isArray(response.tokens) && response.tokens.length > 0) {
                this.alignTokensWithTail(response.tokens);
            }
        } else if (Array.isArray(response.segments) && response.segments.length > 0) {
            // --- Legacy schema (used by unit tests) ---
            const filtered = this.filterSegmentsByConfidence(response.segments);
            incomingWords = this.extractWordsFromSegments(filtered, sessionId, currentSequence);
        }

        if (incomingWords.length === 0) {
            if (this.config.debug) console.warn('[Merger] No words extracted from response; skipping.');
            return this.getCurrentState();
        }

        this.stats.totalSegmentsProcessed++;

        // Determine segment end time from extracted words (safer across schemas)
        const actualSegmentEndTime = incomingWords[incomingWords.length - 1].end;

        if (this.config.debug) {
            console.debug(`[Merger Seq ${currentSequence}, Sess ${sessionId}] Processing payload with ${incomingWords.length} words. End: ${actualSegmentEndTime.toFixed(2)}, IsFinal: ${isFinalPayload}`);
            if (response.metrics) {
                console.debug(`[Merger Metrics] AvgWordConf: ${response.metrics.average_word_confidence}, Utterance: "${response.utterance_text}"`);
                this.stats.lastMetrics = { ...response.metrics };
            }
        }

        this.stats.totalWordsProcessed += incomingWords.length;

        const segmentStartTime = incomingWords[0].start; // Assumes incomingWords is sorted
        
        console.debug(`[Merger Seq ${currentSequence}] Extracted ${incomingWords.length} words. Time Range: [${segmentStartTime.toFixed(2)} - ${actualSegmentEndTime.toFixed(2)}]`);

        // --- Step 2: Find Overlapping Existing Words --- 
        const overlapInfo = this.findIndicesInMergedTranscript(segmentStartTime, actualSegmentEndTime);
        const overlappingWords = overlapInfo 
            ? this.mergedTranscript.slice(overlapInfo.startIndex, overlapInfo.endIndex + 1) 
            : [];
        
        if (this.config.debug) {
             if (overlapInfo) {
                console.debug(`[Merger Seq ${currentSequence}] Found ${overlappingWords.length} overlapping existing words (Indices: ${overlapInfo.startIndex}-${overlapInfo.endIndex}).`);
             } else {
                 console.debug(`[Merger Seq ${currentSequence}] No overlapping existing words found.`);
             }
        }
        
        // --- Step 3: Compare & Decide (Using the new logic) --- 
        const action = this.decideReplacement(incomingWords, overlappingWords, currentSequence);
        
        // --- Step 4: Reconcile Transcript --- 
        let wordsAddedCount = 0;
        let wordsReplacedCount = 0;
        let wordsKeptCount = 0;

        switch (action.action) {
            case 'add_new':
                if (this.config.debug) console.debug(`[Merger Seq ${currentSequence}] Action: Add New.`);
                const newWordsToAdd = incomingWords.map(word => this.createMergedWord(word, currentSequence));
                wordsAddedCount = newWordsToAdd.length;
                // Use -1 hint for simple append or find position if transcript not empty
                const insertionHintAdd = this.mergedTranscript.length > 0 ? -1 : 0;
                this.insertWordsIntoTranscript(this.mergedTranscript, newWordsToAdd, insertionHintAdd);
                break;

            case 'keep':
                if (this.config.debug) console.debug(`[Merger Seq ${currentSequence}] Action: Keep Existing.`);
                // Stability was incremented inside decideReplacement/incrementStability
                // Ensure lastModifiedSequence is updated for all potentially kept words
                wordsKeptCount = overlappingWords.length; // All overlapping words are kept
                for(const word of overlappingWords) {
                    // Only update if not already updated by stability increment
                    if (word.lastModifiedSequence < currentSequence) {
                        word.lastModifiedSequence = currentSequence; // Mark as seen
                    }
                }
                break;

            case 'replace_all':
                if (this.config.debug) console.debug(`[Merger Seq ${currentSequence}] Action: Replace All.`);
                let insertionIndexReplaceAll = -1;
                let removedHistoryReplaceAll = []; // Store history here
                if (overlapInfo) {
                     const removedCount = overlappingWords.length;
                     insertionIndexReplaceAll = overlapInfo.startIndex; // Save index before removing
                     // Capture history *before* splicing
                     removedHistoryReplaceAll = overlappingWords.map(w => ({ 
                         text: w.text, 
                         confidence: w.confidence, 
                         start: w.start,
                         end: w.end,
                         // Optional: add more details like sourceSegmentId, sequence if needed
                         // sourceSegmentId: w.sourceSegmentId,
                         // sequence: w.lastModifiedSequence 
                     }));
                     this.mergedTranscript.splice(overlapInfo.startIndex, removedCount); // Now remove
                     wordsReplacedCount = removedCount;
                     if (this.config.debug) console.debug(`  Removed ${removedCount} words from index ${overlapInfo.startIndex}.`);
                 } else {
                     if (this.config.debug) console.debug("  No overlap info for replace_all action?"); 
                     // Fallback: find insertion index if overlapInfo was somehow null
                     insertionIndexReplaceAll = -1; 
                 }
                 const wordsToInsertReplaceAll = incomingWords.map(word => this.createMergedWord(word, currentSequence));
                 // Attach history to the first new word if history exists
                 if (wordsToInsertReplaceAll.length > 0 && removedHistoryReplaceAll.length > 0) {
                     // Prepend new history to existing history
                     const existingHistory = wordsToInsertReplaceAll[0].history || [];
                     wordsToInsertReplaceAll[0].history = [...removedHistoryReplaceAll, ...existingHistory];
                 }
                 wordsAddedCount = wordsToInsertReplaceAll.length;
                 this.insertWordsIntoTranscript(this.mergedTranscript, wordsToInsertReplaceAll, insertionIndexReplaceAll);
                 if (this.config.debug) console.debug(`  Inserted ${wordsAddedCount} new words.`);
                break;

            case 'partial_replace':
                if (this.config.debug) console.debug(`[Merger Seq ${currentSequence}] Action: Partial Replace (Agreement: ${action.agreementLength}).`);
                let insertionIndexPartial = -1;
                let removedHistoryPartial = []; // Store history here
                if (overlapInfo && action.agreementLength < overlappingWords.length) {
                     const removeIndex = overlapInfo.startIndex + action.agreementLength;
                     const removeCount = overlappingWords.length - action.agreementLength;
                     insertionIndexPartial = removeIndex; // Insertion point is where removal happened
                     // Capture history *before* splicing
                     const wordsBeingRemoved = this.mergedTranscript.slice(removeIndex, removeIndex + removeCount);
                     removedHistoryPartial = wordsBeingRemoved.map(w => ({
                         text: w.text,
                         confidence: w.confidence,
                         start: w.start,
                         end: w.end,
                         // Optional: add more details
                     }));
                     const wordsToRemove = this.mergedTranscript.splice(removeIndex, removeCount); // Now remove
                     wordsReplacedCount = wordsToRemove.length;
                     wordsKeptCount = action.agreementLength; // The agreed part was kept
                     if (this.config.debug) console.debug(`  Removed ${removeCount} words from index ${removeIndex}.`);
                } else if (overlapInfo) {
                     // Agreement covers all or more of the overlap, but maybe incoming has more words? 
                     wordsKeptCount = overlappingWords.length; // Keep all existing overlapping
                     insertionIndexPartial = overlapInfo.startIndex + overlappingWords.length; // Insert after existing
                     if (this.config.debug) console.debug(`  Partial replace: Agreement length (${action.agreementLength}) >= overlap length (${overlappingWords.length}). Kept all existing overlapping.`);
                } else {
                    // Should not happen if action is partial_replace, implies overlap existed
                     if (this.config.debug) console.debug("  No overlap info for partial_replace action?");
                     insertionIndexPartial = -1; // Fallback
                     wordsKeptCount = 0;
                }
                
                const wordsToInsertPartial = incomingWords.slice(action.agreementLength).map(word => this.createMergedWord(word, currentSequence));
                // Attach history to the first new word if history exists
                if (wordsToInsertPartial.length > 0 && removedHistoryPartial.length > 0) {
                    // Prepend new history to existing history
                    const existingHistory = wordsToInsertPartial[0].history || [];
                    wordsToInsertPartial[0].history = [...removedHistoryPartial, ...existingHistory];
                }
                if (wordsToInsertPartial.length > 0) {
                    wordsAddedCount = wordsToInsertPartial.length;
                    // Use calculated insertionIndexPartial
                    this.insertWordsIntoTranscript(this.mergedTranscript, wordsToInsertPartial, insertionIndexPartial);
                    if (this.config.debug) console.debug(`  Inserted ${wordsAddedCount} new words after agreement.`);
                } else {
                     if (this.config.debug) console.debug("  Partial replace: No new words to insert after agreement.");
                }
                // Update lastModifiedSequence for the kept (agreed) part
                 if (overlapInfo) {
                    const keptExistingWords = this.mergedTranscript.slice(overlapInfo.startIndex, overlapInfo.startIndex + action.agreementLength);
                    for(const word of keptExistingWords) {
                        // Only update if not already updated by stability increment
                if (word.lastModifiedSequence < currentSequence) { 
                             word.lastModifiedSequence = currentSequence;
                         }
                     }
                 }
                break;

            default:
                console.error(`[Merger Seq ${currentSequence}] Unknown action: ${action.action}`);
        }
        
        // Update stats (moved from incrementStability to avoid double counting)
        this.stats.wordsAdded += wordsAddedCount;
        this.stats.wordsReplaced += wordsReplacedCount;
        this.stats.wordsKeptStable += wordsKeptCount; // Use count based on action outcome

        // --- Step 5: Update Finalization & Mature Cursor (Correct Order) ---
        // First, update finalization based on stability and age. This provides the
        // necessary finalized words for the cursor logic to work with.
        this.updateFinalization(this.mergedTranscript, actualSegmentEndTime, this.matureCursorTime, currentSequence);

        // Second, update the cursor time based on the newly finalized words.
        this.updateMatureCursorTime(actualSegmentEndTime);

        // Third, run finalization AGAIN. This is a crucial step to finalize any
        // words that are now behind the newly advanced mature cursor.
        this.updateFinalization(this.mergedTranscript, actualSegmentEndTime, this.matureCursorTime, currentSequence);
        
        // --- Step 7: Calculate Rolling WPM ---
        try {
            const windowDurationSeconds = this.config.wpmCalculationWindowSeconds; // This should be 60
            let calculatedRollingWpm = 0;
            const currentSegmentEndTime = response.words[response.words.length - 1].end_time;

            if (this.mergedTranscript.length > 0) {
                const firstWordOfTranscriptTime = this.mergedTranscript[0].start;
                const currentActualTranscriptDuration = currentSegmentEndTime - firstWordOfTranscriptTime;

                if (currentActualTranscriptDuration < windowDurationSeconds && currentActualTranscriptDuration > 0) {
                    // Not enough data for a full rolling window. Calculate WPM based on all speech so far.
                    const wordsSoFarCount = this.mergedTranscript.length;
                    // Use a minimum duration of 0.05s to avoid division by zero or extremely high WPM for single very short words.
                    // If duration is very tiny but words exist, this effectively caps WPM for hyper-short utterances.
                    const effectiveDuration = Math.max(currentActualTranscriptDuration, 0.05);
                    calculatedRollingWpm = (wordsSoFarCount / effectiveDuration) * 60;
                } else if (currentActualTranscriptDuration >= windowDurationSeconds) {
                    // Enough data for a full rolling window.
                    const windowStartTime = currentSegmentEndTime - windowDurationSeconds;
                    const wordsInWindow = this.mergedTranscript.filter(
                        word => word.end > windowStartTime && word.end <= currentSegmentEndTime
                    );
                    if (wordsInWindow.length > 0) {
                        calculatedRollingWpm = (wordsInWindow.length / windowDurationSeconds) * 60;
                    }
                    // If no words in the window, calculatedRollingWpm remains 0
                }
                // If currentActualTranscriptDuration is <= 0 (e.g. first word not fully processed), calculatedRollingWpm remains 0
            }
            this.stats.wpmRolling = calculatedRollingWpm;

            // Calculate Overall WPM
            let calculatedOverallWpm = 0;
            if (this.mergedTranscript.length > 1) {
                const firstWordStartTime = this.mergedTranscript[0].start;
                const lastWordEndTime = this.mergedTranscript[this.mergedTranscript.length - 1].end;
                const overallDurationSeconds = lastWordEndTime - firstWordStartTime;
                if (overallDurationSeconds > 0.1) { // Avoid division by zero or very small durations
                    calculatedOverallWpm = (this.mergedTranscript.length / overallDurationSeconds) * 60;
                }
            } else if (this.mergedTranscript.length === 1 && response.words.length > 0) {
                // Handle single word transcript - estimate WPM based on its own duration if sensible
                const singleWordDuration = this.mergedTranscript[0].end - this.mergedTranscript[0].start;
                if (singleWordDuration > 0.05) { // Arbitrary small duration to make WPM meaningful
                     calculatedOverallWpm = (1 / singleWordDuration) * 60;
                }
            }
            this.stats.wpmOverall = calculatedOverallWpm;

            if (this.config.debug) {
                const debugSegmentEndTime = (response.words && response.words.length > 0) ? response.words[response.words.length - 1].end_time : 0;
                let debugRollingWordsDesc = "(No speech yet)";
                if (this.mergedTranscript.length > 0) {
                    const firstWordOfTranscriptTimeForDebug = this.mergedTranscript[0].start;
                    const currentActualTranscriptDurationForDebug = debugSegmentEndTime - firstWordOfTranscriptTimeForDebug;
                    if (currentActualTranscriptDurationForDebug < windowDurationSeconds && currentActualTranscriptDurationForDebug > 0) {
                        debugRollingWordsDesc = `(Ramp-up: ${this.mergedTranscript.length} words / ${currentActualTranscriptDurationForDebug.toFixed(2)}s)`;
                    } else if (currentActualTranscriptDurationForDebug >= windowDurationSeconds) {
                        const debugWordsInStrictWindowCount = this.mergedTranscript.filter(
                            word => word.end > (debugSegmentEndTime - windowDurationSeconds) && word.end <= debugSegmentEndTime
                        ).length;
                        debugRollingWordsDesc = `(Window: ${debugWordsInStrictWindowCount} words / ${windowDurationSeconds}s)`;
                    } else {
                        debugRollingWordsDesc = "(Initial segment too short or no words)";
                    }
                }
                console.log(`[Merger WPM] Rolling WPM: ${this.stats.wpmRolling.toFixed(1)} ${debugRollingWordsDesc}, Overall WPM: ${this.stats.wpmOverall.toFixed(1)} (Total Words: ${this.mergedTranscript.length})`);
            }
        } catch (e) {
            console.error("[Merger] Error calculating WPM:", e);
            this.stats.wpmRolling = 0;
            this.stats.wpmOverall = 0;
        }

        // --- Step 8: Update State & Stats --- 
        // Stats are updated inline
        if (this.config.debug) console.log(`[Merger Seq ${currentSequence}] Merge complete. Total words: ${this.mergedTranscript.length}. Mature Cursor: ${this.matureCursorTime.toFixed(2)}s. Rolling WPM: ${this.stats.wpmRolling.toFixed(1)}, Overall WPM: ${this.stats.wpmOverall.toFixed(1)}`);
        
        const mergeElapsed = performance.now() - mergeStartTime;
        if (mergeElapsed > 10) { // Log if it takes more than 10ms
            console.log(`[Merger Seq ${currentSequence}] merge() took ${mergeElapsed.toFixed(2)} ms`);
        }

        // Post-merge cleanup to reduce stutter and duplicate phrases near boundaries
        try {
            this.compressConsecutiveDuplicateWords(2.0);
            this.suppressImmediatePhraseRepetition({ lookbackWords: 80, minLen: 3, maxLen: 8, windowSeconds: 6.0 });
        } catch (e) {
            if (this.config.debug) console.warn('[Merger] Post-merge cleanup failed:', e);
        }
        
        return this.getCurrentState();
    }

    // --- Core Helper Functions (Implementations) ---
    
    /**
     * Finds the start and end indices in the **sorted** `mergedTranscript` array 
     * that overlap with the given time range.
     * Uses a variation of binary search for efficiency.
     * @param {number} startTime - The start time of the incoming segment.
     * @param {number} endTime - The end time of the incoming segment.
     * @returns {{startIndex: number, endIndex: number} | null} Indices (inclusive) or null if no overlap.
     */
    findIndicesInMergedTranscript(startTime, endTime) {
        if (this.mergedTranscript.length === 0 || endTime <= startTime) return null;

        // Find the potential start index: first word whose *end* time is > startTime
        // (If word.end === startTime, it doesn't strictly overlap yet)
        let low = 0;
        let high = this.mergedTranscript.length - 1;
        let firstPossibleIndex = -1;

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (this.mergedTranscript[mid].end > startTime) {
                firstPossibleIndex = mid; // Potential start, try earlier
                high = mid - 1;
            } else {
                low = mid + 1; // Word ends too early, try later
            }
        }

        // If no word ends after startTime, no overlap is possible
        if (firstPossibleIndex === -1) return null; 

        // Now find the actual start and end of the overlapping range from this point forward
        let startIndex = -1;
        let endIndex = -1;

        for (let i = firstPossibleIndex; i < this.mergedTranscript.length; i++) {
            const word = this.mergedTranscript[i];

            // If the word starts *at or after* the segment ends, no more overlaps possible
            if (word.start >= endTime) {
                break; 
            }

            // Check for actual overlap using the static helper
            if (TranscriptionMerger.doTimeRangesOverlap(startTime, endTime, word.start, word.end)) {
                if (startIndex === -1) {
                    startIndex = i; // First overlapping word
                }
                endIndex = i; // Update last overlapping word
            }
        }

        // If startIndex remained -1, no actual overlap was found
        if (startIndex === -1) {
            return null; 
        }

        return { startIndex, endIndex };
    }

    /**
     * Decides the action to take based on comparing incoming words with overlapping existing words.
     * Incorporates local agreement principles: prioritizes matching word sequences.
     * @param {IncomingWord[]} incomingWords 
     * @param {MergedWord[]} overlappingWords 
     * @param {number} currentSequence 
     * @returns {Object} An action object, e.g., { action: 'keep' }, 
     *                   { action: 'replace_all' }, 
     *                   { action: 'partial_replace', agreementLength: number },
     *                   { action: 'add_new' }
     */
    decideReplacement(incomingWords, overlappingWords, currentSequence) {
        // --- Check for Locked Words FIRST --- 
        if (overlappingWords && overlappingWords.length > 0) { // Only check if there are words to check
            const isAnyWordLocked = overlappingWords.some(word => word.lockedByUser === true);
            if (isAnyWordLocked) {
                if (this.config.debug) console.debug("[Decide] Overlap contains user-locked words. Forcing KEEP action.");
                
                // Still find agreement to potentially increment stability of non-locked words
                let agreementLength = 0;
                for (let i = 0; i < Math.min(incomingWords.length, overlappingWords.length); i++) {
                    if (incomingWords[i].text.toLowerCase() === overlappingWords[i].text.toLowerCase()) {
                        agreementLength++;
                    } else {
                        break;
                    }
                }
                
                // Increment stability only for the agreed, non-locked prefix
                if (agreementLength > 0) {
                    const agreedNonLockedPrefix = overlappingWords.slice(0, agreementLength).filter(w => !w.lockedByUser);
                    this.incrementStability(agreedNonLockedPrefix, currentSequence);
                }
                
                // Update lastModifiedSequence for ALL overlapping words (locked or not) to show they were involved
                for(const word of overlappingWords) {
                   if (word.lastModifiedSequence < currentSequence) {
                       word.lastModifiedSequence = currentSequence;
                   }
                }
                
                return { action: 'keep' }; 
            }
        }
        // --- End Check for Locked Words ---
        
        if (!overlappingWords || overlappingWords.length === 0) {
            if (this.config.debug) console.debug("[Decide] No overlap.");
            return { action: 'add_new' }; 
        }
        if (!incomingWords || incomingWords.length === 0) {
            if (this.config.debug) console.debug("[Decide] No incoming words, keeping existing.");
            return { action: 'keep' }; // Keep existing
        }

        // --- Find Local Agreement --- 
        let agreementLength = 0;
        for (let i = 0; i < Math.min(incomingWords.length, overlappingWords.length); i++) {
            // Simple case-insensitive text comparison for now
            // TODO: Consider adding timing proximity checks?
            if (incomingWords[i].text.toLowerCase() === overlappingWords[i].text.toLowerCase()) {
                agreementLength++;
            } else {
                break; // Stop at the first mismatch
            }
        }

        if (this.config.debug && agreementLength > 0) console.debug(`[Decide] Found agreement length: ${agreementLength}`);

        // --- Handle Potential Redundancy/Improvement of the Last Agreed Word ---
        let currentIncomingWords = [...incomingWords]; // Work with a mutable copy

        if (agreementLength > 0 && agreementLength < incomingWords.length) {
            const lastAgreedExistingWord = overlappingWords[agreementLength - 1];
            const nextIncomingWord = incomingWords[agreementLength]; // Check original incomingWords here

            if (lastAgreedExistingWord.text.toLowerCase() === nextIncomingWord.text.toLowerCase()) {
                const overlapDuration = TranscriptionMerger.calculateOverlapDuration(
                    lastAgreedExistingWord.start, lastAgreedExistingWord.end,
                    nextIncomingWord.start, nextIncomingWord.end
                );

                if (overlapDuration >= this.config.minOverlapDurationForRedundancy) {
                    if (this.config.debug) console.debug(`[Decide] Redundancy check: Last agreed "${lastAgreedExistingWord.text}" overlaps with next incoming "${nextIncomingWord.text}" by ${overlapDuration.toFixed(3)}s.`);
                    
                    // Case 1: Next incoming word is significantly better, update existing agreed word
                    if (nextIncomingWord.confidence > lastAgreedExistingWord.confidence + this.config.wordConfidenceReplaceThreshold) {
                        if (this.config.debug) console.debug(`[Decide] Redundancy: Next incoming word "${nextIncomingWord.text}" (conf: ${nextIncomingWord.confidence.toFixed(3)}) is better than last agreed existing "${lastAgreedExistingWord.text}" (conf: ${lastAgreedExistingWord.confidence.toFixed(3)}). Updating existing word.`);
                        // Update relevant fields of the existing word. Preserve ID, history, stabilityCounter.
                        lastAgreedExistingWord.start = nextIncomingWord.start;
                        lastAgreedExistingWord.end = nextIncomingWord.end;
                        lastAgreedExistingWord.confidence = nextIncomingWord.confidence;
                        lastAgreedExistingWord.lastModifiedSequence = currentSequence; // Mark as updated by this sequence
                        // Add to history? For now, just updating.
                        
                        // Remove the now-consumed nextIncomingWord from currentIncomingWords
                        currentIncomingWords.splice(agreementLength, 1); 
                    } else {
                        // Case 2: Next incoming word is not significantly better (or worse), treat as redundant
                        if (this.config.debug) console.debug(`[Decide] Redundancy: Next incoming word "${nextIncomingWord.text}" (conf: ${nextIncomingWord.confidence.toFixed(3)}) is not significantly better. Treating as redundant.`);
                        // Remove the redundant nextIncomingWord from currentIncomingWords
                        currentIncomingWords.splice(agreementLength, 1);
                        // Ensure the lastAgreedExistingWord is marked as seen by this sequence, stability was already handled.
                        if (lastAgreedExistingWord.lastModifiedSequence < currentSequence) {
                           lastAgreedExistingWord.lastModifiedSequence = currentSequence;
                        }
                    }
                }
            }
        }
        // Use currentIncomingWords (which might be modified) for subsequent decisions.

        // --- Decision Logic Based on Agreement --- 

        // Scenario 1: Full Agreement (or incoming is subset of agreement)
        // Use currentIncomingWords.length as incomingWords might have been shortened
        if (agreementLength >= currentIncomingWords.length) { 
            if (this.config.debug) console.debug("[Decide] Incoming (possibly after redundancy check) matches existing prefix perfectly or is now shorter. Keeping existing.");
            this.incrementStability(overlappingWords.slice(0, agreementLength), currentSequence);
            // Ensure lastModifiedSequence is updated for any words in the agreed part that weren't touched by redundancy logic or incrementStability
            for (let i = 0; i < agreementLength; i++) {
                if (overlappingWords[i].lastModifiedSequence < currentSequence) {
                    overlappingWords[i].lastModifiedSequence = currentSequence;
                }
            }
            return { action: 'keep' }; 
        }

        // Scenario 2: Partial Agreement
        if (agreementLength > 0) {
            if (this.config.debug) console.debug(`[Decide] Partial agreement (${agreementLength} words). Keeping agreed part.`);
            this.incrementStability(overlappingWords.slice(0, agreementLength), currentSequence);
            // Ensure lastModifiedSequence is updated for any words in the agreed part that weren't touched by redundancy logic or incrementStability
             for (let i = 0; i < agreementLength; i++) {
                if (overlappingWords[i].lastModifiedSequence < currentSequence) {
                    overlappingWords[i].lastModifiedSequence = currentSequence;
                }
            }

            const remainingIncoming = currentIncomingWords.slice(agreementLength);
            const remainingExisting = overlappingWords.slice(agreementLength);
            
            // If incoming ends after agreement, but existing continues, keep existing for now.
            if (remainingIncoming.length === 0 && remainingExisting.length > 0) {
                 if (this.config.debug) console.debug("[Decide] Partial agreement, incoming (post-redundancy) ends here. Keeping remaining existing.");
                 // Let future segments resolve this remaining part. Don't increment stability yet.
                 // Mark remaining existing as seen
                 for(const word of remainingExisting) {
                    if (word.lastModifiedSequence < currentSequence) {
                        word.lastModifiedSequence = currentSequence;
                    }
                 }
                 return { action: 'keep' }; 
            }
            
            // If existing ends after agreement, but incoming continues, replace (append) rest.
            // This constitutes a partial replace action.
            if (remainingExisting.length === 0 && remainingIncoming.length > 0) {
                 if (this.config.debug) console.debug("[Decide] Partial agreement, existing ends here. Replacing (appending) remaining incoming (post-redundancy).");
                 return { action: 'partial_replace', agreementLength }; // agreementLength refers to original agreement
            }
            
            // Both have remaining parts - compare the non-matching tails.
            if (remainingIncoming.length > 0 && remainingExisting.length > 0) {
                if (this.config.debug) console.debug("[Decide] Partial agreement, comparing remaining parts (post-redundancy) using confidence...");
                // Decide based on confidence/stability whether to replace the remainingExisting part.
                const replaceRemaining = this.decideReplacementByConfidence(remainingIncoming, remainingExisting, currentSequence);
                if (replaceRemaining) {
                     if (this.config.debug) console.debug("[Decide] Partial agreement: Replacing remaining existing part.");
                    return { action: 'partial_replace', agreementLength }; // agreementLength refers to original agreement
                } else {
                     if (this.config.debug) console.debug("[Decide] Partial agreement: Keeping remaining existing part.");
                     this.incrementStability(remainingExisting, currentSequence); // Stabilize the kept remaining part
                    return { action: 'keep' }; // Keep the whole existing block
                }
            }
            
            // If both remaining are empty (shouldn't happen if agreementLength > 0 and < currentIncomingWords.length)
            if (this.config.debug) console.debug("[Decide] Partial agreement, both remaining (post-redundancy) empty? Defaulting to keep.");
            return { action: 'keep' }; 
        }

        // Scenario 3: No Agreement (agreementLength === 0)
        // Here, currentIncomingWords is the same as original incomingWords
        if (this.config.debug) console.debug("[Decide] No agreement, comparing segments using confidence/stability...");
        const replaceBasedOnConfidence = this.decideReplacementByConfidence(currentIncomingWords, overlappingWords, currentSequence);
        
        if (replaceBasedOnConfidence) {
             if (this.config.debug) console.debug("[Decide] No agreement: Confidence favors REPLACING existing.");
            return { action: 'replace_all' };
        } else {
             if (this.config.debug) console.debug("[Decide] No agreement: Confidence favors KEEPING existing.");
             this.incrementStability(overlappingWords, currentSequence); // Stabilize the kept words
            return { action: 'keep' };
        }
    }
    
    /**
     * Helper to increment stability counters for a list of words.
     * @param {MergedWord[]} wordsToStabilize 
     * @param {number} currentSequence 
     */
    incrementStability(wordsToStabilize, currentSequence) {
        let stabilityIncrementedCount = 0;
        for (const word of wordsToStabilize) {
             // Only increment stability if the word wasn't just added/modified 
             // by the immediately preceding sequence OR this sequence (in case of re-insertion).
            if (word.lastModifiedSequence < currentSequence) { 
                word.stabilityCounter++;
                word.lastModifiedSequence = currentSequence; // Mark as 'seen' by this sequence
                stabilityIncrementedCount++;
            }
        }
        // Avoid double counting if called multiple times in one decision path
        // this.stats.wordsKeptStable += stabilityIncrementedCount; // Stat update moved to merge()
        if (this.config.debug && stabilityIncrementedCount > 0) {
            console.debug(`[Stabilize] Incremented stability for ${stabilityIncrementedCount} words.`);
        }
        return stabilityIncrementedCount; // Return count for potential use
    }

    /**
     * Original decision logic based purely on confidence, stability, recency.
     * Used as a fallback when there's no local word agreement or for comparing tails.
     * @param {IncomingWord[] | MergedWord[]} incomingWords Segment/words being considered.
     * @param {MergedWord[]} overlappingWords Segment/words being compared against.
     * @param {number} currentSequence 
     * @returns {boolean} True to replace overlappingWords with incomingWords, false to keep existing.
     */
    decideReplacementByConfidence(incomingWords, overlappingWords, currentSequence) {
         if (!incomingWords || incomingWords.length === 0) return false; // Cannot replace with nothing
         if (!overlappingWords || overlappingWords.length === 0) return true; // Always replace nothing
        
        // Calculate metrics for comparison
        const calcAverageConfidence = (words) => {
            if (!words || words.length === 0) return 0;
            // Ensure confidence is treated as a number, default to 0
            const sum = words.reduce((acc, w) => acc + (Number(w.confidence) || 0), 0);
            return sum / words.length;
        };
        
        const incomingAvgConfidence = calcAverageConfidence(incomingWords);
        const existingAvgConfidence = calcAverageConfidence(overlappingWords);
        const incomingWordCount = incomingWords.length;
        const existingWordCount = overlappingWords.length;

        const minExistingStability = overlappingWords.length > 0 
            ? overlappingWords.reduce((min, w) => Math.min(min, w.stabilityCounter || 0), Infinity) 
            : 0;
        const maxExistingSequence = overlappingWords.length > 0 
            ? overlappingWords.reduce((max, w) => Math.max(max, w.lastModifiedSequence || 0), 0) 
            : 0;
        const isExistingVeryRecent = maxExistingSequence >= currentSequence -1; 

        if (this.config.debug) {
            console.debug(`[Decide Conf] Comparing: Incoming (Conf:${incomingAvgConfidence.toFixed(3)}, Len:${incomingWordCount}) vs Existing (Conf:${existingAvgConfidence.toFixed(3)}, Len:${existingWordCount}, MinStab:${minExistingStability === Infinity ? 'N/A' : minExistingStability}, Recent:${isExistingVeryRecent})`);
        }

        let preliminaryReplaceDecision = false;

        // --- Decision Rules --- 
        const effectiveConfidenceBias = isExistingVeryRecent ? this.config.confidenceBias * 1.1 : this.config.confidenceBias;

        if (incomingAvgConfidence > existingAvgConfidence * effectiveConfidenceBias) {
            if (this.config.debug) console.debug(`[Decide Conf] Rule 1 Triggered: New segment confidence significantly higher (Bias: ${effectiveConfidenceBias.toFixed(2)}). PRELIMINARY REPLACE.`);
            preliminaryReplaceDecision = true; 
        } else {
            const tolerance = existingAvgConfidence > 0 
                            ? (effectiveConfidenceBias - 1.0) * existingAvgConfidence 
                            : 0.01; 
            const confidenceDifference = Math.abs(incomingAvgConfidence - existingAvgConfidence);
            
            if (confidenceDifference <= tolerance) { 
                if (this.config.debug) console.debug(`[Decide Conf] Confidence difference (${confidenceDifference.toFixed(3)}) within tolerance (${tolerance.toFixed(3)}). Checking stability...`);
                if (minExistingStability !== Infinity && minExistingStability >= this.config.stabilityThreshold && !isExistingVeryRecent) {
                    if (this.config.debug) console.debug("[Decide Conf] Rule 2a Triggered: Confidence similar, existing words are stable and not very recent. PRELIMINARY KEEP.");
                    preliminaryReplaceDecision = false; 
                } else {
                    if (this.config.debug) console.debug(`[Decide Conf] Confidence similar, existing words NOT stable (Stab:${minExistingStability === Infinity ? 'N/A' : minExistingStability}) or very recent (${isExistingVeryRecent}). Applying length bias...`);
                    const lengthAdjustedIncomingConf = incomingAvgConfidence + (this.config.lengthBiasFactor * incomingWordCount);
                    const lengthAdjustedExistingConf = existingAvgConfidence + (this.config.lengthBiasFactor * existingWordCount);
                    
                    if (this.config.debug) console.debug(`[Decide Conf] Scores: Incoming=${lengthAdjustedIncomingConf.toFixed(4)}, Existing=${lengthAdjustedExistingConf.toFixed(4)}`);
                    if (lengthAdjustedIncomingConf > lengthAdjustedExistingConf) {
                        if (this.config.debug) console.debug("[Decide Conf] Rule 2b Triggered: Incoming score higher after bias. PRELIMINARY REPLACE.");
                        preliminaryReplaceDecision = true;
                    } else {
                        if (this.config.debug) console.debug("[Decide Conf] Rule 2b: Existing score higher or equal after bias. PRELIMINARY KEEP.");
                        preliminaryReplaceDecision = false;
                    }
                }
            } else if (incomingAvgConfidence < existingAvgConfidence) { 
                if (this.config.debug) console.debug("[Decide Conf] Incoming confidence is lower. Checking existing stability/recency...");
                if (minExistingStability !== Infinity && minExistingStability >= 1 && !isExistingVeryRecent) { 
                    if (this.config.debug) console.debug("[Decide Conf] Rule 3b: Incoming lower confidence, existing has survived at least one round and not very recent. PRELIMINARY KEEP.");
                    preliminaryReplaceDecision = false; 
                } else {
                    if (this.config.debug) console.debug("[Decide Conf] Rule 3a Triggered: Incoming lower confidence, but existing is brand new or stability 0. PRELIMINARY REPLACE (allows quick corrections).");
                    preliminaryReplaceDecision = true; 
                }
            } else {
                // Default Case: Incoming confidence is higher, but not by the biased amount (Rule 1 failed),
                // and the difference wasn't within the tolerance (Rule 2 failed).
                // This implies a moderate confidence improvement for the incoming segment.
                if (this.config.debug) console.debug("[Decide Conf] Default Case: Incoming confidence improvement is moderate. PRELIMINARY REPLACE.");
                preliminaryReplaceDecision = true; 
            }
        }

        // --- Veto Logic --- 
        if (preliminaryReplaceDecision) {
            const vetoCheckLength = Math.min(3, incomingWords.length, overlappingWords.length);
            if (this.config.debug && vetoCheckLength > 0) console.debug(`[Decide Conf Veto] Preliminary decision is REPLACE. Checking for veto on first ${vetoCheckLength} words.`);

            for (let i = 0; i < vetoCheckLength; i++) {
                const oWord = overlappingWords[i];
                const iWord = incomingWords[i];

                // Veto if a stable, significantly higher-confidence existing word (DIFFERENT TEXT) is being replaced by a lower-confidence new word.
                if (oWord.text.toLowerCase() !== iWord.text.toLowerCase() &&
                    oWord.stabilityCounter >= this.config.stabilityThresholdForVeto &&
                    oWord.confidence > iWord.confidence + this.config.wordMinConfidenceSuperiorityForVeto) {
                    
                    if (this.config.debug) {
                        console.debug(`[Decide Conf VETO] VETOING replacement. Existing word "${oWord.text}" (conf: ${oWord.confidence.toFixed(3)}, stab: ${oWord.stabilityCounter}) is significantly better and different text than incoming "${iWord.text}" (conf: ${iWord.confidence.toFixed(3)}).`);
                    }
                    return false; // Veto the replacement, KEEP existing.
                }
            }
        }
        
        return preliminaryReplaceDecision; 
    }

    /**
     * Creates a MergedWord object from an IncomingWord structure.
     * @param {IncomingWord} incomingWord 
     * @param {number} currentSequence 
     * @returns {MergedWord}
     */
    createMergedWord(incomingWord, currentSequence) {
        // This function is now simple mapping + initialization
        return { 
            id: incomingWord.id, 
            text: incomingWord.text,
            start: incomingWord.start,
            end: incomingWord.end,
            confidence: incomingWord.confidence,
            finalized: false,
            sourceSegmentId: incomingWord.sourceSegmentId,
            stabilityCounter: 0, // Initial stability
            lastModifiedSequence: currentSequence, // Mark when it was added
            history: [], // Initialize history array
            lockedByUser: false // Initialize locked flag
        };
    }

    /**
     * Inserts an array of new MergedWord objects into the main transcript array,
     * maintaining the sort order based on start time.
     * Uses the provided insertionHint (startIndex from splice) if available.
     * @param {MergedWord[]} transcript - The main sorted transcript array (will be modified).
     * @param {MergedWord[]} wordsToInsert - The new words to insert, assumed sorted by start time.
     * @param {number} insertionHint - The index where removal occurred (-1 if no removal).
     */
    insertWordsIntoTranscript(transcript, wordsToInsert, insertionHint = -1) {
        if (!wordsToInsert || wordsToInsert.length === 0) return;
        
        if (insertionHint !== -1 && insertionHint <= transcript.length) {
            // Optimization: If we have a valid hint (from where words were removed), insert there.
            // Check if the start time of the new words fits reasonably at the hint index.
            const fitsAtHint = 
                (insertionHint === 0 || transcript[insertionHint - 1].start <= wordsToInsert[0].start) &&
                (insertionHint === transcript.length || transcript[insertionHint].start >= wordsToInsert[wordsToInsert.length - 1].start);

            if (fitsAtHint) {
                 transcript.splice(insertionHint, 0, ...wordsToInsert);
                 if (this.config.debug) console.debug(`[Insert] Inserted ${wordsToInsert.length} words at hinted index ${insertionHint}.`);
                 return; // Done
            } else {
                 if (this.config.debug) console.warn(`[Insert] Insertion hint ${insertionHint} invalid based on timing. Falling back to search.`);
                 // Hint was wrong, fall back to searching
            }
        }
        
        // Fallback: Find the correct position using binary search logic
        // Find insertion point for the first word: index of the first word starting >= new word start time
        const firstWordStartTime = wordsToInsert[0].start;
        let low = 0;
        let high = transcript.length - 1;
        let insertionIndex = transcript.length; // Default to appending at the end

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (transcript[mid].start >= firstWordStartTime) {
                insertionIndex = mid; // Found a potential spot, try earlier
                high = mid - 1;
            } else {
                low = mid + 1; // Too early, try later
            }
        }
        
        transcript.splice(insertionIndex, 0, ...wordsToInsert);
        if (this.config.debug) console.debug(`[Insert] Inserted ${wordsToInsert.length} words at calculated index ${insertionIndex}.`);
    }

    // --- Extraction, Finalization, Mature Cursor (Adapted Below) ---

    /**
     * Extract individual words from segments into the IncomingWord structure.
     * Ensures unique IDs are generated for each word instance.
     */
    extractWordsFromSegments(filteredSegments, originalSegmentId, sequence) {
        const words = [];
        let wordCounter = 0; 
        filteredSegments.forEach((segment, segmentIndex) => {
            if (segment.words && segment.words.length > 0) {
                for (const word of segment.words) {
                    let cleanedWord = word.word ? word.word.trim() : ''; 
                    if (!cleanedWord) continue; 

                    const startTime = typeof word.start === 'number' ? word.start : NaN;
                    const endTime = typeof word.end === 'number' ? word.end : NaN;
                    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
                        if (this.config.debug) console.warn(`[Merger Extract] Skipping word with invalid/zero duration: "${cleanedWord}" [${startTime}-${endTime}] in seg ${originalSegmentId}`);
                        continue; 
                    }
                    
                    const wordId = `${originalSegmentId}_s${segmentIndex}_w${wordCounter++}_q${sequence}`; // Added sequence
                    
                    const wordInfo = {
                        id: wordId, 
                        text: cleanedWord,
                        start: startTime,
                        end: endTime,
                        confidence: typeof word.confidence === 'number' ? word.confidence : 0.0,
                        sourceSegmentId: originalSegmentId,
                        sequence: sequence, 
                    };
                    words.push(wordInfo);
                }
            } 
        });
        words.sort((a,b) => a.start - b.start); 
        return words;
    }

    /**
     * NEW: Extract individual words from the Parakeet payload's `words` array.
     * @param {WordDetail[]} payloadWords - Array of WordDetail objects from Parakeet.
     * @param {string} sessionId - The session ID for this payload.
     * @param {number} sequenceNum - The sequence number of this payload.
     * @param {boolean} isFinalPayload - Whether this payload is marked as final.
     * @returns {IncomingWord[]}
     */
    extractWordsFromPayload(payloadWords, sessionId, sequenceNum, isFinalPayload) {
        const incomingWords = [];
        if (!payloadWords || payloadWords.length === 0) {
            return incomingWords;
        }

        payloadWords.forEach((wordDetail, index) => {
            const cleanedWordText = wordDetail.text ? wordDetail.text.trim() : '';
            if (!cleanedWordText) {
                if (this.config.debug) console.warn(`[Merger ExtractPayload] Skipping empty word text at index ${index}, Sess ${sessionId}, Seq ${sequenceNum}`);
                return; // continue to next wordDetail
            }

            const startTime = typeof wordDetail.start_time === 'number' ? wordDetail.start_time : NaN;
            const endTime = typeof wordDetail.end_time === 'number' ? wordDetail.end_time : NaN;

            if (isNaN(startTime) || isNaN(endTime) || startTime > endTime) { // Allow startTime === endTime for zero-duration? Schema implies duration.
                if (this.config.debug) console.warn(`[Merger ExtractPayload] Skipping word with invalid/negative duration: "${cleanedWordText}" [${startTime}-${endTime}] in Sess ${sessionId}, Seq ${sequenceNum}`);
                return; // continue to next wordDetail
            }
            
            // Generate a unique ID for the word instance
            const wordId = `${sessionId}_seq${sequenceNum}_w${index}`;

            const wordInfo = {
                id: wordId,
                text: cleanedWordText,
                start: startTime,
                end: endTime,
                confidence: typeof wordDetail.confidence === 'number' ? wordDetail.confidence : 0.0,
                sourceSegmentId: `${sessionId}_seq${sequenceNum}`, // Using combined ID for source
                sequence: sequenceNum,
                // Potentially use isFinalPayload here to influence initial 'finalized' state later in createMergedWord
                // For now, createMergedWord handles initial finalization
            };
            incomingWords.push(wordInfo);
        });

        // Words from Parakeet are already sorted by start_time as per schema example.
        // If not guaranteed, uncomment: incomingWords.sort((a, b) => a.start - b.start);
        return incomingWords;
    }

    /**
     * Updates the finalization status of merged words.
     * @param {Array<MergedWord>} transcript - The full transcript of words.
     * @param {number} segmentEndTime - The end time of the latest processed segment.
     * @param {number} currentMatureCursorTime - The current mature cursor time.
     * @param {number} currentSequence - The sequence number of the latest segment.
     */
    updateFinalization(transcript, segmentEndTime, currentMatureCursorTime, currentSequence) {
        let finalizedCountChange = 0;
        const { finalizationStabilityThreshold, useAgeFinalization, finalizationAgeThreshold } = this.config;

        for (const word of transcript) {
            if (word.finalized) continue;

            let shouldFinalize = false;
            let reason = "";

            // Reason 1: Word ends significantly before the mature cursor – safe to finalize.
            if (currentMatureCursorTime > 0 && word.end < currentMatureCursorTime - 0.1) {
                shouldFinalize = true;
                reason = 'Cursor';
            }

            // Reason 2: Word is old enough compared with segment end (age finalization).
            if (!shouldFinalize && useAgeFinalization && segmentEndTime - word.end >= finalizationAgeThreshold) {
                shouldFinalize = true;
                reason = `Age (${(segmentEndTime - word.end).toFixed(1)}s >= ${finalizationAgeThreshold}s)`;
            }

            // Reason 3: Word has high stability (and wasn't just modified)
            if (!shouldFinalize && word.stabilityCounter >= finalizationStabilityThreshold && word.lastModifiedSequence < currentSequence) {
                shouldFinalize = true;
                reason = `Stability (${word.stabilityCounter} >= ${finalizationStabilityThreshold})`;
            }

            if (shouldFinalize) {
                word.finalized = true;
                finalizedCountChange++;
                if (this.config.debug) console.debug(`[Finalize] Word "${word.text}" (${word.start.toFixed(2)}-${word.end.toFixed(2)}) finalized. Reason: ${reason}`);
            }
        }

        if (finalizedCountChange > 0) {
            this.stats.wordsFinalized = transcript.filter(w => w.finalized).length;
            if (this.config.debug) console.debug(`[Finalize] Finalized ${finalizedCountChange} new words. Total finalized: ${this.stats.wordsFinalized}`);
        }
    }

    /**
     * Updates the mature cursor time based on finalized words and sentence boundaries/pauses.
     * @param {number} currentTime - The current segment end time for initial context check
     */
    updateMatureCursorTime(currentTime = 0) {
        const { minInitialContextTime, cursorBehaviorMode } = this.config;

        // --- Step 1: Get Finalized Words & Check Initial Conditions ---
        const finalizedWords = this.mergedTranscript.filter(w => w.finalized);
        if (finalizedWords.length === 0) {
            if (this.config.debug) console.debug(`[Cursor] No finalized words, cursor held.`);
            return;
        }

        // --- Step 2: Determine New Mature Time based on Cursor Behavior Mode ---
        let newMatureTime = this.matureCursorTime;

        if (cursorBehaviorMode === 'sentenceBased') {
            // --- Sentence-Based Logic ---
            const sentenceEndings = this.sentenceDetector.detectSentenceEndings(finalizedWords);

            if (sentenceEndings.length >= 2) {
                const secondToLastEndWord = sentenceEndings[sentenceEndings.length - 2];

                if (this.config.debug) {
                    const method = secondToLastEndWord.sentenceMetadata?.detectionMethod || 'heuristic';
                    console.log(`[Cursor Logic] Mode: sentenceBased-${method}. Advancing cursor to 2nd-last sentence end at ${secondToLastEndWord.end.toFixed(2)}s ("${secondToLastEndWord.text}").`);
                }

                // Directly use the end of the second-to-last finalized sentence. No extra pause enforced.
                newMatureTime = secondToLastEndWord.end;
            } else {
                if (this.config.debug) console.log(`[Cursor Logic] Fewer than 2 sentences detected among finalized words. Cursor held.`);
            }
        } else {
            // --- lastFinalized Logic (Fallback) ---
            const lastFinalizedWord = finalizedWords[finalizedWords.length - 1];
            if (lastFinalizedWord) {
                newMatureTime = lastFinalizedWord.end;
                if (this.config.debug) console.debug(`[Cursor Mode: lastFinalized] Setting candidate time to last finalized word end: ${newMatureTime.toFixed(2)}s`);
            }
        }
        
        // --- Step 3: Final Checks and Update ---
        // Only advance if we have sufficient context time AND the new time is actually greater
        if (newMatureTime > this.matureCursorTime && currentTime >= minInitialContextTime) {
            if (this.config.debug) console.log(`[Cursor] Mature cursor advanced from ${this.matureCursorTime.toFixed(2)}s to ${newMatureTime.toFixed(2)}s.`);
            this.matureCursorTime = newMatureTime;
        } else if (this.config.debug && newMatureTime > this.matureCursorTime) {
            console.debug(`[Cursor] Holding cursor - insufficient context time (${currentTime.toFixed(2)}s < ${minInitialContextTime}s)`);
        }
    }

    // --- Utility and State Management ---

    /**
     * Update WPM (Words Per Minute) statistics based on current transcript
     */
    updateWpmStats() {
        const now = Date.now() / 1000; // Current time in seconds
        const finalizedWords = this.mergedTranscript.filter(w => w.finalized);
        
        if (finalizedWords.length === 0) {
            this.stats.wpmOverall = 0;
            this.stats.wpmRolling = 0;
            return;
        }

        // Calculate overall WPM from first to last finalized word
        const firstWord = finalizedWords[0];
        const lastWord = finalizedWords[finalizedWords.length - 1];
        const totalDuration = lastWord.end - firstWord.start;
        
        if (totalDuration > 0) {
            this.stats.wpmOverall = Math.round((finalizedWords.length / totalDuration) * 60);
        }

        // Calculate rolling WPM for the last minute
        const oneMinuteAgo = now - 60;
        const recentWords = finalizedWords.filter(w => w.end >= oneMinuteAgo);
        
        if (recentWords.length > 0) {
            const recentFirstWord = recentWords[0];
            const recentLastWord = recentWords[recentWords.length - 1];
            const recentDuration = recentLastWord.end - recentFirstWord.start;
            
            if (recentDuration > 0) {
                this.stats.wpmRolling = Math.round((recentWords.length / recentDuration) * 60);
            }
        } else {
            this.stats.wpmRolling = 0;
        }
    }

    /**
     * Returns the current state of the merger.
     */
    getCurrentState() {
        // Update WPM stats before returning state
        this.updateWpmStats();
        
        return { 
            text: this.getFinalText(), // Uses mergedTranscript via getFinalText
            words: [...this.mergedTranscript], // Return a shallow copy
            stats: {...this.stats}, // Return a copy of stats
            matureCursorTime: this.matureCursorTime 
        };
    }

    /**
     * Filter segments based on confidence levels.
     */
    filterSegmentsByConfidence(segments) {
         if (!segments || segments.length === 0) return [];
        
        // THIS METHOD IS NO LONGER DIRECTLY USED IN `merge` because the new payload
        // does not have a `segments` array in the same way.
        // It's kept here for now in case it's useful for other purposes or if the structure changes.
        // If it's definitely obsolete, it should be removed.
        if (this.config.debug) console.warn("[Merger] filterSegmentsByConfidence was called, but it's likely obsolete with the new Parakeet payload structure.");

        const minAbsoluteConfidence = this.config.segmentFilterMinAbsoluteConfidence;
        const stdDevThresholdFactor = this.config.segmentFilterStdDevThresholdFactor;
        
        if (segments.length === 1) {
            const segConf = segments[0].confidence;
            return (typeof segConf === 'number' && isFinite(segConf) && segConf >= minAbsoluteConfidence) 
                   ? segments : [];
        }

        const confidences = segments.map(s => s.confidence).filter(c => typeof c === 'number' && isFinite(c));
        if (confidences.length === 0) return []; 

        const sum = confidences.reduce((acc, val) => acc + val, 0);
        const mean = sum / confidences.length;
        
        if (confidences.length === 1) {
             // If filtering leaves only one segment, apply absolute threshold to it
             return segments.filter(s => s.confidence === confidences[0] && s.confidence >= minAbsoluteConfidence);
        }

        const sqDiffs = confidences.map(val => Math.pow(val - mean, 2));
        const avgSqDiff = sqDiffs.reduce((acc, val) => acc + val, 0) / confidences.length;
        const stdDev = Math.sqrt(avgSqDiff);

        const dynamicThreshold = mean - (stdDevThresholdFactor * stdDev);
        const finalThreshold = isNaN(dynamicThreshold) || !isFinite(dynamicThreshold)
            ? minAbsoluteConfidence
            : Math.max(minAbsoluteConfidence, dynamicThreshold);

        // Debug logging can be added here if needed using this.config.debug

        const filtered = segments.filter(segment => typeof segment.confidence === 'number' && segment.confidence >= finalThreshold);
        
        // Debug logging for discarded segments can be added here
        
        return filtered;
    }

    /**
     * Generates the display text from mergedTranscript, handling spacing.
     */
    getFinalText() {
        // Use the current mergedTranscript
        if (this.mergedTranscript.length === 0) return '';
        
        let text = '';
        for (let i = 0; i < this.mergedTranscript.length; i++) {
            const wordInfo = this.mergedTranscript[i];
            if (!wordInfo || typeof wordInfo.text !== 'string') continue; 

            const currentWordText = wordInfo.text;
            let needsSpace = false;
            if (i > 0) {
                 const prevWordInfo = this.mergedTranscript[i-1];
                if (prevWordInfo && typeof prevWordInfo.text === 'string') {
                        needsSpace = true;
                    const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(currentWordText);
                    if (noSpaceBefore) needsSpace = false;
                    if (currentWordText.startsWith("'")) {
                         const commonContractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                         if (commonContractions.includes(currentWordText.toLowerCase())) needsSpace = false;
                     }
                    if (currentWordText.toLowerCase() === "n't" && prevWordInfo.text.toLowerCase().endsWith("n")) needsSpace = false;
                 }
            }
            if (needsSpace) text += ' ';
            text += currentWordText;
        }
        return text.replace(/\s+/g, ' ').trim(); 
    }

    // ... (updateConfig and reset methods remain) ...
    updateConfig(newConfig) {
        if (newConfig) {
            // Merge new config over existing, preserving defaults for missing keys
            this.config = { ...this.config, ...newConfig }; 
            
            // Update sentence detector config if sentence detection settings changed
            if (newConfig.hasOwnProperty('useNLPSentenceDetection') || 
                newConfig.hasOwnProperty('nlpSentenceDetectionDebug')) {
                this.sentenceDetector.updateConfig({
                    useNLP: this.config.useNLPSentenceDetection,
                    debug: this.config.nlpSentenceDetectionDebug || this.config.debug
                });
            }
            
            console.log("[Merger] Config updated:", this.config);
        } else {
            console.warn("[Merger] updateConfig called with null or undefined config.");
        }
        return this.config; // Return the updated config
    }
    reset(config) {
        if (config) {
            this.updateConfig(config); // Use updateConfig to handle changes properly
            console.log("SegmentAlign TranscriptionMerger reset with new config:", this.config);
        } else {
            // Reset to initial default state if no config is passed
            this.config = { ...this.defaultConfig };
            console.log("SegmentAlign TranscriptionMerger reset to default state and config.");
        }

        this.mergedTranscript = [];
        this.matureCursorTime = 0;
        this.stats = this.getInitialStats();

        // Also reset the sentence detector's incremental state
        if (this.sentenceDetector) {
            this.sentenceDetector.reset();
        }
    }

    // --- Removed Obsolete TimeBin Methods ---
    /*
    // Removed:
    getOrCreateBin(...) {}
    getOrCreateCandidate(...) {}
    updateWinningCandidate(...) {}
    extractTranscriptFromBins(...) {}
    _finalizeWordSequence(...) {}
    _resolveOverlapConflict(...) {}
    _findDominantCandidateInGap(...) {}
    getConfidenceForWord(...) {}
    getAlternativesForTimeRange(...) {}
    */

    // Keep utility function
    static doTimeRangesOverlap(start1, end1, start2, end2) {
        if (start1 >= end1 || start2 >= end2) return false;
        return Math.max(start1, start2) < Math.min(end1, end2);
    }

    static calculateOverlapDuration(start1, end1, start2, end2) {
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        return Math.max(0, overlapEnd - overlapStart);
    }

    // --- Token alignment (time-aware DP) ------------------------------------
    alignTokensWithTail(newTokens = []) {
        if (!Array.isArray(newTokens) || newTokens.length === 0) return;
        const norm = (t) => ({
            token: (t.token || '').toLowerCase(),
            start: Number.isFinite(t.start_time) ? t.start_time : 0,
            end: Number.isFinite(t.end_time) ? t.end_time : 0,
            confidence: Number.isFinite(t.confidence) ? t.confidence : 0
        });
        const A = this.tokenTail.map(norm);
        const B = newTokens.map(norm);
        if (A.length === 0) {
            this.tokenTail = B;
            this._truncateTokenTail();
            return;
        }

        const n = A.length, m = B.length;
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        const bt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        const wMatch = 2.0, wConf = 0.5, gap = 1.0, tWindow = 1.5;

        for (let i = 1; i <= n; i++) { dp[i][0] = dp[i-1][0] - gap; bt[i][0] = 1; }
        for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j-1] - gap; bt[0][j] = 2; }

        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                const a = A[i-1], b = B[j-1];
                let sMatch = -Infinity;
                if (a.token && a.token === b.token) {
                    const timeOk = Math.abs(a.start - b.start) <= tWindow && b.start >= a.start - 0.2;
                    if (timeOk) {
                        const conf = (a.confidence + b.confidence) * 0.5;
                        sMatch = dp[i-1][j-1] + wMatch + wConf * conf;
                    }
                }
                const sDel = dp[i-1][j] - gap;
                const sIns = dp[i][j-1] - gap;
                if (sMatch >= sDel && sMatch >= sIns) { dp[i][j] = sMatch; bt[i][j] = 0; }
                else if (sDel >= sIns) { dp[i][j] = sDel; bt[i][j] = 1; }
                else { dp[i][j] = sIns; bt[i][j] = 2; }
            }
        }

        // Backtrack (not currently used to splice; we keep B as the tail snapshot)
        this.tokenTail = B;
        this._truncateTokenTail();
    }

    _truncateTokenTail() {
        if (!Array.isArray(this.tokenTail) || this.tokenTail.length === 0) return;
        const cutoff = (this.tokenTail[this.tokenTail.length - 1].end) - this.maxTokenTailSeconds;
        let idx = 0;
        while (idx < this.tokenTail.length && this.tokenTail[idx].end < cutoff) idx++;
        if (idx > 0) this.tokenTail = this.tokenTail.slice(idx);
    }

    /**
     * Remove immediate consecutive duplicate words (e.g., "just just") within a short time window.
     * Keeps the higher-confidence instance when both are non-finalized; never removes finalized words.
     * @param {number} windowSeconds
     */
    compressConsecutiveDuplicateWords(windowSeconds = 2.0) {
        if (!Array.isArray(this.mergedTranscript) || this.mergedTranscript.length < 2) return;
        const out = [];
        for (let i = 0; i < this.mergedTranscript.length; i++) {
            const w = this.mergedTranscript[i];
            const prev = out.length ? out[out.length - 1] : null;
            if (prev && w.text && prev.text && w.text.toLowerCase() === prev.text.toLowerCase()) {
                const closeInTime = Math.abs((w.start - prev.end)) <= windowSeconds;
                if (closeInTime) {
                    // Prefer finalized; otherwise keep higher confidence
                    if (prev.finalized) {
                        continue; // drop current duplicate
                    } else if (w.finalized) {
                        out[out.length - 1] = w; // replace with finalized
                        continue;
                    } else {
                        out[out.length - 1] = (w.confidence >= prev.confidence) ? w : prev;
                        continue;
                    }
                }
            }
            out.push(w);
        }
        this.mergedTranscript = out;
    }

    /**
     * Suppress phrase-level immediate repetition at boundaries (A followed immediately by A again).
     * Only affects the recent tail (last lookbackWords) and never removes finalized words in the first occurrence.
     * @param {{lookbackWords:number,minLen:number,maxLen:number,windowSeconds:number}} cfg
     */
    suppressImmediatePhraseRepetition(cfg = {}) {
        const lookbackWords = cfg.lookbackWords ?? 80;
        const minLen = cfg.minLen ?? 3;
        const maxLen = cfg.maxLen ?? 8;
        const windowSeconds = cfg.windowSeconds ?? 6.0;
        const n = this.mergedTranscript.length;
        if (n < 2 || minLen > maxLen) return;
        const startIdx = Math.max(0, n - Math.max(lookbackWords, maxLen * 4));
        // Work on a sliding window in the tail
        for (let end = n - 1; end >= startIdx + (2 * minLen) - 1; end--) {
            for (let L = Math.min(maxLen, Math.floor((end - startIdx + 1) / 2)); L >= minLen; L--) {
                const mid = end - L + 1;
                const aStart = mid - L;
                if (aStart < startIdx) break;
                const seqA = this.mergedTranscript.slice(aStart, mid);
                const seqB = this.mergedTranscript.slice(mid, end + 1);
                // Quick checks
                const textEq = (sa, sb) => sa.text?.toLowerCase() === sb.text?.toLowerCase();
                let equal = true;
                for (let k = 0; k < L; k++) {
                    if (!textEq(seqA[k], seqB[k])) { equal = false; break; }
                }
                if (!equal) continue;
                const timeSpan = (seqB[seqB.length - 1].end - seqA[0].start);
                if (timeSpan > windowSeconds) continue;
                // We have A A repeated back-to-back; prefer earlier occurrence if finalized
                const anyFinalInA = seqA.some(w => w.finalized);
                if (anyFinalInA) {
                    // Remove B words if they are not finalized
                    const canRemoveAllB = seqB.every(w => !w.finalized);
                    if (!canRemoveAllB) continue; // skip if B has finalized words
                    this.mergedTranscript.splice(mid, L);
                } else {
                    // Neither finalized; keep the higher-confidence sequence overall
                    const avgConf = arr => (arr.reduce((a, w) => a + (Number(w.confidence) || 0), 0) / Math.max(1, arr.length));
                    const keepA = avgConf(seqA) >= avgConf(seqB);
                    if (keepA) {
                        // Remove B
                        this.mergedTranscript.splice(mid, L);
                    } else {
                        // Remove A
                        this.mergedTranscript.splice(aStart, L);
                    }
                }
                return; // One suppression per call is sufficient; will run again next merge
            }
        }
    }
}

export default TranscriptionMerger; 