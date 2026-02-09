const WINDOW_DURATION = 0.080;

class CaptureProcessor extends AudioWorkletProcessor {
    private inputSampleRate: number;
    private targetSampleRate: number;
    private ratio: number;
    private bufferSize: number;
    private buffer: Float32Array;
    private index: number;
    private _lastLog: number;

    constructor(options: any) {
        super(options);
        const opts = options?.processorOptions || {};
        this.inputSampleRate = opts.inputSampleRate || 16000;
        this.targetSampleRate = opts.targetSampleRate || this.inputSampleRate;
        this.ratio = this.inputSampleRate / this.targetSampleRate;
        this.bufferSize = Math.round(WINDOW_DURATION * this.inputSampleRate);
        this.buffer = new Float32Array(this.bufferSize);
        this.index = 0;
        this._lastLog = 0;
    }

    _emitChunk() {
        let out: Float32Array;
        let maxAbs = 0;

        if (this.targetSampleRate === this.inputSampleRate) {
            out = new Float32Array(this.bufferSize);
            for (let i = 0; i < this.bufferSize; i++) {
                const v = this.buffer[i];
                out[i] = v;
                const a = v < 0 ? -v : v;
                if (a > maxAbs) maxAbs = a;
            }
        } else {
            const outLength = Math.floor(this.bufferSize / this.ratio);
            out = new Float32Array(outLength);
            for (let i = 0; i < outLength; i++) {
                const srcIndex = i * this.ratio;
                const srcIndexFloor = Math.floor(srcIndex);
                const srcIndexCeil = Math.min(srcIndexFloor + 1, this.bufferSize - 1);
                const t = srcIndex - srcIndexFloor;
                const v = this.buffer[srcIndexFloor] * (1 - t) + this.buffer[srcIndexCeil] * t;
                out[i] = v;
                const a = v < 0 ? -v : v;
                if (a > maxAbs) maxAbs = a;
            }
        }

        this.port.postMessage(
            { type: 'audio', samples: out, sampleRate: this.targetSampleRate, maxAbs },
            [out.buffer]
        );
    }

    process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0];

        // Buffer the data
        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.index++] = channelData[i];

            if (this.index >= this.bufferSize) {
                this._emitChunk();
                this.index = 0;

                // Debug log every ~5 seconds
                const now = Date.now();
                if (now - this._lastLog > 5000) {
                    this.port.postMessage({ type: 'log', message: '[AudioWorklet] Active' });
                    this._lastLog = now;
                }
            }
        }

        return true;
    }
}

registerProcessor('capture-processor', CaptureProcessor);
