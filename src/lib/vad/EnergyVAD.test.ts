import { describe, it, expect, beforeEach } from 'vitest';
import { EnergyVAD } from './EnergyVAD';

describe('EnergyVAD', () => {
    let vad: EnergyVAD;
    const SAMPLE_RATE = 16000;

    beforeEach(() => {
        vad = new EnergyVAD({ sampleRate: SAMPLE_RATE });
    });

    /**
     * Helper to create a mono float32 audio chunk with constant amplitude
     */
    function createChunk(durationSec: number, amplitude: number): Float32Array {
        const numSamples = Math.floor(durationSec * SAMPLE_RATE);
        return new Float32Array(numSamples).fill(amplitude);
    }

    it('initializes with default values', () => {
        // Process a tiny chunk with energy equal to initial noise floor (0.005)
        // to verify the starting value without it drifting away due to adaptation.
        const result = vad.process(createChunk(0.01, 0.005));

        // Initial noise floor is 0.005
        expect(result.noiseFloor).toBeCloseTo(0.005, 5);
        expect(result.isSpeech).toBe(false);
    });

    describe('Noise Floor Adaptation', () => {
        it('adapts quickly initially (fast adaptation)', () => {
            // Initial noise floor is 0.005.
            // Feed silence with lower energy (0.001) for 0.1s
            const chunk = createChunk(0.1, 0.001);
            const result = vad.process(chunk);

            // Logic breakdown:
            // 1. silenceDuration becomes 0.1
            // 2. blendFactor = 0.1 / 1.0 = 0.1
            // 3. adaptationRate = 0.15 * (1 - 0.1) + 0.05 * 0.1
            //                   = 0.15 * 0.9 + 0.005
            //                   = 0.135 + 0.005 = 0.14
            // 4. noiseFloor = 0.005 * (1 - 0.14) + 0.001 * 0.14
            //               = 0.005 * 0.86 + 0.00014
            //               = 0.0043 + 0.00014 = 0.00444

            expect(result.noiseFloor).toBeLessThan(0.005);
            expect(result.noiseFloor).toBeCloseTo(0.00444, 5);
        });

        it('adapts slowly after duration threshold (normal adaptation)', () => {
            // 1. Feed 1.5 seconds of silence to push past fast adaptation phase
            // Using small chunks or one big chunk doesn't matter for the logic,
            // but let's use a few chunks to simulate flow.
            // Using one big chunk for simplicity.
            vad.process(createChunk(1.5, 0.001));

            // The noise floor should be very close to 0.001 now.
            const currentState = vad.process(createChunk(0.01, 0.001));
            const previousNoiseFloor = currentState.noiseFloor!;

            // 2. Change input energy slightly
            const newLevel = 0.002;
            const chunk = createChunk(0.1, newLevel);

            const result = vad.process(chunk);

            // Logic breakdown:
            // silenceDuration > 1.0, so adaptationRate is noiseFloorAdaptationRate (0.05)
            // noiseFloor = previous * (1 - 0.05) + 0.002 * 0.05
            //            = previous * 0.95 + 0.0001

            const expected = previousNoiseFloor * 0.95 + newLevel * 0.05;
            expect(result.noiseFloor).toBeCloseTo(expected, 6);
        });

        it('does not adapt noise floor during speech', () => {
             // Establish a baseline
             vad.process(createChunk(0.1, 0.005));

             // Trigger speech (High Energy)
             // Energy 0.1. Noise floor 0.005. SNR ~ 13dB.
             const speechChunk = createChunk(0.2, 0.1);

             const result1 = vad.process(speechChunk);
             expect(result1.isSpeech).toBe(true);

             // Noise floor should remain at baseline (approx 0.005)
             // It should NOT move towards 0.1
             expect(result1.noiseFloor).toBeCloseTo(0.005, 2);

             // Process another speech chunk
             const result2 = vad.process(speechChunk);
             expect(result2.noiseFloor).toBeCloseTo(0.005, 2);
        });

        it('resets adaptation (silence duration) after speech', () => {
             // 1. Trigger speech
             const speechChunk = createChunk(0.2, 0.1);
             vad.process(speechChunk);

             // 2. Go back to silence.
             // silenceDuration should have been reset to 0 in the previous step (in the else block of isSpeech).
             // Wait, if isSpeech is TRUE, silenceDuration = 0.

             // Now process a silence chunk.
             const silenceChunk = createChunk(0.1, 0.001);

             // logic:
             // !isSpeech (true for this chunk)
             // silenceDuration += 0.1 -> 0.1
             // blendFactor = 0.1
             // rate = ~0.14 (fast)

             const result = vad.process(silenceChunk);

             // If it was slow rate (0.05), result would be around 0.0048 (assuming start from 0.005)
             // With fast rate (0.14), result is around 0.00444

             expect(result.noiseFloor).toBeCloseTo(0.00444, 4);
        });
    });

    describe('VAD Logic', () => {
        it('detects speech based on energy threshold', () => {
            // Default energyThreshold 0.02
            // Create chunk with 0.03 amplitude
            // Duration 200ms > minSpeechDuration 100ms
            const loudChunk = createChunk(0.2, 0.03);
            const result = vad.process(loudChunk);

            expect(result.isSpeech).toBe(true);
            expect(result.speechStart).toBe(true);
        });

        it('detects speech based on SNR (below energy threshold)', () => {
            // Noise floor 0.005
            // SNR Threshold 3dB
            // Energy 0.015 (< 0.02 energy threshold)
            // SNR = 10 * log10(0.015/0.005) = 4.77 dB > 3dB

            const quietSpeech = createChunk(0.2, 0.015);
            const result = vad.process(quietSpeech);

            expect(result.snr).toBeGreaterThan(3);
            expect(result.isSpeech).toBe(true);
        });

        it('respects minSpeechDuration', () => {
            // Short burst of speech (50ms) < 100ms
            const shortBurst = createChunk(0.05, 0.1);
            const result = vad.process(shortBurst);

            expect(result.isSpeech).toBe(false);
        });

        it('respects minSilenceDuration', () => {
            // 1. Activate speech
            vad.process(createChunk(0.2, 0.1));
            expect(vad.process(createChunk(0.01, 0.1)).isSpeech).toBe(true);

            // 2. Short silence (100ms) < minSilenceDuration (300ms)
            const shortSilence = createChunk(0.1, 0);
            const result = vad.process(shortSilence);

            expect(result.isSpeech).toBe(true); // Should stay active
        });

        it('deactivates speech after minSilenceDuration', () => {
            // 1. Activate speech
            vad.process(createChunk(0.2, 0.1));

            // 2. Long silence (400ms) > minSilenceDuration (300ms)
            const longSilence = createChunk(0.4, 0);
            const result = vad.process(longSilence);

            expect(result.isSpeech).toBe(false);
            expect(result.speechEnd).toBe(true);
        });
    });
});
