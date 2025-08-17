import { createStore } from "solid-js/store";
import { reconcile } from "solid-js/store";
import { createContext, useContext } from "solid-js";

export const TranscriptionContext = createContext();

const initialState = {
  mergedWords: [],
  stats: {},
  matureTimestamp: 0,
  lastUtteranceText: null,
  lastIsFinal: false,
  lastUpdateTime: null,
  allMatureSentences: [],
  livePreviewText: ''
};

export function TranscriptionProvider(props) {
  const [state, setState] = createStore({ ...initialState });

  const store = [
    state,
    {
      setData(data) {
        if (data.mergedWords) setState('mergedWords', data.mergedWords);
        if (data.stats) setState('stats', data.stats);
        if (data.lastUtteranceText) setState('lastUtteranceText', data.lastUtteranceText);
        if (data.lastIsFinal !== undefined) setState('lastIsFinal', data.lastIsFinal);
        if (data.lastUpdateTime) setState('lastUpdateTime', data.lastUpdateTime);
        if (data.matureTimestamp !== undefined) {
          setState('matureTimestamp', data.matureTimestamp);
        }
      },
      setMatureTimestamp(time) {
        setState('matureTimestamp', time);
      },
      setAllMatureSentences(sentences) {
        console.log('[TranscriptionStore] setAllMatureSentences called with:', sentences.length, sentences);
        setState('allMatureSentences', reconcile(sentences));
        console.log('[TranscriptionStore] State after update:', state.allMatureSentences.length);
      },
      setLivePreviewText(text) {
        setState('livePreviewText', text);
      },
      updateWordLock(wordId, locked, newText) {
        setState('mergedWords', w => w.id === wordId, {
          locked: locked,
          word: newText,
          // You might need to handle history here as well
        });
      },
      resetTranscription() {
        setState({ ...initialState });
      }
    }
  ];

  return (
    <TranscriptionContext.Provider value={store}>
      {props.children}
    </TranscriptionContext.Provider>
  );
}

export function useTranscription() { return useContext(TranscriptionContext); } 