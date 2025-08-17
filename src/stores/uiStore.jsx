import { createStore, produce } from "solid-js/store";
import { createContext, useContext, onMount, createEffect } from "solid-js";

export const UIContext = createContext();

const initialState = {
    isSettingsPanelOpen: false,
    darkMode: false,
    activeTab: 'live',
    isPlainTextVisible: true,
    isMergedTranscriptionVisible: true,
    isWaveformVisible: true,
    transcriptDisplayMode: 'plain',
    autoScrollEnabled: true,
    mergedTranscriptionWidgetLoaded: false,
    showLivePreview: false,
    isModelSettingsPanelOpen: false,
};

export function UIProvider(props) {
  const [state, setState] = createStore({ ...initialState });

  onMount(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setState('darkMode', true);
    }
  });
  
  createEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  });

  const store = [
    state,
    {
      toggleSettingsPanel(isOpen) {
        setState('isSettingsPanelOpen', isOpen ?? !state.isSettingsPanelOpen);
      },
      toggleDarkMode() {
        setState("darkMode", (o) => !o);
      },
      setDarkMode(isDark) {
        setState("darkMode", isDark);
      },
      setActiveTab(tab) {
        setState("activeTab", tab);
      },
      setAutoScrollEnabled(enabled) {
        setState('autoScrollEnabled', enabled);
      },
      setMergedTranscriptionWidgetLoaded(loaded) {
        setState('mergedTranscriptionWidgetLoaded', loaded);
      },
      setShowLivePreview(show) {
        setState('showLivePreview', show);
      },
      togglePlainTextVisibility() {
        setState('isPlainTextVisible', (visible) => !visible);
      },
      toggleMergedTranscriptionVisibility() {
        setState('isMergedTranscriptionVisible', (visible) => !visible);
      },
      toggleWaveformVisibility() {
        setState('isWaveformVisible', (visible) => !visible);
      },
      setTranscriptDisplayMode(mode) {
        setState('transcriptDisplayMode', mode);
      },
      toggleModelSettingsPanel(isOpen) {
        setState('isModelSettingsPanelOpen', isOpen ?? !state.isModelSettingsPanelOpen);
      }
    }
  ];

  return (
    <UIContext.Provider value={store}>
      {props.children}
    </UIContext.Provider>
  );
}

export function useUI() { return useContext(UIContext); } 