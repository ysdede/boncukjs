# Parakeet.js Usage and Optimization Report (Keet Integration)

**Date:** February 15, 2026  
**Project:** `N:\github\ysdede\keet-wt-v5-token-timeline`  
**Related library repos:**  
- `N:\github\ysdede\parakeet.js`  
- `N:\github\ysdede\parakeet.js-wt-v5-stream-api`

## Goal
Provide a practical, detailed guide for using Parakeet.js correctly in Keet without long-session CPU drift, with special focus on streaming/transcription hot paths.

## Current Integration Snapshot

1. Keet can load Parakeet from either npm or local alias.
- Switch is controlled in `vite.config.js` via `USE_LOCAL_PARAKEET`: `vite.config.js:8`.
- Local alias target is `../parakeet.js-wt-v5-stream-api`: `vite.config.js:11`.

2. In the profiled session, Parakeet logs came from bundled npm dependency path (`node_modules/.vite/deps/parakeet__js.js`), not from a direct source import.

3. v4 worker currently calls Parakeet with extra output flags and no explicit profiling disable:
- `src/lib/transcription/transcription.worker.ts:688`
- `src/lib/transcription/transcription.worker.ts:695`
- `src/lib/transcription/transcription.worker.ts:696`

4. Parakeet transcribe defaults to profiling enabled:
- `src/parakeet.js` in local Parakeet repo: `src/parakeet.js:487` (`enableProfiling = true`)

5. Parakeet precomputed-features path logs unconditionally:
- `src/parakeet.js:520` (`[Parakeet] Preprocessor: mel-worker ...`)

6. Perf logs print in transcribe when profiling/debug is active:
- `src/parakeet.js:784`
- `src/parakeet.js:883`

## Main Risk Areas for CPU Over Time

1. Profiling/logging on every inference tick.
- Default `enableProfiling = true` in Parakeet transcribe adds repeated metric/log work.
- Frequent `console.log` and `console.table` in continuous sessions increase CPU and message traffic.

2. Requesting unused outputs.
- In v4, `returnTokenIds` and `returnFrameIndices` are enabled but v4 merger uses word-level output.
- Extra arrays and serialization cost accumulate in long runs.

3. Source mismatch between npm and local Parakeet forks.
- Fixes made in `parakeet.js` may not apply if Keet runs npm package or another local fork.

4. Overlap streaming used without strict cache discipline.
- Incremental decode/mel caching is only efficient when `cacheKey` is stable and overlap/prefix parameters are correct.

## Correct Parakeet Usage Patterns

## 1) Choose and verify one Parakeet source per run

1. For local development with patched Parakeet, run:
```powershell
cross-env USE_LOCAL_PARAKEET=true vite
```

2. Verify source at startup:
- `vite.config.js:38` to `vite.config.js:53` logs active source/version.

3. Keep patches synchronized:
- If production uses npm, changes in `parakeet.js-wt-v5-stream-api` alone will not affect production behavior.

## 2) Disable profiling in real-time hot paths

1. Set `enableProfiling: false` for continuous/streaming loops unless actively diagnosing.

2. In Keet v4 worker call (`src/lib/transcription/transcription.worker.ts:688`), pass:
- `enableProfiling: false`

3. Keep profiling for short benchmark/test runs only.

## 3) Request only outputs you consume

1. If merger uses `utterance_text` + `words`, avoid requesting:
- `returnTokenIds`
- `returnFrameIndices`
- `returnLogProbs`

2. Keep these flags enabled only for token-timeline or frame-aligned merge paths (v5/v3 advanced flows).

## 4) Use precomputed features correctly

1. When mel is computed externally (worker), call Parakeet with `precomputedFeatures`.

2. Avoid redundant feature extraction in Parakeet for those paths.

3. If precomputed path is your default, ensure its log statements are gated behind debug/profiling.

## 5) Use incremental decoder cache correctly

1. Use stable `incremental.cacheKey` per stream/session.

2. Provide accurate `prefixSeconds` matching overlap.

3. Do not rotate cache keys each tick; that defeats reuse.

4. Periodically reset/clear on session boundaries:
- `clearIncrementalCache()` support exists in Parakeet.

## 6) Use incremental mel caching where applicable

