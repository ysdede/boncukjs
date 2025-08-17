import { createSignal, For, Show } from 'solid-js';
import LanguageSelector from './LanguageSelector';
import { useSettings } from '../stores/settingsStore';
import { useAudio } from '../stores/audioStore';
import { models as availableModels } from '../config/models.js';
import { promptTemplates } from '../config/prompts.js';
import audioParams from '../config/audioParams.js';
import { AVAILABLE_MODELS } from '../constants.js';

function SettingsWidget(props) {
  const [settings, { updateSetting, saveSettings }] = useSettings();
  const [audio, { setSelectedDeviceId }] = useAudio();

  const [openSections, setOpenSections] = createSignal({
    devices: true, model: true, aiServices: false, segmentation: false,
    segmentationSpeed: false, vadAdvanced: false, snrSettings: false,
    adaptiveEnergy: false, finalization: false, matureCursor: false, segmentFilter: false
  });

  const toggleSection = (section) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleTextChange = (setting, value) => updateSetting(setting, value);
  const handleNumberChange = (setting, value) => updateSetting(setting, parseFloat(value));
  const handleIntChange = (setting, value) => updateSetting(setting, parseInt(value, 10));
  const handleCheckboxChange = (setting, checked) => updateSetting(setting, checked);
  const handleDeviceChange = (deviceId) => {
    updateSetting('selectedDeviceId', deviceId);
    setSelectedDeviceId(deviceId); // Also update the audio store
  };

  return (
    <div class="settings-widget">
      {/* Device and Recording Section */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('devices')} aria-expanded={openSections().devices}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Recording Devices</span>
        </button>
        <Show when={openSections().devices}>
          <div class="section-content">
            <div class="form-group">
              <label for="device-select" class="form-label">Audio Device</label>
              <select 
                id="device-select" 
                value={settings.selectedDeviceId} 
                onChange={(e) => handleDeviceChange(e.target.value)} 
                disabled={audio.recording || audio.audioDevices.length === 0}
                class="form-control form-select"
              >
                <For each={audio.audioDevices}>
                  {(device) => (
                    <option value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={settings.autoGainEnabled} 
                  onChange={(e) => handleCheckboxChange('autoGainEnabled', e.target.checked)} 
                  disabled={audio.recording}
                  class="form-check-input"
                />
                <span class="form-check-label">Auto Gain Control</span>
              </label>
            </div>
            <div class="form-group">
              <label for="audio-format-select" class="form-label">Audio Format</label>
              <select 
                id="audio-format-select" 
                value={settings.audioFormat} 
                onChange={(e) => handleTextChange('audioFormat', e.target.value)} 
                disabled={audio.recording}
                class="form-control form-select"
              >
                <option value="int16-lz4">INT16-LZ4 (Compressed)</option>
                <option value="float32">FLOAT32 (Original)</option>
              </select>
            </div>
          </div>
        </Show>
      </div>
      {/* AI Services Section */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('aiServices')} aria-expanded={openSections().aiServices}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">AI Services</span>
        </button>
        <Show when={openSections().aiServices}>
          <div class="section-content">
            <div class="form-group">
              <label for="gemini-api-key" class="form-label">Gemini API Key</label>
              <input id="gemini-api-key" type="password" placeholder="Enter your Gemini API key" class="form-control" value={settings.geminiApiKey} onInput={(e) => handleTextChange('geminiApiKey', e.target.value)} />
            </div>
            <div class="form-group">
              <label for="sentence-count" class="form-label">
                Context Sentences
                <span class="range-value">{settings.contextSentenceCount}</span>
              </label>
              <input id="sentence-count" type="range" min="1" max="100" step="1" value={settings.contextSentenceCount} onInput={(e) => handleIntChange('contextSentenceCount', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
              <label for="sentence-overlap" class="form-label">
                Sentence Overlap
                <span class="range-value">{settings.sentenceOverlap}</span>
              </label>
              <input id="sentence-overlap" type="range" min="0" max="10" step="1" value={settings.sentenceOverlap} onInput={(e) => handleIntChange('sentenceOverlap', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
              <label for="prompt-select" class="form-label">Prompt Template</label>
              <select id="prompt-select" value={settings.selectedPromptKey} onChange={(e) => handleTextChange('selectedPromptKey', e.target.value)} class="form-control form-select">
                <For each={Object.entries(promptTemplates)}>
                  {([key, { name }]) => <option value={key}>{name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label for="model-select-ai" class="form-label">AI Model</label>
              <select id="model-select-ai" value={settings.selectedModelId} onChange={(e) => handleTextChange('selectedModelId', e.target.value)} class="form-control form-select">
                <For each={Object.entries(availableModels)}>
                  {([id, { name }]) => <option value={id}>{name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" checked={settings.includeReasoning} onChange={(e) => handleCheckboxChange('includeReasoning', e.target.checked)} class="form-check-input" />
                <span class="form-check-label">Include Reasoning in Output</span>
              </label>
            </div>
            <div class="form-group">
              <button onClick={() => props.onOpenPromptEditor?.()} class="btn btn-sm btn-primary w-full">Edit Prompt Template</button>
            </div>
            <div class="form-group">
                <button
                    onClick={() => props.onClearSettings?.()}
                    class="btn btn-xs btn-secondary w-full"
                    title="Clear all saved settings from local storage and reload the page."
                >
                    Clear Saved Settings
                </button>
            </div>
            <div class="form-group">
                <button
                    onClick={() => saveSettings()}
                    class="btn btn-xs btn-secondary w-full"
                    title="Force save current settings to localStorage (debug)"
                >
                    Force Save Settings
                </button>
            </div>
          </div>
        </Show>
      </div>
      {/* Model and Language Section */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('model')} aria-expanded={openSections().model}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Model & Language</span>
        </button>
        <Show when={openSections().model}>
          <div class="section-content">
            <div class="form-group">
              <label for="model-select-transcription" class="form-label">Transcription Model</label>
              <select id="model-select-transcription" value={settings.selectedModel} onChange={(e) => handleTextChange('selectedModel', e.target.value)} disabled class="form-control form-select">
                <For each={Object.values(AVAILABLE_MODELS)}>
                  {(model) => <option value={model.id}>{model.name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label for="language-select" class="form-label">Language</label>
              <LanguageSelector id="language-select" value={settings.language} onChange={(value) => handleTextChange('language', value)} disabled class="form-control form-select" />
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" checked={settings.useVadFilter} onChange={(e) => handleCheckboxChange('useVadFilter', e.target.checked)} disabled={audio.recording} class="form-check-input" />
                <span class="form-check-label">Enable VAD Filter</span>
              </label>
            </div>
            <div class="form-group">
              <label for="beamSize" class="form-label">
                Beam Size
                <span class="range-value">{settings.beamSize === 1 ? 'greedy_batch' : settings.beamSize}</span>
              </label>
              <input id="beamSize" type="range" min="1" max="10" step="1" value={settings.beamSize} onInput={(e) => handleNumberChange('beamSize', e.target.value)} disabled class="form-range" />
            </div>
            <div class="form-group">
              <label for="temperature" class="form-label">
                Temperature
                <span class="range-value">{settings.temperature.toFixed(1)}</span>
              </label>
              <input id="temperature" type="range" min="0" max="1" step="0.1" value={settings.temperature} onInput={(e) => handleNumberChange('temperature', e.target.value)} disabled class="form-range" />
            </div>
          </div>
        </Show>
      </div>
      {/* Segmentation Strategy Section */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('segmentation')} aria-expanded={openSections().segmentation}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Segmentation Strategy</span>
        </button>
        <Show when={openSections().segmentation && settings.useVadFilter}>
          <div class="section-content">
            <div class="form-group">
              <label for="segmentation-preset-select" class="form-label">Speed Preset</label>
              <select id="segmentation-preset-select" value={settings.segmentationPreset} onChange={(e) => handleTextChange('segmentationPreset', e.target.value)} disabled={audio.recording} class="form-control form-select">
                <For each={Object.entries(audioParams.segmentationPresets)}>
                  {([key, preset]) => <option value={key}>{preset.name}</option>}
                </For>
              </select>
            </div>
          </div>
        </Show>
      </div>
      {/* Segmentation Speed Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('segmentationSpeed')} aria-expanded={openSections().segmentationSpeed}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Segmentation Speed Settings</span>
        </button>
        <Show when={openSections().segmentationSpeed && settings.useVadFilter}>
          <div class="section-content">
            <div class="form-group">
              <label for="vadThreshold" class="form-label">
                Threshold
                <span class="range-value">{settings.audioThreshold.toFixed(3)}</span>
              </label>
              <input id="vadThreshold" type="range" min="0.01" max="0.5" step="0.01" value={settings.audioThreshold} onInput={(e) => handleNumberChange('audioThreshold', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
              <label for="silenceLength" class="form-label">
                Silence Length (s)
                <span class="range-value">{settings.silenceLength.toFixed(2)}</span>
              </label>
              <input id="silenceLength" type="range" min="0.1" max="2.0" step="0.1" value={settings.silenceLength} onInput={(e) => handleNumberChange('silenceLength', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
                <label for="speechHangover" class="form-label">
                    Speech Hangover (s)
                    <span class="range-value">{settings.speechHangover.toFixed(2)}</span>
                </label>
                <input id="speechHangover" type="range" min="0.08" max="1.6" step="0.02" value={settings.speechHangover} onInput={(e) => handleNumberChange('speechHangover', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
                <label for="maxSegmentDuration" class="form-label">
                    Max Segment Duration (s)
                    <span class="range-value">{settings.maxSegmentDuration.toFixed(1)}</span>
                </label>
                <input id="maxSegmentDuration" type="range" min="0.4" max="12.0" step="0.4" value={settings.maxSegmentDuration} onInput={(e) => handleNumberChange('maxSegmentDuration', e.target.value)} class="form-range" />
            </div>
          </div>
        </Show>
      </div>
      {/* VAD Advanced Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('vadAdvanced')} aria-expanded={openSections().vadAdvanced}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">VAD Advanced</span>
        </button>
        <Show when={openSections().vadAdvanced && settings.useVadFilter}>
          <div class="section-content">
            <div class="flex-col">
              <div class="form-group">
                <label for="vadEnergyScale" class="form-label">
                  Energy Scale
                  <span class="range-value">{settings.energyScale.toFixed(1)}</span>
                </label>
                <input id="vadEnergyScale" type="range" min="0" max="10" step="0.1" value={settings.energyScale} onInput={(e) => handleNumberChange('energyScale', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadHysteresisRatio" class="form-label">
                  Hysteresis Ratio
                  <span class="range-value">{settings.hysteresisRatio.toFixed(1)}</span>
                </label>
                <input id="vadHysteresisRatio" type="range" min="1.0" max="2.0" step="0.1" value={settings.hysteresisRatio} onInput={(e) => handleNumberChange('hysteresisRatio', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadMinSpeechDuration" class="form-label">
                  Min Speech Duration (s)
                  <span class="range-value">{settings.minSpeechDuration.toFixed(1)}</span>
                </label>
                <input id="vadMinSpeechDuration" type="range" min="0.0" max="1.0" step="0.1" value={settings.minSpeechDuration} onInput={(e) => handleNumberChange('minSpeechDuration', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadMaxSilenceWithinSpeech" class="form-label">
                  Max Silence Within Speech (s)
                  <span class="range-value">{settings.maxSilenceWithinSpeech.toFixed(1)}</span>
                </label>
                <input id="vadMaxSilenceWithinSpeech" type="range" min="0.0" max="1.0" step="0.1" value={settings.maxSilenceWithinSpeech} onInput={(e) => handleNumberChange('maxSilenceWithinSpeech', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadEndingSpeechTolerance" class="form-label">
                  Ending Speech Tolerance (s)
                  <span class="range-value">{settings.endingSpeechTolerance.toFixed(1)}</span>
                </label>
                <input id="vadEndingSpeechTolerance" type="range" min="0.0" max="1.0" step="0.1" value={settings.endingSpeechTolerance} onInput={(e) => handleNumberChange('endingSpeechTolerance', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadEndingEnergyThreshold" class="form-label">
                  Ending Energy Threshold
                  <span class="range-value">{settings.endingEnergyThreshold.toFixed(2)}</span>
                </label>
                <input id="vadEndingEnergyThreshold" type="range" min="0.01" max="1.0" step="0.01" value={settings.endingEnergyThreshold} onInput={(e) => handleNumberChange('endingEnergyThreshold', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadMinEnergyIntegral" class="form-label">
                  Min Energy Integral
                  <span class="range-value">{settings.minEnergyIntegral}</span>
                </label>
                <input id="vadMinEnergyIntegral" type="range" min="0" max="100" step="1" value={settings.minEnergyIntegral} onInput={(e) => handleIntChange('minEnergyIntegral', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadMinEnergyPerSecond" class="form-label">
                  Min Energy Per Second
                  <span class="range-value">{settings.minEnergyPerSecond}</span>
                </label>
                <input id="vadMinEnergyPerSecond" type="range" min="0" max="30" step="1" value={settings.minEnergyPerSecond} onInput={(e) => handleIntChange('minEnergyPerSecond', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadLookbackDuration" class="form-label">
                  Lookback Duration (s)
                  <span class="range-value">{settings.lookbackDuration.toFixed(3)}</span>
                </label>
                <input id="vadLookbackDuration" type="range" min="0.0" max="0.5" step="0.080" value={settings.lookbackDuration} onInput={(e) => handleNumberChange('lookbackDuration', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="vadOverlapDuration" class="form-label">
                  Overlap Duration (s)
                  <span class="range-value">{settings.overlapDuration.toFixed(3)}</span>
                </label>
                <input id="vadOverlapDuration" type="range" min="0.0" max="0.5" step="0.040" value={settings.overlapDuration} onInput={(e) => handleNumberChange('overlapDuration', e.target.value)} class="form-range" />
              </div>
            </div>
          </div>
        </Show>
      </div>
      
      {/* SNR Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('snrSettings')} aria-expanded={openSections().snrSettings}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">SNR & Noise Adaptation</span>
        </button>
        <Show when={openSections().snrSettings && settings.useVadFilter}>
          <div class="section-content">
            <div class="flex-col">
              <div class="form-group">
                <label for="snrThreshold" class="form-label">
                  SNR Threshold (dB)
                  <span class="range-value">{settings.snrThreshold.toFixed(1)}</span>
                </label>
                <input id="snrThreshold" type="range" min="0" max="10" step="0.5" value={settings.snrThreshold} onInput={(e) => handleNumberChange('snrThreshold', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="minSnrThreshold" class="form-label">
                  Min SNR Threshold (dB)
                  <span class="range-value">{settings.minSnrThreshold.toFixed(1)}</span>
                </label>
                <input id="minSnrThreshold" type="range" min="-1.0" max="5" step="0.1" value={settings.minSnrThreshold} onInput={(e) => handleNumberChange('minSnrThreshold', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="noiseFloorAdaptationRate" class="form-label">
                  Noise Adaptation Rate
                  <span class="range-value">{settings.noiseFloorAdaptationRate.toFixed(2)}</span>
                </label>
                <input id="noiseFloorAdaptationRate" type="range" min="0.01" max="0.2" step="0.01" value={settings.noiseFloorAdaptationRate} onInput={(e) => handleNumberChange('noiseFloorAdaptationRate', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="fastAdaptationRate" class="form-label">
                  Fast Adaptation Rate
                  <span class="range-value">{settings.fastAdaptationRate.toFixed(2)}</span>
                </label>
                <input id="fastAdaptationRate" type="range" min="0.05" max="0.5" step="0.05" value={settings.fastAdaptationRate} onInput={(e) => handleNumberChange('fastAdaptationRate', e.target.value)} class="form-range" />
              </div>
              <div class="form-group">
                <label for="energyRiseThreshold" class="form-label">
                  Energy Rise Threshold
                  <span class="range-value">{settings.energyRiseThreshold.toFixed(2)}</span>
                </label>
                <input id="energyRiseThreshold" type="range" min="0.01" max="0.2" step="0.01" value={settings.energyRiseThreshold} onInput={(e) => handleNumberChange('energyRiseThreshold', e.target.value)} class="form-range" />
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Adaptive Energy Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('adaptiveEnergy')} aria-expanded={openSections().adaptiveEnergy}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Adaptive Energy</span>
        </button>
        <Show when={openSections().adaptiveEnergy && settings.useVadFilter}>
          <div class="section-content">
            <div class="flex-col">
              <div class="form-group">
                <label class="checkbox-label">
                  <input type="checkbox" checked={settings.useAdaptiveEnergyThresholds} onChange={(e) => handleCheckboxChange('useAdaptiveEnergyThresholds', e.target.checked)} class="form-check-input" />
                  <span class="form-check-label">Enable Adaptive Energy Thresholds</span>
                </label>
              </div>
              
              <div class="form-group">
                <label for="adaptiveEnergyIntegralFactor" class="form-label">
                  Integral Factor
                  <span class="range-value">{settings.adaptiveEnergyIntegralFactor}</span>
                </label>
                <input id="adaptiveEnergyIntegralFactor" type="range" min="1" max="100" step="1" value={settings.adaptiveEnergyIntegralFactor} onInput={(e) => handleIntChange('adaptiveEnergyIntegralFactor', e.target.value)} class="form-range" disabled={!settings.useAdaptiveEnergyThresholds} />
                <p class="help-text text-xs">Multiplier for noise floor to set energy integral threshold.</p>
              </div>
              
              <div class="form-group">
                <label for="adaptiveEnergyPerSecondFactor" class="form-label">
                  Energy/s Factor
                  <span class="range-value">{settings.adaptiveEnergyPerSecondFactor}</span>
                </label>
                <input id="adaptiveEnergyPerSecondFactor" type="range" min="1" max="100" step="1" value={settings.adaptiveEnergyPerSecondFactor} onInput={(e) => handleIntChange('adaptiveEnergyPerSecondFactor', e.target.value)} class="form-range" disabled={!settings.useAdaptiveEnergyThresholds} />
                <p class="help-text text-xs">Multiplier for noise floor to set energy/sec threshold.</p>
              </div>
              
              <div class="form-group">
                <label for="minAdaptiveEnergyIntegral" class="form-label">
                  Min Integral Threshold
                  <span class="range-value">{settings.minAdaptiveEnergyIntegral}</span>
                </label>
                <input id="minAdaptiveEnergyIntegral" type="range" min="0" max="50" step="1" value={settings.minAdaptiveEnergyIntegral} onInput={(e) => handleIntChange('minAdaptiveEnergyIntegral', e.target.value)} class="form-range" disabled={!settings.useAdaptiveEnergyThresholds} />
                <p class="help-text text-xs">Floor for the adaptive integral threshold.</p>
              </div>
              
              <div class="form-group">
                <label for="minAdaptiveEnergyPerSecond" class="form-label">
                  Min Energy/s Threshold
                  <span class="range-value">{settings.minAdaptiveEnergyPerSecond}</span>
                </label>
                <input id="minAdaptiveEnergyPerSecond" type="range" min="0" max="30" step="1" value={settings.minAdaptiveEnergyPerSecond} onInput={(e) => handleIntChange('minAdaptiveEnergyPerSecond', e.target.value)} class="form-range" disabled={!settings.useAdaptiveEnergyThresholds} />
                <p class="help-text text-xs">Floor for the adaptive energy/sec threshold.</p>
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Finalization Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('finalization')} aria-expanded={openSections().finalization}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Finalization</span>
        </button>
        <Show when={openSections().finalization}>
          <div class="section-content">
            <div class="form-group">
              <label for="finalization-stability-threshold" class="form-label">
                Finalization Stability Threshold
                <span class="range-value">{settings.finalizationStabilityThreshold}</span>
              </label>
              <input
                id="finalization-stability-threshold"
                type="range"
                min="1"
                max="10"
                step="1"
                value={settings.finalizationStabilityThreshold}
                onInput={(e) => handleIntChange('finalizationStabilityThreshold', e.target.value)}
                class="form-range"
              />
              <p class="help-text text-xs">Min stability counter for automatic finalization.</p>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.useAgeFinalization}
                  onChange={(e) => handleCheckboxChange('useAgeFinalization', e.target.checked)}
                  class="form-check-input"
                />
                <span class="form-check-label">Use Age Fallback</span>
              </label>
            </div>
            <div class="form-group">
              <label for="finalization-age-threshold" class="form-label">
                Finalization Age Threshold (s)
                <span class="range-value">{settings.finalizationAgeThreshold.toFixed(1)}</span>
              </label>
              <input
                id="finalization-age-threshold"
                type="range"
                min="1"
                max="30"
                step="1"
                value={settings.finalizationAgeThreshold}
                onInput={(e) => handleNumberChange('finalizationAgeThreshold', e.target.value)}
                class="form-range"
              />
              <p class="help-text text-xs">Force finalization for words older than this many seconds.</p>
            </div>
          </div>
        </Show>
      </div>

      {/* Mature Cursor Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('matureCursor')} aria-expanded={openSections().matureCursor}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Mature Cursor</span>
        </button>
        <Show when={openSections().matureCursor}>
          <div class="section-content">
            <div class="form-group">
                <label for="cursor-behavior-mode" class="form-label">Cursor Behavior</label>
                <select id="cursor-behavior-mode" value={settings.cursorBehaviorMode} onChange={(e) => handleTextChange('cursorBehaviorMode', e.target.value)} class="form-control form-select">
                    <option value="sentenceBased">Sentence Aware</option>
                    <option value="lastFinalized">Last Finalized Word</option>
                </select>
            </div>
            <div class="form-group">
                <label for="min-pause-duration-for-cursor" class="form-label">
                    Min Pause for Cursor (s)
                    <span class="range-value">{settings.minPauseDurationForCursor.toFixed(2)}</span>
                </label>
                <input id="min-pause-duration-for-cursor" type="range" min="0" max="1" step="0.01" value={settings.minPauseDurationForCursor} onInput={(e) => handleNumberChange('minPauseDurationForCursor', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
                <label for="min-initial-context-time" class="form-label">
                    Min Initial Context (s)
                    <span class="range-value">{settings.minInitialContextTime.toFixed(1)}</span>
                </label>
                <input id="min-initial-context-time" type="range" min="0" max="10" step="0.1" value={settings.minInitialContextTime} onInput={(e) => handleNumberChange('minInitialContextTime', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" checked={settings.useNLPSentenceDetection} onChange={(e) => handleCheckboxChange('useNLPSentenceDetection', e.target.checked)} class="form-check-input" />
                    <span class="form-check-label">Use NLP Sentence Detection</span>
                </label>
            </div>
          </div>
        </Show>
      </div>

      {/* Segment Filter Settings */}
      <div class="settings-section">
        <button class="section-toggle" onClick={() => toggleSection('segmentFilter')} aria-expanded={openSections().segmentFilter}>
          <span class="toggle-icon">▶</span>
          <span class="section-title">Segment Filter</span>
        </button>
        <Show when={openSections().segmentFilter}>
          <div class="section-content">
            <div class="form-group">
                <label for="segment-filter-min-absolute-confidence" class="form-label">
                    Min Absolute Confidence
                    <span class="range-value">{settings.segmentFilterMinAbsoluteConfidence.toFixed(2)}</span>
                </label>
                <input id="segment-filter-min-absolute-confidence" type="range" min="0" max="1" step="0.01" value={settings.segmentFilterMinAbsoluteConfidence} onInput={(e) => handleNumberChange('segmentFilterMinAbsoluteConfidence', e.target.value)} class="form-range" />
            </div>
            <div class="form-group">
                <label for="segment-filter-std-dev-threshold-factor" class="form-label">
                    Std Dev Threshold Factor
                    <span class="range-value">{settings.segmentFilterStdDevThresholdFactor.toFixed(1)}</span>
                </label>
                <input id="segment-filter-std-dev-threshold-factor" type="range" min="0" max="5" step="0.1" value={settings.segmentFilterStdDevThresholdFactor} onInput={(e) => handleNumberChange('segmentFilterStdDevThresholdFactor', e.target.value)} class="form-range" />
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default SettingsWidget; 