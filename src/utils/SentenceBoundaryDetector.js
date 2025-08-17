/**
 * SentenceBoundaryDetector.js
 * 
 * Utility class for detecting sentence boundaries using winkNLP.
 * Provides both the old heuristic method and the new NLP-based method
 * for sentence boundary detection in transcription data.
 */

import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

class SentenceBoundaryDetector {
    constructor(config = {}) {
        this.config = {
            useNLP: true,                    // Whether to use winkNLP or fall back to heuristic
            debug: false,                    // Enable debug logging
            cacheSize: 100,                  // Max number of cached NLP results
            minSentenceLength: 3,            // Minimum characters for a valid sentence
            nlpContextSentences: 8,          // Number of previous sentences to include as context for incremental NLP.
            // NEW: maximum number of sentence endings that should be kept in memory. Older
            // sentences are considered permanently mature/final and will not be re-processed.
            // Keeping this list short prevents work from scaling with very long recordings.
            maxRetainedSentences: 20,
            ...config
        };

        // Initialize winkNLP with sentence boundary detection pipeline
        this.nlp = null;
        this.cache = new Map(); // Cache for NLP results to improve performance
        this.lastProcessedWordCount = 0;
        this.lastSentenceEndings = [];
        this.lastWordsCache = []; // Cache of the word array reference for incremental check
        
        this.initializeNLP();
    }

    /**
     * Initialize winkNLP with the sentence boundary detection pipeline
     */
    initializeNLP() {
        try {
            // Use only sentence boundary detection for optimal performance (~1.5M tokens/sec)
            this.nlp = winkNLP(model, ['sbd']);
            if (this.config.debug) {
                console.log('[SentenceDetector] winkNLP initialized successfully');
            }
        } catch (error) {
            console.warn('[SentenceDetector] Failed to initialize winkNLP:', error);
            console.warn('[SentenceDetector] Falling back to heuristic sentence detection');
            this.config.useNLP = false;
        }
    }

    /**
     * Detect sentence boundaries in a text and return sentence ending positions
     * @param {Array<Object>} words - Array of word objects with {text, start, end} properties
     * @returns {Array<Object>} Array of words that end sentences, with additional metadata
     */
    detectSentenceEndings(words) {
        if (!words || words.length === 0) {
            this.reset();
            return [];
        }

        // If the new word list is shorter, it might be a completely new transcript. Reset.
        if (words.length < this.lastProcessedWordCount) {
            if (this.config.debug) console.log(`[SentenceDetector] Word list shrank from ${this.lastProcessedWordCount} to ${words.length}, resetting.`);
            this.reset();
        }

        if (!this.config.useNLP || !this.nlp) {
            return this.detectSentenceEndingsHeuristic(words);
        }

        try {
            return this.detectSentenceEndingsNLP(words);
        } catch (error) {
            if (this.config.debug) {
                console.warn('[SentenceDetector] NLP detection failed, falling back to heuristic:', error);
            }
            this.reset(); // Fallback should also reset, as NLP state might be inconsistent
            return this.detectSentenceEndingsHeuristic(words);
        }
    }

