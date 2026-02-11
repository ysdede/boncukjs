import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';

describe('AudioEngine Visualization', () => {
    let engine: AudioEngine;

    beforeEach(() => {
        // Create engine with default config (16kHz sample rate)
        engine = new AudioEngine({
            sampleRate: 16000
        });
    });

    /**
     * Helper to inject audio data into the engine via private method handleAudioChunk.
     */
    function injectAudio(chunk: Float32Array, sampleRate: number = 16000) {
        // Access private method
        (engine as any).handleAudioChunk(chunk, undefined, sampleRate);
    }

    it('should initialize with empty visualization data', () => {
        const data = engine.getVisualizationData(100);
        expect(data).toBeInstanceOf(Float32Array);
        expect(data.length).toBe(200); // 100 * 2 (min/max)
        expect(data.every(v => v === 0)).toBe(true);
    });

    it('should update visualization data when audio is injected', () => {
        // Create a chunk with known values (e.g., constant 0.5)
        const chunk = new Float32Array(1600); // 0.1s at 16kHz
        chunk.fill(0.5);

        injectAudio(chunk);

        // Request 100 points
        const data = engine.getVisualizationData(100);

        // Since we filled with 0.5, min and max should reflect that (or close to it)
        // Note: The visualization summary might not cover the whole buffer yet,
        // but the part that was written should have 0.5.
        // The buffer is 30s long. We injected 0.1s.
        // So most of the buffer is still 0.
        // But the *start* of the buffer (oldest) is where we write?
        // Wait, visualizationSummaryPosition starts at 0.
        // We write to it and increment.
        // So the *newest* data is at the beginning of the circular buffer?
        // No, we write at `visualizationSummaryPosition` and increment.
        // So 0..N is the data we just wrote (chronologically oldest in the buffer? No, oldest in history terms?)
        // `updateVisualizationBuffer` writes at `visualizationSummaryPosition`.
        // `getVisualizationData` reads from `visualizationSummaryPosition + s` (modulo size).
        // Since `visualizationSummaryPosition` is the NEXT write index, it is also the OLDEST data index in the circular buffer.
        // So `visualizationSummaryPosition` points to the start of the chronological sequence.

        // After writing 0.1s (which is very small compared to 30s),
        // we wrote some points.
        // 0.1s / 30s = 1/300th of the buffer.
        // VIS_SUMMARY_SIZE = 2000.
        // We wrote roughly 2000 / 300 = 6.6 points.

        // The data returned by `getVisualizationData` is unwrapped.
        // So the last few points (most recent) should be 0.5.
        // The first points (oldest) should be 0 (initial state).
        // Wait, if we just started, the buffer was all 0.
        // We wrote new data.
        // The "oldest" data in the ring buffer is actually the data we HAVEN'T written to yet (still 0),
        // followed by the data we JUST wrote (0.5) at the END of the chronological sequence?

        // Let's trace:
        // Summary size 2000. Pos = 0.
        // Write 6 points. Pos becomes 6.
        // Unwrapping loop: s goes from 0 to 2000.
        // index = (Pos + s) % 2000.
        // s=0 -> index 6 (0.0) -> Oldest (relative to now)
        // ...
        // s=1993 -> index (6 + 1993) % 2000 = 1999 (0.0)
        // s=1994 -> index (6 + 1994) % 2000 = 0 (0.5) -> Newest data starts appearing?
        // s=1999 -> index (6 + 1999) % 2000 = 5 (0.5) -> Most recent point.

        // So the last points in `data` should be 0.5.

        // Check the last point (max value)
        const lastMax = data[data.length - 1]; // index 199
        // 100 points requested.
        // If we only have ~7 points of data out of 2000, that's 0.35% of the timeline.
        // 100 points -> each point covers 1%.
        // So only the last point might show it?

        // Let's inject more data to be sure. Inject 15 seconds (half buffer).
        const bigChunk = new Float32Array(16000 * 15);
        bigChunk.fill(0.8);
        injectAudio(bigChunk);

        const data2 = engine.getVisualizationData(100);
        // Now half the buffer is 0.8.
        // The last 50 points (approx) should be 0.8.

        const lastIdx = data2.length - 1;
        expect(data2[lastIdx]).toBeCloseTo(0.8, 4);
        expect(data2[lastIdx - 1]).toBeCloseTo(0.8, 4); // min

        // The beginning should still be 0 (from initialization)
        // Wait, did we overwrite the 0.5s?
        // We wrote 0.1s of 0.5, then 15s of 0.8.
        // Total 15.1s. Still half buffer.
        // So the oldest data (index 0 of output) should be 0.
        expect(data2[0]).toBe(0);
        expect(data2[1]).toBe(0);
    });

    it('should clamp requested width to summary size', () => {
        // Summary size is 2000.
        // Request 3000 points.
        const data = engine.getVisualizationData(3000);
        expect(data.length).toBe(4000); // 2000 * 2
    });

    it('should reset visualization data', () => {
        // Inject data
        const chunk = new Float32Array(16000);
        chunk.fill(1.0);
        injectAudio(chunk);

        const dataBefore = engine.getVisualizationData(100);
        // Verify we have some 1.0s
        const maxVal = Math.max(...dataBefore);
        expect(maxVal).toBeCloseTo(1.0);

        // Reset
        engine.reset();

        const dataAfter = engine.getVisualizationData(100);
        // Should be all zeros
        const maxValAfter = Math.max(...dataAfter);
        expect(maxValAfter).toBe(0);
    });

    it('should handle wrapping correctly', () => {
        // VIS_SUMMARY_SIZE is 2000.
        // Buffer duration 30s.
        // Fill the entire buffer with 0.2
        const chunk1 = new Float32Array(16000 * 30);
        chunk1.fill(0.2);
        injectAudio(chunk1);

        // Now fill 1 second with 0.9. This should wrap around and overwrite the oldest 0.2s.
        const chunk2 = new Float32Array(16000 * 1);
        chunk2.fill(0.9);
        injectAudio(chunk2);

        // Get full resolution data (2000 points)
        const data = engine.getVisualizationData(2000);

        // Chronologically:
        // We had 30s of 0.2.
        // We overwrote the oldest 1s with 0.9.
        // So the buffer contains: [0.9 (1s), 0.2 (29s)]?
        // Wait.
        // We wrote 30s. Buffer is full. Pos wrapped to start (or close).
        // Then we wrote 1s.
        // The visualization buffer is circular history.
        // Newest data overwrites oldest data.
        // So the "Newest" data is the 0.9s.
        // The "Oldest" data is the 0.2s (that wasn't overwritten yet).
        // In the linear output from `getVisualizationData`:
        // Index 0 -> Oldest data
        // Index N -> Newest data

        // So the END of the array should be 0.9.
        // The BEGINNING of the array should be 0.2.

        const lastVal = data[data.length - 1]; // Newest max
        expect(lastVal).toBeCloseTo(0.9);

        const firstVal = data[0]; // Oldest min
        expect(firstVal).toBeCloseTo(0.2);

        // Ensure there is a transition
        let foundTransition = false;
        for (let i = 0; i < data.length; i+=2) {
            if (data[i] > 0.5) {
                foundTransition = true;
                break;
            }
        }
        expect(foundTransition).toBe(true);
    });
});
