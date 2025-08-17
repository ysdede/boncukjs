/**
 * Audio Processing Parameters
 * 
 * This file contains all the parameters used for audio processing, including
 * Voice Activity Detection (VAD) and segment processing. These values are
 * sample-rate-aligned where appropriate to ensure exact integer sample counts.
 */

// Define segmentation presets FIRST
export const segmentationPresets = {
  fast: {
    name: 'Fast (Short Segments)',
    icon: 'bolt',
    speechHangover: 0.08,
    audioThreshold: 0.120, // Higher threshold
    silenceLength: 0.1   // Short silence duration (2 windows)
  },
  medium: {
    name: 'Medium (Balanced)',
    icon: 'av_timer',
    speechHangover: 0.16,
    audioThreshold: 0.08, // Medium threshold
    silenceLength: 0.4   // Medium silence duration (5 windows)
  },
  slow: {
    name: 'Slow (Long Segments)',
    icon: 'hourglass_bottom',
    speechHangover: 0.24,
    audioThreshold: 0.06, // Lower threshold (original default)
    silenceLength: 1.0   // Long silence duration (10 windows)
  }
};

// Basic VAD settings - Derived from 'medium' preset
export const audioThreshold = segmentationPresets.medium.audioThreshold; // Default from medium preset
export const silenceLength = segmentationPresets.medium.silenceLength;    // Default from medium preset
export const speechHangover = segmentationPresets.medium.speechHangover;   // Default from medium preset

// Advanced VAD settings
export const energyScale = 2.0;          // Scaling factor for energy calculation
export const hysteresisRatio = 1.2;      // Hysteresis ratio for threshold comparison
export const minSpeechDuration = 0.240;  // 320ms minimum speech duration (4 * 80ms)
export const maxSilenceWithinSpeech = 0.160;  // 160ms max silence within speech (2 * 80ms)
export const endingSpeechTolerance = 0.240;  // 240ms tolerance for ending speech
export const endingEnergyThreshold = 0.600;  // Threshold multiplier for ending speech detection
export const minEnergyIntegral = 22;     // Minimum energy integral for speech detection
export const minEnergyPerSecond = 5;    // Minimum energy per second for speech detection

// Adaptive energy threshold settings
export const useAdaptiveEnergyThresholds = true; // A switch to turn it on/off
export const adaptiveEnergyIntegralFactor = 25.0; // Multiplier for noise floor to get integral threshold
export const adaptiveEnergyPerSecondFactor = 10.0; // Multiplier for noise floor to get per-second threshold
export const minAdaptiveEnergyIntegral = 3; // A floor for the adaptive threshold
export const minAdaptiveEnergyPerSecond = 1;   // A floor for the adaptive threshold

// Sample-rate-aligned timing parameters
export const windowDuration = 0.080;     // 80ms window duration - Perfectly divisible by common sample rates
export const lookbackDuration = 0.120;   // 120ms lookback duration - Perfectly divisible by common sample rates
export const overlapDuration = 0.080;    // 80ms overlap duration - Perfectly divisible by common sample rates

// Buffer durations
export const recentAudioDuration = 3.0;  // 3 seconds of recent audio storage
export const visualizationDuration = 30.0;  // 30 seconds of visualization buffer

// SNR and Noise Floor adaptation settings
export const snrThreshold = 3.0;         // SNR threshold in dB for speech detection
export const minSnrThreshold = 1.0;      // Minimum SNR threshold for low energy speech
export const noiseFloorAdaptationRate = 0.05;  // Standard adaptation rate for noise floor (0-1)
export const fastAdaptationRate = 0.15;  // Fast adaptation rate for initial calibration
export const minBackgroundDuration = 1.0;     // Minimum duration of silence to be considered "background" for fast adaptation
export const energyRiseThreshold = 0.08;      // Threshold for detecting a rising energy trend for potential speech start

// Additional processor-specific parameters
export const smaLength = 6;              // Length of the Simple Moving Average for energy smoothing
export const lookbackChunks = 3;         // Number of chunks to look back for speech start detection
export const maxHistoryLength = 20;      // Max length for storing speech/silence stats history

// New parameter for splitting long segments
export const maxSegmentDuration = 4.8;     // Automatically split segments longer than this (in seconds)

/**
 * Get sample counts for different parameters at a given sample rate
 * @param {number} sampleRate - The sample rate to calculate for
 * @returns {Object} - Object with sample counts for different parameters
 */
export function getSampleCounts(sampleRate) {
  return {
    windowSamples: Math.round(windowDuration * sampleRate),
    lookbackSamples: Math.round(lookbackDuration * sampleRate),
    overlapSamples: Math.round(overlapDuration * sampleRate),
    recentAudioSamples: Math.round(recentAudioDuration * sampleRate),
    visualizationSamples: Math.round(visualizationDuration * sampleRate),
    minSpeechSamples: Math.round(minSpeechDuration * sampleRate),
    silenceSamples: Math.round(silenceLength * sampleRate)
  };
}

// Export a default object with all parameters for easy import
export default {
  audioThreshold,
  silenceLength,
  speechHangover,
  energyScale,
  hysteresisRatio,
  minSpeechDuration,
  maxSilenceWithinSpeech,
  endingSpeechTolerance,
  endingEnergyThreshold,
  minEnergyIntegral,
  minEnergyPerSecond,
  windowDuration,
  lookbackDuration,
  overlapDuration,
  recentAudioDuration,
  visualizationDuration,
  snrThreshold,
  minSnrThreshold,
  noiseFloorAdaptationRate,
  fastAdaptationRate,
  minBackgroundDuration,
  energyRiseThreshold,
  smaLength,
  lookbackChunks,
  maxHistoryLength,
  segmentationPresets,
  getSampleCounts,
  useAdaptiveEnergyThresholds,
  adaptiveEnergyIntegralFactor,
  adaptiveEnergyPerSecondFactor,
  minAdaptiveEnergyIntegral,
  minAdaptiveEnergyPerSecond,
  maxSegmentDuration
}; 

// audioManager.js hardcoded values, we may need them later use.
/*
threshold: 0.125,               // Energy threshold unchanged
silenceLength: 0.800,           // 800ms = 10 windows of 80ms
minSpeechDuration: 0.320,       // 320ms = 4 windows of 80ms
minEnergyPerSecond: 50,         // Energy per second unchanged
snrThreshold: 6,                // Default SNR threshold for speech detection
minSnrThreshold: 1.5,           // Minimum SNR threshold for low energy speech 
noiseFloorAdaptationRate: 0.05, // Standard adaptation rate for noise floor
fastAdaptationRate: 0.15,       // Fast adaptation rate for initial calibration
minBackgroundDuration: 0.3,     // Minimum duration before adapting noise floor
energyRiseThreshold: 0.08,       // Threshold for detecting rising energy trend
speechHangover: 0.1,            // Added: speech hangover duration
*/