    /**
     * NLP-based sentence boundary detection using winkNLP with incremental processing.
     * @param {Array<Object>} words - Array of word objects
     * @returns {Array<Object>} Array of sentence ending words with metadata
     */
    detectSentenceEndingsNLP(words) {
        // Condition for incremental update.
        // This heuristic works if the `words` array is grown by appending new word objects.
        const canIncrement = this.lastProcessedWordCount > 0 &&
                             words.length > this.lastProcessedWordCount &&
                             this.lastWordsCache.length > 0 &&
                             words[0] === this.lastWordsCache[0] &&
                             words[this.lastProcessedWordCount - 1] === this.lastWordsCache[this.lastProcessedWordCount - 1];

        if (canIncrement) {
            // --- Incremental path ---
            const numPrevSentences = this.lastSentenceEndings.length;
            const contextSentenceCount = this.config.nlpContextSentences;
            let contextIndex;

            // Determine context start index: prefer sentence-based, fallback to word-based.
            if (numPrevSentences > contextSentenceCount) {
                const firstReprocessSentenceIdx = numPrevSentences - contextSentenceCount;
                const lastHistoricSentence = this.lastSentenceEndings[firstReprocessSentenceIdx - 1];
                contextIndex = lastHistoricSentence.wordIndex + 1;
            } else {
                // Fallback to word-based context if not enough sentences are available.
                const CONTEXT_WORDS = 15;
                contextIndex = Math.max(0, this.lastProcessedWordCount - CONTEXT_WORDS);
            }
            
            const wordsToProcess = words.slice(contextIndex);
            const contextStartTime = wordsToProcess[0]?.start ?? 0;

            // Retain endings that are safely before the reprocessing window.
            const retainedEndings = this.lastSentenceEndings.filter(e => e.end < contextStartTime);
            
            if (this.config.debug) {
                console.log(`[SentenceDetector] Incremental: Reprocessing from word ${contextIndex} (${wordsToProcess.length} words). Retaining ${retainedEndings.length} endings.`);
            }

            const newEndingWordsResult = this._performNLP(wordsToProcess);

            // Remap wordIndex to be global. The word object itself is a correct reference.
            const newEndingWords = newEndingWordsResult.map(word => ({
                ...word,
                wordIndex: word.wordIndex + contextIndex
            }));

            let combinedEndings = [...retainedEndings, ...newEndingWords];

            // ---- Memory / CPU optimisation ----
            // Trim the list so we never keep more than `maxRetainedSentences` endings.
            // We keep the newest endings (towards the end of the array).
            if (combinedEndings.length > this.config.maxRetainedSentences) {
                combinedEndings = combinedEndings.slice(-this.config.maxRetainedSentences);
            }

            // Update state for next run
            this.lastSentenceEndings = combinedEndings;
            this.lastProcessedWordCount = words.length;
            this.lastWordsCache = words;

            return combinedEndings;

        } else {
            // --- Full processing path ---
            if (this.config.debug) {
                const reason = this.lastProcessedWordCount === 0 ? 'first run' : 'transcript diverged';
                console.log(`[SentenceDetector] Full: processing all ${words.length} words (${reason}).`);
            }

            this.reset(); // Reset state since we are doing a full pass

            let allEndingWords = this._performNLP(words);

            // ---- Memory / CPU optimisation (full-reprocess path) ----
            if (allEndingWords.length > this.config.maxRetainedSentences) {
                allEndingWords = allEndingWords.slice(-this.config.maxRetainedSentences);
            }

            // Update state for next run
            this.lastSentenceEndings = allEndingWords;
            this.lastProcessedWordCount = words.length;
            this.lastWordsCache = words;

            return allEndingWords;
        }
    }

    /**
     * Performs stateless NLP sentence detection on a given array of words.
     * @param {Array<Object>} words - Array of word objects to process.
     * @returns {Array<Object>} Array of sentence ending words with metadata.
     * @private
     */
    _performNLP(words) {
        if (!words || words.length === 0) {
            return [];
        }
        // Reconstruct the text from words while maintaining word-to-position mapping
        const { fullText, wordPositions } = this.reconstructTextWithPositions(words);

        // Check cache first - this is mainly for the full-reprocess case now
        const cacheKey = this.generateCacheKey(fullText);
        if (this.cache.has(cacheKey)) {
            const cachedResult = this.cache.get(cacheKey);
            return this.mapSentenceEndingsToWords(cachedResult, words, wordPositions);
        }

        // Process with winkNLP
        const doc = this.nlp.readDoc(fullText);
        const sentences = [];

        const sentenceTexts = doc.sentences().out();
        let currentPos = 0;
        
        sentenceTexts.forEach((sentenceText) => {
            // Find the sentence in the full text starting from current position
            const sentenceStart = fullText.indexOf(sentenceText, currentPos);
            if (sentenceStart !== -1) {
                const sentenceEnd = sentenceStart + sentenceText.length;
                sentences.push({
                    text: sentenceText,
                    endPos: sentenceEnd
                });
                currentPos = sentenceEnd;
            }
        });

        // Cache the result
        this.addToCache(cacheKey, sentences);

        // Map sentence endings back to original words
        return this.mapSentenceEndingsToWords(sentences, words, wordPositions);
    }

    /**
     * Fallback heuristic sentence boundary detection (original method)
     * @param {Array<Object>} words - Array of word objects
     * @returns {Array<Object>} Array of sentence ending words
     */
    detectSentenceEndingsHeuristic(words) {
        return words.filter(word => /[.?!]$/.test(word.text));
    }

    /**
     * Reconstruct full text from words while maintaining position mapping
     * @param {Array<Object>} words - Array of word objects
     * @returns {Object} Object with fullText and wordPositions mapping
     */
    reconstructTextWithPositions(words) {
        let fullText = '';
        const wordPositions = [];

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (!word || typeof word.text !== 'string') continue;

            const currentWordText = word.text;
            let needsSpace = false;

            if (i > 0) {
                const prevWord = words[i-1];
                if (prevWord && typeof prevWord.text === 'string') {
                    needsSpace = true;
                    // Apply the same spacing rules as in TranscriptionMerger.getFinalText()
                    const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(currentWordText);
                    if (noSpaceBefore) needsSpace = false;
                    if (currentWordText.startsWith("'")) {
                        const commonContractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                        if (commonContractions.includes(currentWordText.toLowerCase())) needsSpace = false;
                    }
                    if (currentWordText.toLowerCase() === "n't" && prevWord.text.toLowerCase().endsWith("n")) needsSpace = false;
                }
            }

            if (needsSpace) {
                fullText += ' ';
            }
            
            const wordStartPos = fullText.length;
            fullText += currentWordText;
            const wordEndPos = fullText.length;

            wordPositions.push({
                wordIndex: i,
                originalWord: word,
                textStartPos: wordStartPos,
                textEndPos: wordEndPos
            });
        }

