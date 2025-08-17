import { createSignal, createEffect } from 'solid-js';
import { useSettings } from '../stores/settingsStore';
import { useAudio } from '../stores/audioStore';
import { useLogs } from '../stores/logStore';
import { audioManager } from '../AudioManager';
import audioProcessorUrl from '../audio-processor.js?url';

export function useAudioRecorder() {
    const [settings] = useSettings();
    const [audio, { setRecording }] = useAudio();
    const [, { addLog }] = useLogs();

    const [status, setStatus] = createSignal('idle');
    const [statusMessage, setStatusMessage] = createSignal('Select device and click Start');
    const [micPermissionError, setMicPermissionError] = createSignal(false);
    const [inputSampleRate, setInputSampleRate] = createSignal(null);
    const [audioContext, setAudioContext] = createSignal(null);

    let stream;

    // Initialize AudioManager with current settings
    const initializeAudioManager = async (sampleRate) => {
        try {
            addLog(`Initializing AudioManager with sample rate: ${sampleRate}`);
            
            // Update AudioManager sample rate
            audioManager.updateSampleRate(sampleRate);
            
            // Initialize AudioManager with proper parameters
            await audioManager.initialize({
                sampleRate: sampleRate,
                onSegmentDetected: (segment) => {
                    addLog(`Audio segment detected: ${segment.id} (${segment.duration.toFixed(2)}s)`);
                    // Segment will be handled by AudioManager internally
                }
            });
            
            // Update AudioManager parameters from settings
            audioManager.updateParameters({
                threshold: settings.audioThreshold,
                silenceLength: settings.silenceLength,
                speechHangover: settings.speechHangover,
                lookbackDuration: settings.lookbackDuration,
                overlapDuration: settings.overlapDuration,
                minSpeechDuration: settings.minSpeechDuration,
                maxSilenceWithinSpeech: settings.maxSilenceWithinSpeech,
                endingSpeechTolerance: settings.endingSpeechTolerance,
                minEnergyPerSecond: settings.minEnergyPerSecond,
                minEnergyIntegral: settings.minEnergyIntegral,
                snrThreshold: settings.snrThreshold,
                minSnrThreshold: settings.minSnrThreshold,
                noiseFloorAdaptationRate: settings.noiseFloorAdaptationRate,
                fastAdaptationRate: settings.fastAdaptationRate,
                energyRiseThreshold: settings.energyRiseThreshold,
                maxSegmentDuration: settings.maxSegmentDuration
            });
            
            // Set other AudioManager properties
            audioManager.setLanguage(settings.language);
            audioManager.setAudioFormat(settings.audioFormat);
            
            addLog('AudioManager initialized successfully');
        } catch (error) {
            addLog(`Failed to initialize AudioManager: ${error.message}`, 'error');
            throw error;
        }
    };

    const handleStartAudio = async () => {
        if (audio.recording) return;
        addLog('Attempting to start audio...');
        setMicPermissionError(false);
        setStatus('loading');
        setStatusMessage('Initializing audio context and requesting microphone...');

        try {
            // Reset AudioManager state before starting new stream
            audioManager.reset();
            
            // Ensure existing context is closed if any
            if (audioContext() && audioContext().state !== 'closed') {
                await audioContext().close();
            }

            const constraints = {
                audio: {
                    deviceId: settings.selectedDeviceId ? { exact: settings.selectedDeviceId } : undefined,
                    autoGainControl: settings.autoGainEnabled,
                    echoCancellation: settings.echoCancellation,
                    noiseSuppression: settings.noiseSuppression,
                    channelCount: 1
                }
            };
            
            addLog(`Requesting audio stream with constraints: ${JSON.stringify(constraints)}`);
            const userStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const audioTrack = userStream.getAudioTracks()[0];
            const trackSettings = audioTrack.getSettings();
            const actualSampleRate = trackSettings.sampleRate;
            addLog(`Audio stream acquired. Actual sample rate: ${actualSampleRate}`);
            setInputSampleRate(actualSampleRate);
            
            // Create AudioContext with the correct sample rate
            const newAudioContext = new AudioContext({ sampleRate: actualSampleRate });
            setAudioContext(newAudioContext);
            addLog(`AudioContext created with sample rate: ${newAudioContext.sampleRate}`);
            
            // Initialize AudioManager with the actual sample rate
            await initializeAudioManager(actualSampleRate);
            
            // Load AudioWorklet Processor
            try {
                addLog(`Attempting to load AudioWorklet module from: ${audioProcessorUrl}`);
            await newAudioContext.audioWorklet.addModule(audioProcessorUrl);
                addLog('AudioWorklet module loaded successfully.');
            } catch (workletError) {
                addLog(`Failed to load AudioWorklet module: ${workletError}`, 'error');
                // Cleanup stream/context if worklet fails
                userStream.getTracks().forEach(track => track.stop());
                if (newAudioContext.state !== 'closed') await newAudioContext.close();
                setAudioContext(null);
                setInputSampleRate(null);
                throw workletError;
            }
            
            const source = newAudioContext.createMediaStreamSource(userStream);
            const gainNode = newAudioContext.createGain();
            gainNode.gain.value = 1.0; // Default gain
            
            const workletNode = new AudioWorkletNode(newAudioContext, 'audio-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                processorOptions: {
                    sampleRate: actualSampleRate
                }
            });
            addLog('AudioWorkletNode created.');

            source.connect(gainNode);
            gainNode.connect(workletNode);
            workletNode.connect(newAudioContext.destination);

            workletNode.port.onmessage = (event) => {
                if (event.data.type === 'audio_data') {
                    const { audioData, energy, timestamp, isSpeaking } = event.data;
                    audioManager.processNewChunk(
                        audioData, // Float32Array chunk
                        energy,
                        actualSampleRate,
                        isSpeaking
                    );
                } else if (event.data.type === 'audio_chunk') {
                    // Pass chunk and energy to AudioManager
                    audioManager.processNewChunk(
                        event.data.audioData, 
                        event.data.energy, 
                        event.data.sampleRate
                    );
                } else if (event.data.type === 'transcription_result') {
                    audioManager.handleTranscriptionResult(event.data);
                } else if (event.data.type === 'error') {
                    addLog(`Worklet error: ${event.data.message}`, 'error');
                } else {
                    // Skip logging frequent worklet messages to avoid console spam
                    // addLog(`Worklet message: ${event.data.type || 'unknown'}`);
                }
            };

            workletNode.port.onerror = (err) => {
                addLog(`Error from Worklet port: ${err}`, 'error');
            };
            
            // Update state
            stream = userStream;
            setRecording(true);
            setStatus('ready');
            setStatusMessage('Recording...');
            addLog('Audio recording started successfully.');
            
        } catch (error) {
            addLog(`Failed to start audio: ${error.name} - ${error.message}`, 'error');
            if (error.name === 'NotAllowedError') {
                setMicPermissionError(true);
                setStatusMessage('Microphone permission denied. Please grant access in your browser settings and try again.');
                addLog('Microphone permission was denied by the user.', 'error');
            } else {
                setStatusMessage(`Error accessing microphone: ${error.message}. Check console for details.`);
                addLog(`getUserMedia error: ${error.name} - ${error.message}`, 'error');
            }
            handleStopAudio();
        }
    };

    const handleStopAudio = () => {
        if (!audio.recording) return;
        addLog('Stopping audio recording...');
        setRecording(false);
        setStatus('idle');
        setStatusMessage('Select device and click Start');
        
        // Stop stream tracks
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        
        // Close AudioContext
        if (audioContext() && audioContext().state !== 'closed') {
            audioContext().close().then(() => {
                addLog('AudioContext closed.');
                setAudioContext(null);
            }).catch(err => addLog(`Error closing AudioContext: ${err}`, 'error'));
        }
        
        // Reset AudioManager state
        audioManager.reset();
        addLog('Audio stopped.');
    };

    return {
        status,
        statusMessage,
        micPermissionError,
        audioContext,
        inputSampleRate,
        handleStartAudio,
        handleStopAudio
    };
} 