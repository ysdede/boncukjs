/**
 * BoncukJS v2.0 - Model Loading Overlay
 * 
 * Shows download progress and status during model initialization.
 * Story 2.2: Model Download Progress UI
 */

import { Component, Show } from 'solid-js';

interface ModelLoadingOverlayProps {
    isVisible: boolean;
    progress: number;
    message: string;
    backend: 'webgpu' | 'wasm';
    isError: boolean;
    onRetry?: () => void;
}

export const ModelLoadingOverlay: Component<ModelLoadingOverlayProps> = (props) => {
    const progressWidth = () => `${Math.max(0, Math.min(100, props.progress))}%`;

    return (
        <Show when={props.isVisible}>
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
                <div class="w-full max-w-md mx-4">
                    {/* Card */}
                    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                        {/* Header */}
                        <div class="p-6 pb-4 text-center">
                            <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                                <Show
                                    when={!props.isError}
                                    fallback={<span class="material-icons-round text-white text-3xl">error_outline</span>}
                                >
                                    <span class="material-icons-round text-white text-3xl animate-pulse">psychology</span>
                                </Show>
                            </div>

                            <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
                                {props.isError ? 'Loading Failed' : 'Loading AI Model'}
                            </h2>

                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {props.message}
                            </p>
                        </div>

                        {/* Progress Section */}
                        <Show when={!props.isError}>
                            <div class="px-6 pb-6">
                                {/* Progress bar background */}
                                <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    {/* Progress bar fill */}
                                    <div
                                        class="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300 ease-out"
                                        style={{ width: progressWidth() }}
                                    />
                                </div>

                                {/* Progress percentage */}
                                <div class="flex justify-between mt-2 text-sm">
                                    <span class="text-gray-500 dark:text-gray-400 font-medium">
                                        {props.progress}%
                                    </span>
                                    <span class="text-gray-400 dark:text-gray-500">
                                        ~300 MB model
                                    </span>
                                </div>
                            </div>
                        </Show>

                        {/* Error state with retry button */}
                        <Show when={props.isError}>
                            <div class="px-6 pb-6">
                                <button
                                    onClick={() => props.onRetry?.()}
                                    class="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-xl hover:from-blue-600 hover:to-indigo-700 transition-all"
                                >
                                    Try Again
                                </button>
                            </div>
                        </Show>

                        {/* Backend badge */}
                        <div class="px-6 py-3 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center gap-2">
                            <span class="material-icons-round text-sm text-gray-400">memory</span>
                            <span class="text-xs text-gray-500 dark:text-gray-400">
                                {props.backend === 'webgpu' ? 'WebGPU Acceleration' : 'WASM Compatibility Mode'}
                            </span>
                        </div>
                    </div>

                    {/* First-time hint */}
                    <p class="text-center text-xs text-gray-400 mt-4">
                        First load downloads the model. Subsequent loads are instant.
                    </p>
                </div>
            </div>
        </Show>
    );
};
