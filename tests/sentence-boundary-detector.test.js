/**
 * Test suite for SentenceBoundaryDetector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import SentenceBoundaryDetector from '../src/utils/SentenceBoundaryDetector.js';

describe('SentenceBoundaryDetector', () => {
    let detector;

    beforeEach(() => {
        detector = new SentenceBoundaryDetector({
            useNLP: true,
            debug: false
        });
    });

    describe('Heuristic Detection (Fallback)', () => {
        beforeEach(() => {
            detector = new SentenceBoundaryDetector({
                useNLP: false,
                debug: false
            });
        });

        it('should detect sentence endings using regex pattern', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: 'there!', start: 1, end: 2 },
                { text: 'How', start: 2, end: 3 },
                { text: 'are', start: 3, end: 4 },
                { text: 'you?', start: 4, end: 5 }
            ];

            const sentenceEnds = detector.detectSentenceEndings(words);
            
            expect(sentenceEnds).toHaveLength(2);
            expect(sentenceEnds[0].text).toBe('there!');
            expect(sentenceEnds[1].text).toBe('you?');
        });

        it('should handle empty word arrays', () => {
            const sentenceEnds = detector.detectSentenceEndings([]);
            expect(sentenceEnds).toHaveLength(0);
        });

        it('should handle words without sentence endings', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: 'there', start: 1, end: 2 },
                { text: 'friend', start: 2, end: 3 }
            ];

            const sentenceEnds = detector.detectSentenceEndings(words);
            expect(sentenceEnds).toHaveLength(0);
        });
    });

    describe('NLP Detection', () => {
        it('should detect sentence endings using winkNLP', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: 'there!', start: 1, end: 2 },
                { text: 'How', start: 2, end: 3 },
                { text: 'are', start: 3, end: 4 },
                { text: 'you?', start: 4, end: 5 }
            ];

            const sentenceEnds = detector.detectSentenceEndings(words);
            
            expect(sentenceEnds.length).toBeGreaterThan(0);
            // Check that we get metadata indicating NLP detection
            if (sentenceEnds.length > 0) {
                expect(sentenceEnds[0].sentenceMetadata?.detectionMethod).toBe('nlp');
            }
        });

        it('should handle complex sentences with abbreviations and contractions', () => {
            const words = [
                { text: 'Dr.', start: 0, end: 0.5 },
                { text: 'Smith', start: 0.5, end: 1 },
                { text: 'said', start: 1, end: 1.5 },
                { text: "we'll", start: 1.5, end: 2 },
                { text: 'test', start: 2, end: 2.5 },
                { text: 'this.', start: 2.5, end: 3 },
                { text: "It's", start: 3, end: 3.5 },
                { text: 'working!', start: 3.5, end: 4 }
            ];

            const sentenceEnds = detector.detectSentenceEndings(words);
            
            // Should detect sentences properly despite abbreviations
            expect(sentenceEnds.length).toBeGreaterThan(0);
        });

        it('should fall back to heuristic method on NLP failure', () => {
            // Force NLP failure by calling with malformed data
            const words = [
                { text: null, start: 0, end: 1 }, // Invalid word text
                { text: 'Hello!', start: 1, end: 2 }
            ];

            const sentenceEnds = detector.detectSentenceEndings(words);
            
            // Should still work via fallback
            expect(sentenceEnds.length).toBe(1);
            expect(sentenceEnds[0].text).toBe('Hello!');
        });
    });

    describe('Text Reconstruction', () => {
        it('should properly reconstruct text with spacing rules', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: ',', start: 1, end: 1.1 },
                { text: 'world', start: 1.1, end: 2 },
                { text: '!', start: 2, end: 2.1 }
            ];

            const { fullText, wordPositions } = detector.reconstructTextWithPositions(words);
            
            expect(fullText).toBe('Hello, world!');
            expect(wordPositions).toHaveLength(4);
        });

        it('should handle contractions correctly', () => {
            const words = [
                { text: 'I', start: 0, end: 0.5 },
                { text: "'m", start: 0.5, end: 1 },
                { text: 'fine', start: 1, end: 1.5 }
            ];

            const { fullText } = detector.reconstructTextWithPositions(words);
            
            expect(fullText).toBe("I'm fine");
        });
    });

    describe('Configuration', () => {
        it('should update configuration correctly', () => {
            const initialStats = detector.getStats();
            expect(initialStats.usingNLP).toBe(true);

            detector.updateConfig({ useNLP: false });
            
            const updatedStats = detector.getStats();
            expect(updatedStats.usingNLP).toBe(false);
        });

        it('should maintain cache functionality', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: 'world!', start: 1, end: 2 }
            ];

            // First call
            detector.detectSentenceEndings(words);
            const statsAfterFirst = detector.getStats();
            
            // Second call (should use cache)
            detector.detectSentenceEndings(words);
            const statsAfterSecond = detector.getStats();
            
            expect(statsAfterSecond.cacheSize).toBeGreaterThanOrEqual(statsAfterFirst.cacheSize);
        });

        it('should clear cache when requested', () => {
            const words = [
                { text: 'Hello', start: 0, end: 1 },
                { text: 'world!', start: 1, end: 2 }
            ];

            detector.detectSentenceEndings(words);
            expect(detector.getStats().cacheSize).toBeGreaterThan(0);

            detector.clearCache();
            expect(detector.getStats().cacheSize).toBe(0);
        });
    });
}); 