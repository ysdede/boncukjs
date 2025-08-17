import { Show } from 'solid-js';
import { useSettings } from '../stores/settingsStore';
import { useAudio } from '../stores/audioStore';
import { useTranscription } from '../stores/transcriptionStore';
import { audioManager } from '../AudioManager';
import audioParams from '../config/audioParams.js';
import './AudioVisualizer.css';
import BufferVisualizer from './BufferVisualizer';
import StatsWidget from './StatsWidget';

function AudioVisualizer(props) {
  const [settings, { updateSetting }] = useSettings();
  const [audioState] = useAudio();
  const [transcriptionState] = useTranscription();

  const formatNumber = (num, decimals = 2) => {
    if (typeof num !== 'number' || isNaN(num)) {
      return 'N/A';
    }
    return num.toFixed(decimals);
  };

  const handleFloatChange = (key, value) => updateSetting(key, parseFloat(value));
  const handleIntChange = (key, value) => updateSetting(key, parseInt(value, 10));
  const handleBoolChange = (key, checked) => updateSetting(key, checked);

  return (
    <div class={props.className}>
      <div class="visualization-container">
        <div class="waveform">
          <BufferVisualizer 
            segments={audioState.segmentsForViz} 
            showAdaptiveThreshold={settings.showAdaptiveThreshold}
            snrThreshold={settings.snrThreshold}
            minSnrThreshold={settings.minSnrThreshold}
            visible={props.visible !== false}
          />
        </div>
        <div class="stats-container -mt-1">
          <StatsWidget 
            audioManager={audioManager}
            audioContext={audioState.audioContext}
            processor={audioManager.processor}
            wpmOverall={transcriptionState.stats?.wpmOverall}
            wpmRolling={transcriptionState.stats?.wpmRolling}
          />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4">
        <Show when={!props.hideControls}>
          <div class="controls-panel rounded-lg p-3">
            <h3 class="text-xs font-semibold mb-2">Speech Detection Parameters</h3>
            <div class="grid grid-cols-2 gap-4">
              
              <div class="flex flex-col">
                <label for="thresholdRange" class="text-xs mb-1">Energy Threshold: {formatNumber(settings.audioThreshold, 3)}</label>
                <input id="thresholdRange" type="range" min="0.01" max="0.5" step="0.01" value={settings.audioThreshold} onInput={(e) => handleFloatChange('audioThreshold', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="silenceLengthRange" class="text-xs mb-1">Silence Length (s): {formatNumber(settings.silenceLength)}</label>
                <input id="silenceLengthRange" type="range" min="0.1" max="2.0" step="0.1" value={settings.silenceLength} onInput={(e) => handleFloatChange('silenceLength', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="speechHangoverRange" class="text-xs mb-1">Speech Hangover (s): {formatNumber(settings.speechHangover)}</label>
                <input id="speechHangoverRange" type="range" min="0.0" max="1.0" step="0.1" value={settings.speechHangover} onInput={(e) => handleFloatChange('speechHangover', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="energyScaleRange" class="text-xs mb-1">Energy Scale: {formatNumber(settings.energyScale)}</label>
                <input id="energyScaleRange" type="range" min="0.5" max="5.0" step="0.1" value={settings.energyScale} onInput={(e) => handleFloatChange('energyScale', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="hysteresisRatioRange" class="text-xs mb-1">Hysteresis Ratio: {formatNumber(settings.hysteresisRatio)}</label>
                <input id="hysteresisRatioRange" type="range" min="1.0" max="2.0" step="0.1" value={settings.hysteresisRatio} onInput={(e) => handleFloatChange('hysteresisRatio', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="minSpeechDurationRange" class="text-xs mb-1">Min Speech (s): {formatNumber(settings.minSpeechDuration)}</label>
                <input id="minSpeechDurationRange" type="range" min="0.0" max="1.0" step="0.1" value={settings.minSpeechDuration} onInput={(e) => handleFloatChange('minSpeechDuration', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="maxSilenceWithinSpeechRange" class="text-xs mb-1">Max Silence (s): {formatNumber(settings.maxSilenceWithinSpeech)}</label>
                <input id="maxSilenceWithinSpeechRange" type="range" min="0.0" max="1.0" step="0.1" value={settings.maxSilenceWithinSpeech} onInput={(e) => handleFloatChange('maxSilenceWithinSpeech', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="endingSpeechToleranceRange" class="text-xs mb-1">End Tolerance (s): {formatNumber(settings.endingSpeechTolerance)}</label>
                <input id="endingSpeechToleranceRange" type="range" min="0.0" max="1.0" step="0.1" value={settings.endingSpeechTolerance} onInput={(e) => handleFloatChange('endingSpeechTolerance', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="endingEnergyThresholdRange" class="text-xs mb-1">End Threshold: {formatNumber(settings.endingEnergyThreshold, 3)}</label>
                <input id="endingEnergyThresholdRange" type="range" min="0.01" max="0.5" step="0.01" value={settings.endingEnergyThreshold} onInput={(e) => handleFloatChange('endingEnergyThreshold', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="minEnergyIntegralRange" class="text-xs mb-1">Min Energy Integral: {settings.minEnergyIntegral}</label>
                <input id="minEnergyIntegralRange" type="range" min="0" max="100" step="1" value={settings.minEnergyIntegral} onInput={(e) => handleIntChange('minEnergyIntegral', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="minEnergyPerSecondRange" class="text-xs mb-1">Min Energy/s: {settings.minEnergyPerSecond}</label>
                <input id="minEnergyPerSecondRange" type="range" min="0" max="100" step="1" value={settings.minEnergyPerSecond} onInput={(e) => handleIntChange('minEnergyPerSecond', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="lookbackDurationRange" class="text-xs mb-1">Lookback (s): {formatNumber(settings.lookbackDuration)}</label>
                <input id="lookbackDurationRange" type="range" min="0.0" max="0.5" step="0.040" value={settings.lookbackDuration} onInput={(e) => handleFloatChange('lookbackDuration', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="overlapDurationRange" class="text-xs mb-1">Overlap (s): {formatNumber(settings.overlapDuration)}</label>
                <input id="overlapDurationRange" type="range" min="0.0" max="0.5" step="0.040" value={settings.overlapDuration} onInput={(e) => handleFloatChange('overlapDuration', e.target.value)} class="w-full" />
              </div>

              <div class="flex flex-col">
                <label for="showAdaptiveThresholdToggle" class="text-xs mb-1">Show Adaptive Threshold</label>
                <input id="showAdaptiveThresholdToggle" type="checkbox" checked={settings.showAdaptiveThreshold} onChange={(e) => handleBoolChange('showAdaptiveThreshold', e.target.checked)} class="w-full" />
              </div>

            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default AudioVisualizer; 