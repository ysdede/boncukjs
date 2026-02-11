/**
 * Keet v2.0 - Type Definitions
 * 
 * Core types for the transcription application.
 * Based on architecture.md specifications.
 */

// ============================================
// Audio Types
// ============================================

export interface AudioConfig {
  sampleRate: number;      // 16000 Hz
  channels: number;        // 1 (mono)
  chunkSize: number;       // Frame-aligned (40/80/120ms)
}

export interface AudioChunk {
  samples: Float32Array;
  timestamp: number;       // Absolute time in ms
  duration: number;        // Duration in ms
}

// ============================================
// VAD Types
// ============================================

export interface VADResult {
  isSpeech: boolean;
  energy: number;          // RMS energy level (0-1)
  timestamp: number;
}

export interface VADConfig {
  energyThreshold: number; // Default: 0.01
  minSpeechDuration: number; // Default: 100ms
  minSilenceDuration: number; // Default: 300ms
}

// ============================================
// Transcription Types
// ============================================

export interface TranscriptionResult {
  text: string;
  tokens: Token[];
  isFinal: boolean;
  timestamp: number;
}

export interface Token {
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface DecoderState {
  // Opaque state from parakeet.js
  // LSTM hidden/cell states for stateful streaming
  [key: string]: unknown;
}

// ============================================
// App State Types
// ============================================

export type RecordingState = 'idle' | 'recording' | 'paused';
export type ModelState = 'unloaded' | 'loading' | 'ready' | 'error';
export type BackendType = 'webgpu' | 'wasm';

export interface AppState {
  recording: RecordingState;
  model: ModelState;
  backend: BackendType;
  transcript: string;
  sessionDuration: number;
  isOfflineReady: boolean;
}

// ============================================
// Component Props Types
// ============================================

export interface TranscriptPanelProps {
  transcript: string;
  isRecording: boolean;
  onCopy: () => void;
  onClear: () => void;
}

export interface WaveformProps {
  audioLevel: number;
  isRecording: boolean;
}

export interface RecordButtonProps {
  isRecording: boolean;
  onToggle: () => void;
  disabled: boolean;
}
