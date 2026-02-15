# Parakeet.js Trace Reanalysis Report (WASM/WebGPU Focus)

**Date:** February 15, 2026  
**Project:** `N:\github\ysdede\keet-wt-v5-token-timeline`  
**Trace file:** `Trace-20260215T021055.json`  
**Goal:** Re-analyze the current Chrome trace specifically for Parakeet.js runtime behavior (WASM + WebGPU), and separate Parakeet cost from Keet pipeline/windowing behavior.

## Scope and Method

This report focuses on:
1. Parakeet-attributed console markers (`[Parakeet]`, `[Perf]`).
2. GPU command pipeline events tied to ONNX Runtime WebGPU execution.
3. WASM compilation/logging overhead signals.
4. Worker threads likely handling Parakeet inference.

Data was derived from trace parsing plus existing summary artifacts:
- `trace_analysis_summary.json`
- direct event parsing of `Trace-20260215T021055.json`

## High-Level Conclusion

Parakeet.js is active in this trace and contributes meaningful runtime work (especially through WebGPU command submission), **but the long-session CPU growth pattern is still dominated by Keet feeding larger and larger v4 windows over time**.

In short:
- Parakeet runtime cost is real and visible.
- Parakeet is **not** the primary source of the “grows with time” behavior by itself.
- The strongest drift driver remains window growth in Keet v4 orchestration.

## Verified Parakeet Presence in Trace

1. Parakeet/perf message events:
- **30 real console message events** (`args.message`) were found.
- Split:
  - `15` x `[Parakeet] Preprocessor: mel-worker ...`
  - `15` x `[Perf] RTF: ...`
- If track-event mirror entries are also counted, total becomes `60`.

2. Example trace lines:
- `Trace-20260215T021055.json:124388`  
  `[Parakeet] Preprocessor: mel-worker (precomputed 1608 frames × 128 mel bins, 0 ms)`
- `Trace-20260215T021055.json:192392`  
  `[Perf] RTF: 16.13x (audio 16.08 s, time 1.00 s)`

3. Bundled source mapping from trace logs:
- line hit counts in bundled `parakeet__js.js`:
  - line `979`: 15 hits (preprocessor log site)
  - line `1248`: 15 hits (perf log site)

## WebGPU Pipeline Findings (Parakeet/ORT Runtime Side)

From event aggregation in this trace:

1. GPU command pipeline totals (approx):
- `GpuChannel::ExecuteDeferredRequest`: **5285.5 ms**, count `5443`
- `CommandBuffer::Flush`: **5110.6 ms**, count `4979`
- `CommandBufferStub::OnAsyncFlush`: **5095.3 ms**, count `4979`
- `CommandBufferService:PutChanged`: **5052.1 ms**, count `4979`
- `CommandBufferHelper::Flush`: **64.3 ms**, count `2929`

2. Existing summary confirms heavy WebGPU activity:
- `trace_analysis_summary.json` → `webgpu.total_ms`: **3096.3 ms**
- `high_dur_gt5ms`: `188`
- command rate: `77.6/s` over ~19s span

Interpretation:
- This is expected for active encoder-side GPU inference.
- It indicates substantial GPU submission pressure, but not alone evidence of monotonic CPU drift.

## WASM Findings (Parakeet/ORT Runtime Side)

1. Aggregate from current pass:
- `wasm.CompileLazy`: **142.8 ms total**, count `409`
- wasm/v8 logcode family: **370.1 ms total**, count `12909`

2. Existing summary context:
- major wasm compile spikes mostly around initialization/warmup phases.

Interpretation:
- WASM compilation/logging overhead exists, but scale is not consistent with the long-run CPU increase pattern seen during continuing transcription.

## Likely Parakeet Inference Worker Threads

Likely workers (high `HandlePostMessage` + `v8.callFunction`) identified in trace:
- `tid=75520`: combined ~`751.5 ms` (worker label in summary: `Worker-75520`)
- `tid=85376`: combined ~`600.2 ms` (worker label in summary: `Worker-85376`)
- `tid=64888`: combined ~`405.4 ms` (worker label in summary: `Worker-64888`)

These align with existing summary sections where worker JS call cadence remains relatively stable.

## Why Drift Is Still Mostly Keet-Side (Window Growth)

Parakeet log lines themselves show input size growth, reflecting upstream window growth:
- 1608 frames → 1752 → 1872 → 2048 → 2176 → 2304 ...

Keet v4 window growth evidence (from prior validated findings):
- `Trace-20260215T021055.json:123909` (v4 window 16.08s)
- `Trace-20260215T021055.json:636932` (v4 window 25.76s)
- `Trace-20260215T021055.json:421894` (MelWorker getFeatures 21.76s)

So Parakeet is processing what Keet gives it; as windows grow, Parakeet work per tick grows.

## Parakeet-Specific Integration Issues Found

These do add avoidable CPU overhead and should still be fixed:

1. Default profiling enabled in Parakeet transcribe:
- `n:\github\ysdede\parakeet.js-wt-v5-stream-api\src\parakeet.js:487`
- `enableProfiling = true`

2. Unconditional precomputed path logging:
- `n:\github\ysdede\parakeet.js-wt-v5-stream-api\src\parakeet.js:520`
- logs every inference even when not debugging.

3. Perf logging with table output in hot path:
- `n:\github\ysdede\parakeet.js-wt-v5-stream-api\src\parakeet.js:784`
- `n:\github\ysdede\parakeet.js-wt-v5-stream-api\src\parakeet.js:883`

4. Keet v4 worker requests extra outputs not used by v4 merger:
- `src/lib/transcription/transcription.worker.ts:695` (`returnTokenIds: true`)
- `src/lib/transcription/transcription.worker.ts:696` (`returnFrameIndices: true`)

## Practical Impact Ranking

1. **Highest (drift driver):** growing v4 window duration in Keet.
2. **Medium:** always-on Parakeet profiling/perf logs in streaming loops.
3. **Medium:** unused output flags in v4 call path.
4. **Lower:** WASM compile/log events after warmup.

## Recommended Next Changes

1. Keet v4 call-site hardening:
- In `src/lib/transcription/transcription.worker.ts` v4 path, set `enableProfiling: false`.
- Remove `returnTokenIds` and `returnFrameIndices` for v4 unless needed.

2. Parakeet log gating:
- Guard precomputed path log at `src/parakeet.js:520` behind `debug || perfEnabled` (or a dedicated flag).
- Keep perf `console.table` off for normal streaming runs.

3. Keep primary window-size fixes in Keet as top priority:
- start-hint usage,
- tighter `maxDurationSec`,
- less hot-path logging.

## Validation Plan After Patches

1. Capture a fresh 5+ minute trace.
2. Check:
- fewer `[Parakeet]` / `[Perf]` console entries,
- stable/flat inference worker CPU trend,
- v4 windows no longer expanding into large durations,
- lower renderer/console overhead.

## Useful Re-Run Commands

```powershell
# Parakeet/perf log events in current trace
rg -n "\[Parakeet\]|\[Perf\]" Trace-20260215T021055.json

# v4 window growth evidence
rg -n "\[v4Tick #[0-9]+\] Window" Trace-20260215T021055.json

# Keet v4 transcribe option usage
rg -n "PROCESS_V4_CHUNK_WITH_FEATURES|model\.transcribe\(|returnTokenIds|returnFrameIndices|enableProfiling" src/lib/transcription/transcription.worker.ts
```
