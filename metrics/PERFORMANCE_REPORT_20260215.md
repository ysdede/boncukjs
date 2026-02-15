# Performance Analysis Report - Keet Token Timeline
**Date:** February 15, 2026
**Trace File:** `Trace-20260215T021055.json`
**Status:** High CPU usage observed after a few seconds of recording.

## Executive Summary
The application suffers from **Main Thread Layout Thrashing** and **Worker Garbage Collection (GC) pressure**. The most critical issue is a forced synchronous layout triggered every frame in the waveform visualization, which blocks the event loop for up to 128ms, subsequently causing jitter in the AudioWorklet and transcription delays.

---

## 1. Main Thread Bottlenecks

### 1.1 Layout Thrashing in `Waveform.tsx` (CRITICAL)
- **Issue:** The `animate` loop in `src/components/Waveform.tsx` calls `getComputedStyle(canvasRef).getPropertyValue(...)` on every frame.
- **Trace Evidence:** Multiple "Forced Style and Layout" events coinciding with `FireAnimationFrame`. `v8.callFunction` tasks taking >100ms.
- **Impact:** Every frame forces the browser to recompute the entire CSS layout tree. This is the primary source of the "heavy CPU" feeling and UI stutter.
- **Recommendation:** Cache the required colors (`--color-earthy-bg`, `--color-primary`) during `onMount` or via a `ResizeObserver` callback. Do not read them inside the `requestAnimationFrame` loop.

### 1.2 Main Thread Blockage Impact on AudioWorklet
- **Issue:** AudioWorklet task durations spike to **76ms** (normally <1ms).
- **Trace Evidence:** Max task duration 76.2ms, Max interval 76.3ms.
- **Impact:** When the Main Thread is locked by layout recomputations, the browser's internal task scheduling for workers and worklets is delayed. This leads to audio buffer underruns/overruns and audible glitches.

---

## 2. Transcription Worker Bottlenecks

### 2.1 GC Pressure in `transcription.worker.ts` (HIGH)
- **Issue:** **3,581 GC events** recorded in 28 seconds on Worker-64888.
- **Root Cause:** The `toV5StatePayload` function in `src/lib/transcription/transcription.worker.ts` performs O(N) operations every time a result is prepared. It filters all words, maps them to new token objects, and joins them into strings.
- **Impact:** As the session length increases, the number of objects created per "tick" grows linearly, leading to massive memory churn and frequent "Stop-the-world" GC pauses in the worker.
- **Recommendation:** 
    - Implement incremental updates.
    - Cache `TimelineToken` objects for finalized (stable) words.
    - Only re-map and re-join text for the "draft" (unstable) region of the timeline.

---

## 3. Backend Bottlenecks (`parakeet.js`)

### 3.1 Synchronous Decoder Loop (HIGH)
- **Issue:** The `transcribe` function in `parakeet.js` uses `await` for every token emission step inside its frame loop.
- **Impact:** Each `_runCombinedStep` involves a call to the ONNX Runtime session (joiner). Sequential awaits prevent the browser from batching GPU commands effectively and introduce significant JS-to-WASM/GPU bridge latency accumulated over many tokens.
- **Recommendation:** Explore if multiple frames can be processed in parallel or if the decoder loop can be further optimized to reduce the number of session runs.

### 3.2 Mel Preprocessor Manual MatMul (MEDIUM)
- **Issue:** `mel.js` implements the triangular filterbank multiplication using nested manual loops in JavaScript.
- **Impact:** This is an O(nMels * 257) operation per frame. At 100 fps with 128 bins, this results in ~3.3M multiplications per second on the CPU.
- **Recommendation:** Consider using a TypedArray-optimized dot product or offloading the mel filterbank to a pre-computed ONNX kernel if not using the incremental path.

### 3.3 Memory Churn in `JsPreprocessor`
- **Issue:** `computeRawMel` and `normalizeFeatures` allocate new `Float32Array` objects on every call.
- **Impact:** For long windows (e.g., the 30s buffer), these allocations are large and frequent, contributing to the GC pressure seen in the transcription worker.
- **Recommendation:** Use pre-allocated circular buffers or pool Float32Arrays for the `rawMel` and `features` outputs.

---

## 4. Data Layer & Visualization

### 3.1 Spectrogram Rendering Overhead (MEDIUM)
- **Issue:** `LayeredBufferVisualizer` requests and processes 8 seconds of mel data (~100k floats) every 100ms.
- **Impact:** Even with zero-copy transfers, iterating over 100,000 values to draw pixels on the Main Thread consumes significant CPU.
- **Recommendation:** 
    - Implement a "sliding window" canvas. 
    - Draw only the *newest* mel frames to the edge of the offscreen canvas and use `ctx.drawImage` to shift the existing pixels.

### 3.2 BufferWorker Efficiency (LOW-MEDIUM)
- **Issue:** `CircularLayer.readRange` in `buffer.worker.ts` uses manual loops for copying data.
- **Recommendation:** Use `TypedArray.prototype.set()` and `subarray()` for bulk copies. Optimize `hasSpeechInRange` to return early as soon as the threshold is crossed.

---

## 4. Priority Fix List
1. **[Waveform.tsx]** Remove `getComputedStyle` from animation loop.
2. **[transcription.worker.ts]** Cache stable tokens in `toV5StatePayload`.
3. **[LayeredBufferVisualizer.tsx]** Optimize spectrogram drawing via offscreen canvas pixel shifting.
4. **[buffer.worker.ts]** Optimize range queries with `TypedArray` methods.
