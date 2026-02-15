# Performance Issue: Sustained CPU Usage After Brief Activity

## Problem Statement
The app CPU does not settle down quickly after a few seconds of activity. Trace evidence suggests a sustained baseline workload rather than one-time spikes.

## Evidence from Current Trace (93.4s)
- Main render loop remains active at high frequency:
  - `ProxyMain::BeginMainFrame`: 1,646 calls
  - `PageAnimator::serviceScriptedAnimations`: 1,646 calls
- Repeated synchronous style/layout work:
  - Forced style+layout: 8,248 calls
- Worker pipelines continue periodic processing:
  - Mel worker: 385 calls
  - Buffer worker: 417 calls
- GPU/inference worker shows allocation pressure:
  - GC is 28.7% of worker CPU time
- GPU command churn is high even with low inference cadence:
  - 3,315+ commands
  - 117 commands >5ms

## Root-Cause Hypothesis
Sustained CPU is primarily caused by always-on periodic loops (UI frame callbacks + worker ticks + GPU command churn) that continue even when useful work is low.

## Optimization Plan (Prioritized)
### P0: Reduce baseline activity when idle
- Gate waveform/UI updates by real data changes.
- Pause or downshift render/update loops in low/no-signal state.
- Stop non-essential visual updates when tab is hidden.

### P0: Make worker processing event-driven
- Avoid fixed-interval polling loops when ring buffer/input has insufficient data.
- Introduce explicit worker states (`active`, `cooldown`, `idle`).
- Wake workers on threshold crossing instead of constant ticks.

### P1: Lower GC and GPU command overhead
- Reuse typed arrays and inference buffers.
- Reuse ONNX Runtime input/output wrappers where possible.
- Batch command submission and reduce command buffer flush frequency.

### P1: Reduce layout overhead
- Split DOM reads/writes per frame.
- Avoid geometry reads inside hot reactive paths.
- Batch worker-to-UI updates.

## Acceptance Criteria
Validate in a 5-10 minute trace with idle/active phases:
1. Main-thread CPU share reduced by >=25%.
2. Forced style/layout count per minute reduced by >=50%.
3. GPU worker GC share reduced from 28.7% to <15%.
4. WebGPU >5ms commands reduced by >=30%.
5. CPU shows clear drop during idle windows (no sustained elevated baseline).
