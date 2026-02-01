import { AudioEngine as IAudioEngine, AudioEngineConfig, AudioSegment, IRingBuffer } from './types';
import { RingBuffer } from './RingBuffer';
import { EnergyVAD } from '../vad/EnergyVAD';

/**
 * AudioEngine implementation for capturing audio, buffering it, and performing basic VAD.
 */
export class AudioEngine implements IAudioEngine {
    private config: AudioEngineConfig;
    private ringBuffer: IRingBuffer;
    private energyVad: EnergyVAD;
    private deviceId: string | null = null;

    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;

    private currentEnergy: number = 0;
    private speechStartFrame: number = 0;
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

        this.deviceId = this.config.deviceId || null;
        this.ringBuffer = new RingBuffer(this.config.sampleRate, this.config.bufferDuration);
        this.energyVad = new EnergyVAD({
            energyThreshold: this.config.energyThreshold,
            minSpeechDuration: this.config.minSpeechDuration,
            minSilenceDuration: this.config.minSilenceDuration,
            sampleRate: this.config.sampleRate,
        });
    }

    private isWorkletInitialized = false;

    async init(): Promise<void> {
        // Request microphone permission with optional deviceId
        try {
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(t => t.stop());
            }

            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
                    channelCount: 1,
                    sampleRate: this.config.sampleRate,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            };

            console.log('[AudioEngine] Requesting microphone:', constraints);
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('[AudioEngine] Microphone stream acquired:', this.mediaStream.id);
        } catch (err) {
            console.error('[AudioEngine] Failed to get media stream:', err);
            throw err;
        }

        if (!this.audioContext) {
            this.audioContext = new AudioContext({
                sampleRate: this.config.sampleRate,
                latencyHint: 'interactive',
            });
            console.log('[AudioEngine] Created AudioContext:', this.audioContext.state);
        }

        if (!this.isWorkletInitialized) {
            // Buffered processor: 4096 samples @ 16kHz = ~256ms.
            // This is safer for the main thread than 128 samples.
            const processorCode = `
                class CaptureProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.bufferSize = 1024; // 64ms @ 16kHz
                        this.buffer = new Float32Array(this.bufferSize);
                        this.index = 0;
                        this._lastLog = 0;
                    }

                    process(inputs, outputs) {
                        const input = inputs[0];
                        if (!input || !input[0]) return true;
                        
                        const channelData = input[0];
                        
                        // Buffer the data
                        for (let i = 0; i < channelData.length; i++) {
                            this.buffer[this.index++] = channelData[i];
                            
                            if (this.index >= this.bufferSize) {
                                // Send buffer
                                this.port.postMessage(this.buffer.slice());
                                this.index = 0;
                                
                                // Debug log every ~5 seconds (roughly every 20 chunks)
                                const now = Date.now();
                                if (now - this._lastLog > 5000) {
                                    console.log('[AudioWorklet] Processed 4096 samples');
                                    this._lastLog = now;
                                }
                            }
                        }
                        
                        return true;
                    }
                }
                registerProcessor('capture-processor', CaptureProcessor);
            `;
            const blob = new Blob([processorCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            try {
                await this.audioContext.audioWorklet.addModule(url);
                this.isWorkletInitialized = true;
                console.log('[AudioEngine] AudioWorklet module loaded');
            } catch (err) {
                console.error('[AudioEngine] Failed to load worklet:', err);
                if (err instanceof Error && err.name === 'InvalidStateError') {
                    // Ignore if already registered
                    this.isWorkletInitialized = true;
                }
            }
        }

        // Re-create worklet node if needed (it might handle dispose differently, but safe to new)
        if (this.workletNode) this.workletNode.disconnect();

        this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor');
        this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
            this.handleAudioChunk(event.data);
        };
        this.workletNode.onprocessorerror = (e) => {
            console.error('[AudioEngine] Worklet processor error:', e);
        };

        // Reconnect source node
        this.sourceNode?.disconnect();
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.sourceNode.connect(this.workletNode);

        // Keep graph alive
        this.workletNode.connect(this.audioContext.destination);
        console.log('[AudioEngine] Graph connected: Source -> Worklet -> Destination');
    }

    async start(): Promise<void> {
        if (!this.mediaStream || !this.audioContext || !this.workletNode) {
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
    }

    getCurrentEnergy(): number {
        return this.currentEnergy;
    }

    isSpeechActive(): boolean {
        return this.currentEnergy > this.config.energyThreshold;
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
        this.energyVad.updateConfig({
            energyThreshold: this.config.energyThreshold,
            minSpeechDuration: this.config.minSpeechDuration,
            minSilenceDuration: this.config.minSilenceDuration,
        });
    }

    async setDevice(deviceId: string): Promise<void> {
        this.deviceId = deviceId;
        await this.init();

        // Reconnect if running
        if (this.audioContext && this.workletNode) {
            this.sourceNode?.disconnect();
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream!);
            this.sourceNode.connect(this.workletNode);
        }
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
        // 1. Process VAD
        const vadResult = this.energyVad.process(chunk);
        this.currentEnergy = vadResult.energy;

        // 2. Write to ring buffer
        const endFrame = this.ringBuffer.getCurrentFrame() + chunk.length;
        this.ringBuffer.write(chunk);

        // 3. Handle segments
        if (vadResult.speechStart) {
            this.speechStartFrame = endFrame - chunk.length;
            this.segmentEnergySum = vadResult.energy * chunk.length;
            this.segmentSampleCount = chunk.length;
        } else if (vadResult.isSpeech) {
            this.segmentEnergySum += vadResult.energy * chunk.length;
            this.segmentSampleCount += chunk.length;
        }

        if (vadResult.speechEnd) {
            const segment: AudioSegment = {
                startFrame: this.speechStartFrame,
                endFrame: endFrame - Math.ceil((this.energyVad.getConfig().minSilenceDuration / 1000) * this.config.sampleRate),
                duration: (endFrame - this.speechStartFrame) / this.config.sampleRate,
                averageEnergy: this.segmentEnergySum / this.segmentSampleCount,
                timestamp: Date.now(),
            };

            // Adjust endFrame to be more accurate (excluding the silence that triggered the end)
            const silenceFrames = Math.ceil((this.energyVad.getConfig().minSilenceDuration / 1000) * this.config.sampleRate);
            segment.endFrame = endFrame - silenceFrames;
            segment.duration = (segment.endFrame - segment.startFrame) / this.config.sampleRate;

            if (segment.duration > 0) {
                this.notifySegment(segment);
            }
        }
    }

    private notifySegment(segment: AudioSegment): void {
        this.segmentCallbacks.forEach((cb) => cb(segment));
    }
}
