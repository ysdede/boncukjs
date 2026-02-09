import type {
    ModelProgress,
    ModelState,
    TranscriptionResult
} from './types';
import type { TokenStreamResult } from './TokenStreamTranscriber';
import type { MergerResult, MergerStats } from './UtteranceBasedMerger';

/** Incremental cache parameters for v4 transcription */
export interface V4IncrementalCache {
    cacheKey: string;
    prefixSeconds: number;
}

/** Result from v4 utterance-based processing (processed chunk) */
export interface V4ProcessResult {
    matureText: string;
    immatureText: string;
    matureCursorTime: number;
    fullText: string;
    metrics?: any;
    totalSentences: number;
    matureSentenceCount: number;
    pendingSentence: string | null;
    stats: MergerStats;
}

/** Result from v4 timeout finalization (subset of V4ProcessResult) */
export interface V4TimeoutResult {
    matureText: string;
    immatureText: string;
    matureCursorTime: number;
    fullText: string;
}

/** Discriminated union of all messages sent from the worker to the client */
export type WorkerMessage =
    // Reactive Notifications
    | { type: 'MODEL_PROGRESS'; payload: ModelProgress; id?: undefined }
    | { type: 'MODEL_STATE'; payload: ModelState; id?: undefined }
    | { type: 'V3_CONFIRMED'; payload: { text: string; words: any[] }; id?: undefined }
    | { type: 'V3_PENDING'; payload: { text: string; words: any[] }; id?: undefined }
    | { type: 'ERROR'; payload: string; id?: number } // Error can be notification or response

    // Responses to Requests
    | { type: 'INIT_MODEL_DONE'; payload?: undefined; id: number }
    | { type: 'INIT_SERVICE_DONE'; payload?: undefined; id: number }
    | { type: 'INIT_V3_SERVICE_DONE'; payload?: undefined; id: number }
    | { type: 'PROCESS_CHUNK_DONE'; payload: TranscriptionResult; id: number }
    | { type: 'PROCESS_V3_CHUNK_DONE'; payload: TokenStreamResult; id: number }
    | { type: 'PROCESS_V3_CHUNK_WITH_FEATURES_DONE'; payload: TokenStreamResult; id: number }
    | { type: 'TRANSCRIBE_SEGMENT_DONE'; payload: TranscriptionResult; id: number }
    | { type: 'RESET_DONE'; payload?: undefined; id: number }
    | { type: 'FINALIZE_DONE'; payload: TranscriptionResult | TokenStreamResult | MergerResult | { text: string }; id: number }
    | { type: 'INIT_V4_SERVICE_DONE'; payload?: undefined; id: number }
    | { type: 'PROCESS_V4_CHUNK_WITH_FEATURES_DONE'; payload: V4ProcessResult; id: number }
    | { type: 'V4_FINALIZE_TIMEOUT_DONE'; payload: V4TimeoutResult | null; id: number }
    | { type: 'V4_RESET_DONE'; payload?: undefined; id: number };
