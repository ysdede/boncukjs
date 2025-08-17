import { createEffect } from 'solid-js';
import { audioManager } from '../AudioManager';
import { settingsManager } from './settingsManager';

/**
 * Creates effects to handle settings changes and trigger necessary side effects.
 * @param {object} settings - The settings store state.
 * @param {Function} handleStartAudio - Function to start audio.
 * @param {Function} handleStopAudio - Function to stop audio.
 * @param {object} audio - The audio store state.
 * @param {object} worker - A signal accessor for the worker instance.
 * @param {object} sentenceProcessor - The sentence processor instance.
 */
export function setupSettingsEffects(settings, audio, worker, sentenceProcessor, handleStartAudio, handleStopAudio) {

    // Effect to handle audio device or auto-gain changes, which require a stream restart.
    createEffect((prev) => {
        const currentDeviceId = settings.selectedDeviceId;
        const currentAutoGain = settings.autoGainEnabled;
        
        // Skip initial run
        if (prev === undefined) {
            return { deviceId: currentDeviceId, autoGain: currentAutoGain };
        }

        if (prev.deviceId !== currentDeviceId || prev.autoGain !== currentAutoGain) {
            console.log('Audio device or auto-gain changed. Restarting audio stream...');
            if (audio.recording) {
                (async () => {
                    await handleStopAudio();
                    // Short delay to ensure resources are released
                    setTimeout(handleStartAudio, 100);
                })();
            }
        }
        return { deviceId: currentDeviceId, autoGain: currentAutoGain };
    });

    // Effect to update AudioManager parameters that don't require a restart.
    createEffect(() => {
        // Gather all audio-related parameters from the settings store
        const params = {
            threshold: settings.audioThreshold,
            silenceLength: settings.silenceLength,
            speechHangover: settings.speechHangover,
            energyScale: settings.energyScale,
            hysteresisRatio: settings.hysteresisRatio,
            minSpeechDuration: settings.minSpeechDuration,
            minEnergyIntegral: settings.minEnergyIntegral,
            minEnergyPerSecond: settings.minEnergyPerSecond,
            lookbackDuration: settings.lookbackDuration,
            overlapDuration: settings.overlapDuration,
            maxSilenceWithinSpeech: settings.maxSilenceWithinSpeech,
            endingSpeechTolerance: settings.endingSpeechTolerance,
            endingEnergyThreshold: settings.endingEnergyThreshold,
            maxSegmentDuration: settings.maxSegmentDuration,
            // SNR and adaptive threshold parameters
            snrThreshold: settings.snrThreshold,
            minSnrThreshold: settings.minSnrThreshold,
            noiseFloorAdaptationRate: settings.noiseFloorAdaptationRate,
            fastAdaptationRate: settings.fastAdaptationRate,
            energyRiseThreshold: settings.energyRiseThreshold,
        };

        // Only update parameters if all values are defined and settings are loaded
        if (settings.settingsLoaded && Object.values(params).every(p => p !== undefined && p !== null)) {
            console.log('Audio parameters changed. Updating AudioManager.');
            audioManager.updateParameters(params);
        }
    });

    // Effect to update the worker's merger configuration.
    createEffect(() => {
        const mergerConfig = {
            // Finalization
            finalizationStabilityThreshold: settings.finalizationStabilityThreshold,
            useAgeFinalization: settings.useAgeFinalization,
            finalizationAgeThreshold: settings.finalizationAgeThreshold,
            
            // Mature Cursor
            cursorBehaviorMode: settings.cursorBehaviorMode,
            minPauseDurationForCursor: settings.minPauseDurationForCursor,
            minInitialContextTime: settings.minInitialContextTime,

            // Sentence Boundary Detection
            useNLPSentenceDetection: settings.useNLPSentenceDetection,
            nlpSentenceDetectionDebug: settings.nlpSentenceDetectionDebug,

            // Segment Filtering
            segmentFilterMinAbsoluteConfidence: settings.segmentFilterMinAbsoluteConfidence,
            segmentFilterStdDevThresholdFactor: settings.segmentFilterStdDevThresholdFactor,

            // Word-level confidence & veto logic
            wordConfidenceReplaceThreshold: settings.wordConfidenceReplaceThreshold,
            minOverlapDurationForRedundancy: settings.minOverlapDurationForRedundancy,
            stabilityThresholdForVeto: settings.stabilityThresholdForVeto,
            wordMinConfidenceSuperiorityForVeto: settings.wordMinConfidenceSuperiorityForVeto,
            
            // Other
            wpmCalculationWindowSeconds: settings.wpmCalculationWindowSeconds,
            debug: settings.debug,
         };

        const w = worker();
        // Only send config updates if worker exists and settings are fully loaded
        if (w && settings.settingsLoaded && Object.values(mergerConfig).every(p => p !== undefined)) {
            console.log('Merger config changed. Sending update to worker.');
            w.postMessage({
                type: 'update_merger_config',
                data: { config: mergerConfig }
            });
        }
    });

    // Effect to update other services like SentenceProcessor
    createEffect(() => {
        // Only update if settings are loaded to avoid unnecessary calls during initialization
        if (settings.settingsLoaded) {
            audioManager.setModel(settings.selectedModel);
            audioManager.setLanguage(settings.language);
            audioManager.setAudioFormat(settings.audioFormat);
            // Maybe temperature and beamSize need to be sent somewhere too.

            if (sentenceProcessor) {
                sentenceProcessor.updateConfig({
                    useNLPSentenceDetection: settings.useNLPSentenceDetection,
                    nlpSentenceDetectionDebug: settings.nlpSentenceDetectionDebug
                });
            }
        }
    });
}

export function saveSettingsToStorage(settings, audio, addLog) {
    if (!settings.settingsLoaded) return;
    const settingsWithDevices = { ...settings, audioDevices: audio.audioDevices };
    settingsManager.saveSettings(settingsWithDevices);
    addLog('Settings saved to localStorage.', 'debug');
}

export function restoreSettingsWithDevices(availableDevices, setAllSettings, updateSetting, addLog, setSettingsLoaded) {
    const savedSettings = settingsManager.loadSettings(availableDevices);
    if (savedSettings) {
        addLog(`Restoring settings from localStorage: ${JSON.stringify(savedSettings)}`);
        const { audioDevices, ...restored } = savedSettings;
        setAllSettings(restored);

        if (savedSettings.selectedDeviceId) {
          updateSetting('selectedDeviceId', savedSettings.selectedDeviceId);
        }
        setSettingsLoaded(true);
        return !!savedSettings.selectedDeviceId;
    } else {
        addLog('No saved settings found, using defaults');
    }
    setSettingsLoaded(true);
    return false;
} 