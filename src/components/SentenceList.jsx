import { For, Show, createMemo } from 'solid-js';
import { useTranscription } from '../stores/transcriptionStore';
import { useUI } from '../stores/uiStore';
import Timestamp from './Timestamp';

/**
 * Pure SolidJS sentence list - leverages fine-grained reactivity
 * No virtual list needed - SolidJS handles large lists efficiently
 */
export default function SentenceList(props) {
  const [transcription] = useTranscription();
  const [ui] = useUI();

  // Debug logging to see the raw store value
  console.log('[SentenceList] Raw transcription store:', transcription);
  console.log('[SentenceList] allMatureSentences property:', transcription.allMatureSentences);

  // Memoized sentence processing for optimal performance
  const displayedSentences = createMemo(() => {
    const sentences = transcription.allMatureSentences || [];
    
    // Debug logging to see what sentences we're getting
    console.log('[SentenceList] Received sentences:', sentences.length, sentences);
    
    // For very large lists (>1000 sentences), optionally slice recent ones
    // SolidJS can handle thousands of DOM nodes efficiently, but we can optimize further if needed
    if (sentences.length > 1000) {
      return sentences.slice(-1000); // Keep last 1000 sentences
    }
    
    return sentences;
  });

  return (
    <div class="sentence-view" ref={props.setSentenceContainerRef}>
      {/* Debug info */}
      <div style="font-size: 10px; color: gray; padding: 4px;">
        Debug: {displayedSentences().length} sentences loaded
      </div>
      
      <Show when={displayedSentences().length === 0}>
        <div class="text-center text-gray-500 dark:text-gray-400 py-8">
          <div class="text-sm">No mature sentences yet</div>
          <div class="text-xs mt-1">Start speaking to see sentences appear here</div>
        </div>
      </Show>
      
      <Show when={displayedSentences().length > 0}>
        <div class="sentence-list-container">
          {/* 
            Pure SolidJS For - automatically optimizes DOM updates
            Only changed sentence elements will re-render
          */}
          <For each={displayedSentences()}>
            {(sentence, index) => (
              <div class="sentence-item" data-sentence-id={sentence.id}>
                <div class="sentence-metadata">
                  <span class="sentence-id">
                    #{String(index() + 1).padStart(4, '0')}
                  </span>
                  <span class="sentence-timestamp">
                    <Timestamp seconds={sentence.startTime} />-<Timestamp seconds={sentence.endTime} />
                  </span>
                </div>
                <div class="sentence-text">{sentence.text}</div>
                <div class="sentence-wordcount">{sentence.wordCount}w</div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
} 