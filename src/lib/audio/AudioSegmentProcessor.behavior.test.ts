
import { describe, it, expect } from 'vitest';
import { AudioSegmentProcessor, ProcessedSegment } from './AudioSegmentProcessor';

describe('AudioSegmentProcessor Behavior', () => {
    it('should detect speech segments correctly', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.01,
            silenceThreshold: 0.1, // Short silence threshold for testing
            minSpeechDuration: 0.1,
            maxSegmentDuration: 10.0,
            // Ensure consistent behavior for test
            lookbackDuration: 0.1,
            overlapDuration: 0
        });

        // Get window size from initialized processor (default 80ms usually)
        // We can access private options via 'any' cast for test setup if needed,
        // or just calculate based on known defaults.
        // Default windowDuration is imported in the source but not exported.
        // Let's rely on `windowSize` property if exposed, or assume 1280 (16000 * 0.08).
        // The class calculates windowSize in constructor.
        // Let's assume 80ms for now.
        const chunkDuration = 0.08;
        const sampleRate = 16000;
        const windowSize = Math.round(sampleRate * chunkDuration);

        const generateChunk = () => new Float32Array(windowSize);

        const detectedSegments: ProcessedSegment[] = [];
        let currentTime = 0;

        // 1. Initial Silence (0.4s)
        // 5 chunks of 80ms = 0.4s
        for (let i = 0; i < 5; i++) {
            const chunk = generateChunk();
            detectedSegments.push(...processor.processAudioData(chunk, currentTime, 0.001));
            currentTime += chunkDuration;
        }

        // 2. Speech (0.4s)
        // 5 chunks of 80ms = 0.4s
        for (let i = 0; i < 5; i++) {
            const chunk = generateChunk();
            detectedSegments.push(...processor.processAudioData(chunk, currentTime, 0.1));
            currentTime += chunkDuration;
        }

        // 3. Silence (0.4s) to trigger end of segment
        // 5 chunks of 80ms = 0.4s. Silence threshold is 0.1s, so this should trigger end.
        for (let i = 0; i < 5; i++) {
            const chunk = generateChunk();
            detectedSegments.push(...processor.processAudioData(chunk, currentTime, 0.001));
            currentTime += chunkDuration;
        }

        // 4. Another Speech Block (0.24s)
        // 3 chunks
        for (let i = 0; i < 3; i++) {
            const chunk = generateChunk();
            detectedSegments.push(...processor.processAudioData(chunk, currentTime, 0.1));
            currentTime += chunkDuration;
        }

        // 5. Final Silence
        for (let i = 0; i < 5; i++) {
            const chunk = generateChunk();
            detectedSegments.push(...processor.processAudioData(chunk, currentTime, 0.001));
            currentTime += chunkDuration;
        }

        // Verify
        // We expect 2 segments.
        // First segment: starts around 0.4s, duration around 0.4s
        // Second segment: starts around 1.2s, duration around 0.24s

        expect(detectedSegments.length).toBeGreaterThanOrEqual(2);

        // Check first segment
        const seg1 = detectedSegments[0];
        // Start time might be adjusted by lookback, but should be roughly 0.4
        expect(seg1.startTime).toBeGreaterThanOrEqual(0.3);
        expect(seg1.startTime).toBeLessThanOrEqual(0.5);
        expect(seg1.duration).toBeGreaterThan(0.3);

        // Check second segment
        const seg2 = detectedSegments[1];
        // 0.4 (silence) + 0.4 (speech) + 0.4 (silence) = 1.2 start
        expect(seg2.startTime).toBeGreaterThanOrEqual(1.1);
        expect(seg2.startTime).toBeLessThanOrEqual(1.3);
        expect(seg2.duration).toBeGreaterThan(0.2);
    });
});