1. For raw-audio transcribe calls, pass `prefixSamples` for overlap reuse.

2. Keep overlap computation accurate; wrong prefix values reduce cache hits and waste CPU.

## 7) Backend and runtime tuning

1. Prefer `webgpu-hybrid` for best throughput on modern machines.

2. For wasm fallback, set reasonable thread count (cores minus headroom) and verify `SharedArrayBuffer` availability.

3. Keep one model/session alive; avoid repeated load/teardown in active transcription loops.

## Keet-Specific Optimization Recommendations

## Priority A (low risk, immediate gain)

1. v4 worker transcribe call (`src/lib/transcription/transcription.worker.ts:688`):
- Add `enableProfiling: false`.
- Remove `returnTokenIds: true` at `src/lib/transcription/transcription.worker.ts:695` for v4 path.
- Remove `returnFrameIndices: true` at `src/lib/transcription/transcription.worker.ts:696` for v4 path.

2. Gate Parakeet precomputed log:
- In active Parakeet source (`npm` or `parakeet.js-wt-v5-stream-api`), guard `src/parakeet.js:520` with `if (perfEnabled || debug)`.

## Priority B (consistency and reliability)

1. Ensure v4/v5 paths intentionally choose required output fields only.

2. Add integration tests asserting “no token/frame arrays in v4 result path unless explicitly requested”.

3. Add startup telemetry field to debug panel showing `__PARAKEET_SOURCE__` and `__PARAKEET_VERSION__` to reduce source confusion.

## Priority C (advanced/optional)

1. Add runtime flag for “silent production mode” in Parakeet wrappers.

2. Add periodic cache diagnostics (hit ratio) without per-tick console spam.

3. Create stress test scenario (10+ minutes) validating CPU slope stays stable.

## Suggested Code-Level Policy

1. Continuous inference loops default policy:
- `enableProfiling: false`
- `debug: false`
- minimal `return*` flags

2. Diagnostic run policy:
- enable profiling temporarily
- short capture window only
- disable immediately after analysis

3. Session lifecycle policy:
- on start: initialize once
- on stop/reset: clear stream/caches/state
- on mode switch: invalidate old cache keys/states

## Validation Checklist

1. Source validation:
- Confirm startup log says expected source (`local` or `npm`).

2. Logging validation:
- Verify `[Parakeet]` and `[Perf]` logs are absent/minimal during normal transcription.

3. Output payload validation:
- In v4 mode, verify result payload does not include unnecessary token/frame arrays.

4. Performance validation:
- 5+ minute run: CPU should not trend upward from logging/metrics churn.
- New Chrome trace: lower console-event count vs baseline.

## Useful Commands

```powershell
# Keet: inspect Parakeet source selection logic
rg -n "USE_LOCAL_PARAKEET|localParakeetPath|alias|__PARAKEET_SOURCE__" vite.config.js

# Keet: locate transcribe call options in worker paths
rg -n "model\\.transcribe\\(|precomputedFeatures|returnTokenIds|returnFrameIndices|enableProfiling|incremental|prefixSamples" src/lib/transcription/transcription.worker.ts src/lib/transcription/TokenStreamTranscriber.ts

# Parakeet (active source): locate profiling/log hot spots
rg -n "enableProfiling\\s*=\\s*true|Preprocessor: mel-worker|console\\.table\\(|\\[Perf\\]" src/parakeet.js
```

## Junior Glossary

1. `precomputedFeatures`: mel spectrogram already computed elsewhere; Parakeet skips preprocessor work.
2. `incremental cache`: decoder state reuse for overlap regions to avoid re-decoding old context.
3. `prefixSamples` / `prefixSeconds`: amount of overlap between consecutive windows.
4. `cacheKey`: stream identifier used for incremental cache lookup.
5. `enableProfiling`: Parakeet timing/metrics mode; useful for diagnosis, costly for always-on streaming.

## Short Implementation Plan (Next Step)

1. Patch v4 worker transcribe options to disable profiling and drop unused flags.
2. Patch active Parakeet source to gate precomputed-path logs.
3. Re-run 5+ minute transcription and capture a new trace.
4. Compare CPU trend + console event count against `Trace-20260215T021055.json`.