        return { fullText, wordPositions };
    }

    /**
     * Map NLP-detected sentence endings back to original word objects
     * @param {Array<Object>} sentences - Sentences detected by NLP
     * @param {Array<Object>} originalWords - Original word objects
     * @param {Array<Object>} wordPositions - Position mapping from reconstructTextWithPositions
     * @returns {Array<Object>} Array of original words that end sentences
     */
    mapSentenceEndingsToWords(sentences, originalWords, wordPositions) {
        const sentenceEndingWords = [];

        sentences.forEach((sentence) => {
            const sentenceEndPos = sentence.endPos;
            
            let closestWordIndex = -1;
            let minDistance = Infinity;

            // Find the word whose end position is nearest to the sentence's detected end position.
            // We want to find the word that ENDS the sentence, so its end position should be at or just before the sentence's end.
            wordPositions.forEach((wordPos) => {
                const distance = sentenceEndPos - wordPos.textEndPos;
                // We prefer a small, non-negative distance.
                // distance >= 0: word ends before or at the sentence end (e.g., trailing space, perfect match).
                // distance < 0: word ends *after* sentence ends (i.e., it's in the next sentence).
                if (distance >= 0 && distance < minDistance) {
                    minDistance = distance;
                    closestWordIndex = wordPos.wordIndex;
                }
            });

            // If no word was found ending before the sentence end (e.g., due to a reconstruction error),
            // fall back to the absolute closest as a last resort. This prevents returning nothing.
            if (closestWordIndex === -1) {
                if (this.config.debug) console.warn(`[SentenceDetector] Could not find a word ending before sentence end position ${sentenceEndPos}. Falling back to absolute closest match.`);
                wordPositions.forEach((wordPos) => {
                    const distance = Math.abs(sentenceEndPos - wordPos.textEndPos);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestWordIndex = wordPos.wordIndex;
                    }
                });
            }

            if (closestWordIndex !== -1 && closestWordIndex < originalWords.length) {
                const endingWord = originalWords[closestWordIndex];
                // Add metadata about the sentence detection
                sentenceEndingWords.push({
                    ...endingWord,
                    wordIndex: closestWordIndex, // Add index relative to originalWords
                    sentenceMetadata: {
                        sentenceText: sentence.text,
                        detectionMethod: 'nlp'
                    }
                });
            }
        });

        if (this.config.debug) {
            console.log(`[SentenceDetector] NLP detected ${sentences.length} sentences, mapped to ${sentenceEndingWords.length} ending words`);
        }

        return sentenceEndingWords;
    }

    /**
     * Generate cache key for the given text
     * @param {string} text - Text to generate key for
     * @returns {string} Cache key
     */
    generateCacheKey(text) {
        // Simple hash function for caching
        let hash = 0;
        if (text.length === 0) return hash.toString();
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Add result to cache with size management
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    addToCache(key, value) {
        // Implement LRU-like cache management
        if (this.cache.size >= this.config.cacheSize) {
            // Remove the oldest entry
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    /**
     * Update configuration
     * @param {Object} newConfig - New configuration options
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        
        // Reinitialize NLP if useNLP setting changed
        if (newConfig.hasOwnProperty('useNLP') && newConfig.useNLP && !this.nlp) {
            this.initializeNLP();
        }

        if (this.config.debug) {
            console.log('[SentenceDetector] Config updated:', this.config);
        }
    }

    /**
     * Clear the cache and reset incremental state.
     */
    reset() {
        this.cache.clear();
        this.lastProcessedWordCount = 0;
        this.lastSentenceEndings = [];
        this.lastWordsCache = [];
        if (this.config.debug) {
            console.log('[SentenceDetector] Reset: Cache and incremental state cleared');
        }
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.reset();
    }

    /**
     * Get current statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            nlpAvailable: !!this.nlp,
            usingNLP: this.config.useNLP && !!this.nlp,
            cacheSize: this.cache.size,
            maxCacheSize: this.config.cacheSize
        };
    }
}

export default SentenceBoundaryDetector; 