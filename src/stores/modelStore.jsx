import { createStore } from "solid-js/store";
import { createContext, useContext } from "solid-js";

// Default settings based on Parakeet.js README and demo UI
const defaultModelSettings = {
  backend: 'webgpu-hybrid',
  quantization: 'fp32',
  decoderInt8: true,
  preprocessor: 'nemo128',
  stride: 1,
  verbose: false,
  // Use a sensible default for threads, can be overridden by user
  cpuThreads: navigator.hardwareConcurrency ? Math.max(1, navigator.hardwareConcurrency - 2) : 4,
  modelRepoId: 'ysdede/parakeet-tdt-0.6b-v2-onnx'
};

export const ModelSettingsContext = createContext();

export function ModelSettingsProvider(props) {
  const [state, setState] = createStore({ ...defaultModelSettings });

  const store = [
    state,
    {
      updateSetting(key, value) {
        // Coerce to correct type for inputs
        if (typeof defaultModelSettings[key] === 'number') {
          value = Number(value);
        }
        setState(key, value);
      },
      setMultipleSettings(settings) {
        setState(settings);
      },
      reset() {
        setState({ ...defaultModelSettings });
      }
    }
  ];

  return (
    <ModelSettingsContext.Provider value={store}>
      {props.children}
    </ModelSettingsContext.Provider>
  );
}

export function useModelSettings() { return useContext(ModelSettingsContext); } 