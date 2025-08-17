/* eslint-disable no-restricted-globals */
import { RingBuffer } from '../utils/ringBuffer.js';
import TranscriptionMerger from '../TranscriptionMerger.js';
import { parakeetService } from '../ParakeetService.js';

// --- Audio buffering (fixed-size circular buffer) ---------------------------------
let ringBuffer = null;
const MAX_BUFFER_SECONDS = 180; // keep last 3 minutes of audio inside the worker
let bufferStartAbs = 0;         // absolute timestamp (s) that corresponds to ringBuffer frame 0

// --- Transcription merger ---------------------------------------------------------
const merger = new TranscriptionMerger();
let seqNum = 0; // monotonically-increasing sequence number for merger payloads

let matureCursorTime = 0;
let isTranscribing = false;
let sampleRate = 16000;
let sessionId = 'default';
let isModelReady = false;

function resample(audio, from, to) {
  if (from === to) {
    return audio;
  }

  const ratio = to / from;
  const newLength = Math.round(audio.length * ratio);
  const newAudio = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const t = i / ratio;
    const t0 = Math.floor(t);
    const t1 = Math.ceil(t);
    const dt = t - t0;

    if (t1 >= audio.length) {
      newAudio[i] = audio[t0];
    } else {
      newAudio[i] = (1 - dt) * audio[t0] + dt * audio[t1];
    }
  }

  return newAudio;
}

self.onmessage = async (e) => {
  const { type, data } = e.data || {};

  switch (type) {
    case 'chunk': {
      let { audio, start, end, seqId, rate } = data;

      if (!isModelReady) {
        console.warn('[Worker] Model not ready, skipping chunk.');
        return;
      }

      // ---------------------------------------------------------------------------
      // 1.  Initialise / re-initialise ring buffer if needed
      // ---------------------------------------------------------------------------
      if (!ringBuffer) {
        sampleRate = rate || sampleRate;
        ringBuffer = new RingBuffer(MAX_BUFFER_SECONDS, sampleRate);
        bufferStartAbs = start;
      }

      if (rate && rate !== sampleRate) {
        sampleRate = rate;
        ringBuffer = new RingBuffer(MAX_BUFFER_SECONDS, sampleRate);
        bufferStartAbs = start; // reset alignment
      }

      // ---------------------------------------------------------------------------
      // 2.  Ensure temporal alignment – fill gaps with silence if necessary
      // ---------------------------------------------------------------------------
      const expectedStartAbs = bufferStartAbs + ringBuffer.getCurrentFrame() / sampleRate;
      const tolerance = 1e-3; // 1 ms

      if (start > expectedStartAbs + tolerance) {
        // Gap in the timeline – pad with zeros so absolute times stay aligned
        const gapFrames = Math.round((start - expectedStartAbs) * sampleRate);
        ringBuffer.write(new Float32Array(gapFrames));
      } else if (start < expectedStartAbs - tolerance) {
        // Overlapping / duplicate data. We keep only the non-overlapping tail.
        const overlapSec = expectedStartAbs - start;
        const skipFrames = Math.floor(overlapSec * sampleRate);
        if (skipFrames >= audio.length) {
          // Entire chunk is old – drop it silently
          return;
        }
        // Trim the overlapping prefix
        audio = audio.subarray(skipFrames);
        // Note: start variable stays as original absolute time, but we only care
        // about alignment to expectedStartAbs for write(), which now matches.
      }

      // ---------------------------------------------------------------------------
      // 3.  Write actual audio data (ownership already transferred)
      // ---------------------------------------------------------------------------
      ringBuffer.write(audio);

      // ---------------------------------------------------------------------------
      // 4.  Trigger transcription on the most-recent window
      // ---------------------------------------------------------------------------
      transcribeRecentWindow();
      break;
    }
    case 'cursor': {
      matureCursorTime = data.time || 0;
      break;
    }
    case 'config': {
      console.log('[Worker] Received config, loading model...');
      isModelReady = false;
      try {
        await parakeetService.reloadWithConfig(data);
        isModelReady = true;
        self.postMessage({ type: 'ready' });
        self.postMessage({ type: 'init_complete' });
        console.log('[Worker] Model is loaded and ready.');
      } catch (err) {
        console.error('[Worker] Model load failed:', err);
        self.postMessage({ type: 'error', data: { message: 'Model load failed: ' + err.message } });
      }
      break;
    }
  }
};

async function transcribeRecentWindow() {
  if (isTranscribing || !ringBuffer) return;

  // ---------------------------------------------------------------------------
  // 1.  Determine window [startFrame, endFrame)
  // ---------------------------------------------------------------------------
  const endFrame = ringBuffer.getCurrentFrame();
  if (endFrame === 0) return;

  const windowStartAbs = Math.max(matureCursorTime, (bufferStartAbs + endFrame / sampleRate) - 45);
  let startFrame = Math.floor((windowStartAbs - bufferStartAbs) * sampleRate);
  const baseFrame = ringBuffer.getBaseFrameOffset();
  if (startFrame < baseFrame) {
    startFrame = baseFrame; // clamp to earliest available frame
  }
  if (startFrame >= endFrame) return;

  const audioToProcess = ringBuffer.read(startFrame, endFrame);
  if (audioToProcess.length === 0) return;

  isTranscribing = true;
  try {
    const t0 = performance.now();
    const resampledAudio = resample(audioToProcess, sampleRate, 16000);
    const result = await parakeetService.transcribe(resampledAudio, 16000);
    const elapsed = performance.now() - t0;

    const adjustedWords = result.words.map(w => ({
      ...w,
      start_time: w.start_time + windowStartAbs,
      end_time: w.end_time + windowStartAbs,
    }));

    // --- Feed into merger --------------------------------------------------
    const payload = {
      session_id: sessionId,
      sequence_num: seqNum++,
      words: adjustedWords,
      utterance_text: result.utterance_text ?? '',
      is_final: false,
      metrics: result.metrics ?? null,
    };

    const merged = merger.merge(payload);

    // --- Emit update -------------------------------------------------------
    self.postMessage({
      type: 'merged_transcription_update',
      data: {
        mergedWords: merged.words,
        stats: merged.stats,
        matureCursorTime: merged.matureCursorTime,
        lastSegmentId: payload.sequence_num,
        utterance_text: payload.utterance_text,
        is_final: payload.is_final,
        metrics: payload.metrics,
        timestamp: Date.now(),
      }
    });

    // Also keep old simple message (optional, will be ignored by new UI)
    self.postMessage({
      type: 'result',
      data: {
        words: adjustedWords,
        perf: { totalMs: elapsed, audioSec: audioToProcess.length / sampleRate },
        sessionId,
      }
    });
  } catch (err) {
    self.postMessage({ type: 'error', data: { message: err.message } });
  } finally {
    isTranscribing = false;
  }
} 