import { describe, expect, it } from 'vitest';
import { UtteranceBasedMerger, type ASRWord } from './UtteranceBasedMerger';

function buildWords(text: string, start = 0): ASRWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.map((token, i) => ({
    text: token,
    start_time: start + i * 0.2,
    end_time: start + (i + 1) * 0.2,
    confidence: 0.9,
  }));
}

describe('UtteranceBasedMerger timeout finalization', () => {
  it('honors matureSentenceOffset holdback before finalizing', () => {
    const merger = new UtteranceBasedMerger({
      useNLP: false,
      minSentenceLength: 1,
      skipSingleSentences: false,
      matureSentenceOffset: -2,
      requireFollowingSentence: true,
    });

    const twoSentences = merger.processASRResult({
      utterance_text: 'alpha. beta.',
      words: buildWords('alpha. beta.'),
      end_time: 0.4,
    });
    expect(twoSentences.matureText).toBe('');

    const threeSentences = merger.processASRResult({
      utterance_text: 'alpha. beta. gamma.',
      words: buildWords('alpha. beta. gamma.'),
      end_time: 0.6,
    });
    expect(threeSentences.matureText).toContain('alpha.');
    expect(threeSentences.matureText).not.toContain('beta.');
  });

  it('keeps pending sentence across no-boundary chunks and finalizes it on timeout', () => {
    const merger = new UtteranceBasedMerger({
      useNLP: false,
      minSentenceLength: 1,
      enableTimeoutFinalization: true,
    });
    const punctuated = 'want to welcome you.';
    merger.processASRResult({
      utterance_text: punctuated,
      words: buildWords(punctuated),
      end_time: 0.8,
    });

    merger.processASRResult({
      utterance_text: 'and keep speaking without terminal punctuation',
      words: buildWords('and keep speaking without terminal punctuation', 1.0),
      end_time: 2.0,
    });

    expect(merger.getPendingSentence()?.text).toBe(punctuated);
    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).not.toBeNull();
    expect(flushed?.matureText).toContain(punctuated);
    expect(flushed?.immatureText).toBe('and keep speaking without terminal punctuation');
  });

  it('removes only finalized sentence prefix from live buffer on timeout', () => {
    const merger = new UtteranceBasedMerger({
      useNLP: false,
      minSentenceLength: 1,
      enableTimeoutFinalization: true,
    });

    merger.processASRResult({
      utterance_text: 'first sentence. second live tail words',
      words: buildWords('first sentence. second live tail words'),
      end_time: 1.2,
    });

    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).not.toBeNull();
    expect(flushed?.matureText).toContain('first sentence.');
    expect(flushed?.immatureText).toBe('second live tail words');
  });

  it('does not finalize no-punctuation tails', () => {
    const merger = new UtteranceBasedMerger({
      useNLP: false,
      minSentenceLength: 1,
      enableTimeoutFinalization: true,
    });
    const text = 'hello there';
    merger.processASRResult({
      utterance_text: text,
      words: buildWords(text),
      end_time: 0.4,
    });

    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).toBeNull();
    expect(merger.getImmatureText()).toBe(text);
    expect(merger.getPendingSentence()).toBeNull();
  });

  it('still finalizes punctuated pending sentences', () => {
    const merger = new UtteranceBasedMerger({
      minSentenceLength: 1,
      enableTimeoutFinalization: true,
    });
    const text = 'this is complete.';
    merger.processASRResult({
      utterance_text: text,
      words: buildWords(text),
      end_time: 0.8,
    });

    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).not.toBeNull();
    expect(flushed?.matureText).toContain('this is complete.');
    expect(flushed?.immatureText).toBe('');
  });
});
