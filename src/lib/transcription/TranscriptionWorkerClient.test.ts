import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionWorkerClient } from './TranscriptionWorkerClient';

// Mock Worker class
class MockWorker {
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
    onerror: ((this: Worker, ev: ErrorEvent) => any) | null = null;

    constructor(stringUrl: string | URL, options?: WorkerOptions) {}

    postMessage(data: any) {
        // Simulate async response
        setTimeout(() => {
            if (this.onmessage) {
                const { type, id } = data;

                let responsePayload: any = undefined;

                // Simulate specific responses based on request type
                if (type === 'INIT_SERVICE') {
                    // void response
                } else if (type === 'PROCESS_CHUNK') {
                    responsePayload = {
                        chunkText: 'test',
                        text: 'test',
                        words: [],
                        totalDuration: 1.0,
                        isFinal: false
                    };
                } else if (type === 'LOAD_LOCAL_MODEL') {
                    // void response
                }

                // In the real worker, success messages usually allow the promise to resolve with the payload
                // The client handles: if type === 'ERROR' reject, else resolve(payload)

                // For void responses, payload is undefined.
                // For data responses, payload is the data.

                // The client handleMessage looks for id matching pending promise.
                // It resolves with payload.

                this.onmessage({
                    data: {
                        type: 'SUCCESS', // Type doesn't matter for promise resolution, only ID matters unless it is ERROR
                        id,
                        payload: responsePayload
                    }
                } as MessageEvent);
            }
        }, 0);
    }

    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
}

// Replace global Worker with MockWorker
const originalWorker = global.Worker;
global.Worker = MockWorker as any;

describe('TranscriptionWorkerClient', () => {
    let client: TranscriptionWorkerClient;

    beforeEach(() => {
        client = new TranscriptionWorkerClient();
    });

    afterEach(() => {
        client.dispose();
    });

    it('should initialize service', async () => {
        const config = { sampleRate: 16000 };
        await expect(client.initService(config)).resolves.toBeUndefined();
    });

    it('should process audio chunk', async () => {
        const audio = new Float32Array(16000);
        const result = await client.processChunk(audio);
        expect(result).toEqual({
            chunkText: 'test',
            text: 'test',
            words: [],
            totalDuration: 1.0,
            isFinal: false
        });
    });

    it('should load local model files', async () => {
        const file = new File([''], 'model.onnx');
        await expect(client.initLocalModel([file])).resolves.toBeUndefined();
    });
});

// Restore global Worker
afterEach(() => {
    // global.Worker = originalWorker;
    // We keep it mocked for all tests in this file.
    // Ideally we restore in afterAll or use vi.stubGlobal if available but direct assignment works here.
});
