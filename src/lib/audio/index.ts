export type { AudioEngineConfig, AudioSegment, IRingBuffer, AudioEngine as IAudioEngine, AudioMetrics } from './types';
export { AudioEngine } from './AudioEngine';
export { RingBuffer } from './RingBuffer';
export { MelWorkerClient, type MelFeatures } from './MelWorkerClient';
export { MEL_CONSTANTS, hzToMel, melToHz, createMelFilterbank, createPaddedHannWindow, precomputeTwiddles, fft, preemphasize, computeMelFrame, normalizeMelFeatures, sampleToFrame } from './mel-math';
export { MEL_DISPLAY_MIN_DB, MEL_DISPLAY_MAX_DB, MEL_DISPLAY_DB_RANGE, normalizeMelForDisplay } from './mel-display';
export { AudioSegmentProcessor, type ProcessedSegment, type AudioSegmentProcessorConfig } from './AudioSegmentProcessor';
export { defaultAudioParams, segmentationPresets, getSampleCounts } from './audioParams';
export type { AudioParams, SegmentationPreset } from './audioParams';
