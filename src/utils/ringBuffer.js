/*
 * RingBuffer – fixed-size circular buffer for PCM audio samples
 * ---------------------------------------------------------------------------
 *  • Stores the most-recent <durationSeconds> seconds of mono PCM data.
 *  • Addressed exclusively in GLOBAL FRAME OFFSETS (0 … ∞).
 *  • When incoming data exceeds the capacity (durationSeconds · sampleRate
 *    frames) the oldest samples are transparently overwritten.
 *
 *  Public API (all time values expressed in FRAMES unless stated otherwise):
 *
 *      constructor RingBuffer(durationSeconds:number, sampleRate:number)
 *          – durationSeconds … maximum buffer length in seconds (eg 120)
 *          – sampleRate       … input sample-rate in Hz (eg 48000)
 *
 *      write(chunk:Float32Array): void
 *          – Appends the PCM frames contained in `chunk` to the buffer.
 *
 *      read(startFrame:number, endFrame:number): Float32Array
 *          – Returns a new Float32Array containing frames in the half-open
 *            interval [startFrame, endFrame). If   startFrame < baseFrameOffset
 *            (i.e. data already overwritten) an Error is thrown.
 *
 *      getCurrentFrame(): number
 *          – Global frame offset of the NEXT frame that will be written. The
 *            newest valid sample currently in the buffer is
 *              getCurrentFrame() – 1
 *
 *      getCurrentTime(): number
 *          – Same as getCurrentFrame() but converted to seconds.
 *
 *      getBaseFrameOffset(): number
 *          – Global frame offset corresponding to the first valid sample that
 *            is still stored in the buffer.
 *
 *  All operations are O(n) in the length of the requested chunk (read/write)
 *  and O(1) otherwise.  The implementation is entirely self-contained and has
 *  no external dependencies.
 * ---------------------------------------------------------------------------
 */

export class RingBuffer {
    /**
     * @param {number} durationSeconds – maximum length of the buffer in seconds
     * @param {number} sampleRate      – sample-rate of the audio stream (Hz)
     */
    constructor(durationSeconds, sampleRate) {
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            throw new Error('RingBuffer: durationSeconds must be a positive number');
        }
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
            throw new Error('RingBuffer: sampleRate must be a positive number');
        }
        this.sampleRate = sampleRate;
        this.maxFrames = Math.round(durationSeconds * sampleRate);
        if (this.maxFrames <= 0) {
            throw new Error('RingBuffer: resulting maxFrames must be > 0');
        }

        // Backing store holding exactly `maxFrames` mono samples.
        this._buffer = new Float32Array(this.maxFrames);

        // Global bookkeeping --------------------------------------------------
        this._totalFramesWritten = 0;   // Increases monotonically – uint64 safe
        // (The following properties are derived but cached for convenience)
        this._writeIndex = 0;           // Next position to be written (0 ≤ … < maxFrames)
        this._baseFrameOffset = 0;      // Global frame offset of _buffer[0]
    }

    // --------------------------------------------------------------------- //
    //  Public API                                                           //
    // --------------------------------------------------------------------- //

    /**
     * Appends `chunk` (mono PCM frames) to the buffer.
     * @param {Float32Array} chunk
     */
    write(chunk) {
        if (!(chunk instanceof Float32Array)) {
            throw new TypeError('RingBuffer.write: chunk must be a Float32Array');
        }
        const framesToWrite = chunk.length;
        if (framesToWrite === 0) return;

        let srcOffset = 0;
        let framesRemaining = framesToWrite;

        while (framesRemaining > 0) {
            const writePos = this._writeIndex; // Always up-to-date
            const spaceAtEnd = this.maxFrames - writePos;
            const framesNow = Math.min(framesRemaining, spaceAtEnd);

            // Copy contiguous block
            this._buffer.set(chunk.subarray(srcOffset, srcOffset + framesNow), writePos);

            // Update cursors
            srcOffset += framesNow;
            framesRemaining -= framesNow;
            this._writeIndex = (writePos + framesNow) % this.maxFrames;
        }

        // Global counters ----------------------------------------------------
        this._totalFramesWritten += framesToWrite;
        // Old data may have been overwritten → recalc baseFrameOffset
        this._baseFrameOffset = Math.max(0, this._totalFramesWritten - this.maxFrames);
    }

    /**
     * Returns a copy of the samples in the half-open interval [startFrame, endFrame).
     * @param {number} startFrame – inclusive global frame offset
     * @param {number} endFrame   – exclusive global frame offset
     */
    read(startFrame, endFrame) {
        if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)) {
            throw new TypeError('RingBuffer.read: frame indices must be integers');
        }
        if (startFrame < 0 || endFrame < 0 || endFrame < startFrame) {
            throw new RangeError('RingBuffer.read: invalid frame range');
        }
        if (endFrame > this._totalFramesWritten) {
            throw new RangeError('RingBuffer.read: endFrame is in the future');
        }
        if (startFrame < this._baseFrameOffset) {
            throw new RangeError('RingBuffer.read: data before startFrame has been overwritten');
        }

        const framesRequested = endFrame - startFrame;
        if (framesRequested === 0) return new Float32Array(0);

        const result = new Float32Array(framesRequested);

        const startIdx = startFrame % this.maxFrames;
        const contiguous = Math.min(framesRequested, this.maxFrames - startIdx);

        // First contiguous part
        result.set(this._buffer.subarray(startIdx, startIdx + contiguous), 0);

        // If wrap-around required copy second part
        const remaining = framesRequested - contiguous;
        if (remaining > 0) {
            result.set(this._buffer.subarray(0, remaining), contiguous);
        }

        return result;
    }

    /** Global frame offset of the *next* sample that will be written. */
    getCurrentFrame() {
        return this._totalFramesWritten;
    }

    /** Same as getCurrentFrame() but converted to seconds. */
    getCurrentTime() {
        return this._totalFramesWritten / this.sampleRate;
    }

    /** Oldest valid global frame offset still stored in the buffer. */
    getBaseFrameOffset() {
        return this._baseFrameOffset;
    }

    /** Returns the underlying backing store (for advanced diagnostics). */
    getInternalBuffer() {
        return this._buffer;
    }
}

// Default export for convenience
export default RingBuffer; 