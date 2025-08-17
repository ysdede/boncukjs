import { createStore } from "solid-js/store";
import { createContext, useContext } from "solid-js";
import { settingsManager } from '../utils/settingsManager';
import { DEFAULT_LANGUAGE, DEFAULT_MODEL } from '../constants';
import audioParams from '../config/audioParams';
import { promptTemplates, defaultPromptKey } from '../config/prompts';
import { defaultModel as defaultLLMModel } from '../config/models';

export const SettingsContext = createContext();

export function SettingsProvider(props) {
  // Log environment API key status for debugging
  if (import.meta.env.VITE_GEMINI_API_KEY) {
    console.log('Loaded Gemini API key from environment:', import.meta.env.VITE_GEMINI_API_KEY.substring(0, 8) + '...');
  } else {
    console.log('No VITE_GEMINI_API_KEY found in environment variables');
  }

  const [state, setState] = createStore({
    // Settings loading state
    settingsLoaded: false,
    
    // Audio settings
    selectedDeviceId: null,
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
    audioFormat: 'int16-lz4',
    useVadFilter: true,
    
    // Model and language
    selectedModel: DEFAULT_MODEL,
    language: DEFAULT_LANGUAGE,
    temperature: 1.0,
    beamSize: 1,
    
    // VAD parameters from config
    audioThreshold: audioParams.audioThreshold,
    silenceLength: audioParams.silenceLength,
    speechHangover: audioParams.speechHangover,
    energyScale: audioParams.energyScale,
    hysteresisRatio: audioParams.hysteresisRatio,
    minSpeechDuration: audioParams.minSpeechDuration,
    maxSilenceWithinSpeech: audioParams.maxSilenceWithinSpeech,
    endingSpeechTolerance: audioParams.endingSpeechTolerance,
    endingEnergyThreshold: audioParams.endingEnergyThreshold,
    minEnergyIntegral: audioParams.minEnergyIntegral,
    minEnergyPerSecond: audioParams.minEnergyPerSecond,
    lookbackDuration: audioParams.lookbackDuration,
    overlapDuration: audioParams.overlapDuration,
    maxSegmentDuration: audioParams.maxSegmentDuration,
    
    // SNR and adaptive threshold parameters
    snrThreshold: audioParams.snrThreshold,
    minSnrThreshold: audioParams.minSnrThreshold,
    noiseFloorAdaptationRate: audioParams.noiseFloorAdaptationRate,
    fastAdaptationRate: audioParams.fastAdaptationRate,
    energyRiseThreshold: audioParams.energyRiseThreshold,
    
    // Adaptive energy VAD settings
    useAdaptiveEnergyThresholds: audioParams.useAdaptiveEnergyThresholds,
    adaptiveEnergyIntegralFactor: audioParams.adaptiveEnergyIntegralFactor,
    adaptiveEnergyPerSecondFactor: audioParams.adaptiveEnergyPerSecondFactor,
    minAdaptiveEnergyIntegral: audioParams.minAdaptiveEnergyIntegral,
    minAdaptiveEnergyPerSecond: audioParams.minAdaptiveEnergyPerSecond,
    
    // Visualization settings
    showAdaptiveThreshold: true,

    // Sentence boundary detection
    useNLPSentenceDetection: true,
    nlpSentenceDetectionDebug: false,
    cursorBehaviorMode: 'sentenceBased',
    
    // Segmentation
    segmentationPreset: 'medium',
    
    // Prompts - initialize with the actual prompt templates
    prompts: promptTemplates,
    selectedPromptKey: defaultPromptKey,
    
    // Gemini API Key
    geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
    
    // Other settings that might be needed
    contextSentenceCount: 8,
    sentenceOverlap: 2,
    selectedModelId: defaultLLMModel, // Use the LLM model, not ASR model
    includeReasoning: false,
    autoGenerateEnabled: false,
    
    // Finalization settings - CORRECTED TO MATCH WORKING SVELTE VERSION
    finalizationStabilityThreshold: 2,
    useAgeFinalization: true,
    finalizationAgeThreshold: 10.0,
    useSentenceBoundaries: true,
    minPauseDurationForCursor: 0.1,  // FIXED: Was 0.4, should be 0.1 like Svelte
    minInitialContextTime: 3.0,
    segmentFilterMinAbsoluteConfidence: 0.20,
    segmentFilterStdDevThresholdFactor: 2.0,
    wordConfidenceReplaceThreshold: 0.15,
    minOverlapDurationForRedundancy: 0.05,
    stabilityThresholdForVeto: 1,
    wordMinConfidenceSuperiorityForVeto: 0.20,
    wpmCalculationWindowSeconds: 60,
    debug: false,
  });

  const store = [
    state,
    {
      updateSetting(key, value) {
        setState(key, value);
      },
      setMultipleSettings(settingsObject) {
        setState(settingsObject);
      },
      setAllSettings(settingsObject) {
        // Merges the new settings into the existing state
        setState(settingsObject);
      },
      setSettingsLoaded(loaded) {
        setState('settingsLoaded', loaded);
      },
      saveSettings() {
        // We pass the whole state, not a sub-property
        settingsManager.saveSettings(state);
      },
      // REMOVED: Obsolete merger() method that was not being used and returned incomplete config
    }
  ];

  return (
    <SettingsContext.Provider value={store}>
      {props.children}
    </SettingsContext.Provider>
  );
}

export function useSettings() { return useContext(SettingsContext); } 