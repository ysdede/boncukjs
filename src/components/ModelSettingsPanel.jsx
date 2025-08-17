import { createSignal } from 'solid-js';
import { useModelSettings } from '../stores/modelStore';
import { parakeetService } from '../ParakeetService';
import './ModelSettingsPanel.css';

function ModelSettingsPanel(props) {
  const [settings, { updateSetting, reset }] = useModelSettings();
  const [isLoading, setIsLoading] = createSignal(false);

  const handleApply = async () => {
    setIsLoading(true);
    try {
      await parakeetService.reloadWithConfig(settings);
      props.onClose(); // Close panel on success
    } catch (err) {
      console.error("Failed to reload model with new settings:", err);
      // Optionally show an error message to the user
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class={`model-settings-panel ${props.isOpen ? 'open' : ''}`}>
      <h3>Model Settings</h3>

      <div class="form-grid">
        <label for="model-repo-id">Model Repo</label>
        <input id="model-repo-id" type="text" value={settings.modelRepoId} onInput={(e) => updateSetting('modelRepoId', e.target.value)} />

        <label for="backend-select">Backend</label>
        <select id="backend-select" value={settings.backend} onChange={(e) => updateSetting('backend', e.target.value)}>
          <option value="webgpu-hybrid">WebGPU (Hybrid)</option>
          <option value="wasm">WASM</option>
        </select>

        <label for="quant-select">Quantization</label>
        <select id="quant-select" value={settings.quantization} onChange={(e) => updateSetting('quantization', e.target.value)}>
          <option value="fp32">FP32 (Higher Quality)</option>
          <option value="int8">INT8 (Faster)</option>
        </select>
        
        <label for="preprocessor-select">Preprocessor</label>
        <select id="preprocessor-select" value={settings.preprocessor} onChange={(e) => updateSetting('preprocessor', e.target.value)}>
          <option value="nemo128">nemo128 (default)</option>
          <option value="nemo80">nemo80</option>
        </select>
        
        <label for="stride-select">Stride</label>
        <select id="stride-select" value={settings.stride} onChange={(e) => updateSetting('stride', e.target.value)}>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>

        <label for="threads-input">Threads</label>
        <input id="threads-input" type="number" min="1" value={settings.cpuThreads} onInput={(e) => updateSetting('cpuThreads', e.target.value)} />

        <label class="checkbox-label">
          <input type="checkbox" checked={settings.decoderInt8} onChange={(e) => updateSetting('decoderInt8', e.target.checked)} />
          <span>Decoder INT8 on CPU</span>
        </label>
        
        <label class="checkbox-label">
          <input type="checkbox" checked={settings.verbose} onChange={(e) => updateSetting('verbose', e.target.checked)} />
          <span>Verbose ORT Log</span>
        </label>
      </div>
      
      <div class="panel-actions">
        <button class="btn btn-secondary" onClick={reset} disabled={isLoading()}>
          Reset to Defaults
        </button>
        <button class="btn btn-primary" onClick={handleApply} disabled={isLoading()}>
          {isLoading() ? 'Loading...' : 'Apply & Reload'}
        </button>
      </div>
    </div>
  );
}

export default ModelSettingsPanel; 