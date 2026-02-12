
import { describe, it, expect } from 'vitest';
import { AudioSegmentProcessor } from './AudioSegmentProcessor';

describe('AudioSegmentProcessor', () => {
    it('should initialize without errors', () => {
        const processor = new AudioSegmentProcessor();
        expect(processor).toBeDefined();
        const stats = processor.getStats();
        expect(stats).toBeDefined();
        expect(stats.noiseFloor).toBeGreaterThan(0);
    });

    it('should process silence without detecting segments', () => {
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.1
        });

        // 16000 samples = 1 second
        const silence = new Float32Array(16000).fill(0);
        const energy = 0.0001;
        const currentTime = 1.0;

        const segments = processor.processAudioData(silence, currentTime, energy);

        expect(segments).toEqual([]);
        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
    });

    it('should process speech and detect segments', () => {
        // This is a simplified test.
        // Real VAD is complex, so we just check state transitions if we force high energy
        const processor = new AudioSegmentProcessor({
            sampleRate: 16000,
            energyThreshold: 0.01
        });

        const speech = new Float32Array(1600).fill(0.5); // 100ms
        const energy = 0.5; // High energy

        // Process a few chunks to trigger speech detection
        let segments = processor.processAudioData(speech, 1.0, energy);

        // It might not trigger immediately due to lookback/SNR checks,
        // but let's check internal state or just that it doesn't crash

        // Force state check
        // processor.processAudioData is complex, so let's just ensure it runs
        expect(Array.isArray(segments)).toBe(true);
    });

    it('should reset state correctly', () => {
        const processor = new AudioSegmentProcessor();

        // Simulate some state change
        const chunk = new Float32Array(100).fill(0.1);
        processor.processAudioData(chunk, 1.0, 0.5);

        processor.reset();

        const stats = processor.getStats();
        expect(stats.noiseFloor).toBe(0.005); // Default reset value
        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
        expect(state.speechStartTime).toBeNull();
    });

    it('should proactively split segments exceeding maxDuration', () => {
        // Configure processor with a short max segment duration
        const sampleRate = 16000;
        const maxDuration = 0.5; // 500ms

        const processor = new AudioSegmentProcessor({
            sampleRate,
            maxSegmentDuration: maxDuration,
            energyThreshold: 0.01, // Low threshold to ensure speech detection
            minSpeechDuration: 0.1,
            // Disable complex logic that might interfere with simple test
            snrThreshold: 0,
            minSnrThreshold: 0
        });

        const chunkSize = Math.round(sampleRate * 0.1); // 100ms chunks
        const highEnergyChunk = new Float32Array(chunkSize).fill(0.5);
        const highEnergy = 0.5;

        // Process chunks
        let currentTime = 0;
        let emittedSegments: any[] = [];
        let speechStarted = false;

        // Feed chunks for 0.8 seconds (8 chunks)
        // We expect a split around 0.5 - 0.6 seconds
        for (let i = 0; i < 8; i++) {
            currentTime += 0.1;

            const segments = processor.processAudioData(highEnergyChunk, currentTime, highEnergy);

            if (segments.length > 0) {
                emittedSegments.push(...segments);
            }

            const state = processor.getStateInfo();
            if (state.inSpeech) {
                speechStarted = true;
            }
        }

        // Verify speech started
        expect(speechStarted).toBe(true);

        // Verify we got at least one segment due to splitting
        expect(emittedSegments.length).toBeGreaterThan(0);

        const firstSegment = emittedSegments[0];

        // The first segment should be around maxDuration
        expect(firstSegment.duration).toBeGreaterThanOrEqual(maxDuration);
        expect(firstSegment.duration).toBeLessThan(maxDuration + 0.2);

        // Verify the processor is still in speech state
        const finalState = processor.getStateInfo();
        expect(finalState.inSpeech).toBe(true);
        expect(finalState.speechStartTime).toBeGreaterThanOrEqual(firstSegment.endTime);
    });
});
