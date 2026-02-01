import { AudioEngine as IAudioEngine, AudioEngineConfig, AudioSegment, IRingBuffer } from './types';
import { RingBuffer } from './RingBuffer';

/**
 * AudioEngine implementation for capturing audio, buffering it, and performing basic VAD.
 */
export class AudioEngine implements IAudioEngine {
    private config: AudioEngineConfig;
    private ringBuffer: IRingBuffer;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;

    private currentEnergy: number = 0;
    private isSpeechInProgress: boolean = false;
    private speechStartFrame: number = 0;
    private silenceStartFrame: number = 0;
    private segmentEnergySum: number = 0;
    private segmentSampleCount: number = 0;

    private segmentCallbacks: Array<(segment: AudioSegment) => void> = [];

    constructor(config: Partial<AudioEngineConfig> = {}) {
        this.config = {
            sampleRate: 16000,
            bufferDuration: 120,
            energyThreshold: 0.02,
            minSpeechDuration: 100,
            minSilenceDuration: 300,
            ...config,
        };

        this.ringBuffer = new RingBuffer(this.config.sampleRate, this.config.bufferDuration);
    }

    async init(): Promise<void> {
        if (this.audioContext) return;

        // Request microphone permission
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.config.sampleRate,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
        } catch (error) {
            console.error('Microphone permission denied', error);
            throw new Error('Microphone permission denied');
        }

        this.audioContext = new AudioContext({
            sampleRate: this.config.sampleRate,
        });

        // Load worklet
        // Note: In a real production app, this would be a path to a built JS file or a Vite-resolved URL.
        // For now, we assume capture-processor.js is available or handled by the build system.
        // Given the task is for a standalone module, we might use a Blob for the processor.
        const processorCode = `
      class CaptureProcessor extends AudioWorkletProcessor {
        process(inputs, outputs) {
          const input = inputs[0];
          if (input && input[0]) {
            this.port.postMessage(input[0]);
          }
          return true;
        }
      }
      registerProcessor('capture-processor', CaptureProcessor);
    `;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await this.audioContext.audioWorklet.addModule(url);

        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor');

        this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
            this.handleAudioChunk(event.data);
        };

        this.sourceNode.connect(this.workletNode);
        // Note: Don't connect to destination to avoid feedback loop
    }

    async start(): Promise<void> {
        if (!this.audioContext) {
            await this.init();
        }

        if (this.audioContext?.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    stop(): void {
        if (this.audioContext?.state === 'running') {
            this.audioContext.suspend();
        }

        // We don't necessarily want to kill the stream, just stop processing
        // But for a full stop:
        // this.mediaStream?.getTracks().forEach(track => track.stop());
    }

    getCurrentEnergy(): number {
        return this.currentEnergy;
    }

    isSpeechActive(): boolean {
        return this.isSpeechInProgress;
    }

    getRingBuffer(): IRingBuffer {
        return this.ringBuffer;
    }

    onSpeechSegment(callback: (segment: AudioSegment) => void): () => void {
        this.segmentCallbacks.push(callback);
        return () => {
            this.segmentCallbacks = this.segmentCallbacks.filter((cb) => cb !== callback);
        };
    }

    updateConfig(config: Partial<AudioEngineConfig>): void {
        this.config = { ...this.config, ...config };
        // If buffer duration changed, we'd need to re-create the ring buffer
        // For now, just update VAD parameters
    }

    dispose(): void {
        this.stop();
        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.audioContext?.close();
        this.audioContext = null;
        this.mediaStream = null;
        this.workletNode = null;
        this.sourceNode = null;
    }

    private handleAudioChunk(chunk: Float32Array): void {
        // 1. Calculate energy (RMS)
        let sumSquares = 0;
        for (let i = 0; i < chunk.length; i++) {
            sumSquares += chunk[i] * chunk[i];
        }
        this.currentEnergy = Math.sqrt(sumSquares / chunk.length);

        // 2. Write to ring buffer
        this.ringBuffer.write(chunk);

        // 3. Simple Energy-based VAD (Pre-VAD logic)
        const isOverThreshold = this.currentEnergy > this.config.energyThreshold;
        const currentFrame = this.ringBuffer.getCurrentFrame();
        const chunkMs = (chunk.length / this.config.sampleRate) * 1000;

        if (isOverThreshold) {
            if (!this.isSpeechInProgress) {
                // Potential speech start
                this.isSpeechInProgress = true;
                this.speechStartFrame = currentFrame - chunk.length;
                this.segmentEnergySum = this.currentEnergy * chunk.length;
                this.segmentSampleCount = chunk.length;
            } else {
                // Continue speech
                this.segmentEnergySum += this.currentEnergy * chunk.length;
                this.segmentSampleCount += chunk.length;
            }
            this.silenceStartFrame = 0;
        } else {
            if (this.isSpeechInProgress) {
                if (this.silenceStartFrame === 0) {
                    this.silenceStartFrame = currentFrame - chunk.length;
                }

                const silenceDurationMs = ((currentFrame - this.silenceStartFrame) / this.config.sampleRate) * 1000;

                if (silenceDurationMs > this.config.minSilenceDuration) {
                    // Finalize segment
                    const segmentDurationMs = ((this.silenceStartFrame - this.speechStartFrame) / this.config.sampleRate) * 1000;

                    if (segmentDurationMs > this.config.minSpeechDuration) {
                        const segment: AudioSegment = {
                            startFrame: this.speechStartFrame,
                            endFrame: this.silenceStartFrame,
                            duration: segmentDurationMs / 1000,
                            averageEnergy: this.segmentEnergySum / this.segmentSampleCount,
                            timestamp: Date.now(),
                        };
                        this.notifySegment(segment);
                    }

                    this.isSpeechInProgress = false;
                    this.silenceStartFrame = 0;
                } else {
                    // Treat as continuing speech for now (counting towards duration)
                    this.segmentEnergySum += this.currentEnergy * chunk.length;
                    this.segmentSampleCount += chunk.length;
                }
            }
        }
    }

    private notifySegment(segment: AudioSegment): void {
        this.segmentCallbacks.forEach((cb) => cb(segment));
    }
}
