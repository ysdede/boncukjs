import { Component, Show } from 'solid-js';
import { appStore } from '../stores/appStore';

export const StatusBar: Component = () => {
    const modelStatusText = () => {
        switch (appStore.modelState()) {
            case 'unloaded': return 'Model not loaded';
            case 'loading': return appStore.modelMessage() || `Loading... ${appStore.modelProgress()}%`;
            case 'ready': return 'Ready';
            case 'error': return 'Error';
            default: return '';
        }
    };

    const statusDotClass = () => {
        switch (appStore.modelState()) {
            case 'ready': return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
            case 'loading': return 'bg-yellow-500 animate-pulse';
            case 'error': return 'bg-red-500';
            default: return 'bg-gray-400';
        }
    };

    return (
        <div class="flex-none h-8 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-gray-800 px-4 flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest transition-colors duration-300">
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-2">
                    <div class={`w-2 h-2 rounded-full ${statusDotClass()}`}></div>
                    <span class="text-gray-600 dark:text-gray-300">{modelStatusText()}</span>
                </div>

                <div class="flex items-center gap-2 border-l border-gray-200 dark:border-gray-800 pl-6">
                    <span class="material-icons-round text-sm text-gray-400">memory</span>
                    <span class="text-gray-500">BACKEND: <span class="text-primary">{appStore.backend().toUpperCase()}</span></span>
                </div>
            </div>

            <div class="flex items-center gap-6">
                <Show when={appStore.isOfflineReady()}>
                    <div class="flex items-center gap-1.5 text-blue-500 dark:text-blue-400">
                        <span class="material-icons-round text-sm">offline_bolt</span>
                        <span>100% On-Device</span>
                    </div>
                </Show>
                <div class="flex items-center gap-1.5">
                    <div class={`w-1.5 h-1.5 rounded-full ${appStore.isOnline() ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span class="text-gray-500">{appStore.isOnline() ? 'Sync: Connected' : 'Sync: Offline'}</span>
                </div>
            </div>
        </div>
    );
};
