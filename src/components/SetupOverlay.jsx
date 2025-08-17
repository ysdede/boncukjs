import { createSignal, onCleanup, onMount } from 'solid-js';
import { useModelSettings } from '../stores/modelStore';
import './ModelSettingsPanel.css'; // Re-use some of the form styles
import './SetupOverlay.css';

function SetupOverlay(props) {
  const [settings, { updateSetting }] = useModelSettings();
  const [status, setStatus] = createSignal('idle');

  const handleLoad = async () => {
    if (status() === 'idle' || status() === 'error') {
      setStatus('loading');
      if (props.worker) {
        // Convert SolidJS proxy to a plain object before sending
        const plainSettings = JSON.parse(JSON.stringify(settings));
        props.worker.postMessage({ type: 'config', data: plainSettings });
      } else {
        console.error("Worker not available to send config.");
        setStatus('error');
      }
    }
  };
  
  onMount(() => {
    if (props.worker) {
      // Temporary listener for model loading errors
      const tempErrorListener = (e) => {
        if (e.data.type === 'error' && e.data.data.message.includes('Model load failed')) {
          setStatus('error');
        }
      };
      props.worker.addEventListener('message', tempErrorListener);
      onCleanup(() => props.worker.removeEventListener('message', tempErrorListener));
    }
  });


  const statusText = () => {
    switch (status()) {
      case 'loading':
        return `Loading model... This may take a moment.`;
      case 'error':
        return 'Model failed to load. Please check console and retry.';
      default:
        return 'Configure and load the speech model to begin.';
    }
  };

  return (
    <div class="setup-overlay-backdrop">
      <div class="setup-container">
        <h2>Welcome to Boncuk.js</h2>
        <p>{statusText()}</p>

        <div class="form-grid">
          <label for="setup-model-repo-id">Model Repo</label>
          <input id="setup-model-repo-id" type="text" value={settings.modelRepoId} onInput={(e) => updateSetting('modelRepoId', e.target.value)} />

          <label for="setup-backend-select">Backend</label>
          <select id="setup-backend-select" value={settings.backend} onChange={(e) => updateSetting('backend', e.target.value)}>
            <option value="webgpu-hybrid">WebGPU (Hybrid)</option>
            <option value="wasm">WASM</option>
          </select>

          <label for="setup-quant-select">Quantization</label>
          <select id="setup-quant-select" value={settings.quantization} onChange={(e) => updateSetting('quantization', e.target.value)}>
            <option value="fp32">FP32 (Higher Quality)</option>
            <option value="int8">INT8 (Faster)</option>
          </select>
          
          <label for="setup-preprocessor-select">Preprocessor</label>
          <select id="setup-preprocessor-select" value={settings.preprocessor} onChange={(e) => updateSetting('preprocessor', e.target.value)}>
            <option value="nemo128">nemo128 (default)</option>
            <option value="nemo80">nemo80</option>
          </select>
          
          <label for="setup-stride-select">Stride</label>
          <select id="setup-stride-select" value={settings.stride} onChange={(e) => updateSetting('stride', e.target.value)}>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>

          <label for="setup-threads-input">Threads</label>
          <input id="setup-threads-input" type="number" min="1" value={settings.cpuThreads} onInput={(e) => updateSetting('cpuThreads', e.target.value)} />

          <label class="checkbox-label">
            <input type="checkbox" checked={settings.decoderInt8} onChange={(e) => updateSetting('decoderInt8', e.target.checked)} />
            <span>Decoder INT8 on CPU</span>
          </label>
          
          <label class="checkbox-label">
            <input type="checkbox" checked={settings.verbose} onChange={(e) => updateSetting('verbose', e.target.checked)} />
            <span>Verbose ORT Log</span>
          </label>
        </div>

        <button class="btn btn-primary btn-lg" onClick={handleLoad} disabled={status() === 'loading'}>
          {status() === 'loading' ? 'Loading...' : 'Load Model & Start'}
        </button>
      </div>
    </div>
  );
}

export default SetupOverlay; 