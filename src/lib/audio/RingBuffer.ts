import { IRingBuffer } from './types';

/**
 * Fixed-size circular buffer for PCM audio samples.
 * Uses global frame offsets for absolute addressing.
 */
export class RingBuffer implements IRingBuffer {
    readonly sampleRate: number;
    readonly maxFrames: number;
    private buffer: Float32Array;
    private currentFrame: number = 0; // The next frame to be written (global)

    constructor(sampleRate: number, durationSeconds: number) {
        this.sampleRate = sampleRate;
        this.maxFrames = Math.floor(sampleRate * durationSeconds);
        this.buffer = new Float32Array(this.maxFrames);
    }

    /**
     * Append PCM frames to the buffer.
     */
    write(chunk: Float32Array): void {
        const chunkLength = chunk.length;

        // If chunk is larger than buffer (unlikely but handle it), only take the end
        if (chunkLength > this.maxFrames) {
            const start = chunkLength - this.maxFrames;
            this.buffer.set(chunk.subarray(start));
            this.currentFrame += chunkLength;
            return;
        }

        const writePos = this.currentFrame % this.maxFrames;
        const remainingSpace = this.maxFrames - writePos;

        if (chunkLength <= remainingSpace) {
            // Single operation
            this.buffer.set(chunk, writePos);
        } else {
            // Wrap around
            this.buffer.set(chunk.subarray(0, remainingSpace), writePos);
            this.buffer.set(chunk.subarray(remainingSpace), 0);
        }

        this.currentFrame += chunkLength;
    }

    /**
     * Read samples from [startFrame, endFrame).
     * @throws RangeError if data has been overwritten by circular buffer.
     */
    read(startFrame: number, endFrame: number): Float32Array {
        if (startFrame < 0) throw new RangeError('startFrame must be non-negative');
        if (endFrame <= startFrame) return new Float32Array(0);

        const baseFrame = this.getBaseFrameOffset();
        if (startFrame < baseFrame) {
            throw new RangeError(
                `Requested frame ${startFrame} has been overwritten. Oldest available: ${baseFrame}`
            );
        }

        if (endFrame > this.currentFrame) {
            throw new RangeError(
                `Requested frame ${endFrame} is in the future. Latest available: ${this.currentFrame}`
            );
        }

        const length = endFrame - startFrame;
        const result = new Float32Array(length);

        const readPos = startFrame % this.maxFrames;
        const remainingAtEnd = this.maxFrames - readPos;

        if (length <= remainingAtEnd) {
            result.set(this.buffer.subarray(readPos, readPos + length));
        } else {
            result.set(this.buffer.subarray(readPos, this.maxFrames));
            result.set(this.buffer.subarray(0, length - remainingAtEnd), remainingAtEnd);
        }

        return result;
    }

    getCurrentFrame(): number {
        return this.currentFrame;
    }

    getCurrentTime(): number {
        return this.currentFrame / this.sampleRate;
    }

    getBaseFrameOffset(): number {
        return Math.max(0, this.currentFrame - this.maxFrames);
    }

    reset(): void {
        this.currentFrame = 0;
        this.buffer.fill(0);
    }
}
