/* eslint-disable no-restricted-globals */
import { RingBuffer } from '../utils/ringBuffer.js';
import TranscriptionMerger from '../TranscriptionMerger.js';
import { parakeetService } from '../ParakeetService.js';

// Utility function for timestamped logging
function logWithTimestamp(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [Worker] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [Worker] ${message}`);
  }
}

// Utility function to yield control back to the event loop
async function yieldControl() {
  return new Promise(resolve => {
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Utility function to process large arrays in chunks with yielding
async function processInChunks(array, chunkSize, processChunk) {
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    await processChunk(chunk, i);
    
    // Yield control periodically
    if (i % (chunkSize * 10) === 0) {
      await yieldControl();
    }
  }
}

// --- Audio buffering (fixed-size circular buffer) ---------------------------------
// Remove internal worker ring buffer; rely on VAD-gated segments stitched by AudioManager
let bufferStartAbs = 0;         // absolute timestamp for current stitched buffer start
let stitchedAudio = new Float32Array(0); // current stitched audio window

// --- Transcription merger ---------------------------------------------------------
const merger = new TranscriptionMerger();
let seqNum = 0; // monotonically-increasing sequence number for merger payloads

let matureCursorTime = 0;
let isTranscribing = false;
let sampleRate = 16000;
let sessionId = 'default';
let isModelReady = false;

// Resampling worker for offloading resampling work
let resamplingWorker = null;
let lastChunkStartAbs = 0;
let lastChunkEndAbs = 0;

// --- Streaming tuning params (configurable) ----------------------------------
let LEFT_CONTEXT_SECONDS = 0.8;        // adaptive; initial value
let LEFT_CONTEXT_MIN = 0.8;            // lower bound for adaptation
let LEFT_CONTEXT_MAX = 2.4;            // upper bound for adaptation
let TRIM_MARGIN_SECONDS = 0.05;        // drop words ending very near the cursor
let DROP_FIRST_BOUNDARY_WORD = true;   // heuristic: drop first in-window word
let WINDOW_SIZE_SECONDS = 30;          // hard clamp as safety (still applied)
let RIGHT_WINDOW_SECONDS = 1.6;        // size of newest chunk portion to decode (Rt)
let MIN_DECODE_SECONDS = 0.8;           // ensure decoder always gets at least this much audio
let INITIAL_BASE_SECONDS = 4.0;         // before first words finalize, allow more base audio

// Adaptive LC controls
let ADAPTIVE_LC_ENABLED = true;
let LC_INC_STEP = 0.2;
let LC_DEC_STEP = 0.2;
let LC_DECAY_STABLE_TICKS = 3; // number of stable updates before decay
let _stableTicks = 0;
let _lastStatsSnapshot = { wordsReplaced: 0, wordsAdded: 0, wordsKeptStable: 0 };

// Patch decode controls
let PATCH_ENABLED = true;
let PATCH_LEFT_SECONDS = 1.0;
let PATCH_RIGHT_SECONDS = 1.2;
let PATCH_COOLDOWN_MS = 750;
let _lastPatchTs = 0;
let _isPatching = false;

self.onmessage = async (e) => {
  const { type, data } = e.data || {};

  switch (type) {
    case 'chunk': {
      let { audio, start, end, seqId, rate } = data;

      if (!isModelReady) {
        logWithTimestamp('Model not ready, skipping chunk.');
        return;
      }

      // ---------------------------------------------------------------------------
      // Maintain a stitched buffer from VAD-gated segments provided by AudioManager
      // ---------------------------------------------------------------------------
      sampleRate = rate || sampleRate;
      if (stitchedAudio.length === 0) {
        bufferStartAbs = start;
        stitchedAudio = audio;
      } else {
        const expectedStartAbs = bufferStartAbs + (stitchedAudio.length / sampleRate);
        const tolerance = 1e-3;
        if (start > expectedStartAbs + tolerance) {
          // Gap: optionally insert tiny fixed silence (disabled by default)
          // For now, just append the new audio
          const newBuffer = new Float32Array(stitchedAudio.length + audio.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(audio, stitchedAudio.length);
          stitchedAudio = newBuffer;
        } else if (start < expectedStartAbs - tolerance) {
          // Overlap: trim overlapped prefix
          const overlapSec = expectedStartAbs - start;
          const skipFrames = Math.floor(overlapSec * sampleRate);
          const trimmed = skipFrames >= audio.length ? new Float32Array(0) : audio.subarray(skipFrames);
          const newBuffer = new Float32Array(stitchedAudio.length + trimmed.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(trimmed, stitchedAudio.length);
          stitchedAudio = newBuffer;
        } else {
          // Aligned: append
          const newBuffer = new Float32Array(stitchedAudio.length + audio.length);
          newBuffer.set(stitchedAudio, 0);
          newBuffer.set(audio, stitchedAudio.length);
          stitchedAudio = newBuffer;
        }
      }
      lastChunkStartAbs = start;
      lastChunkEndAbs = end;

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
      logWithTimestamp('Received config, loading model...');
      isModelReady = false;
      try {
        // Allow tuning params to be passed along with model config
        if (typeof data?.streaming === 'object') {
          const s = data.streaming;
          if (typeof s.leftContextSeconds === 'number') LEFT_CONTEXT_SECONDS = Math.min(Math.max(s.leftContextSeconds, LEFT_CONTEXT_MIN), LEFT_CONTEXT_MAX);
          if (typeof s.leftContextMin === 'number') LEFT_CONTEXT_MIN = s.leftContextMin;
          if (typeof s.leftContextMax === 'number') LEFT_CONTEXT_MAX = s.leftContextMax;
          if (typeof s.trimMarginSeconds === 'number') TRIM_MARGIN_SECONDS = Math.max(0, s.trimMarginSeconds);
          if (typeof s.dropFirstBoundaryWord === 'boolean') DROP_FIRST_BOUNDARY_WORD = s.dropFirstBoundaryWord;
          if (typeof s.windowSeconds === 'number') WINDOW_SIZE_SECONDS = Math.max(5, s.windowSeconds);
          if (typeof s.rightWindowSeconds === 'number') RIGHT_WINDOW_SECONDS = Math.max(0.2, s.rightWindowSeconds);
          if (typeof s.minDecodeSeconds === 'number') MIN_DECODE_SECONDS = Math.max(0.2, s.minDecodeSeconds);
          if (typeof s.initialBaseSeconds === 'number') INITIAL_BASE_SECONDS = Math.max(1.0, s.initialBaseSeconds);
          if (typeof s.adaptiveLcEnabled === 'boolean') ADAPTIVE_LC_ENABLED = s.adaptiveLcEnabled;
          if (typeof s.lcIncStep === 'number') LC_INC_STEP = Math.max(0.05, s.lcIncStep);
          if (typeof s.lcDecStep === 'number') LC_DEC_STEP = Math.max(0.05, s.lcDecStep);
          if (typeof s.lcDecayStableTicks === 'number') LC_DECAY_STABLE_TICKS = Math.max(1, Math.floor(s.lcDecayStableTicks));
          if (typeof s.patchEnabled === 'boolean') PATCH_ENABLED = s.patchEnabled;
          if (typeof s.patchLeftSeconds === 'number') PATCH_LEFT_SECONDS = Math.max(0.2, s.patchLeftSeconds);
          if (typeof s.patchRightSeconds === 'number') PATCH_RIGHT_SECONDS = Math.max(0.2, s.patchRightSeconds);
          if (typeof s.patchCooldownMs === 'number') PATCH_COOLDOWN_MS = Math.max(100, Math.floor(s.patchCooldownMs));
          logWithTimestamp('Updated streaming params', { LEFT_CONTEXT_SECONDS, LEFT_CONTEXT_MIN, LEFT_CONTEXT_MAX, TRIM_MARGIN_SECONDS, DROP_FIRST_BOUNDARY_WORD, WINDOW_SIZE_SECONDS, RIGHT_WINDOW_SECONDS, MIN_DECODE_SECONDS, INITIAL_BASE_SECONDS });
        }

        await parakeetService.reloadWithConfig(data);
        isModelReady = true;
        self.postMessage({ type: 'ready' });
        self.postMessage({ type: 'init_complete' });
        logWithTimestamp('Model is loaded and ready.');
      } catch (err) {
        logWithTimestamp('Model load failed:', err);
        self.postMessage({ type: 'error', data: { message: 'Model load failed: ' + err.message } });
      }
      break;
    }
    case 'init_resampling_worker': {
      // Initialize the resampling worker
      if (!resamplingWorker) {
        try {
          const ResamplingWorkerModule = data.workerUrl;
          resamplingWorker = new Worker(ResamplingWorkerModule, { type: 'module' });
          resamplingWorker.onmessage = handleResamplingWorkerMessage;
          logWithTimestamp('Resampling worker initialized');
        } catch (err) {
          logWithTimestamp('Failed to initialize resampling worker:', err);
        }
      }
      break;
    }
  }
};

function handleResamplingWorkerMessage(e) {
  const { type, data } = e.data || {};
  
  switch (type) {
    case 'resample_complete': {
      // Handle resampled audio - this would be used in the transcription process
      logWithTimestamp(`Resampling complete: ${data.originalLength} -> ${data.resampledLength} samples`);
      break;
    }
    case 'error': {
      logWithTimestamp('Resampling worker error:', data.message);
      break;
    }
  }
}

async function transcribeRecentWindow() {
  if (isTranscribing || stitchedAudio.length === 0) return;

  const windowStartTime = performance.now();
  logWithTimestamp('Starting transcribeRecentWindow');

  // ---------------------------------------------------------------------------
  // 1.  Determine window [startFrame, endFrame)
  // ---------------------------------------------------------------------------
  const endFrame = Math.floor(stitchedAudio.length);
  if (endFrame === 0) return;

  // Define LC+Rt window strictly for decoding
  const streamEndAbs = bufferStartAbs + (stitchedAudio.length / sampleRate);
  const isBootstrap = !matureCursorTime || matureCursorTime <= 0;
  let desiredStartAbs, desiredEndAbs;

  if (isBootstrap) {
    // Bootstrap: decode a slightly larger base to seed first words
    desiredEndAbs = streamEndAbs;
    desiredStartAbs = Math.max(bufferStartAbs, desiredEndAbs - INITIAL_BASE_SECONDS);
  } else {
    desiredStartAbs = Math.max(bufferStartAbs, matureCursorTime - LEFT_CONTEXT_SECONDS);
    // Ensure we always include at least the latest segment end
    const rightByCursor = matureCursorTime + RIGHT_WINDOW_SECONDS;
    desiredEndAbs = Math.min(streamEndAbs, Math.max(lastChunkEndAbs, rightByCursor));
  }

  // Guarantee a minimum decode duration
  if (desiredEndAbs - desiredStartAbs < MIN_DECODE_SECONDS) {
    const needed = MIN_DECODE_SECONDS - (desiredEndAbs - desiredStartAbs);
    const canExtendEnd = streamEndAbs - desiredEndAbs;
    if (canExtendEnd >= needed) {
      desiredEndAbs = desiredEndAbs + needed;
    } else {
      desiredStartAbs = Math.max(bufferStartAbs, desiredStartAbs - (needed - canExtendEnd));
      desiredEndAbs = streamEndAbs;
    }
  }

  const fallbackStartAbs = Math.max(bufferStartAbs, streamEndAbs - WINDOW_SIZE_SECONDS);
  const windowStartAbs = Math.max(desiredStartAbs, fallbackStartAbs);
  let startFrame = Math.floor((windowStartAbs - bufferStartAbs) * sampleRate);
  if (startFrame < 0) startFrame = 0;
  if (startFrame >= endFrame) return;

  // End frame capped to LC+Rt
  const desiredEndAbsClamped = Math.max(bufferStartAbs, desiredEndAbs);
  let endFrameCapped = Math.floor((desiredEndAbsClamped - bufferStartAbs) * sampleRate);
  if (endFrameCapped <= startFrame || endFrameCapped > endFrame) endFrameCapped = endFrame;
  const audioToProcess = stitchedAudio.subarray(startFrame, endFrameCapped);
  if (audioToProcess.length === 0) return;

  logWithTimestamp(`Read audio data: ${audioToProcess.length} samples, window range: [${startFrame}, ${endFrame})`);

  // Add a small delay to prevent blocking the worker thread completely
  await new Promise(resolve => setTimeout(resolve, 0));

  isTranscribing = true;
  try {
    const t0 = performance.now();
    
    // Use resampling worker if available, otherwise fall back to direct resampling
    let audioForTranscription;
    if (sampleRate !== 16000) {
      if (resamplingWorker) {
        logWithTimestamp(`Sending ${audioToProcess.length} samples to resampling worker`);
        // Send to resampling worker
        const resamplingPromise = new Promise((resolve, reject) => {
          const handleResamplingResponse = (e) => {
            const { type, data } = e.data || {};
            if (type === 'resample_complete') {
              resamplingWorker.removeEventListener('message', handleResamplingResponse);
              resolve(data.audio);
            } else if (type === 'error') {
              resamplingWorker.removeEventListener('message', handleResamplingResponse);
              reject(new Error(data.message));
            }
          };
          
          resamplingWorker.addEventListener('message', handleResamplingResponse);
          resamplingWorker.postMessage({ 
            type: 'resample', 
            data: { 
              audio: audioToProcess,
              from: sampleRate,
              to: 16000
            } 
          }, [audioToProcess.buffer.slice(0)]); // Send a copy to avoid transfer issues
        });
        
        try {
          audioForTranscription = await resamplingPromise;
          logWithTimestamp(`Resampling worker completed: ${audioToProcess.length} -> ${audioForTranscription.length} samples`);
        } catch (resampleError) {
          logWithTimestamp('Resampling worker failed, falling back to direct resampling:', resampleError);
          audioForTranscription = await resampleDirect(audioToProcess, sampleRate, 16000);
        }
      } else {
        // Direct resampling in worker thread
        audioForTranscription = await resampleDirect(audioToProcess, sampleRate, 16000);
      }
    } else {
      audioForTranscription = audioToProcess;
      logWithTimestamp(`No resampling needed: ${audioToProcess.length} samples`);
    }
    
    // Add another small delay before transcription to allow other tasks to run
    await new Promise(resolve => setTimeout(resolve, 0));
    
    logWithTimestamp(`Starting transcription with ${audioForTranscription.length} samples`);
    // Provide incremental hint so decoder can reuse prefix state across calls
    const incOptions = {
      incremental: {
        cacheKey: sessionId + ':' + 'lc-rt',
        prefixSeconds: Math.max(0, Math.min(LEFT_CONTEXT_SECONDS, (bufferStartAbs + endFrame / sampleRate) - windowStartAbs))
      }
    };
    const result = await parakeetService.transcribe(audioForTranscription, 16000, incOptions);
    const elapsed = performance.now() - t0;
    logWithTimestamp(`Transcription completed in ${elapsed.toFixed(2)} ms`);

    const adjustedWords = result.words.map(w => ({
      ...w,
      start_time: w.start_time + windowStartAbs,
      end_time: w.end_time + windowStartAbs,
    }));

    // Trim words that are fully before the mature cursor (plus a small safety margin)
    let wordsForMerge = (matureCursorTime > 0)
      ? adjustedWords.filter(w => (w.end_time > (matureCursorTime + TRIM_MARGIN_SECONDS)))
      : adjustedWords;

    // Optionally drop the very first word inside the window as a boundary heuristic
    if (!isBootstrap && DROP_FIRST_BOUNDARY_WORD && wordsForMerge.length > 0) {
      const first = wordsForMerge[0];
      // Drop if it starts very close to the window start or just after the cursor
      const isBoundary = (first.start_time <= (matureCursorTime + TRIM_MARGIN_SECONDS)) ||
                         (first.start_time - windowStartAbs) <= 0.05;
      if (isBoundary) {
        wordsForMerge = wordsForMerge.slice(1);
      }
    }

    // --- Feed into merger --------------------------------------------------
    const payload = {
      session_id: sessionId,
      sequence_num: seqNum++,
      words: wordsForMerge,
      tokens: result.tokens || [],
      utterance_text: result.utterance_text ?? '',
      is_final: false,
      metrics: result.metrics ?? null,
    };

    logWithTimestamp(`Merging ${wordsForMerge.length} words (trimmed from ${adjustedWords.length})`);
    const merged = merger.merge(payload);
    logWithTimestamp(`Merge completed, ${merged.words.length} words in transcript`);

    // Adaptive LC: analyze churn near the cursor and adjust LC up/down
    if (ADAPTIVE_LC_ENABLED && merged?.stats) {
      const deltaReplaced = Math.max(0, (merged.stats.wordsReplaced || 0) - (_lastStatsSnapshot.wordsReplaced || 0));
      const deltaAdded = Math.max(0, (merged.stats.wordsAdded || 0) - (_lastStatsSnapshot.wordsAdded || 0));
      const churn = deltaReplaced / Math.max(1, deltaAdded + 1);
      if (churn > 0.25) {
        // Unstable boundary -> increase LC
        LEFT_CONTEXT_SECONDS = Math.min(LEFT_CONTEXT_MAX, LEFT_CONTEXT_SECONDS + LC_INC_STEP);
        _stableTicks = 0;
        logWithTimestamp(`Adaptive LC: increased to ${LEFT_CONTEXT_SECONDS.toFixed(2)}s (churn=${churn.toFixed(2)})`);
      } else {
        _stableTicks += 1;
        if (_stableTicks >= LC_DECAY_STABLE_TICKS) {
          const old = LEFT_CONTEXT_SECONDS;
          LEFT_CONTEXT_SECONDS = Math.max(LEFT_CONTEXT_MIN, LEFT_CONTEXT_SECONDS - LC_DEC_STEP);
          if (LEFT_CONTEXT_SECONDS !== old) {
            logWithTimestamp(`Adaptive LC: decreased to ${LEFT_CONTEXT_SECONDS.toFixed(2)}s after stability`);
          }
          _stableTicks = 0;
        }
      }
      _lastStatsSnapshot = { ...merged.stats };
    }

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
    
    const windowElapsed = performance.now() - windowStartTime;
    logWithTimestamp(`transcribeRecentWindow completed in ${windowElapsed.toFixed(2)} ms`);
  } catch (err) {
    logWithTimestamp('Error in transcribeRecentWindow:', err);
    self.postMessage({ type: 'error', data: { message: err.message } });
  } finally {
    isTranscribing = false;

    // Optionally schedule a patch re-decode for the boundary band when instability was detected
    if (PATCH_ENABLED && !_isPatching) {
      const now = performance.now();
      if (now - _lastPatchTs > PATCH_COOLDOWN_MS) {
        const patchStart = Math.max(bufferStartAbs, matureCursorTime - PATCH_LEFT_SECONDS);
        const patchEnd = Math.min(bufferStartAbs + (stitchedAudio.length / sampleRate), matureCursorTime + PATCH_RIGHT_SECONDS);
        if (patchEnd > patchStart) {
          _isPatching = true;
          _lastPatchTs = now;
          try {
            // Ensure no other transcribe runs concurrently with patch
            if (isTranscribing) return; // safety
            isTranscribing = true;
            const ps = Math.floor((patchStart - bufferStartAbs) * sampleRate);
            const pe = Math.floor((patchEnd - bufferStartAbs) * sampleRate);
            const patchAudio = stitchedAudio.subarray(ps, pe);
            let patchAudio16k = patchAudio;
            if (sampleRate !== 16000) {
              patchAudio16k = await resampleDirect(patchAudio, sampleRate, 16000);
            }
            const patchResult = await parakeetService.transcribe(patchAudio16k, 16000, {
              frameStride: 1,
              incremental: { cacheKey: sessionId + ':patch', prefixSeconds: Math.min(LEFT_CONTEXT_SECONDS, PATCH_LEFT_SECONDS) },
              returnTimestamps: true,
              returnConfidences: true,
            });
            const adj = patchResult.words.map(w => ({
              ...w,
              start_time: w.start_time + patchStart,
              end_time: w.end_time + patchStart,
            }));
            const payload = {
              session_id: sessionId,
              sequence_num: seqNum++,
              words: adj,
              utterance_text: patchResult.utterance_text ?? '',
              is_final: false,
              metrics: patchResult.metrics ?? null,
            };
            const mergedPatch = merger.merge(payload);
            self.postMessage({
              type: 'merged_transcription_update',
              data: {
                mergedWords: mergedPatch.words,
                stats: mergedPatch.stats,
                matureCursorTime: mergedPatch.matureCursorTime,
                lastSegmentId: payload.sequence_num,
                utterance_text: payload.utterance_text,
                is_final: payload.is_final,
                metrics: payload.metrics,
                timestamp: Date.now(),
              }
            });
          } catch (e) {
            logWithTimestamp('Patch decode failed', e);
          } finally {
            isTranscribing = false;
            _isPatching = false;
          }
        }
      }
    }
  }
}

// Direct resampling function (fallback)
async function resampleDirect(audio, from, to) {
  if (from === to) {
    return audio;
  }

  const ratio = to / from;
  const newLength = Math.round(audio.length * ratio);
  const newAudio = new Float32Array(newLength);

  // Process in chunks to prevent blocking
  const CHUNK_SIZE = 10000;
  for (let i = 0; i < newLength; i += CHUNK_SIZE) {
    const endIndex = Math.min(i + CHUNK_SIZE, newLength);
    for (let j = i; j < endIndex; j++) {
      const t = j / ratio;
      const t0 = Math.floor(t);
      const t1 = Math.ceil(t);
      const dt = t - t0;

      if (t1 >= audio.length) {
        newAudio[j] = audio[t0];
      } else {
        newAudio[j] = (1 - dt) * audio[t0] + dt * audio[t1];
      }
    }
    
    // Yield control back to the event loop periodically
    if (i % (CHUNK_SIZE * 5) === 0) {
      await yieldControl();
    }
  }

  return newAudio;
}