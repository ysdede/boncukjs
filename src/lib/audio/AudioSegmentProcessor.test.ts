import { describe, it, expect, beforeEach } from 'vitest';
import { AudioSegmentProcessor } from './AudioSegmentProcessor';

describe('AudioSegmentProcessor', () => {
    let processor: AudioSegmentProcessor;
    const sampleRate = 16000;
    // Default window duration is 0.08s (80ms), so 1280 samples at 16k
    const windowSize = 1280;

    // Helper to create a silence chunk
    const createSilenceChunk = () => new Float32Array(windowSize).fill(0);

    // Helper to create a speech chunk
    const createSpeechChunk = () => new Float32Array(windowSize).fill(0.5);

    beforeEach(() => {
        processor = new AudioSegmentProcessor({
            sampleRate,
            logger: () => {} // Silence logs
        });
    });

    it('should initialize with default options', () => {
        const stats = processor.getStats();
        expect(stats).toBeDefined();
        expect(stats.noiseFloor).toBeGreaterThan(0);

        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
        expect(state.speechStartTime).toBeNull();
    });

    it('should update noise floor during silence', () => {
        // Initial noise floor is 0.005 (from reset)
        // Feed silence (energy = 0.0001)
        const chunk = createSilenceChunk();
        const energy = 0.0001;

        // Process a few seconds of silence
        // Each chunk is 0.08s. 20 chunks = 1.6s
        for (let i = 0; i < 20; i++) {
            processor.processAudioData(chunk, i * 0.08, energy);
        }

        const state = processor.getStateInfo();
        // Noise floor should adapt towards 0.0001
        expect(state.noiseFloor).toBeLessThan(0.005);
        expect(state.noiseFloor).toBeGreaterThan(0);
    });

    it('should detect speech onset (transition from silence)', () => {
        const chunk = createSpeechChunk();

        // 1. Establish silence/noise floor
        // Pre-fill with silence to stabilize noise floor
        for (let i = 0; i < 10; i++) {
            processor.processAudioData(createSilenceChunk(), i * 0.08, 0.001);
        }

        // 2. Sudden speech (energy = 0.5)
        // Default audioThreshold is usually around 0.06 (slow) to 0.12 (fast).
        // 0.5 is safely above.

        const startTime = 10 * 0.08;
        const segments = processor.processAudioData(chunk, startTime, 0.5);

        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(true);
        expect(state.speechStartTime).toBeDefined();
        // Speech start might be adjusted by lookback, but should be close to startTime
        // Lookback logic might push it earlier if previous chunks had rising energy,
        // but here we jump from silence (0.001) to speech (0.5), so it should detect immediately or slightly before due to lookback window.
        expect(state.speechStartTime).toBeLessThanOrEqual(startTime);
    });

    it('should detect speech offset (transition to silence)', () => {
        // Configure short silence threshold for testing
        // 0.16s = 2 chunks of 80ms
        processor = new AudioSegmentProcessor({
            sampleRate,
            silenceThreshold: 0.16,
            logger: () => {}
        });

        const speechChunk = createSpeechChunk();
        const silenceChunk = createSilenceChunk();

        // 1. Start Speech
        processor.processAudioData(speechChunk, 0, 0.5);
        expect(processor.getStateInfo().inSpeech).toBe(true);

        // 2. Continue Speech
        processor.processAudioData(speechChunk, 0.08, 0.5);
        expect(processor.getStateInfo().inSpeech).toBe(true);

        // 3. Silence 1 (0.08s) - not enough yet (threshold 0.16s)
        let segments = processor.processAudioData(silenceChunk, 0.16, 0.0001);
        expect(processor.getStateInfo().inSpeech).toBe(true);
        expect(segments.length).toBe(0);

        // 4. Silence 2 (0.16s) - threshold reached (>= 2 chunks)
        // Note: The processor logic uses `silenceCounter` which increments on every non-speech frame.
        // `chunksNeeded` for 0.16s / 0.08s window is 2.
        // First silence frame: counter=1. 1 < 2 -> wait.
        // Second silence frame: counter=2. 2 >= 2 -> end speech.
        segments = processor.processAudioData(silenceChunk, 0.24, 0.0001);

        expect(processor.getStateInfo().inSpeech).toBe(false);
        expect(segments.length).toBe(1);
        expect(segments[0].duration).toBeGreaterThan(0);
        // Duration should cover the speech part (0 to 0.16 roughly)
        // Expected duration: 0.16 (2 speech frames) approx.
        expect(segments[0].endTime).toBeGreaterThan(segments[0].startTime);
    });

    it('should proactively split long segments', () => {
        const maxDuration = 0.4; // Set small max duration for testing (5 chunks)
        processor = new AudioSegmentProcessor({
            sampleRate,
            maxSegmentDuration: maxDuration,
            logger: () => {}
        });

        const chunk = createSpeechChunk();
        const energy = 0.5;

        // Feed continuous speech
        let segmentsFound = 0;

        // Feed 10 chunks (0.8s), should trigger split at 0.4s
        for (let i = 0; i < 10; i++) {
            const time = i * 0.08;
            const segments = processor.processAudioData(chunk, time, energy);
            if (segments.length > 0) {
                segmentsFound += segments.length;
                // Verify segment duration is at least maxDuration
                // It splits AFTER exceeding, so it will be 0.4 + 0.08 = 0.48
                segments.forEach(seg => {
                    expect(seg.duration).toBeGreaterThanOrEqual(maxDuration);
                });
            }
        }

        // Should have found at least 1 segment due to splitting
        expect(segmentsFound).toBeGreaterThan(0);
        // And we should still be in speech state for the new segment
        expect(processor.getStateInfo().inSpeech).toBe(true);
    });

    it('should calculate statistics correctly', () => {
        processor = new AudioSegmentProcessor({
            sampleRate,
            silenceThreshold: 0.08, // 1 chunk silence to end
            maxSilenceWithinSpeech: 0, // Ensure silence immediately ends speech
            logger: () => {}
        });

        // 1. Speech (0.08s)
        processor.processAudioData(createSpeechChunk(), 0, 0.5);
        // 2. End Speech (Silence)
        processor.processAudioData(createSilenceChunk(), 0.08, 0.0001);

        // Check stats
        const stats = processor.getStats();

        // We should have 1 speech segment recorded in stats history
        // Note: updateStats is called at the end of processAudioData
        expect(stats.speech.avgEnergy).toBeGreaterThan(0);
        expect(stats.speech.avgDuration).toBeGreaterThan(0);
    });

    it('should update configuration via setters', () => {
        processor.setThreshold(0.9);
        // Access private options via `any` casting or just trust the setter if we can't inspect private
        // But we can check behavior. With threshold 0.9, energy 0.5 should be silence.

        const chunk = createSpeechChunk();
        const energy = 0.5;

        // Ensure silence state initially
        processor.reset();

        processor.processAudioData(chunk, 0, energy);
        expect(processor.getStateInfo().inSpeech).toBe(false); // 0.5 < 0.9

        processor.setThreshold(0.1);
        processor.processAudioData(chunk, 0.08, energy);
        expect(processor.getStateInfo().inSpeech).toBe(true); // 0.5 > 0.1
    });

    it('should reset state correctly', () => {
        // Start some speech
        processor.processAudioData(createSpeechChunk(), 0, 0.5);
        expect(processor.getStateInfo().inSpeech).toBe(true);

        processor.reset();

        const state = processor.getStateInfo();
        expect(state.inSpeech).toBe(false);
        expect(state.speechStartTime).toBeNull();
        expect(state.noiseFloor).toBe(0.005); // Reset default
    });
});
