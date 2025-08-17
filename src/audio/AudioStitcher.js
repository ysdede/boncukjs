/**
 * @fileoverview Port of the Python AudioStitcher to JavaScript.
 * Handles stitching of audio segments based on their absolute start and end times.
 */

const DEFAULT_FIXED_SILENCE_S = 0.0; // Default to no silence insertion

/**
 * Rounds a time value to a consistent precision.
 * @param {number} timeValue
 * @returns {number}
 */
function roundTime(timeValue) {
  return Math.round(timeValue * 100) / 100;
}

export class AudioStitcher {
  /**
   * @param {object} config
   * @param {number} config.sampleRate The sample rate of the audio segments (e.g., 16000).
   * @param {number} [config.fixedSilenceDurationS=0.0] The fixed duration of silence (in seconds) to insert for any gap.
   */
  constructor({ sampleRate, fixedSilenceDurationS = DEFAULT_FIXED_SILENCE_S }) {
    if (!sampleRate || typeof sampleRate !== 'number' || sampleRate <= 0) {
      throw new Error("sampleRate must be a positive integer.");
    }
    if (fixedSilenceDurationS < 0) {
      throw new Error("fixedSilenceDurationS must be non-negative.");
    }

    this.sampleRate = sampleRate;
    this.fixedSilenceDurationS = roundTime(fixedSilenceDurationS);
    this.fixedSilenceSamples = Math.floor(this.fixedSilenceDurationS * this.sampleRate);

    console.log(`AudioStitcher initialized (Rate: ${this.sampleRate} Hz, Fixed Silence: ${this.fixedSilenceDurationS}s)`);
  }

  /**
   * Stitches multiple audio segments together based on their timing.
   * The segments list MUST be sorted chronologically by start_time.
   *
   * @param {Array<[audio: Float32Array, seqId: number, startTime: number, endTime: number]>} segments
   * @returns {{stitchedAudio: Float32Array, absoluteStartTime: number}}
   */
  stitch(segments) {
    if (!segments || segments.length === 0) {
      console.warn("stitch called with empty segments list.");
      return { stitchedAudio: new Float32Array(0), absoluteStartTime: 0.0 };
    }

    // Note: Python version checks for sorting. Assuming JS caller sorts correctly.

    const absoluteStartTime = segments[0][2];
    const outputBufferList = [];
    let prevEndTime = segments[0][2]; // Initialize with the first segment's start time

    for (let i = 0; i < segments.length; i++) {
      const [audio, seqId, startTime, endTime] = segments[i];

      const segmentDuration = audio.length / this.sampleRate;
      if (audio.length === 0 || segmentDuration <= 0) {
        console.warn(`Segment ${seqId} (Index ${i}): Empty audio data. Skipping.`);
        prevEndTime = Math.max(prevEndTime, endTime);
        continue;
      }

      let segmentToAdd = audio;
      const timeTolerance = 1e-6;

      // Case 1: Gap
      if (startTime > prevEndTime + timeTolerance) {
        if (this.fixedSilenceSamples > 0) {
          outputBufferList.push(new Float32Array(this.fixedSilenceSamples));
        }
      }
      // Case 2: Overlap
      else if (startTime < prevEndTime - timeTolerance) {
        const overlapDuration = prevEndTime - startTime;
        const overlapSamples = Math.floor(overlapDuration * this.sampleRate);
        
        if (overlapSamples >= audio.length) {
          segmentToAdd = null; // Overlap is >= segment, skip
        } else {
          segmentToAdd = audio.subarray(overlapSamples);
        }
      }
      // Case 3: Adjacent - do nothing, use full segmentToAdd

      if (segmentToAdd && segmentToAdd.length > 0) {
        outputBufferList.push(segmentToAdd);
      }
      
      prevEndTime = Math.max(prevEndTime, endTime);
    }

    if (outputBufferList.length === 0) {
      return { stitchedAudio: new Float32Array(0), absoluteStartTime };
    }

    // Concatenate all parts
    const totalLength = outputBufferList.reduce((acc, val) => acc + val.length, 0);
    const stitchedAudio = new Float32Array(totalLength);
    let offset = 0;
    for (const buffer of outputBufferList) {
      stitchedAudio.set(buffer, offset);
      offset += buffer.length;
    }
    
    console.log(`Stitching complete. Processed ${segments.length} segments. Final duration: ${(stitchedAudio.length / this.sampleRate).toFixed(2)}s`);
    
    return { stitchedAudio, absoluteStartTime };
  }
} 