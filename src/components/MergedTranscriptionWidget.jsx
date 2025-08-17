import { createSignal, createEffect, onCleanup, onMount, For, Show, createMemo } from 'solid-js';
import { useTranscription } from '../stores/transcriptionStore';
import { useUI } from '../stores/uiStore';
import WordAlternativesPopup from './WordAlternativesPopup.jsx';
import './MergedTranscriptionWidget.css';

export default function MergedTranscriptionWidget(props) {
    const [transcription, { updateWordLock, setMatureTimestamp, worker }] = useTranscription();
    const [ui, { setMergedTranscriptionWidgetLoaded }] = useUI();


    const [mergerConfig, setMergerConfig] = createSignal({
        stabilityThreshold: 3,
        confidenceBias: 1.15,
        lengthBiasFactor: 0.01,
        finalizationStabilityThreshold: 5,
        useAgeFinalization: false,
        finalizationAgeThreshold: 10.0,
        segmentFilterMinAbsoluteConfidence: 0.20,
        segmentFilterStdDevThresholdFactor: 2.0,
        useSentenceBoundaries: true,
        minPauseDurationForCursor: 0.4,
        minInitialContextTime: 3.0,
        debug: false,
    });

    // UI state
    const [colorByConfidence, setColorByConfidence] = createSignal(true);
    const [showFinalizedWords, setShowFinalizedWords] = createSignal(true);
    const [showWordDetails, setShowWordDetails] = createSignal(false);
    const [showMergerSettings, setShowMergerSettings] = createSignal(false);
    const [showFullUtterance, setShowFullUtterance] = createSignal(false);
    const [isContentVisible, setIsContentVisible] = createSignal(true);

    const [userScrolledUp, setUserScrolledUp] = createSignal(false);
    const [focusedWordIndex, setFocusedWordIndex] = createSignal(-1);
    const [showAlternativesPopup, setShowAlternativesPopup] = createSignal(false);
    const [alternativesPopupData, setAlternativesPopupData] = createSignal([]);
    const [popupPosition, setPopupPosition] = createSignal({ top: 0, left: 0 });
    const [popupPlacement, setPopupPlacement] = createSignal('top');
    
    let transcriptionContainerRef;

    const displayedWords = createMemo(() => transcription.mergedWords || []);
    const matureCursorTime = createMemo(() => transcription.matureTimestamp || 0);
    const matureCursorWordId = createMemo(() => {
        const words = displayedWords();
        const cursorTime = matureCursorTime();
        if (!words.length || cursorTime === 0) return null;

        // Find the last word that is at or before the cursor time.
        let lastWordId = null;
        for (let i = words.length - 1; i >= 0; i--) {
            if (words[i].end <= cursorTime) {
                lastWordId = words[i].id;
                break;
            }
        }
        return lastWordId;
    });

    createEffect(() => {
        if (transcriptionContainerRef && !userScrolledUp()) {
            requestAnimationFrame(() => {
                transcriptionContainerRef.scrollTop = transcriptionContainerRef.scrollHeight;
            });
        }
    });

    const handleScroll = () => {
        if (!transcriptionContainerRef) return;
        const threshold = 10;
        const isNearBottom = transcriptionContainerRef.scrollHeight - transcriptionContainerRef.scrollTop - transcriptionContainerRef.clientHeight < threshold;
        setUserScrolledUp(!isNearBottom);
    };

    const handleWordClick = (index, event) => {
        if (index === focusedWordIndex()) {
            setFocusedWordIndex(-1);
            setShowAlternativesPopup(false);
        } else {
            setFocusedWordIndex(index);
            const word = displayedWords()[index];
            const history = word.history || [];
            
            setAlternativesPopupData(history.filter(h => h.text !== word.text));

            const wordElement = event.currentTarget;
            const rect = wordElement.getBoundingClientRect();
            const containerRect = transcriptionContainerRef.getBoundingClientRect();

            const buffer = 10;
            const estimatedPopupHeight = 150;
            const spaceAbove = rect.top - containerRect.top;
            const spaceBelow = containerRect.bottom - rect.bottom;

            let topPosition;
            if (spaceAbove > estimatedPopupHeight + buffer) {
                setPopupPlacement('top');
                topPosition = rect.top - containerRect.top - buffer;
            } else {
                setPopupPlacement('bottom');
                topPosition = rect.bottom - containerRect.top + buffer;
            }

            setPopupPosition({
                top: topPosition,
                left: rect.left - containerRect.left + rect.width / 2
            });

            if (alternativesPopupData().length > 0) {
              setShowAlternativesPopup(true);
            }
        }
    };

    const handleAlternativeSelect = (selectedAlternative) => {
        const index = focusedWordIndex();
        if (index === -1) return;

        const originalWord = displayedWords()[index];
        const newHistory = [
            { text: originalWord.text, confidence: originalWord.confidence, start: originalWord.start, end: originalWord.end },
            ...(originalWord.history || []).filter(h => h.text !== selectedAlternative.text)
        ];

        updateWordLock(
            originalWord.id, 
            true, 
            selectedAlternative.text, 
            newHistory
        );

        setShowAlternativesPopup(false);
    };

    const updateMergerConfigAndNotify = (configChanges) => {
        const newConfig = { ...mergerConfig(), ...configChanges };
        setMergerConfig(newConfig);
        if (worker) {
            worker.postMessage({
                type: 'update_merger_config',
                data: { config: newConfig }
            });
        }
    };
    
    onMount(() => {
        if (worker) {
            worker.postMessage({ type: 'get_merged_transcription' });
        }
    });

    const confidenceThresholds = { high: 0.95, medium: 0.85, low: 0.70 };

    const getConfidenceColor = (confidence) => {
        if (!colorByConfidence()) return '';
        if (confidence >= confidenceThresholds.high) return 'confidence-high';
        if (confidence >= confidenceThresholds.medium) return 'confidence-medium';
        if (confidence >= confidenceThresholds.low) return 'confidence-low';
        return 'confidence-very-low';
    };

    const formatTime = (seconds) => {
        if (typeof seconds !== 'number' || isNaN(seconds)) return '?:??';
        const date = new Date(null);
        date.setSeconds(seconds);
        const iso = date.toISOString().substr(14, 8);
        const dec = (seconds % 1).toFixed(3).substring(2);
        return `${iso}.${dec}`;
    };
    
    const shouldAddSpace = (index) => {
        if (index === 0) return false;
        const currentWord = displayedWords()[index];
        const prevWord = displayedWords()[index - 1];
        if (!currentWord || !prevWord) return false;
        const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(currentWord.text);
        if (noSpaceBefore) return false;
        if (currentWord.text.startsWith("'")) {
            const contractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
            if (contractions.includes(currentWord.text.toLowerCase())) return false;
        }
        if (currentWord.text.toLowerCase() === "n't" && prevWord.text.toLowerCase().endsWith("n")) return false;
        return true;
    };

  return (
    <div class="widget-container">
        <div class="widget-header">
            <h3 class="widget-title">Merged Transcription</h3>
            <div class="stats-container">
                <div class="stat"><strong>Words:</strong> {displayedWords().length || 0}</div>
                <div class="stat"><strong>Segments:</strong> {transcription.stats.totalSegmentsProcessed || 0}</div>
                <div class="stat"><strong>Mature:</strong> {formatTime(matureCursorTime())}</div>
                <Show when={(transcription.stats.wordsFinalized || 0) > 0}><div class="stat"><strong>Finalized:</strong> {transcription.stats.wordsFinalized}</div></Show>
                <Show when={(transcription.stats.wordsAdded || 0) > 0}><div class="stat text-green-600"><strong>Added:</strong> {transcription.stats.wordsAdded}</div></Show>
                <Show when={(transcription.stats.wordsReplaced || 0) > 0}><div class="stat text-blue-600"><strong>Replaced:</strong> {transcription.stats.wordsReplaced}</div></Show>
                <Show when={(transcription.stats.wordsKeptStable || 0) > 0}><div class="stat text-purple-600"><strong>Kept Stable:</strong> {transcription.stats.wordsKeptStable}</div></Show>
                <Show when={transcription.lastUpdateTime}><div class="stat"><strong>Updated:</strong> {new Date(transcription.lastUpdateTime).toLocaleTimeString()}</div></Show>
                <Show when={transcription.lastIsFinal !== undefined}><div class="stat" classList={{'text-green-600': transcription.lastIsFinal, 'text-blue-600': !transcription.lastIsFinal}}><strong>Status:</strong> {transcription.lastIsFinal ? 'Final' : 'Interim'}</div></Show>
            </div>
            <div class="widget-actions">
                <Show when={isContentVisible()}>
                    <button class="btn btn-icon-xs btn-toggle" classList={{active: colorByConfidence()}} title="Color words by confidence" onClick={() => setColorByConfidence(!colorByConfidence())}>
                        <span class="material-icons">palette</span>
                    </button>
                    <button class="btn btn-icon-xs btn-toggle" classList={{active: showFinalizedWords()}} title="Highlight finalized words" onClick={() => setShowFinalizedWords(!showFinalizedWords())}>
                        <span class="material-icons">check_circle</span>
                    </button>
                    <button class="btn btn-icon-xs btn-toggle" classList={{active: showWordDetails()}} title="Show word details" onClick={() => setShowWordDetails(!showWordDetails())}>
                        <span class="material-icons">info</span>
                    </button>
                    <button class="btn btn-icon-xs btn-ghost" title="Copy transcription" onClick={() => navigator.clipboard.writeText(displayedWords().map(w => w.text).join(' '))} disabled={displayedWords().length === 0}>
                        <span class="material-icons">content_copy</span>
                    </button>
                    <button class="btn btn-icon-xs btn-toggle" classList={{active: showMergerSettings()}} title="Merger Settings" onClick={() => setShowMergerSettings(!showMergerSettings())}>
                        <span class="material-icons">settings</span>
                    </button>
                    <button class="btn btn-icon-xs btn-toggle" classList={{active: showFullUtterance()}} title="Show/Hide full utterance" onClick={() => setShowFullUtterance(!showFullUtterance())}>
                        <span class="material-icons">subject</span>
                    </button>
                </Show>
                <button class="btn btn-icon-xs btn-toggle" classList={{active: isContentVisible()}} title={isContentVisible() ? 'Hide' : 'Show'} onClick={() => setIsContentVisible(!isContentVisible())}>
                    <span class="material-icons">{isContentVisible() ? 'unfold_less' : 'unfold_more'}</span>
                </button>
            </div>
        </div>
        
        <Show when={isContentVisible()}>
            <div class="widget-content">
                <Show when={showFullUtterance() && transcription.lastUtteranceText}>
                    <div class="utterance-text-container">
                        <h4 class="utterance-heading">Full Utterance:</h4>
                        <p class="utterance-text">{transcription.lastUtteranceText}</p>
                    </div>
                </Show>

                <div class="transcription-content" ref={transcriptionContainerRef} onScroll={handleScroll}>
                <Show when={displayedWords().length > 0} 
                    fallback={
                        <div class="empty-state">
                            <p>No transcription data available yet.</p>
                        </div>
                    }>
                    <div class="words-container">
                        <For each={displayedWords()}>
                            {(word, i) => {
                                const hasHistory = () => (word.history || []).length > 0;
                                const isPunctuation = /^[.,!?;:"']$/.test(word.text);
                                
                                return <>
                                    <span 
                                        class="word"
                                        classList={{
                                            [getConfidenceColor(word.confidence)]: true,
                                            'finalized': showFinalizedWords() && word.finalized,
                                            'focused': i() === focusedWordIndex(),
                                            'has-alternatives': hasHistory(),
                                            'punctuation': isPunctuation,
                                            'mature-cursor-word': word.id === matureCursorWordId()
                                        }}
                                        onClick={[handleWordClick, i()]}
                                        title={`[${i()}] ${word.text} (Conf: ${(word.confidence * 100).toFixed(1)}%) - ${formatTime(word.start)}-${formatTime(word.end)} - ${word.finalized ? 'Finalized' : 'Hypothesis'}\nStab: ${word.stabilityCounter || 0} | LastModSeq: ${word.lastModifiedSequence || 'N/A'}\nID: ${word.id}`}
                                    >
                                        {word.text}
                                    </span>
                                    {shouldAddSpace(i()) && ' '}
                                </>;
                            }}
                        </For>
                        <Show when={showAlternativesPopup() && focusedWordIndex() !== -1 && alternativesPopupData().length > 0}>
                            <WordAlternativesPopup 
                                alternatives={alternativesPopupData()} 
                                position={popupPosition()}
                                placement={popupPlacement()}
                                onClose={() => setShowAlternativesPopup(false)}
                                onSelect={handleAlternativeSelect} 
                            />
                        </Show>
                    </div>
                    
                    <Show when={showWordDetails() && focusedWordIndex() !== -1 && displayedWords()[focusedWordIndex()]}>
                        {(() => {
                            const word = displayedWords()[focusedWordIndex()];
                            return <div class="word-details">
                                <h4>Word Details (Index: {focusedWordIndex()})</h4>
                                <table>
                                    <tbody>
                                    <tr><td>ID:</td><td>{word.id || 'N/A'}</td></tr>
                                    <tr><td>Text:</td><td>{word.text}</td></tr>
                                    <tr><td>Time:</td><td>{formatTime(word.start)} - {formatTime(word.end)} ({(word.end - word.start).toFixed(3)}s)</td></tr>
                                    <tr><td>Confidence:</td><td>{(word.confidence * 100).toFixed(1)}%</td></tr>
                                    <tr><td>Status:</td><td>{word.finalized ? 'Finalized' : 'Hypothesis'}</td></tr>
                                    <tr><td>Stability:</td><td>{word.stabilityCounter || 0}</td></tr>
                                    <tr><td>Last Mod Seq:</td><td>{word.lastModifiedSequence || 'N/A'}</td></tr>
                                    <tr><td>Source Seg ID:</td><td>{word.sourceSegmentId || 'N/A'}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        })()}
                    </Show>


                </Show>
                </div>
            </div>
            
            <Show when={showMergerSettings()}>
                {/* <MergerSettingsPanel config={mergerConfig()} onConfigChange={updateMergerConfigAndNotify} /> */}
            </Show>
            

        </Show>
    </div>
    );
} 