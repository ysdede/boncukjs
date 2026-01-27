import { AudioStitcher } from './AudioStitcher.js';

/**
 * @fileoverview Manages the audio buffer for a single transcription session,
 * mirroring the logic from the Python backend's AudioBuffer.
 */
export class SessionBuffer {
  /**
   * @param {object} config
   * @param {string} config.sessionId
   * @param {number} config.sampleRate
   * @param {number} [config.maxTranscriptionDuration=45.0] Max duration of audio to process per cycle.
   */
  constructor({ sessionId, sampleRate, maxTranscriptionDuration = 45.0 }) {
    this.sessionId = sessionId;
    this.sampleRate = sampleRate;
    this.maxTranscriptionDuration = maxTranscriptionDuration;

    /** @type {Array<{audio: Float32Array, seqId: number, startTime: number, endTime: number}>} */
    this.segments = [];
    
    /** @type {Float32Array} */
    this.completeAudio = new Float32Array(0);
    this.bufferStartTime = 0.0;

    this.stitcher = new AudioStitcher({ sampleRate });
  }

  /**
   * Adds a new audio segment and rebuilds the complete buffer.
   * @param {{audio: Float32Array, seqId: number, startTime: number, endTime: number}} segment
   */
  addSegment(segment) {
    this.segments.push(segment);
    // Keep segments sorted by start time, essential for the stitcher
    this.segments.sort((a, b) => a.startTime - b.startTime);

    this.rebuildCompleteBuffer();
  }

  rebuildCompleteBuffer() {
    if (this.segments.length === 0) return;

    const segmentTuples = this.segments.map(s => [s.audio, s.seqId, s.startTime, s.endTime]);
    const { stitchedAudio, absoluteStartTime } = this.stitcher.stitch(segmentTuples);

    this.completeAudio = stitchedAudio;
    this.bufferStartTime = absoluteStartTime;
  }
  
  /**
   * Gets the recent portion of the audio buffer for transcription.
   * @param {number} matureCursorTime - The timestamp up to which transcription is considered stable.
   * @returns {{audioToProcess: Float32Array, windowStartTime: number}|null}
   */
  getTranscriptionWindow(matureCursorTime = 0) {
    if (this.completeAudio.length === 0) {
      return null;
    }

    const totalBufferDuration = this.completeAudio.length / this.sampleRate;
    
    // Convert absolute mature cursor time to be relative to our buffer's start
    const relativeMatureCursor = matureCursorTime - this.bufferStartTime;

    let transcribeFromRelative = 0;
    if (relativeMatureCursor > 0) {
      transcribeFromRelative = relativeMatureCursor;
    }
    
    // The window starts at the latest of:
    // 1. The mature cursor position.
    // 2. The start of the last `maxTranscriptionDuration` seconds of the buffer.
    const windowStartTimeRelative = Math.max(
      transcribeFromRelative,
      totalBufferDuration - this.maxTranscriptionDuration
    );

    const startSample = Math.floor(windowStartTimeRelative * this.sampleRate);
    
    if (startSample >= this.completeAudio.length) {
      console.log("No new audio to transcribe based on windowing.");
      return null;
    }
    
    const audioToProcess = this.completeAudio.subarray(startSample);
    
    // This is the absolute time corresponding to the start of the returned audio slice
    const windowStartTimeAbsolute = this.bufferStartTime + windowStartTimeRelative;

    return {
      audioToProcess,
      windowStartTime: windowStartTimeAbsolute,
    };
  }

  /**
   * Returns a LC window ending at the given absolute end time.
   * @param {number} endTimeAbs - Absolute end time in seconds (e.g., current segment end).
   * @param {number} leftContextSeconds - How many seconds of left context to include.
   * @returns {{audioToProcess: Float32Array, windowStartTime: number}|null}
   */
  getWindowEndingAt(endTimeAbs, leftContextSeconds = 2.4) {
    if (this.completeAudio.length === 0) return null;

    const startAbs = Math.max(this.bufferStartTime, endTimeAbs - Math.max(0, leftContextSeconds));
    const startRel = startAbs - this.bufferStartTime;
    const endRel = endTimeAbs - this.bufferStartTime;

    const startSample = Math.max(0, Math.floor(startRel * this.sampleRate));
    const endSample = Math.min(this.completeAudio.length, Math.ceil(endRel * this.sampleRate));

    if (endSample <= startSample) return null;

    const audioToProcess = this.completeAudio.subarray(startSample, endSample);
    return { audioToProcess, windowStartTime: startAbs };
  }

  reset() {
    this.segments = [];
    this.completeAudio = new Float32Array(0);
    this.bufferStartTime = 0.0;
    console.log(`SessionBuffer for ${this.sessionId} reset.`);
  }
} 