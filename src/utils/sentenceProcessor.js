import SentenceBoundaryDetector from './SentenceBoundaryDetector.js';

class SentenceProcessor {
    constructor(config = {}) {
        this.sentenceBoundaryDetector = new SentenceBoundaryDetector({
            useNLP: config.useNLPSentenceDetection,
            debug: config.nlpSentenceDetectionDebug
        });
        this.allMatureSentences = [];
        this.lastProcessedWordTimestamp = 0;
        this.sentenceIdCounter = 0;
        this.config = config;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.sentenceBoundaryDetector.updateConfig({
            useNLP: this.config.useNLPSentenceDetection,
            debug: this.config.nlpSentenceDetectionDebug
        });
    }

    process(matureTimestamp, mergedWords) {
        const processStartTime = performance.now();
        
        if (!mergedWords || mergedWords.length === 0) {
            return { newSentences: [], updatedSentences: this.allMatureSentences };
        }

        const matureWords = mergedWords.filter(w => w.end <= matureTimestamp);
        const newMatureWords = matureWords.filter(w => w.end > this.lastProcessedWordTimestamp);

        if (newMatureWords.length === 0 && matureTimestamp <= this.lastProcessedWordTimestamp) {
            return { newSentences: [], updatedSentences: this.allMatureSentences };
        }

        const CONTEXT_SENTENCE_COUNT = 3;
        const contextSentences = this.allMatureSentences.slice(-CONTEXT_SENTENCE_COUNT);
        const contextWords = contextSentences.flatMap(sentence => sentence.words || []);

        const wordsToProcess = [...contextWords, ...newMatureWords];
        const detectStartTime = performance.now();
        const sentenceEndings = this.sentenceBoundaryDetector.detectSentenceEndings(wordsToProcess);
        const detectElapsed = performance.now() - detectStartTime;

        const newSentenceEndings = sentenceEndings.filter(ending => {
            const endingWord = wordsToProcess[ending.wordIndex];
            return endingWord && endingWord.end > this.lastProcessedWordTimestamp;
        });

        const newSentences = [];
        let sentenceStartIndex = 0;
        
        if (contextWords.length > 0) {
            const lastContextSentence = contextSentences[contextSentences.length - 1];
            const lastContextWordEndTime = lastContextSentence.endTime;
            const firstNewWordIndex = wordsToProcess.findIndex(w => w.end > lastContextWordEndTime);
            if (firstNewWordIndex >= 0) {
                sentenceStartIndex = firstNewWordIndex;
            } else {
                // This can happen if new words are within the timestamp of context words but not part of them
                 const firstNewWordInNewArray = newMatureWords[0];
                 const startIdx = wordsToProcess.findIndex(w => w.start === firstNewWordInNewArray.start && (w.text || w.word) === (firstNewWordInNewArray.text || firstNewWordInNewArray.word));
                 if(startIdx > -1) sentenceStartIndex = startIdx;
            }
        }

        let lastEndingIndex = -1;
        newSentenceEndings.forEach((ending) => {
            const endIndex = ending.wordIndex + 1;
            const sentenceWords = wordsToProcess.slice(sentenceStartIndex, endIndex);

            if (sentenceWords.length > 0) {
                const sentence = this.createSentenceObject(sentenceWords);
                newSentences.push(sentence);
            }
            sentenceStartIndex = endIndex;
            lastEndingIndex = endIndex;
        });

        // The logic for handling "incomplete" sentences (the last part of the text without punctuation)
        // is complex. We should check if the last processed part was already an incomplete sentence and merge it.

        const lastSentence = this.allMatureSentences[this.allMatureSentences.length - 1];
        if (lastSentence && lastSentence.detectionMethod === 'incomplete') {
            // There was a previous incomplete sentence. We need to merge it with the first new sentence if it makes sense.
            const firstNew = newSentences[0];
            if (firstNew) {
                const combinedWords = [...lastSentence.words, ...firstNew.words];
                const newText = combinedWords.map(w => w.text || w.word).join(' ');

                // A simple check: if the first new sentence completes the old one.
                if (firstNew.detectionMethod !== 'incomplete') {
                    lastSentence.text = newText;
                    lastSentence.words = combinedWords;
                    lastSentence.endTime = firstNew.endTime;
                    lastSentence.wordCount = combinedWords.length;
                    lastSentence.detectionMethod = firstNew.detectionMethod;
                    // Remove the now-merged sentence from newSentences
                    newSentences.shift();
                }
            }
        }


        // Handle any remaining words that don't form a full sentence yet.
        if (sentenceStartIndex < wordsToProcess.length) {
            const remainingWords = wordsToProcess.slice(sentenceStartIndex);
            if (remainingWords.length > 0) {
                const sentence = this.createSentenceObject(remainingWords, 'incomplete');
                newSentences.push(sentence);
            }
        }
        
        this.allMatureSentences.push(...newSentences);
        this.lastProcessedWordTimestamp = matureTimestamp;
        
        const processElapsed = performance.now() - processStartTime;
        if (processElapsed > 5) { // Log if it takes more than 5ms
            if (Math.random() < 0.1) { // Log 10% of slow processes
                console.log(`[SentenceProcessor] process() took ${processElapsed.toFixed(2)} ms (detect: ${detectElapsed.toFixed(2)} ms, ${wordsToProcess.length} words, ${newSentences.length} new sentences)`);
            }
        }

        return { newSentences, updatedSentences: this.allMatureSentences };
    }

    createSentenceObject(words, detectionMethod = null) {
        const sentenceText = words.map(w => w.text || w.word).join(' ');
        const startTime = words[0].start;
        const endTime = words[words.length - 1].end;
        
        return {
            id: `sentence_${this.sentenceIdCounter++}`,
            text: sentenceText,
            startTime: startTime,
            endTime: endTime,
            wordCount: words.length,
            words: words,
            detectionMethod: detectionMethod || words[words.length - 1].sentenceMetadata?.detectionMethod || 'heuristic',
            isMature: true,
            timestamp: Date.now()
        };
    }

    reset() {
        this.allMatureSentences = [];
        this.lastProcessedWordTimestamp = 0;
        this.sentenceIdCounter = 0;
    }
}

export default SentenceProcessor; 