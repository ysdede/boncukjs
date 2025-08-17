import { Show, For, createSignal } from 'solid-js';
import { useUI } from '../stores/uiStore';
import { useTranscription } from '../stores/transcriptionStore';
import { useSettings } from '../stores/settingsStore';

// Import Components
import SettingsWidget from './SettingsWidget';
import AudioVisualizer from './AudioVisualizer';
import LLMProcessor from './LLMProcessor';
import MergedTranscriptionWidget from './MergedTranscriptionWidget';
import TranscriptionOutput from './TranscriptionOutput';
import SentenceList from './SentenceList';

export default function LiveView(props) {
    const [ui, { 
        togglePlainTextVisibility, 
        setTranscriptDisplayMode, 
        setAutoScrollEnabled, 
        setShowLivePreview,
        setMergedTranscriptionWidgetLoaded
    }] = useUI();

    const [transcription, { updateWordLock }] = useTranscription();
    const [settings] = useSettings();
    
    // LLM processing state
    const [lastProcessedSentenceTimestamp, setLastProcessedSentenceTimestamp] = createSignal(0);
    const [lastProcessedSentenceId, setLastProcessedSentenceId] = createSignal(null);
    
    // Handler for when LLM generation is complete
    const handleGenerationComplete = (data) => {
        setLastProcessedSentenceTimestamp(data.lastSentenceTimestamp);
        setLastProcessedSentenceId(data.lastSentenceId);
    };
    
    // Handler for resetting transcription - also reset LLM processing state
    const handleTranscriptionReset = () => {
        setLastProcessedSentenceTimestamp(0);
        setLastProcessedSentenceId(null);
        if (props.handleReset) {
            props.handleReset();
        }
    };

    return (
        <div classList={{ "flex-layout": true, "settings-open": ui.isSettingsPanelOpen }}>
            <div classList={{ "panel": true, "settings-panel": true, "expanded": ui.isSettingsPanelOpen, "collapsed": !ui.isSettingsPanelOpen }}>
                <div class="p-4">
                    <Show when={props.micPermissionError()}>
                        <div class="status-message error">{props.statusMessage()}</div>
                    </Show>
                    <SettingsWidget 
                        onChange={props.handleSettingChange}
                        onOpenPromptEditor={() => {/* Handle prompt editor */}}
                        onClearSettings={props.handleClearSettings}
                        onForceSave={() => {/* Handle force save */}}
                    />
                </div>
            </div>
            <div class="panel content-panel">
                <div class="flex flex-col">
                    <Show when={ui.isWaveformVisible}>
                        <div class="waveform-container rounded-md overflow-hidden">
                            <AudioVisualizer />
                        </div>
                    </Show>

                    <div class="llm-processor-container">
                        <LLMProcessor 
                            allMatureSentences={transcription.allMatureSentences}
                            lastProcessedSentenceTimestamp={lastProcessedSentenceTimestamp()}
                            lastProcessedSentenceId={lastProcessedSentenceId()}
                            sentenceOverlap={settings.sentenceOverlap}
                            contextSentenceCount={settings.contextSentenceCount}
                            editablePrompt={settings.prompts[settings.selectedPromptKey]?.prompt || ''}
                            selectedModelId={settings.selectedModelId}
                            includeReasoning={settings.includeReasoning}
                            autoGenerateEnabled={settings.autoGenerateEnabled}
                            onGenerationcomplete={handleGenerationComplete}
                        />
                    </div>

                    <div class="widget-container">
                        <div class="widget-header">
                            <div class="flex items-center gap-3 min-w-0">
                                <h2 class="widget-title">Live Transcript</h2>
                                <Show when={ui.showLivePreview && transcription.livePreviewText}>
                                    <p class="live-preview-header">
                                        {transcription.livePreviewText}
                                    </p>
                                </Show>
                            </div>
                            <div class="widget-actions">
                                <button
                                    class="btn btn-icon-xs btn-ghost"
                                    classList={{ 'btn-active': ui.showLivePreview }}
                                    onClick={() => setShowLivePreview(!ui.showLivePreview)}
                                    title="Toggle live preview of unfinalized text"
                                >
                                    <span class="material-icons">track_changes</span>
                                </button>
                                <button
                                    class="btn btn-icon-xs btn-ghost"
                                    classList={{ 'btn-active': ui.autoScrollEnabled }}
                                    onClick={() => setAutoScrollEnabled(!ui.autoScrollEnabled)}
                                    title={ui.autoScrollEnabled ? 'Auto-scroll is ON' : 'Auto-scroll is OFF'}
                                >
                                    <span class="material-icons">{ui.autoScrollEnabled ? 'arrow_downward' : 'arrow_upward'}</span>
                                </button>
                                <button
                                    class="btn btn-icon-xs btn-ghost"
                                    onClick={() => setTranscriptDisplayMode(ui.transcriptDisplayMode === 'plain' ? 'sentences' : 'plain')}
                                    title={ui.transcriptDisplayMode === 'plain' ? 'Switch to sentence view' : 'Switch to plain text view'}
                                >
                                    <span class="material-icons">
                                        {ui.transcriptDisplayMode === 'plain' ? 'format_list_bulleted' : 'subject'}
                                    </span>
                                </button>
                                <button
                                    class="btn btn-icon-xs btn-primary"
                                    onClick={props.copyHandler}
                                    title="Copy to clipboard"
                                >
                                    <span class="material-icons">content_copy</span>
                                </button>
                                <button
                                    class="btn btn-icon-xs btn-danger"
                                    onClick={handleTranscriptionReset}
                                    title="Clear transcription"
                                >
                                    <span class="material-icons">delete_outline</span>
                                </button>
                                <button
                                    class="btn btn-icon-xs btn-ghost"
                                    classList={{ 'btn-active': ui.isPlainTextVisible }}
                                    onClick={togglePlainTextVisibility}
                                    title={ui.isPlainTextVisible ? 'Hide live transcript' : 'Show live transcript'}
                                >
                                    <span class="material-icons">{ui.isPlainTextVisible ? 'visibility_off' : 'visibility'}</span>
                                </button>
                            </div>
                        </div>
                        <Show when={ui.isPlainTextVisible}>
                            <div class="widget-content widget-content-unpadded">
                                <Show when={ui.transcriptDisplayMode === 'plain'}>
                                    <div ref={props.setPlainTextContainerRef}>
                                        <TranscriptionOutput
                                            text={transcription.mergedWords.map(w => w.text || w.word).join(' ')}
                                            readonly={true}
                                        />
                                    </div>
                                </Show>
                                <Show when={ui.transcriptDisplayMode === 'sentences'}>
                                    <div style="font-size: 10px; color: gray; padding: 4px;">
                                        Debug: Sentence mode active, isPlainTextVisible: {ui.isPlainTextVisible ? 'true' : 'false'}
                                    </div>
                                    <SentenceList setSentenceContainerRef={props.setSentenceContainerRef} />
                                </Show>
                            </div>
                        </Show>
                    </div>

                    <div class="merged-transcription-container">
                        <MergedTranscriptionWidget
                            onWordLockUpdate={(data) => updateWordLock(data.wordId, data.locked, data.newText)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
} 