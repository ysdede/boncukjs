import { For } from 'solid-js';
import { useAudio } from '../stores/audioStore';
import { useSettings } from '../stores/settingsStore';
import './LanguageSelector.css'; // reuse simple styles

function AudioInputSelector() {
  const [audio, { setSelectedDeviceId }] = useAudio();
  const [ , { updateSetting }] = useSettings();

  const handleChange = (id) => {
    setSelectedDeviceId(id);
    updateSetting('selectedDeviceId', id);
  };

  return (
    <select
      id="audio-input-select"
      class="language-select" // reuse same compact styles
      value={audio.selectedDeviceId || ''}
      onChange={(e) => handleChange(e.target.value)}
      disabled={audio.audioDevices.length === 0}
      aria-label="Select audio input device"
    >
      <For each={audio.audioDevices}>
        {(device) => (
          <option value={device.deviceId}>{device.label || `Mic ${device.deviceId}`}</option>
        )}
      </For>
    </select>
  );
}

export default AudioInputSelector; 