import { Component } from 'solid-js';

export const PrivacyBadge: Component = () => {
    return (
        <div class="fixed bottom-12 right-6 z-30 group">
            <div class="bg-green-500/10 backdrop-blur-md border border-green-500/20 rounded-full px-4 py-2 flex items-center gap-2 shadow-lg hover:bg-green-500/20 transition-all cursor-help">
                <span class="material-icons-round text-green-500 text-sm">shield</span>
                <span class="text-xs font-bold text-green-600 dark:text-green-400">PRIVATE & SECURE</span>
            </div>

            <div class="absolute bottom-full right-0 mb-4 w-64 p-4 bg-white dark:bg-card-dark rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-all transform translate-y-2 group-hover:translate-y-0">
                <h4 class="font-bold text-sm mb-1">Local Processing</h4>
                <p class="text-[11px] text-gray-500 leading-relaxed">
                    Your audio never leaves this device. All transcription and AI processing happens locally in your browser's WebGPU sandbox.
                </p>
            </div>
        </div>
    );
};
