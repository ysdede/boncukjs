import { Show } from 'solid-js';
import { useUI } from '../stores/uiStore';
import { useAudio } from '../stores/audioStore';
import { useSettings } from '../stores/settingsStore';
import { useTranscription } from '../stores/transcriptionStore';

import CompactStatsSnr from './CompactStatsSnr';
import ThemeToggle from './ThemeToggle';
import AudioInputSelector from './AudioInputSelector';
import { segmentationPresets } from '../config/audioParams.js';
import { audioManager } from '../AudioManager';

export default function AppHeader(props) {
  const [ui, { setActiveTab, toggleWaveformVisibility, toggleSettingsPanel, toggleModelSettingsPanel }] = useUI();
  const [audio] = useAudio();
  const [settings] = useSettings();
  const [transcription] = useTranscription();

  return (
    <header class="app-header">
      <div class="header-left flex items-center gap-4">
        <div class="tabs flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
          <button 
            class="tab-button"
            classList={{ active: ui.activeTab === 'live' }}
            onClick={() => setActiveTab('live')}
            title="Live View"
          >
            <span class="material-icons text-base">sensors</span>
          </button>
          <button 
            class="tab-button"
            classList={{ active: ui.activeTab === 'offline' }}
            onClick={() => setActiveTab('offline')}
            title="Offline Test"
          >
            <span class="material-icons text-base">science</span>
          </button>
        </div>

        {/* Audio device selector */}
        <AudioInputSelector />

        {/* Model settings button */}
        <button
          class="btn btn-icon-sm btn-ghost"
          classList={{ 'btn-active': ui.isModelSettingsPanelOpen }}
          onClick={() => toggleModelSettingsPanel()}
          title="Model Settings"
        >
          <span class="material-icons">biotech</span>
        </button>
      </div>
      
      <div class="header-center flex-1 flex justify-center items-center px-2">
        <Show when={ui.activeTab === 'live' && (audio.recording || audioManager)}>
          <CompactStatsSnr 
            processor={audioManager?.processor} 
            audioManager={audioManager}
            audioContext={props.audioContext}
            snrThreshold={settings.snrThreshold}
            minSnrThreshold={settings.minSnrThreshold}
            wpmOverall={transcription.stats?.wpmOverall ?? 0}
            wpmRolling={transcription.stats?.wpmRolling ?? 0}
            isHeaderMode={true}
          />
        </Show>
      </div>
      
      <div class="header-right flex items-center gap-2">
        <button 
          class="btn btn-icon-sm"
          classList={{ 'btn-danger btn-recording': audio.recording, 'btn-primary': !audio.recording }}
          onClick={audio.recording ? props.handleStopAudio : props.handleStartAudio}
          disabled={props.status() === 'loading' || audio.audioDevices.length === 0}
          title={audio.recording ? "Stop recording" : "Start recording"}
        >
          <span class="material-icons">{audio.recording ? 'stop' : 'mic'}</span>
        </button>
        
        <button 
          class="btn btn-icon-sm btn-ghost"
          classList={{ 'btn-active': ui.isWaveformVisible }}
          onClick={toggleWaveformVisibility}
          title={ui.isWaveformVisible ? "Hide waveform visualization" : "Show waveform visualization"}
        >
          <span class="material-icons">{ui.isWaveformVisible ? 'show_chart' : 'equalizer'}</span>
        </button>

        <button
          class="btn btn-icon-sm btn-ghost"
          onClick={props.cycleSegmentationPreset}
          title={`Current Preset: ${segmentationPresets[settings.segmentationPreset]?.name || settings.segmentationPreset}`}
        >
          <span class="material-icons">
            {segmentationPresets[settings.segmentationPreset]?.icon || 'settings'} 
          </span>
        </button>

        <button 
          class="btn btn-icon-sm btn-ghost"
          classList={{ 'btn-active': ui.isSettingsPanelOpen }}
          onClick={toggleSettingsPanel}
          title={ui.isSettingsPanelOpen ? 'Close settings' : 'Open settings'}
        >
          <span class="material-icons">{ui.isSettingsPanelOpen ? 'close' : 'settings'}</span>
        </button>
        
        {/* WebSocket button removed in local Parakeet.js mode */}
        
        <button 
          class="btn btn-icon-sm btn-ghost"
          onClick={props.handleSaveSession}
          disabled={props.isSavingSession() || !props.worker()}
          title={props.isSavingSession() ? "Saving session data..." : "Save current session data to JSON"}
        >
          <span class="material-icons">{props.isSavingSession() ? 'hourglass_top' : 'save'}</span>
        </button>
        
        <ThemeToggle />
      </div>
    </header>
  );
} 