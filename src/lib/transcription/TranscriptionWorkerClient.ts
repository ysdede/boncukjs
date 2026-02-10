/**
 * BoncukJS v4.0 - Transcription Worker Client
 * 
 * Main thread bridge to the Transcription Web Worker.
 * Offloads heavy AI transcription to a background thread to prevent UI stutters.
 *
 * Supports both v3 (token-stream) and v4 (utterance-based) pipelines.
 */

import { ModelState, ModelProgress, TranscriptionResult } from './types';
import { TokenStreamResult, TokenStreamConfig } from './TokenStreamTranscriber';
import type { MergerResult, UtteranceBasedMergerConfig } from './UtteranceBasedMerger';
import type {
    WorkerMessage,
    V4ProcessResult,
    V4IncrementalCache,
    V4TimeoutResult
} from './WorkerMessages';

// Re-export types for compatibility
export type { V4ProcessResult, V4IncrementalCache, V4TimeoutResult };

export class TranscriptionWorkerClient {
    private worker: Worker;
    private messageId = 0;
    private pendingPromises: Map<number, { resolve: Function; reject: Function }> = new Map();

    // Callbacks for reactive updates
    public onModelProgress?: (p: ModelProgress) => void;
    public onModelStateChange?: (s: ModelState) => void;
    public onV3Confirmed?: (text: string, words: any[]) => void;
    public onV3Pending?: (text: string, words: any[]) => void;
    public onError?: (msg: string) => void;

    constructor() {
        // Create the worker
        this.worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (e) => this.handleMessage(e.data);
        this.worker.onerror = (e) => {
            console.error('[TranscriptionWorkerClient] Fatal Worker Error:', e);
            this.onError?.('Fatal background worker error');
        };
    }

    private handleMessage(data: WorkerMessage) {
        // Handle promise resolutions
        if (data.id !== undefined && this.pendingPromises.has(data.id)) {
            const { resolve, reject } = this.pendingPromises.get(data.id)!;
            this.pendingPromises.delete(data.id);

            if (data.type === 'ERROR') {
                reject(new Error(data.payload));
            } else {
                resolve(data.payload);
            }
            return;
        }

        // Handle reactive notifications
        switch (data.type) {
            case 'MODEL_PROGRESS':
                this.onModelProgress?.(data.payload);
                break;
            case 'MODEL_STATE':
                this.onModelStateChange?.(data.payload);
                break;
            case 'V3_CONFIRMED':
                this.onV3Confirmed?.(data.payload.text, data.payload.words);
                break;
            case 'V3_PENDING':
                this.onV3Pending?.(data.payload.text, data.payload.words);
                break;
            case 'ERROR':
                this.onError?.(data.payload);
                break;
        }
    }

    private sendRequest(type: string, payload?: any): Promise<any> {
        const id = this.messageId++;
        return new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ type, payload, id });
        });
    }

    // API Methods
    async initModel(modelId?: string): Promise<void> {
        return this.sendRequest('INIT_MODEL', { modelId });
    }

    async initLocalModel(files: FileList | File[]): Promise<void> {
        return this.sendRequest('LOAD_LOCAL_MODEL', Array.from(files));
    }

    async initService(config: any): Promise<void> {
        return this.sendRequest('INIT_SERVICE', { config });
    }

    async initV3Service(config: TokenStreamConfig): Promise<void> {
        return this.sendRequest('INIT_V3_SERVICE', { config });
    }

    async processChunk(audio: Float32Array): Promise<TranscriptionResult> {
        return this.sendRequest('PROCESS_CHUNK', audio);
    }

    async processV3Chunk(audio: Float32Array, startTime?: number): Promise<TokenStreamResult> {
        return this.sendRequest('PROCESS_V3_CHUNK', { audio, startTime });
    }

    /**
     * Process a chunk using pre-computed mel features (from mel worker).
     * Bypasses the preprocessor in the inference worker entirely.
     */
    async processV3ChunkWithFeatures(
        features: Float32Array,
        T: number,
        melBins: number,
        startTime?: number,
        overlapSeconds?: number,
    ): Promise<TokenStreamResult> {
        return this.sendRequest('PROCESS_V3_CHUNK_WITH_FEATURES', {
            features, T, melBins, startTime, overlapSeconds,
        });
    }

    async transcribeSegment(audio: Float32Array): Promise<TranscriptionResult> {
        return this.sendRequest('TRANSCRIBE_SEGMENT', audio);
    }

    async reset(): Promise<void> {
        return this.sendRequest('RESET');
    }

    async finalize(): Promise<TranscriptionResult | TokenStreamResult | MergerResult | { text: string }> {
        return this.sendRequest('FINALIZE');
    }

    // ---- v4 Utterance-based pipeline methods ----

    /**
     * Initialize the v4 utterance-based merger in the worker.
     */
    async initV4Service(config?: Partial<UtteranceBasedMergerConfig>): Promise<void> {
        return this.sendRequest('INIT_V4_SERVICE', { config: config || {} });
    }

    /**
     * Process a chunk using pre-computed mel features through the v4 pipeline.
     * Transcribes via parakeet.js, then feeds into UtteranceBasedMerger.
     */
    async processV4ChunkWithFeatures(params: {
        features: Float32Array;
        T: number;
        melBins: number;
        timeOffset?: number;
        endTime?: number;
        segmentId?: string;
        incrementalCache?: V4IncrementalCache;
    }): Promise<V4ProcessResult> {
        return this.sendRequest('PROCESS_V4_CHUNK_WITH_FEATURES', params);
    }

    /**
     * Trigger timeout-based finalization of the pending sentence in the merger.
     * Call this when VAD detects extended silence.
     */
    async v4FinalizeTimeout(): Promise<V4TimeoutResult | null> {
        return this.sendRequest('V4_FINALIZE_TIMEOUT');
    }

    /**
     * Reset the v4 merger state.
     */
    async v4Reset(): Promise<void> {
        return this.sendRequest('V4_RESET');
    }

    dispose() {
        this.worker.terminate();
        this.pendingPromises.clear();
    }
}
