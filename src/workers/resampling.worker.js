/* eslint-disable no-restricted-globals */

// Utility function for timestamped logging
function logWithTimestamp(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [ResamplingWorker] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [ResamplingWorker] ${message}`);
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

// Resampling function
async function resample(audio, from, to) {
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

self.onmessage = async (e) => {
  const { type, data } = e.data || {};

  switch (type) {
    case 'resample': {
      const startTime = performance.now();
      logWithTimestamp(`Starting resampling: ${data.audio.length} samples from ${data.from}Hz to ${data.to}Hz`);
      
      try {
        const { audio, from, to } = data;
        const resampledAudio = await resample(audio, from, to);
        const elapsed = performance.now() - startTime;
        
        logWithTimestamp(`Resampling completed in ${elapsed.toFixed(2)} ms: ${audio.length} -> ${resampledAudio.length} samples`);
        
        // Transfer the buffer back to avoid copying
        self.postMessage({ 
          type: 'resample_complete', 
          data: { 
            audio: resampledAudio,
            originalLength: audio.length,
            resampledLength: resampledAudio.length
          } 
        }, [resampledAudio.buffer]);
      } catch (err) {
        logWithTimestamp('Resampling error:', err);
        self.postMessage({ type: 'error', data: { message: err.message } });
      }
      break;
    }
  }
};