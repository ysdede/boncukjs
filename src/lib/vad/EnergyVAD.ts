import { EnergyVADConfig, VADResult } from './types';

/**
 * EnergyVAD implements SNR-based Voice Activity Detection with adaptive noise floor tracking.
 * Ported from legacy UI project's AudioSegmentProcessor for robust speech detection.
 * 
 * Features:
 * - Adaptive noise floor with fast/slow adaptation rates
 * - SNR-based speech detection (dB scale)
 * - Duration-based hysteresis to filter transients
 */
export class EnergyVAD {
    private config: EnergyVADConfig;
    private isSpeechActive: boolean = false;

    // Timers/Counters in frames
    private speechConfirmationCounter: number = 0;
    private silenceConfirmationCounter: number = 0;

    // Transition thresholds in frames
    private minSpeechFrames: number;
    private minSilenceFrames: number;
    
    // Adaptive noise floor tracking (from legacy UI project)
    private noiseFloor: number = 0.005; // Initial estimate (lower for better sensitivity)
    private snr: number = 0;
    private silenceDuration: number = 0; // Track silence duration for adaptation rate

    // Adaptation rates (from legacy UI project/audioParams.js)
    private readonly noiseFloorAdaptationRate = 0.05; // Standard EMA rate
    private readonly fastAdaptationRate = 0.15; // Fast rate for initial calibration
    private readonly minBackgroundDuration = 1.0; // Seconds before switching to slow adaptation
    private readonly snrThreshold = 3.0; // SNR threshold in dB for speech detection

    constructor(config: Partial<EnergyVADConfig> = {}) {
        this.config = {
            energyThreshold: 0.02, // Fallback energy threshold
            minSpeechDuration: 100,
            minSilenceDuration: 300,
            sampleRate: 16000,
            ...config,
        };

        this.minSpeechFrames = Math.ceil((this.config.minSpeechDuration / 1000) * this.config.sampleRate);
        this.minSilenceFrames = Math.ceil((this.config.minSilenceDuration / 1000) * this.config.sampleRate);
    }

    /**
     * Process an audio chunk and return the VAD state.
     * Uses SNR-based detection with adaptive noise floor (from legacy UI project).
     * @param chunk - Float32Array of mono PCM samples
     */
    process(chunk: Float32Array): VADResult {
        // 1. Calculate RMS Energy
        let sumSquares = 0;
        for (let i = 0; i < chunk.length; i++) {
            sumSquares += chunk[i] * chunk[i];
        }
        const energy = Math.sqrt(sumSquares / chunk.length);
        const timestamp = Date.now();
        const chunkDuration = chunk.length / this.config.sampleRate;

        // 2. Calculate SNR in dB (before updating noise floor)
        const safeNoiseFloor = Math.max(0.0001, this.noiseFloor);
        this.snr = 10 * Math.log10(energy / safeNoiseFloor);

        // 3. Determine if speech based on SNR threshold (primary) and energy threshold (fallback)
        const isAboveSnrThreshold = this.snr > this.snrThreshold;
        const isAboveEnergyThreshold = energy > this.config.energyThreshold;
        const isSpeech = isAboveSnrThreshold || isAboveEnergyThreshold;

        // 4. Update noise floor adaptively (from legacy UI project)
        if (!isSpeech) {
            // Track silence duration for adaptation rate blending
            this.silenceDuration += chunkDuration;
            
            // Blend between fast and normal adaptation rates based on silence duration
            let adaptationRate = this.noiseFloorAdaptationRate;
            if (this.silenceDuration < this.minBackgroundDuration) {
                const blendFactor = Math.min(1, this.silenceDuration / this.minBackgroundDuration);
                adaptationRate = this.fastAdaptationRate * (1 - blendFactor) + 
                                this.noiseFloorAdaptationRate * blendFactor;
            }
            
            // Exponential moving average for noise floor
            this.noiseFloor = this.noiseFloor * (1 - adaptationRate) + energy * adaptationRate;
            this.noiseFloor = Math.max(0.00001, this.noiseFloor); // Prevent zero
        } else {
            // Reset silence duration when speech detected
            this.silenceDuration = 0;
        }

        const chunkLength = chunk.length;
        let speechStart = false;
        let speechEnd = false;

        if (isSpeech) {
            // Speech detected
            this.silenceConfirmationCounter = 0;

            if (!this.isSpeechActive) {
                this.speechConfirmationCounter += chunkLength;
                if (this.speechConfirmationCounter >= this.minSpeechFrames) {
                    this.isSpeechActive = true;
                    speechStart = true;
                }
            }
        } else {
            // Silence detected
            this.speechConfirmationCounter = 0;

            if (this.isSpeechActive) {
                this.silenceConfirmationCounter += chunkLength;
                if (this.silenceConfirmationCounter >= this.minSilenceFrames) {
                    this.isSpeechActive = false;
                    speechEnd = true;
                    this.silenceConfirmationCounter = 0;
                }
            }
        }

        return {
            isSpeech: this.isSpeechActive,
            energy,
            timestamp,
            speechStart,
            speechEnd,
            // Extended metrics
            noiseFloor: this.noiseFloor,
            snr: this.snr
        } as VADResult;
    }

    /**
     * Reset the internal state machine.
     */
    reset(): void {
        this.isSpeechActive = false;
        this.speechConfirmationCounter = 0;
        this.silenceConfirmationCounter = 0;
        this.noiseFloor = 0.005; // Reset to initial estimate
        this.snr = 0;
        this.silenceDuration = 0;
    }

    /**
     * Update configuration at runtime.
     */
    updateConfig(config: Partial<EnergyVADConfig>): void {
        this.config = { ...this.config, ...config };
        this.minSpeechFrames = Math.ceil((this.config.minSpeechDuration / 1000) * this.config.sampleRate);
        this.minSilenceFrames = Math.ceil((this.config.minSilenceDuration / 1000) * this.config.sampleRate);
    }

    /**
     * Get the current configuration.
     */
    getConfig(): EnergyVADConfig {
        return { ...this.config };
    }
}
