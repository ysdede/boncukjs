/**
 * Keet v2.0 - Model Manager
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
const DEFAULT_MODEL_ID = 'parakeet-tdt-0.6b-v2';

const CACHE_NAME = 'keet-model-cache-v1';
const PARAKEET_DB_NAME = 'parakeet-cache-db';

type ModelConfigResolver = ((modelKeyOrRepoId: string) => { repoId?: string } | null) | undefined;

type ResolvedModelAssets = {
  urls: {
    encoderUrl: string;
    decoderUrl: string;
    tokenizerUrl: string;
    preprocessorUrl?: string;
    encoderDataUrl?: string | null;
    decoderDataUrl?: string | null;
  };
  filenames?: {
    encoder: string;
    decoder: string;
  };
  preprocessorBackend?: string;
};

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
   * Check if model is already cached (partial check)
   */
  async checkCache(): Promise<boolean> {
    // In v2.0 we rely on parakeet.js/IndexedDB cache, but we can do a quick check
    return this._isCached;
  }

  /**
   * Load the model with WebGPU/WASM fallback
   */
  async loadModel(config: { modelId?: string } = {}): Promise<void> {
    const modelId = config.modelId || DEFAULT_MODEL_ID;

    this._setState('loading');

    this._setProgress({
      stage: 'init',
      progress: 0,
      message: 'Initializing...'
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
      const { ParakeetModel, getParakeetModel, getModelConfig } = await import('parakeet.js');

      const createModelFromAssets = async (assets: ResolvedModelAssets): Promise<any> => {
        const preprocessorBackend = assets.preprocessorBackend || 'js';
        console.log(`[ModelManager] Loading model with backend=${this._backend}, preprocessorBackend=${preprocessorBackend}`);
        return ParakeetModel.fromUrls({
          ...assets.urls,
          filenames: assets.filenames,
          preprocessorBackend,
          backend: this._backend === 'webgpu' ? 'webgpu-hybrid' : 'wasm',
          verbose: false,
        });
      };

      // 3. Resolve model URLs via parakeet.js Hub (handles .data files correctly)
      this._setProgress({
        stage: 'resolve',
        progress: 20,
        message: 'Resolving model assets...'
      });

      const modelAssets = await getParakeetModel(modelId, {
        backend: this._backend,
        preprocessorBackend: 'js', // Use pure JS mel — faster, no ONNX download needed
        progress: (p: any) => {
          // Map parakeet.js progress to our UI
          const pct = Math.round(20 + (p.loaded / p.total) * 70);
          this._setProgress({
            stage: 'download',
            progress: pct,
            message: 'Downloading assets...',
            file: `${p.file} (${Math.round(p.loaded / 1024 / 1024)}MB)`
          });
        }
      });

      // 4. Load the model into ONNX Runtime
      this._setProgress({
        stage: 'compile',
        progress: 90,
        message: 'Compiling model (this may take a moment)...'
      });

      try {
        this._model = await createModelFromAssets(modelAssets as ResolvedModelAssets);
      } catch (loadError) {
        if (!this._isRecoverableFetchError(loadError)) {
          throw loadError;
        }

        console.warn('[ModelManager] Hub blob URL load failed, clearing stale cache and retrying with direct URLs');
        this._setProgress({
          stage: 'recover',
          progress: 35,
          message: 'Recovering stale model cache...'
        });

        await this._clearParakeetIndexedDbCache();

        const directAssets = this._buildDirectModelAssets(
          modelId,
          this._backend,
          getModelConfig as ModelConfigResolver
        );

        this._setProgress({
          stage: 'recover',
          progress: 55,
          message: 'Retrying model load...'
        });

        this._model = await createModelFromAssets(directAssets);
      }

      // Log which preprocessor the model is actually using
      const ppBackend = this._model.getPreprocessorBackend?.() || 'unknown';
      console.log(`[ModelManager] Model ready. Preprocessor: ${ppBackend === 'js' ? 'JS (mel.js) — no ONNX preprocessor loaded' : 'ONNX (nemo128.onnx)'}`);

      this._setProgress({ stage: 'complete', progress: 100, message: 'Model ready' });
      this._setState('ready');

      // Mark as offline ready
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
   * Side-load model from local files
   */
  async loadLocalModel(files: FileList): Promise<void> {
    this._setState('loading');
    this._setProgress({
      stage: 'init',
      progress: 0,
      message: 'Processing local files...'
    });

    try {
      const fileArray = Array.from(files);
      const findFile = (pattern: RegExp) => fileArray.find(f => pattern.test(f.name));

      // Map files to assets
      const assets = {
        encoder: findFile(/encoder.*\.onnx$/i),
        decoder: findFile(/decoder.*\.onnx$/i),
        tokenizer: findFile(/vocab.*\.txt$/i),
        preprocessor: findFile(/nemo.*\.onnx$/i),
        encoderData: findFile(/encoder.*\.onnx\.data$/i),
        decoderData: findFile(/decoder.*\.onnx\.data$/i),
      };

      // Validation — preprocessor ONNX is optional (JS backend is default)
      if (!assets.encoder || !assets.decoder || !assets.tokenizer) {
        const missing = [];
        if (!assets.encoder) missing.push('encoder-model.onnx');
        if (!assets.decoder) missing.push('decoder_joint-model.onnx');
        if (!assets.tokenizer) missing.push('vocab.txt');
        throw new Error(`Missing required files: ${missing.join(', ')}`);
      }

      const hasWebGPU = await this._detectWebGPU();
      this._backend = hasWebGPU ? 'webgpu' : 'wasm';

      this._setProgress({ stage: 'import', progress: 20, message: 'Initialising parakeet.js...' });
      const { ParakeetModel } = await import('parakeet.js');

      this._setProgress({ stage: 'compile', progress: 40, message: 'Compiling local model...' });

      // Use JS preprocessor by default; fall back to ONNX if preprocessor file is provided
      const useOnnxPreprocessor = !!assets.preprocessor;

      const urls: Record<string, string | undefined> = {
        encoderUrl: URL.createObjectURL(assets.encoder),
        decoderUrl: URL.createObjectURL(assets.decoder),
        tokenizerUrl: URL.createObjectURL(assets.tokenizer),
        encoderDataUrl: assets.encoderData ? URL.createObjectURL(assets.encoderData) : undefined,
        decoderDataUrl: assets.decoderData ? URL.createObjectURL(assets.decoderData) : undefined,
      };
      if (useOnnxPreprocessor) {
        urls.preprocessorUrl = URL.createObjectURL(assets.preprocessor!);
      }

      this._model = await ParakeetModel.fromUrls({
        ...urls,
        filenames: {
          encoder: assets.encoder.name,
          decoder: assets.decoder.name
        },
        preprocessorBackend: useOnnxPreprocessor ? 'onnx' : 'js',
        backend: this._backend === 'webgpu' ? 'webgpu-hybrid' : 'wasm',
        verbose: false,
      });

      this._setProgress({ stage: 'complete', progress: 100, message: 'Local model ready' });
      this._setState('ready');
      this._isOfflineReady = true;

    } catch (error) {
      console.error('Local model loading failed:', error);
      this._setState('error');
      this._setProgress({
        stage: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Failed to load local model'
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
      await this._clearParakeetIndexedDbCache();
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

  private _isRecoverableFetchError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('failed to fetch') || message.includes('fetch failed');
  }

  private _buildDirectModelAssets(
    modelId: string,
    backend: BackendType,
    getModelConfig: ModelConfigResolver
  ): ResolvedModelAssets {
    const repoId = getModelConfig?.(modelId)?.repoId || modelId;
    const revision = 'main';
    const encoderName = backend === 'webgpu' ? 'encoder-model.onnx' : 'encoder-model.int8.onnx';
    const decoderName = 'decoder_joint-model.int8.onnx';
    const baseUrl = `https://huggingface.co/${repoId}/resolve/${revision}`;

    return {
      urls: {
        encoderUrl: `${baseUrl}/${encoderName}`,
        decoderUrl: `${baseUrl}/${decoderName}`,
        tokenizerUrl: `${baseUrl}/vocab.txt`,
      },
      preprocessorBackend: 'js',
    };
  }

  private async _clearParakeetIndexedDbCache(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(PARAKEET_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.warn('[ModelManager] Failed to clear parakeet IndexedDB cache');
        resolve();
      };
      request.onblocked = () => {
        console.warn('[ModelManager] Parakeet IndexedDB cache clear blocked');
        resolve();
      };
    });
  }
}
