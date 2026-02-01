/**
 * Simple AudioWorkletProcessor for capturing raw audio chunks.
 * Minimal logic to keep latency low.
 */
class CaptureProcessor extends AudioWorkletProcessor {
    process(inputs: Float32Array[][], _outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        // Use only the first channel (mono)
        const channelData = input[0];

        // Send audio chunk to the main thread
        // We clone the data to avoid issues with SharedArrayBuffer (if not available)
        this.port.postMessage(channelData);

        return true;
    }
}

registerProcessor('capture-processor', CaptureProcessor);
