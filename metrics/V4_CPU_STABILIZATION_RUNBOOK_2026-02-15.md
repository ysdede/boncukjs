# v4 CPU Stabilization Runbook (Trace-20260215T021055)

## Audience
Junior engineers working on long-running transcription CPU drift in v4 mode.

## Scope
- Project: `N:\github\ysdede\keet-wt-v5-token-timeline`
- Trace: `Trace-20260215T021055.json`
- Mode in trace: **v4** (not v5)

## Quick Conclusion
CPU grows because v4 repeatedly processes large overlapping windows when cursor advancement lags behind live audio progression. This is amplified by a high `maxDurationSec` and verbose hot-path logging.

## Evidence (from trace + code)

1. v4 window growth is visible in trace logs.
- `Trace-20260215T021055.json:123909` shows `v4Tick #377` window `16.08s`.
- `Trace-20260215T021055.json:636932` shows `v4Tick #385` window `25.76s`.
- Unique window samples found in the trace include: `16.08s`, `17.52s`, `18.72s`, `20.48s`, `21.76s`, `23.04s`, `25.76s`.

2. Mel feature extraction confirms large inference ranges.
- `Trace-20260215T021055.json:421894` shows `getFeatures ... 2176 frames, 21.76s`.

3. v4 path is active; v5 is not active in this trace.
- Trace message counts observed: `v4Tick > 0`, `v5Tick = 0`.

4. Current v4 window config allows large reprocessing.
- `src/App.tsx:1512` sets `maxDurationSec: 30.0`.

5. WindowBuilder supports start hints, but v4 call site does not pass one.
- API exists: `src/lib/transcription/WindowBuilder.ts:166` (`buildWindow(startHintFrame?: number)`).
- Hint logic: `src/lib/transcription/WindowBuilder.ts:169`.
- v4 call site currently uses no hint: `src/App.tsx:740`.

6. Existing tests already validate start-hint behavior.
- `src/lib/transcription/WindowBuilder.test.ts:127`
- `src/lib/transcription/WindowBuilder.test.ts:143`

7. Hot-path logging is enabled in v4 path.
- `src/App.tsx:1516` sets `debug: true` for `WindowBuilder`.
- Frequent v4 logs in tick loop: `src/App.tsx:614`, `src/App.tsx:630`, `src/App.tsx:755`, `src/App.tsx:819`.
- Worker logs also present: `src/lib/audio/mel.worker.ts:192`, `src/lib/audio/mel.worker.ts:283`.

## Why CPU Increases Over Time (plain language)
- The app records continuously, so the ring buffer "head" keeps moving forward.
- If the transcription start point does not move forward enough, each new tick transcribes a bigger chunk than the previous one.
- Bigger chunks mean:
  - more mel frames,
  - bigger model input,
  - more merge work,
  - more logging.
- Repeating this every tick causes gradual CPU rise.

## Fix Plan (implementation order)

1. Use a v4 start hint so we do not keep re-reading old audio.
- Add `v4LastInferenceEndSample` state near existing v4 globals in `src/App.tsx`.
- Change window build call from:
  - `windowBuilder.buildWindow()`
  to:
  - `windowBuilder.buildWindow(Math.max(v4LastInferenceEndSample, audioEngine.getRingBuffer().getBaseFrameOffset()))`
- Update `v4LastInferenceEndSample = window.endFrame` only after successful non-stale inference result.
- Reset this variable in the same places that reset other v4 runtime state.

2. Reduce max v4 window length.
- Change `src/App.tsx:1512` from `maxDurationSec: 30.0` to `maxDurationSec: 8.0`.
- Reason: hard cap prevents pathological growth even if cursor progression is delayed.

3. Disable verbose logging by default in hot paths.
- Set `WindowBuilder` debug default to false at creation site (`src/App.tsx:1516`).
- Keep `console.error` logs.
- Gate non-error logs under a single local flag (for example `V4_TRACE_LOGS`), default `false`.

4. Keep v4 interval and flush defaults unchanged initially.
- Current defaults: `src/stores/appStore.ts:168`, `src/stores/appStore.ts:169`, `src/stores/appStore.ts:170`.
- Tune only after window-size fix is validated, to avoid mixing variables.

## Test Cases and Scenarios

1. Unit tests
- Keep existing `WindowBuilder` start-hint tests passing.
- Add one test for "hint follows last inference end and never regresses behind ring base".

2. Integration behavior checks (manual or automated)
- Run 5+ minute continuous speech/noise session.
- Confirm no repeating growth pattern like `16s -> 26s` for consecutive windows.
- Confirm window durations remain under configured cap.

3. Trace acceptance checks
- Capture a new trace after fixes.
- Acceptance criteria:
  - No `v4Tick Window` duration above `8.5s`.
  - No `MelWorker getFeatures` range above `8.5s`.
  - CPU usage should not show monotonic upward trend caused by window-size growth.
  - Log volume should be substantially lower vs previous trace.

## Commands for Re-Validation

```powershell
# verify no v5 activity and count v4/v5 tick logs in trace
rg -n "\[v4Tick|\[v5Tick" Trace-20260215T021055.json

# check current code hotspots
rg -n "buildWindow\(|maxDurationSec|debug: true|console\.log" src/App.tsx
rg -n "buildWindow\(|startHintFrame" src/lib/transcription/WindowBuilder.ts src/lib/transcription/WindowBuilder.test.ts
```

## Glossary (Junior-Friendly)
- Ring buffer: rolling audio memory (new data overwrites oldest when full).
- Window: `[startFrame, endFrame]` audio slice sent for transcription.
- Cursor: "already trusted/processed up to here" timeline position.
- Start hint: lower bound to force next window to begin from newer audio.
- Stale result: inference completed after state changed; must be ignored.

## Out of Scope (for this runbook)
- v5 token timeline optimization.
- Major model/runtime architecture changes.
- GPU/runtime migration work.
