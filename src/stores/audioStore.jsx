import { createStore } from "solid-js/store";
import { createContext, useContext } from "solid-js";

export const AudioContext = createContext();

export function AudioProvider(props) {
  const [state, setState] = createStore({
    recording: false,
    audioDevices: [],
    selectedDeviceId: null,
    
    // Audio visualization data
    segmentsForViz: [],
    visualizationData: null,
    
    // Audio metrics
    currentEnergy: 0,
    averageEnergy: 0,
    peakEnergy: 0,
    rawPeakValue: 0,
    bufferDuration: 0,
    recentAudioData: null,
    isSpeaking: false,
    noiseFloor: 0.01,
    currentSNR: 0,
    
    // Audio processing stats
    inputSampleRate: null,
    audioContext: null,
    stream: null,
  });

  const store = [
    state,
    {
      setRecording(recording) {
        setState('recording', recording);
      },
      setAudioDevices(devices) {
        setState('audioDevices', devices);
      },
      setSelectedDeviceId(id) {
        setState('selectedDeviceId', id);
      },
      setSegmentsForViz(segments) {
        setState('segmentsForViz', segments);
      },
      setVisualizationData(data) {
        setState('visualizationData', data);
      },
      setAudioMetrics(metrics) {
        setState({
          currentEnergy: metrics.currentEnergy || 0,
          averageEnergy: metrics.averageEnergy || 0,
          peakEnergy: metrics.peakEnergy || 0,
          rawPeakValue: metrics.rawPeakValue || 0,
          bufferDuration: metrics.bufferDuration || 0,
          recentAudioData: metrics.recentAudioData,
          isSpeaking: metrics.isSpeaking || false,
          noiseFloor: metrics.noiseFloor || 0.01,
          currentSNR: metrics.currentSNR || 0,
        });
      },
      setInputSampleRate(rate) {
        setState('inputSampleRate', rate);
      },
      setAudioContext(context) {
        setState('audioContext', context);
      },
      setStream(stream) {
        setState('stream', stream);
      }
    }
  ];

  return (
    <AudioContext.Provider value={store}>
      {props.children}
    </AudioContext.Provider>
  );
}

export function useAudio() { return useContext(AudioContext); } 