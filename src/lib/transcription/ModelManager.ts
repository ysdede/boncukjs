/**
 * BoncukJS v2.0 - Model Manager
 * 
 * Handles loading, caching, and managing parakeet.js model lifecycle.
 * Supports WebGPU with WASM fallback.
 * Stories 2.2 & 2.3: Progress UI + Cache API
 */

import type {
  ModelState,
  BackendType,
  ModelConfig,
  ModelProgress,
  ModelManagerCallbacks
} from './types';

// Default model configuration (Parakeet TDT 0.6B)
const DEFAULT_MODEL: ModelConfig = {
  modelId: 'parakeet-tdt-0.6b-v3',
  encoderUrl: 'https://huggingface.co/nicoboss/parakeet-tdt-0.6b-v2-onnx/resolve/main/encoder-model.onnx',
  decoderUrl: 'https://huggingface.co/nicoboss/parakeet-tdt-0.6b-v2-onnx/resolve/main/decoder_joint-model.onnx',
  tokenizerUrl: 'https://huggingface.co/nicoboss/parakeet-tdt-0.6b-v2-onnx/resolve/main/vocab.txt',
  preprocessorUrl: 'https://huggingface.co/nicoboss/parakeet-tdt-0.6b-v2-onnx/resolve/main/nemo80.onnx',
};

const CACHE_NAME = 'boncukjs-model-cache-v1';

export class ModelManager {
  private _state: ModelState = 'unloaded';
  private _progress: number = 0;
  private _backend: BackendType = 'webgpu';
  private _model: any = null; // ParakeetModel instance
  private _callbacks: ModelManagerCallbacks = {};
  private _isOfflineReady: boolean = false;
  private _isCached: boolean = false;

  constructor(callbacks: ModelManagerCallbacks = {}) {
    this._callbacks = callbacks;
  }

  // Getters
  getState(): ModelState { return this._state; }
  getProgress(): number { return this._progress; }
  getBackend(): BackendType { return this._backend; }
  getModel(): any { return this._model; }
  isOfflineReady(): boolean { return this._isOfflineReady; }
  isCached(): boolean { return this._isCached; }

  /**
   * Check if model is already cached
   */
  async checkCache(): Promise<boolean> {
    try {
      const cache = await caches.open(CACHE_NAME);
      const encoderResponse = await cache.match(DEFAULT_MODEL.encoderUrl);
      this._isCached = !!encoderResponse;
      return this._isCached;
    } catch {
      return false;
    }
  }

  /**
   * Load the model with WebGPU/WASM fallback
   */
  async loadModel(config: Partial<ModelConfig> = {}): Promise<void> {
    const modelConfig = { ...DEFAULT_MODEL, ...config };

    this._setState('loading');

    // Check cache first
    const isCached = await this.checkCache();

    this._setProgress({
      stage: 'init',
      progress: 0,
      message: isCached ? 'Loading from cache...' : 'Initializing...'
    });

    try {
      // 1. Detect WebGPU support
      const hasWebGPU = await this._detectWebGPU();
      this._backend = hasWebGPU ? 'webgpu' : 'wasm';

      this._setProgress({
        stage: 'backend',
        progress: 10,
        message: `Using ${this._backend.toUpperCase()} backend`
      });

      // 2. Import parakeet.js dynamically
      this._setProgress({ stage: 'import', progress: 15, message: 'Loading parakeet.js...' });

      // @ts-ignore - parakeet.js is a JS module
      const { ParakeetModel } = await import('parakeet.js');

      // 3. Load the model (with download progress if not cached)
      this._setProgress({
        stage: 'download',
        progress: isCached ? 50 : 20,
        message: isCached ? 'Initializing model from cache...' : 'Downloading model (~300 MB)...'
      });

      this._model = await ParakeetModel.fromUrls({
        encoderUrl: modelConfig.encoderUrl,
        decoderUrl: modelConfig.decoderUrl,
        tokenizerUrl: modelConfig.tokenizerUrl,
        preprocessorUrl: modelConfig.preprocessorUrl,
        backend: this._backend === 'webgpu' ? 'webgpu-hybrid' : 'wasm',
        verbose: false,
      });

      this._setProgress({ stage: 'complete', progress: 100, message: 'Model ready' });
      this._setState('ready');

      // Mark as offline ready (model is now cached by parakeet.js/transformers.js)
      this._isOfflineReady = true;
      this._isCached = true;

    } catch (error) {
      console.error('Model loading failed:', error);
      this._setState('error');
      this._setProgress({
        stage: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Failed to load model'
      });
      this._callbacks.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Detect WebGPU availability
   */
  private async _detectWebGPU(): Promise<boolean> {
    // Cast navigator to any to access WebGPU API (not in all TypeScript defs)
    const nav = navigator as any;
    if (!nav.gpu) {
      console.log('WebGPU not supported in this browser');
      return false;
    }

    try {
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) {
        console.log('No WebGPU adapter found');
        return false;
      }

      const device = await adapter.requestDevice();
      device.destroy();

      console.log('WebGPU is available');
      return true;
    } catch (e) {
      console.log('WebGPU check failed:', e);
      return false;
    }
  }


  /**
   * Update state and notify callbacks
   */
  private _setState(state: ModelState): void {
    this._state = state;
    this._callbacks.onStateChange?.(state);
  }

  /**
   * Update progress and notify callbacks
   */
  private _setProgress(progress: ModelProgress): void {
    this._progress = progress.progress;
    this._callbacks.onProgress?.(progress);
  }

  /**
   * Clear cached model data
   */
  async clearCache(): Promise<void> {
    try {
      await caches.delete(CACHE_NAME);
      this._isCached = false;
      console.log('Model cache cleared');
    } catch (e) {
      console.error('Failed to clear cache:', e);
    }
  }

  /**
   * Dispose model and free resources
   */
  dispose(): void {
    this._model = null;
    this._state = 'unloaded';
    this._progress = 0;
  }
}
