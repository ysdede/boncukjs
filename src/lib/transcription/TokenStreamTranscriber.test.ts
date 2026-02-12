import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenStreamTranscriber } from './TokenStreamTranscriber';
import { ModelManager } from './ModelManager';

// Mock parakeet.js
const mockMergerInstance = {
    processChunk: vi.fn(),
    getText: vi.fn(),
    reset: vi.fn(),
    getState: vi.fn(),
};

vi.mock('parakeet.js', () => {
    return {
        LCSPTFAMerger: class {
            constructor() {
                return mockMergerInstance;
            }
        },
    };
});

// Mock ModelManager
const mockModel = {
    transcribe: vi.fn(),
    tokenizer: {},
    getFrameTimeStride: vi.fn(() => 0.08),
};

const mockModelManager = {
    getModel: vi.fn(() => mockModel),
} as unknown as ModelManager;

describe('TokenStreamTranscriber', () => {
    let transcriber: TokenStreamTranscriber;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMergerInstance.processChunk.mockReturnValue({
            lcsLength: 5,
            anchorValid: true,
            anchorTokens: ['a', 'b'],
            confirmed: [],
            pending: [],
        });
        mockMergerInstance.getText.mockReturnValue({
            confirmed: 'Hello',
            pending: ' world',
            full: 'Hello world',
        });
        mockModel.transcribe.mockResolvedValue({
            metrics: {
                total_ms: 100,
            },
            // ... other result properties
        });
        transcriber = new TokenStreamTranscriber(mockModelManager);
    });

    it('processChunk should call model.transcribe and merger.processChunk', async () => {
        await transcriber.initialize();

        const audio = new Float32Array(16000 * 2);
        const result = await transcriber.processChunk(audio, 0);

        expect(mockModel.transcribe).toHaveBeenCalled();
        expect(mockMergerInstance.processChunk).toHaveBeenCalled();
        expect(result.fullText).toBe('Hello world');
        expect(result.chunkCount).toBe(1);
    });

    it('processChunkWithFeatures should call model.transcribe and merger.processChunk', async () => {
        await transcriber.initialize();

        const features = new Float32Array(80 * 100);
        const result = await transcriber.processChunkWithFeatures(features, 100, 80, 0, 0);

        expect(mockModel.transcribe).toHaveBeenCalledWith(
            null,
            expect.any(Number),
            expect.objectContaining({
                precomputedFeatures: expect.objectContaining({ features }),
            })
        );
        expect(mockMergerInstance.processChunk).toHaveBeenCalled();
        expect(result.fullText).toBe('Hello world');
        expect(result.chunkCount).toBe(1);
    });
});
