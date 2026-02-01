import { Component, createSignal, Show } from 'solid-js';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onToggleDebug: () => void;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  return (
    <div class="flex flex-row-reverse gap-4">
      <nav class="w-20 bg-white dark:bg-card-dark rounded-full shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col items-center py-6 gap-6 z-20">
        <button class="w-12 h-12 rounded-full bg-gray-900 dark:bg-slate-700 text-white flex items-center justify-center mb-4 hover:scale-105 transition-transform">
          <span class="material-icons-round">menu</span>
        </button>
        
        <div class="flex flex-col gap-4 w-full items-center">
          <button 
            class={`nav-item group relative w-12 h-12 flex items-center justify-center rounded-xl transition-all ${
              props.activeTab === 'devices' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary'
            }`}
            onClick={() => props.onTabChange('devices')}
          >
            <span class="material-icons-round text-2xl">mic_none</span>
            <span class="absolute left-full ml-4 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">Devices</span>
          </button>

          <button 
            class={`nav-item group relative w-12 h-12 flex items-center justify-center rounded-xl transition-all ${
              props.activeTab === 'ai' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary'
            }`}
            onClick={() => props.onTabChange('ai')}
          >
            <span class="material-icons-round text-2xl">psychology</span>
            <span class="absolute left-full ml-4 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">AI Services</span>
          </button>

          <button 
            class={`nav-item group relative w-12 h-12 flex items-center justify-center rounded-xl transition-all ${
              props.activeTab === 'transcript' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary'
            }`}
            onClick={() => props.onTabChange('transcript')}
          >
            <span class="material-icons-round text-2xl">text_fields</span>
            <Show when={props.activeTab === 'transcript'}>
              <span class="absolute right-2 top-2 w-2 h-2 bg-primary rounded-full"></span>
            </Show>
          </button>

          <button 
            class={`nav-item group relative w-12 h-12 flex items-center justify-center rounded-xl transition-all ${
              props.activeTab === 'translate' ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary'
            }`}
            onClick={() => props.onTabChange('translate')}
          >
            <span class="material-icons-round text-2xl">translate</span>
          </button>
        </div>

        <div class="mt-auto flex flex-col gap-4">
          <button 
            class="group relative w-12 h-12 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary transition-all" 
            onClick={() => props.onToggleDebug()}
            title="Toggle Developer Debug"
          >
            <span class="material-icons-round text-2xl">terminal</span>
          </button>
          <button class="group relative w-12 h-12 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-primary transition-all">
            <span class="material-icons-round text-2xl">settings</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
