import { Component, Show, For } from 'solid-js';

interface ModelLoadingOverlayProps {
    isVisible: boolean;
    progress: number;
    message: string;
    backend: 'webgpu' | 'wasm';
    state: 'unloaded' | 'loading' | 'ready' | 'error';
    selectedModelId: string;
    onModelSelect: (id: string) => void;
    onStart: () => void;
}

const MODELS = [
    { id: 'parakeet-tdt-0.6b-v2', name: 'Parakeet v2', desc: 'English optimized (Smallest)' },
    { id: 'parakeet-tdt-0.6b-v3', name: 'Parakeet v3', desc: 'Multilingual (Higher accuracy)' },
];

export const ModelLoadingOverlay: Component<ModelLoadingOverlayProps> = (props) => {
    const progressWidth = () => `${Math.max(0, Math.min(100, props.progress))}%`;

    return (
        <Show when={props.isVisible}>
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]">
                <div class="w-full max-w-md mx-4">

                    {/* Card */}
                    <div class="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-300">
                        {/* Header */}
                        <div class="p-8 pb-4 text-center">
                            <div class="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl ring-4 ring-blue-500/20">
                                <Show
                                    when={props.state !== 'error'}
                                    fallback={<span class="material-icons-round text-white text-4xl">error_outline</span>}
                                >
                                    <span class={`material-icons-round text-white text-4xl ${props.state === 'loading' ? 'animate-pulse' : ''}`}>
                                        {props.state === 'loading' ? 'auto_awesome' : 'model_training'}
                                    </span>
                                </Show>
                            </div>

                            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                                {props.state === 'unloaded' ? 'Select AI Model' :
                                    props.state === 'error' ? 'Loading Failed' : 'Loading Model'}
                            </h2>

                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                                {props.state === 'unloaded' ? 'Choose the engine for your transcription session.' : props.message}
                            </p>
                        </div>

                        {/* Selection Mode */}
                        <Show when={props.state === 'unloaded'}>
                            <div class="px-8 pb-8 space-y-3">
                                <div class="grid gap-3">
                                    <For each={MODELS}>
                                        {(model) => (
                                            <button
                                                onClick={() => props.onModelSelect(model.id)}
                                                class={`flex items-center text-left p-4 rounded-2xl border-2 transition-all ${props.selectedModelId === model.id
                                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                                    : 'border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'
                                                    }`}
                                            >
                                                <div class={`w-5 h-5 rounded-full border-2 mr-4 flex-none items-center justify-center flex ${props.selectedModelId === model.id ? 'border-blue-500' : 'border-gray-300'
                                                    }`}>
                                                    <Show when={props.selectedModelId === model.id}>
                                                        <div class="w-2.5 h-2.5 bg-blue-500 rounded-full" />
                                                    </Show>
                                                </div>
                                                <div>
                                                    <div class="font-semibold text-gray-900 dark:text-white">{model.name}</div>
                                                    <div class="text-xs text-gray-500 dark:text-gray-400">{model.desc}</div>
                                                </div>
                                            </button>
                                        )}
                                    </For>
                                </div>

                                <button
                                    onClick={() => props.onStart()}
                                    class="w-full mt-6 py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/25 active:scale-[0.98] transition-all"
                                >
                                    Start Loading
                                </button>
                            </div>
                        </Show>

                        {/* Progress Mode */}
                        <Show when={props.state === 'loading'}>
                            <div class="px-8 pb-8">
                                <div class="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        class="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300 ease-out"
                                        style={{ width: progressWidth() }}
                                    />
                                </div>

                                <div class="flex justify-between mt-3 text-sm font-medium">
                                    <span class="text-blue-500">
                                        {props.progress}%
                                    </span>
                                    <span class="text-gray-400 dark:text-gray-500 uppercase tracking-tighter text-xs">
                                        ~300 MB model
                                    </span>
                                </div>
                            </div>
                        </Show>

                        {/* Error Mode */}
                        <Show when={props.state === 'error'}>
                            <div class="px-8 pb-8">
                                <button
                                    onClick={() => props.onStart()}
                                    class="w-full py-4 bg-red-500 text-white font-bold rounded-2xl hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                                >
                                    Retry Loading
                                </button>
                            </div>
                        </Show>

                        {/* Footer / Backend Info */}
                        <div class="px-8 py-4 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="material-icons-round text-sm text-gray-400">memory</span>
                                <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                                    {props.backend === 'webgpu' ? 'WebGPU Acceleration' : 'WASM Compatibility'}
                                </span>
                            </div>
                            <span class="text-[10px] text-gray-400 uppercase font-bold tracking-widest">
                                BoncukJS v2.0
                            </span>
                        </div>
                    </div>

                    <p class="text-center text-xs text-slate-500 mt-6 font-medium">
                        Model assets are cached in your browser after the first download.
                    </p>
                </div>
            </div>
        </Show>
    );
};

