/**
 * Keet v4.0 - Transcription Web Worker
 * 
 * Runs heavy AI inference and text merging in a background thread
 * to prevent UI stuttering on the main thread.
 *
 * Supports both:
 * - v3 token-stream mode (LCSPTFAMerger, fixed-window)
 * - v4 utterance mode (UtteranceBasedMerger, cursor-based windowing)
 */

import { TranscriptionService } from './TranscriptionService';
import { TokenStreamTranscriber } from './TokenStreamTranscriber';
import { ModelManager } from './ModelManager';
import { UtteranceBasedMerger } from './UtteranceBasedMerger';
import type { ASRResult, MergerResult } from './UtteranceBasedMerger';
import type { StreamStateResult } from './TokenTimelineEngine';
import {
    LocalAgreementMerger,
    type AgreementIncomingSegment,
    type AgreementIncomingWord,
    type LocalAgreementConfig,
    type LocalAgreementState,
    type MergedWord,
} from './LocalAgreementMerger';

let modelManager: ModelManager | null = null;
let transcriptionService: TranscriptionService | null = null;
let tokenStreamTranscriber: TokenStreamTranscriber | null = null;
let utteranceMerger: UtteranceBasedMerger | null = null;
/* ---- v5 Token timeline pipeline (DISABLED for cleanup) ----

let localAgreementMerger: LocalAgreementMerger | null = null;
let v5FastDecoderState: any = null;
let v5FastDecoderStateTime = 0;
let v5Sequence = 0;
let v5CorrectionPasses = 0;
let v5CorrectionAgreementHits = 0;
let v5CacheSamples = 0;
let v5CacheHits = 0;
let v5LastNowSec = 0;

// Caching for stable tokens and text to reduce GC pressure
let v5CachedStableTokens: any[] = [];
let v5CachedStableText = '';
let v5CachedSentences: any[] = [];
let v5LastMatureCursorTime = -1;

async function v5TranscribeTokenChunk(
    model: any,
    payload: any,
    mode: 'fast' | 'correction',
): Promise<any> {
    const timeOffset = payload.timeOffset || 0;
    const allowDecoderContinuation = !!payload.allowDecoderContinuation;

    const incremental = payload.incrementalCache
        ? {
            cacheKey: payload.incrementalCache.cacheKey,
            prefixSeconds: payload.incrementalCache.prefixSeconds,
        }
        : undefined;

    const useFastDecoderState =
        mode === 'fast' &&
        allowDecoderContinuation &&
        v5FastDecoderState &&
        Math.abs(timeOffset - v5FastDecoderStateTime) <= 0.6;

    if (typeof model.transcribeTokenChunk === 'function') {
        const result = await model.transcribeTokenChunk(null, 16000, {
            precomputedFeatures: {
                features: payload.features,
                T: payload.T,
                melBins: payload.melBins,
            },
            returnWords: true,
            returnConfidences: true,
            returnLogProbs: true,
            returnDecoderState: mode === 'fast',
            previousDecoderState: useFastDecoderState ? v5FastDecoderState : null,
            timeOffset,
            incremental,
        });

        if (mode === 'fast') {
            v5FastDecoderState = result.decoderState || null;
            v5FastDecoderStateTime = payload.endTime || timeOffset;
        }

        return result;
    }

    const fallback = await model.transcribe(null, 16000, {
        precomputedFeatures: {
            features: payload.features,
            T: payload.T,
            melBins: payload.melBins,
        },
        returnTimestamps: true,
        returnConfidences: true,
        returnTokenIds: true,
        returnFrameIndices: true,
        returnLogProbs: true,
        timeOffset,
        incremental,
    });

    return {
        utterance_text: fallback.utterance_text || '',
        words: fallback.words || [],
        tokens: fallback.tokens || [],
        tokenIds: fallback.tokenIds || [],
        frameIndices: fallback.frameIndices || [],
        logProbs: fallback.logProbs || [],
        frameTimeStride: fallback.frameTimeStride || model.getFrameTimeStride?.() || 0.08,
        cacheDiagnostics: fallback.cacheDiagnostics || {
            cacheHit: false,
            prefixFrames: 0,
            startFrame: 0,
        },
        metrics: fallback.metrics,
    };
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
}

function confidenceToLogProb(confidence: number): number {
    return Math.log(Math.max(1e-6, clamp01(confidence)));
}

function normalizeWordText(raw: any): string {
    const value = raw?.word ?? raw?.text ?? raw?.token ?? '';
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeWordTime(raw: any, key: 'start' | 'end', fallback: number): number {
    const candidates =
        key === 'start'
            ? [raw?.start, raw?.start_time, raw?.startTime]
            : [raw?.end, raw?.end_time, raw?.endTime];
    for (const candidate of candidates) {
        if (Number.isFinite(candidate)) {
            return Number(candidate);
        }
    }
    return fallback;
}

function normalizeWordConfidence(raw: any, fallback = 0.75): number {
    const candidate = raw?.confidence ?? raw?.probability ?? raw?.score;
    if (Number.isFinite(candidate)) {
        return clamp01(Number(candidate));
    }
    return clamp01(fallback);
}

function average(values: number[], fallback = 0): number {
    if (!values.length) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageLogProbAsConfidence(logProbs: any): number | null {
    if (!Array.isArray(logProbs) || logProbs.length === 0) return null;
    const probs = logProbs
        .map((lp) => (Number.isFinite(lp) ? Math.exp(Math.max(-20, Math.min(0, Number(lp)))) : NaN))
        .filter((p) => Number.isFinite(p)) as number[];
    if (probs.length === 0) return null;
    return clamp01(average(probs, 0.75));
}

function normalizeSegment(segment: any): AgreementIncomingSegment | null {
    const words: AgreementIncomingWord[] = [];
    for (const rawWord of segment?.words || []) {
        const text = normalizeWordText(rawWord);
        if (!text) continue;
        const start = normalizeWordTime(rawWord, 'start', 0);
        const end = normalizeWordTime(rawWord, 'end', start);
        if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
        const confidence = normalizeWordConfidence(rawWord, normalizeWordConfidence(segment, 0.75));
        words.push({ word: text, start, end, confidence });
    }
    if (words.length === 0) return null;
    words.sort((a, b) => a.start - b.start);
    const segmentConfidence = normalizeWordConfidence(segment, average(words.map((w) => w.confidence || 0.75), 0.75));
    return { confidence: segmentConfidence, words };
}

function normalizeSegmentsFromChunk(
    tokenChunk: any,
    payload: any,
    frameTimeStride: number
): AgreementIncomingSegment[] {
    const asProvided: AgreementIncomingSegment[] = [];

    if (Array.isArray(tokenChunk?.segments) && tokenChunk.segments.length > 0) {
        for (const segment of tokenChunk.segments) {
            const normalized = normalizeSegment(segment);
            if (normalized) asProvided.push(normalized);
        }
    }

    if (asProvided.length > 0) {
        return asProvided;
    }

    if (Array.isArray(tokenChunk?.words) && tokenChunk.words.length > 0) {
        const words: AgreementIncomingWord[] = [];
        const inferredSegmentConfidence =
            normalizeWordConfidence({}, averageLogProbAsConfidence(tokenChunk.logProbs) ?? 0.75);

        for (const rawWord of tokenChunk.words) {
            const text = normalizeWordText(rawWord);
            if (!text) continue;
            const fallbackStart = Number(payload?.timeOffset) || 0;
            const start = normalizeWordTime(rawWord, 'start', fallbackStart);
            const end = normalizeWordTime(rawWord, 'end', start + frameTimeStride);
            if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
            const confidence = normalizeWordConfidence(rawWord, inferredSegmentConfidence);
            words.push({ word: text, start, end, confidence });
        }

        if (words.length > 0) {
            words.sort((a, b) => a.start - b.start);
            return [{
                confidence: average(words.map((w) => w.confidence || inferredSegmentConfidence), inferredSegmentConfidence),
                words,
            }];
        }
    }

    const tokenIds = Array.isArray(tokenChunk?.tokenIds) ? tokenChunk.tokenIds : [];
    const frameIndices = Array.isArray(tokenChunk?.frameIndices) ? tokenChunk.frameIndices : [];
    const tokenTexts = Array.isArray(tokenChunk?.tokens) ? tokenChunk.tokens : [];
    const fallbackConfidence = averageLogProbAsConfidence(tokenChunk?.logProbs) ?? 0.75;
    const offset = Number(payload?.timeOffset) || 0;
    const tokenWords: AgreementIncomingWord[] = [];

    if (tokenIds.length > 0 && frameIndices.length === tokenIds.length) {
        for (let i = 0; i < tokenIds.length; i += 1) {
            const tokenText = normalizeWordText(tokenTexts[i]);
            if (!tokenText) continue;
            const frame = Number(frameIndices[i]);
            if (!Number.isFinite(frame)) continue;
            const start = offset + frame * frameTimeStride;
            const nextFrame =
                i + 1 < frameIndices.length && Number.isFinite(frameIndices[i + 1])
                    ? Number(frameIndices[i + 1])
                    : frame + 1;
            const end = offset + Math.max(nextFrame, frame + 1) * frameTimeStride;
            if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
            const logProb = Array.isArray(tokenChunk?.logProbs) && Number.isFinite(tokenChunk.logProbs[i])
                ? Number(tokenChunk.logProbs[i])
                : Math.log(fallbackConfidence);
            const confidence = clamp01(Math.exp(Math.max(-20, Math.min(0, logProb))));
            tokenWords.push({ word: tokenText, start, end, confidence });
        }
    }

    if (tokenWords.length > 0) {
        tokenWords.sort((a, b) => a.start - b.start);
        return [{
            confidence: average(tokenWords.map((w) => w.confidence || fallbackConfidence), fallbackConfidence),
            words: tokenWords,
        }];
    }

    return [];
}

function joinWords(words: Array<{ text: string }>): string {
    if (!words.length) return '';
    let text = '';
    for (let i = 0; i < words.length; i += 1) {
        const current = words[i]?.text || '';
        if (!current) continue;

        let needsSpace = i > 0;
        if (i > 0) {
            const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(current);
            if (noSpaceBefore) {
                needsSpace = false;
            }
            if (current.startsWith("'")) {
                const contractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                if (contractions.includes(current.toLowerCase())) {
                    needsSpace = false;
                }
            }
            const prev = words[i - 1]?.text || '';
            if (current.toLowerCase() === "n't" && prev.toLowerCase().endsWith('n')) {
                needsSpace = false;
            }
        }

        if (needsSpace) text += ' ';
        text += current;
    }
    return text.replace(/\s+/g, ' ').trim();
}

function buildSentencesFromWords(words: MergedWord[]): Array<{
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
}> {
    if (!words.length) return [];
    const out: Array<{ text: string; startTime: number; endTime: number; confidence: number }> = [];
    let current: MergedWord[] = [];

    const flush = () => {
        if (!current.length) return;
        const startTime = current[0].start;
        const endTime = current[current.length - 1].end;
        out.push({
            text: joinWords(current.map((w) => ({ text: w.text }))),
            startTime,
            endTime,
            confidence: average(current.map((w) => clamp01(Number(w.confidence))), 0.75),
        });
        current = [];
    };

    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        current.push(word);

        const next = i + 1 < words.length ? words[i + 1] : null;
        const punctuationBoundary = /[.?!]$/.test(word.text);
        const pauseBoundary = next ? next.start - word.end >= 0.65 : false;
        const endBoundary = i === words.length - 1;

        if (punctuationBoundary || pauseBoundary || endBoundary) {
            flush();
        }
    }

    return out;
}

function wordToTimelineToken(word: MergedWord, index: number, source: 'fast' | 'correction') {
    const confidence = clamp01(Number(word.confidence));
    return {
        id: index,
        text: word.text,
        frameIndex: Math.max(0, Math.round(word.start / 0.08)),
        startTime: word.start,
        endTime: word.end,
        logProb: confidenceToLogProb(confidence),
        stableHits: Math.max(0, Number(word.stabilityCounter) || 0),
        lastCorrectionPass: Math.max(0, Number(word.lastModifiedSequence) || 0),
        source,
    };
}

function mapV5ConfigToLocalAgreement(config: any): Partial<LocalAgreementConfig> {
    const correctionConfirmations = Number.isFinite(config?.correctionConfirmations)
        ? Math.max(1, Math.round(Number(config.correctionConfirmations)))
        : 2;

    return {
        debug: !!config?.debug,
        finalizationStabilityThreshold: correctionConfirmations,
        // Keep age-based finalization conservative to avoid early sentence splits/churn.
        finalizationAgeThreshold: 10.0,
        segmentFilterMinAbsoluteConfidence: 0.20,
        segmentFilterStdDevThresholdFactor: 2.0,
        useAgeFinalization: true,
        wordConfidenceReplaceThreshold: 0.12,
        minOverlapDurationForRedundancy: 0.05,
        stabilityThresholdForVeto: 1,
        wordMinConfidenceSuperiorityForVeto: 0.18,
    };
}

function recordV5CacheTelemetry(cacheDiagnostics: any): void {
    if (typeof cacheDiagnostics?.cacheHit === 'boolean') {
        v5CacheSamples += 1;
        if (cacheDiagnostics.cacheHit) {
            v5CacheHits += 1;
        }
    }
}

function toV5StatePayload(
    state: LocalAgreementState,
    nowSec: number,
    decodeMeta: any = {}
): StreamStateResult & { metrics?: any; cacheDiagnostics?: any } {
    const words = Array.isArray(state.words) ? state.words : [];
    const matureCursorTime = state.matureCursorTime || 0;

    // Incremental update: Recompute stable part only when mature cursor moves
    if (matureCursorTime !== v5LastMatureCursorTime) {
        const stableWords = words.filter((w) => w.finalized);
        v5CachedStableTokens = stableWords.map((w, i) => wordToTimelineToken(w, i, 'correction'));
        v5CachedStableText = joinWords(stableWords.map((w) => ({ text: w.text })));
        v5LastMatureCursorTime = matureCursorTime;
    }

    const draftWords = words.filter((w) => !w.finalized);
    const draftTokens = draftWords.map((w, i) => wordToTimelineToken(w, i + v5CachedStableTokens.length, 'fast'));
    const draftText = joinWords(draftWords.map((w) => ({ text: w.text })));
    
    // fullText can be efficiently joined from stable and draft parts
    const fullText = v5CachedStableText + (v5CachedStableText && draftText ? ' ' : '') + draftText;
    
    const sentences = buildSentencesFromWords(words);
    const stableLagSec =
        Number.isFinite(nowSec) && nowSec > 0
            ? Math.max(0, nowSec - matureCursorTime)
            : 0;
    const sentenceBoundaryConfidence =
        sentences.length === 0 ? 0 : Math.min(1, 0.55 + Math.min(sentences.length, 6) * 0.07);

    return {
        stableTokens: v5CachedStableTokens,
        draftTokens,
        stableText: v5CachedStableText,
        draftText,
        fullText,
        commitCursorTime: matureCursorTime,
        sentences,
        stats: {
            rewriteCount: state.stats?.wordsReplaced || 0,
            stableLagSec,
            correctionPasses: v5CorrectionPasses,
            correctionHitRatio: v5CorrectionPasses > 0 ? v5CorrectionAgreementHits / v5CorrectionPasses : 0,
            cacheHitRatio: v5CacheSamples > 0 ? v5CacheHits / v5CacheSamples : 0,
            commitCursorTime: matureCursorTime,
            sentenceBoundaryConfidence,
        },
        matureText: v5CachedStableText,
        immatureText: draftText,
        matureCursorTime: matureCursorTime,
        metrics: decodeMeta.metrics,
        cacheDiagnostics: decodeMeta.cacheDiagnostics,
    };
}

function buildLocalAgreementMergeState(
    tokenChunk: any,
    payload: any,
    mode: 'fast' | 'correction'
): LocalAgreementState {
    if (!localAgreementMerger) {
        throw new Error('LocalAgreementMerger not initialized');
    }

    const frameTimeStride =
        tokenChunk?.frameTimeStride || payload?.frameTimeStride || 0.08;
    const nowSec = Number.isFinite(payload?.endTime)
        ? Number(payload.endTime)
        : Number.isFinite(payload?.timeOffset)
            ? Number(payload.timeOffset)
            : v5LastNowSec;
    const segments = normalizeSegmentsFromChunk(tokenChunk, payload, frameTimeStride);

    let nextState: LocalAgreementState;
    if (segments.length > 0) {
        const sequence = ++v5Sequence;
        nextState = localAgreementMerger.merge({
            segmentId: payload?.segmentId || `v5-${mode}-${sequence}`,
            sequence,
            segments,
            endTime: nowSec,
        });
    } else {
        // No valid segment: do not advance sequence or force flush.
        // Keep state stable; explicit silence finalize path handles real flush/commit.
        nextState = localAgreementMerger.getCurrentState();
    }

    v5LastNowSec = nowSec;
    return nextState;
}

function updateV5CorrectionTelemetry(before: LocalAgreementState, after: LocalAgreementState): void {
    v5CorrectionPasses += 1;
    const keptDelta = (after.stats?.wordsKeptStable || 0) - (before.stats?.wordsKeptStable || 0);
    const replacedDelta = (after.stats?.wordsReplaced || 0) - (before.stats?.wordsReplaced || 0);
    if (keptDelta > 0 || replacedDelta > 0) {
        v5CorrectionAgreementHits += 1;
    }
}

function toV5StatePayloadWithDecodeMeta(
    state: LocalAgreementState,
    decodeMeta: any = {}
): StreamStateResult & { metrics?: any; cacheDiagnostics?: any } {
    return toV5StatePayload(state, v5LastNowSec, decodeMeta);
}

function toV5StatePayloadLegacyFinal(state: LocalAgreementState): StreamStateResult {
    return {
        ...toV5StatePayload(state, v5LastNowSec),
    };
}
*/

// Keep lastNowSec if needed for other logic
let v5LastNowSec = 0;

// Mock callbacks for ModelManager
const modelCallbacks = {
    onProgress: (p: any) => {
        postMessage({ type: 'MODEL_PROGRESS', payload: p });
    },
    onStateChange: (s: any) => {
        postMessage({ type: 'MODEL_STATE', payload: s });
    },
    onError: (e: Error) => {
        postMessage({ type: 'ERROR', payload: e.message });
    }
};

// Mock callbacks for TranscriptionService
const transcriptionCallbacks = {
    onResult: (result: any) => {
        postMessage({ type: 'TRANSCRIPTION_RESULT', payload: result });
    },
    onError: (e: Error) => {
        postMessage({ type: 'ERROR', payload: e.message });
    }
};

async function v5TranscribeTokenChunk(
    model: any,
    payload: any,
    mode: 'fast' | 'correction',
): Promise<any> {
    const timeOffset = payload.timeOffset || 0;
    const allowDecoderContinuation = !!payload.allowDecoderContinuation;

    const incremental = payload.incrementalCache
        ? {
            cacheKey: payload.incrementalCache.cacheKey,
            prefixSeconds: payload.incrementalCache.prefixSeconds,
        }
        : undefined;

    const useFastDecoderState =
        mode === 'fast' &&
        allowDecoderContinuation &&
        v5FastDecoderState &&
        Math.abs(timeOffset - v5FastDecoderStateTime) <= 0.6;

    if (typeof model.transcribeTokenChunk === 'function') {
        const result = await model.transcribeTokenChunk(null, 16000, {
            precomputedFeatures: {
                features: payload.features,
                T: payload.T,
                melBins: payload.melBins,
            },
            returnWords: true,
            returnConfidences: true,
            returnLogProbs: true,
            returnDecoderState: mode === 'fast',
            previousDecoderState: useFastDecoderState ? v5FastDecoderState : null,
            timeOffset,
            incremental,
        });

        if (mode === 'fast') {
            v5FastDecoderState = result.decoderState || null;
            v5FastDecoderStateTime = payload.endTime || timeOffset;
        }

        return result;
    }

    const fallback = await model.transcribe(null, 16000, {
        precomputedFeatures: {
            features: payload.features,
            T: payload.T,
            melBins: payload.melBins,
        },
        returnTimestamps: true,
        returnConfidences: true,
        returnTokenIds: true,
        returnFrameIndices: true,
        returnLogProbs: true,
        timeOffset,
        incremental,
    });

    return {
        utterance_text: fallback.utterance_text || '',
        words: fallback.words || [],
        tokens: fallback.tokens || [],
        tokenIds: fallback.tokenIds || [],
        frameIndices: fallback.frameIndices || [],
        logProbs: fallback.logProbs || [],
        frameTimeStride: fallback.frameTimeStride || model.getFrameTimeStride?.() || 0.08,
        cacheDiagnostics: fallback.cacheDiagnostics || {
            cacheHit: false,
            prefixFrames: 0,
            startFrame: 0,
        },
        metrics: fallback.metrics,
    };
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    return Math.min(1, Math.max(0, x));
}

function confidenceToLogProb(confidence: number): number {
    return Math.log(Math.max(1e-6, clamp01(confidence)));
}

function normalizeWordText(raw: any): string {
    const value = raw?.word ?? raw?.text ?? raw?.token ?? '';
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeWordTime(raw: any, key: 'start' | 'end', fallback: number): number {
    const candidates =
        key === 'start'
            ? [raw?.start, raw?.start_time, raw?.startTime]
            : [raw?.end, raw?.end_time, raw?.endTime];
    for (const candidate of candidates) {
        if (Number.isFinite(candidate)) {
            return Number(candidate);
        }
    }
    return fallback;
}

function normalizeWordConfidence(raw: any, fallback = 0.75): number {
    const candidate = raw?.confidence ?? raw?.probability ?? raw?.score;
    if (Number.isFinite(candidate)) {
        return clamp01(Number(candidate));
    }
    return clamp01(fallback);
}

function average(values: number[], fallback = 0): number {
    if (!values.length) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageLogProbAsConfidence(logProbs: any): number | null {
    if (!Array.isArray(logProbs) || logProbs.length === 0) return null;
    const probs = logProbs
        .map((lp) => (Number.isFinite(lp) ? Math.exp(Math.max(-20, Math.min(0, Number(lp)))) : NaN))
        .filter((p) => Number.isFinite(p)) as number[];
    if (probs.length === 0) return null;
    return clamp01(average(probs, 0.75));
}

function normalizeSegment(segment: any): AgreementIncomingSegment | null {
    const words: AgreementIncomingWord[] = [];
    for (const rawWord of segment?.words || []) {
        const text = normalizeWordText(rawWord);
        if (!text) continue;
        const start = normalizeWordTime(rawWord, 'start', 0);
        const end = normalizeWordTime(rawWord, 'end', start);
        if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
        const confidence = normalizeWordConfidence(rawWord, normalizeWordConfidence(segment, 0.75));
        words.push({ word: text, start, end, confidence });
    }
    if (words.length === 0) return null;
    words.sort((a, b) => a.start - b.start);
    const segmentConfidence = normalizeWordConfidence(segment, average(words.map((w) => w.confidence || 0.75), 0.75));
    return { confidence: segmentConfidence, words };
}

function normalizeSegmentsFromChunk(
    tokenChunk: any,
    payload: any,
    frameTimeStride: number
): AgreementIncomingSegment[] {
    const asProvided: AgreementIncomingSegment[] = [];

    if (Array.isArray(tokenChunk?.segments) && tokenChunk.segments.length > 0) {
        for (const segment of tokenChunk.segments) {
            const normalized = normalizeSegment(segment);
            if (normalized) asProvided.push(normalized);
        }
    }

    if (asProvided.length > 0) {
        return asProvided;
    }

    if (Array.isArray(tokenChunk?.words) && tokenChunk.words.length > 0) {
        const words: AgreementIncomingWord[] = [];
        const inferredSegmentConfidence =
            normalizeWordConfidence({}, averageLogProbAsConfidence(tokenChunk.logProbs) ?? 0.75);

        for (const rawWord of tokenChunk.words) {
            const text = normalizeWordText(rawWord);
            if (!text) continue;
            const fallbackStart = Number(payload?.timeOffset) || 0;
            const start = normalizeWordTime(rawWord, 'start', fallbackStart);
            const end = normalizeWordTime(rawWord, 'end', start + frameTimeStride);
            if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
            const confidence = normalizeWordConfidence(rawWord, inferredSegmentConfidence);
            words.push({ word: text, start, end, confidence });
        }

        if (words.length > 0) {
            words.sort((a, b) => a.start - b.start);
            return [{
                confidence: average(words.map((w) => w.confidence || inferredSegmentConfidence), inferredSegmentConfidence),
                words,
            }];
        }
    }

    const tokenIds = Array.isArray(tokenChunk?.tokenIds) ? tokenChunk.tokenIds : [];
    const frameIndices = Array.isArray(tokenChunk?.frameIndices) ? tokenChunk.frameIndices : [];
    const tokenTexts = Array.isArray(tokenChunk?.tokens) ? tokenChunk.tokens : [];
    const fallbackConfidence = averageLogProbAsConfidence(tokenChunk?.logProbs) ?? 0.75;
    const offset = Number(payload?.timeOffset) || 0;
    const tokenWords: AgreementIncomingWord[] = [];

    if (tokenIds.length > 0 && frameIndices.length === tokenIds.length) {
        for (let i = 0; i < tokenIds.length; i += 1) {
            const tokenText = normalizeWordText(tokenTexts[i]);
            if (!tokenText) continue;
            const frame = Number(frameIndices[i]);
            if (!Number.isFinite(frame)) continue;
            const start = offset + frame * frameTimeStride;
            const nextFrame =
                i + 1 < frameIndices.length && Number.isFinite(frameIndices[i + 1])
                    ? Number(frameIndices[i + 1])
                    : frame + 1;
            const end = offset + Math.max(nextFrame, frame + 1) * frameTimeStride;
            if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) continue;
            const logProb = Array.isArray(tokenChunk?.logProbs) && Number.isFinite(tokenChunk.logProbs[i])
                ? Number(tokenChunk.logProbs[i])
                : Math.log(fallbackConfidence);
            const confidence = clamp01(Math.exp(Math.max(-20, Math.min(0, logProb))));
            tokenWords.push({ word: tokenText, start, end, confidence });
        }
    }

    if (tokenWords.length > 0) {
        tokenWords.sort((a, b) => a.start - b.start);
        return [{
            confidence: average(tokenWords.map((w) => w.confidence || fallbackConfidence), fallbackConfidence),
            words: tokenWords,
        }];
    }

    return [];
}

function joinWords(words: Array<{ text: string }>): string {
    if (!words.length) return '';
    let text = '';
    for (let i = 0; i < words.length; i += 1) {
        const current = words[i]?.text || '';
        if (!current) continue;

        let needsSpace = i > 0;
        if (i > 0) {
            const noSpaceBefore = /^[.,!?;:)'"\]\]}]/.test(current);
            if (noSpaceBefore) {
                needsSpace = false;
            }
            if (current.startsWith("'")) {
                const contractions = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];
                if (contractions.includes(current.toLowerCase())) {
                    needsSpace = false;
                }
            }
            const prev = words[i - 1]?.text || '';
            if (current.toLowerCase() === "n't" && prev.toLowerCase().endsWith('n')) {
                needsSpace = false;
            }
        }

        if (needsSpace) text += ' ';
        text += current;
    }
    return text.replace(/\s+/g, ' ').trim();
}

function buildSentencesFromWords(words: MergedWord[]): Array<{
    text: string;
    startTime: number;
    endTime: number;
    confidence: number;
}> {
    if (!words.length) return [];
    const out: Array<{ text: string; startTime: number; endTime: number; confidence: number }> = [];
    let current: MergedWord[] = [];

    const flush = () => {
        if (!current.length) return;
        const startTime = current[0].start;
        const endTime = current[current.length - 1].end;
        out.push({
            text: joinWords(current.map((w) => ({ text: w.text }))),
            startTime,
            endTime,
            confidence: average(current.map((w) => clamp01(Number(w.confidence))), 0.75),
        });
        current = [];
    };

    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        current.push(word);

        const next = i + 1 < words.length ? words[i + 1] : null;
        const punctuationBoundary = /[.?!]$/.test(word.text);
        const pauseBoundary = next ? next.start - word.end >= 0.65 : false;
        const endBoundary = i === words.length - 1;

        if (punctuationBoundary || pauseBoundary || endBoundary) {
            flush();
        }
    }

    return out;
}

function wordToTimelineToken(word: MergedWord, index: number, source: 'fast' | 'correction') {
    const confidence = clamp01(Number(word.confidence));
    return {
        id: index,
        text: word.text,
        frameIndex: Math.max(0, Math.round(word.start / 0.08)),
        startTime: word.start,
        endTime: word.end,
        logProb: confidenceToLogProb(confidence),
        stableHits: Math.max(0, Number(word.stabilityCounter) || 0),
        lastCorrectionPass: Math.max(0, Number(word.lastModifiedSequence) || 0),
        source,
    };
}

function mapV5ConfigToLocalAgreement(config: any): Partial<LocalAgreementConfig> {
    const correctionConfirmations = Number.isFinite(config?.correctionConfirmations)
        ? Math.max(1, Math.round(Number(config.correctionConfirmations)))
        : 2;

    return {
        debug: !!config?.debug,
        finalizationStabilityThreshold: correctionConfirmations,
        // Keep age-based finalization conservative to avoid early sentence splits/churn.
        finalizationAgeThreshold: 10.0,
        segmentFilterMinAbsoluteConfidence: 0.20,
        segmentFilterStdDevThresholdFactor: 2.0,
        useAgeFinalization: true,
        wordConfidenceReplaceThreshold: 0.12,
        minOverlapDurationForRedundancy: 0.05,
        stabilityThresholdForVeto: 1,
        wordMinConfidenceSuperiorityForVeto: 0.18,
    };
}

function recordV5CacheTelemetry(cacheDiagnostics: any): void {
    if (typeof cacheDiagnostics?.cacheHit === 'boolean') {
        v5CacheSamples += 1;
        if (cacheDiagnostics.cacheHit) {
            v5CacheHits += 1;
        }
    }
}

function toV5StatePayload(
    state: LocalAgreementState,
    nowSec: number,
    decodeMeta: any = {}
): StreamStateResult & { metrics?: any; cacheDiagnostics?: any } {
    const words = Array.isArray(state.words) ? state.words : [];
    const matureCursorTime = state.matureCursorTime || 0;

    // Incremental update: Recompute stable part only when mature cursor moves
    if (matureCursorTime !== v5LastMatureCursorTime) {
        const stableWords = words.filter((w) => w.finalized);
        v5CachedStableTokens = stableWords.map((w, i) => wordToTimelineToken(w, i, 'correction'));
        v5CachedStableText = joinWords(stableWords.map((w) => ({ text: w.text })));
        v5LastMatureCursorTime = matureCursorTime;
    }

    const draftWords = words.filter((w) => !w.finalized);
    const draftTokens = draftWords.map((w, i) => wordToTimelineToken(w, i + v5CachedStableTokens.length, 'fast'));
    const draftText = joinWords(draftWords.map((w) => ({ text: w.text })));
    
    // fullText can be efficiently joined from stable and draft parts
    const fullText = v5CachedStableText + (v5CachedStableText && draftText ? ' ' : '') + draftText;
    
    const sentences = buildSentencesFromWords(words);
    const stableLagSec =
        Number.isFinite(nowSec) && nowSec > 0
            ? Math.max(0, nowSec - matureCursorTime)
            : 0;
    const sentenceBoundaryConfidence =
        sentences.length === 0 ? 0 : Math.min(1, 0.55 + Math.min(sentences.length, 6) * 0.07);

    return {
        stableTokens: v5CachedStableTokens,
        draftTokens,
        stableText: v5CachedStableText,
        draftText,
        fullText,
        commitCursorTime: matureCursorTime,
        sentences,
        stats: {
            rewriteCount: state.stats?.wordsReplaced || 0,
            stableLagSec,
            correctionPasses: v5CorrectionPasses,
            correctionHitRatio: v5CorrectionPasses > 0 ? v5CorrectionAgreementHits / v5CorrectionPasses : 0,
            cacheHitRatio: v5CacheSamples > 0 ? v5CacheHits / v5CacheSamples : 0,
            commitCursorTime: matureCursorTime,
            sentenceBoundaryConfidence,
        },
        matureText: v5CachedStableText,
        immatureText: draftText,
        matureCursorTime: matureCursorTime,
        metrics: decodeMeta.metrics,
        cacheDiagnostics: decodeMeta.cacheDiagnostics,
    };
}

function buildLocalAgreementMergeState(
    tokenChunk: any,
    payload: any,
    mode: 'fast' | 'correction'
): LocalAgreementState {
    if (!localAgreementMerger) {
        throw new Error('LocalAgreementMerger not initialized');
    }

    const frameTimeStride =
        tokenChunk?.frameTimeStride || payload?.frameTimeStride || 0.08;
    const nowSec = Number.isFinite(payload?.endTime)
        ? Number(payload.endTime)
        : Number.isFinite(payload?.timeOffset)
            ? Number(payload.timeOffset)
            : v5LastNowSec;
    const segments = normalizeSegmentsFromChunk(tokenChunk, payload, frameTimeStride);

    let nextState: LocalAgreementState;
    if (segments.length > 0) {
        const sequence = ++v5Sequence;
        nextState = localAgreementMerger.merge({
            segmentId: payload?.segmentId || `v5-${mode}-${sequence}`,
            sequence,
            segments,
            endTime: nowSec,
        });
    } else {
        // No valid segment: do not advance sequence or force flush.
        // Keep state stable; explicit silence finalize path handles real flush/commit.
        nextState = localAgreementMerger.getCurrentState();
    }

    v5LastNowSec = nowSec;
    return nextState;
}

function updateV5CorrectionTelemetry(before: LocalAgreementState, after: LocalAgreementState): void {
    v5CorrectionPasses += 1;
    const keptDelta = (after.stats?.wordsKeptStable || 0) - (before.stats?.wordsKeptStable || 0);
    const replacedDelta = (after.stats?.wordsReplaced || 0) - (before.stats?.wordsReplaced || 0);
    if (keptDelta > 0 || replacedDelta > 0) {
        v5CorrectionAgreementHits += 1;
    }
}

function toV5StatePayloadWithDecodeMeta(
    state: LocalAgreementState,
    decodeMeta: any = {}
): StreamStateResult & { metrics?: any; cacheDiagnostics?: any } {
    return toV5StatePayload(state, v5LastNowSec, decodeMeta);
}

function toV5StatePayloadLegacyFinal(state: LocalAgreementState): StreamStateResult {
    return {
        ...toV5StatePayload(state, v5LastNowSec),
    };
}

self.onmessage = async (e: MessageEvent) => {
    const { type, payload, id } = e.data;

    try {
        switch (type) {
            case 'INIT_MODEL':
                if (!modelManager) {
                    modelManager = new ModelManager(modelCallbacks);
                }
                await modelManager.loadModel(payload);
                postMessage({ type: 'INIT_MODEL_DONE', id });
                break;

            case 'LOAD_LOCAL_MODEL':
                if (!modelManager) {
                    modelManager = new ModelManager(modelCallbacks);
                }
                // FileList can't be easily sent, but File can be part of Transferable or just sent as is
                await modelManager.loadLocalModel(payload);
                postMessage({ type: 'INIT_MODEL_DONE', id });
                break;

            case 'INIT_SERVICE':
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                transcriptionService = new TranscriptionService(
                    modelManager,
                    payload.config,
                    transcriptionCallbacks
                );
                transcriptionService.initialize();
                postMessage({ type: 'INIT_SERVICE_DONE', id });
                break;

            case 'INIT_V3_SERVICE':
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                tokenStreamTranscriber = new TokenStreamTranscriber(
                    modelManager,
                    payload.config,
                    {
                        onConfirmedUpdate: (text: string, words: any[]) => postMessage({ type: 'V3_CONFIRMED', payload: { text, words } }),
                        onPendingUpdate: (text: string, words: any[]) => postMessage({ type: 'V3_PENDING', payload: { text, words } }),
                        onError: (e: Error) => postMessage({ type: 'ERROR', payload: e.message })
                    }
                );
                await tokenStreamTranscriber.initialize();
                postMessage({ type: 'INIT_V3_SERVICE_DONE', id });
                break;

            case 'PROCESS_CHUNK':
                if (!transcriptionService) {
                    throw new Error('TranscriptionService not initialized');
                }
                const result = await transcriptionService.processChunk(payload);
                postMessage({ type: 'PROCESS_CHUNK_DONE', payload: result, id });
                break;

            case 'PROCESS_V3_CHUNK':
                if (!tokenStreamTranscriber) {
                    throw new Error('TokenStreamTranscriber not initialized');
                }
                const v3Result = await tokenStreamTranscriber.processChunk(payload.audio, payload.startTime);
                // Return result AND current state for UI
                const state = tokenStreamTranscriber.getState();
                postMessage({
                    type: 'PROCESS_V3_CHUNK_DONE',
                    payload: {
                        ...v3Result,
                        lcsLength: v3Result.lcsLength,
                        anchorValid: v3Result.anchorValid,
                        anchorTokens: v3Result.anchorTokens,
                        chunkCount: state.chunkCount
                    },
                    id
                });
                break;

            case 'PROCESS_V3_CHUNK_WITH_FEATURES':
                if (!tokenStreamTranscriber) {
                    throw new Error('TokenStreamTranscriber not initialized');
                }
                const v3FeatResult = await tokenStreamTranscriber.processChunkWithFeatures(
                    payload.features,
                    payload.T,
                    payload.melBins,
                    payload.startTime,
                    payload.overlapSeconds,
                );
                // Return result AND current state for UI
                const featState = tokenStreamTranscriber.getState();
                postMessage({
                    type: 'PROCESS_V3_CHUNK_WITH_FEATURES_DONE',
                    payload: {
                        ...v3FeatResult,
                        lcsLength: v3FeatResult.lcsLength,
                        anchorValid: v3FeatResult.anchorValid,
                        anchorTokens: v3FeatResult.anchorTokens,
                        chunkCount: featState.chunkCount
                    },
                    id
                });
                break;

            case 'TRANSCRIBE_SEGMENT':
                if (!transcriptionService) {
                    throw new Error('TranscriptionService not initialized');
                }
                const segResult = await transcriptionService.transcribeSegment(payload);
                postMessage({ type: 'TRANSCRIBE_SEGMENT_DONE', payload: segResult, id });
                break;

            case 'RESET':
                if (transcriptionService) {
                    transcriptionService.reset();
                }
                if (localAgreementMerger) {
                    localAgreementMerger.reset();
                }
                v5FastDecoderState = null;
                v5FastDecoderStateTime = 0;
                v5Sequence = 0;
                v5CorrectionPasses = 0;
                v5CorrectionAgreementHits = 0;
                v5CacheSamples = 0;
                v5CacheHits = 0;
                v5LastNowSec = 0;
                v5CachedStableTokens = [];
                v5CachedStableText = '';
                v5CachedSentences = [];
                v5LastMatureCursorTime = -1;
                postMessage({ type: 'RESET_DONE', id });
                break;

            case 'FINALIZE':
                if (localAgreementMerger) {
                    const finalV5 = localAgreementMerger.flush(v5LastNowSec, ++v5Sequence);
                    postMessage({ type: 'FINALIZE_DONE', payload: toV5StatePayloadLegacyFinal(finalV5), id });
                } else if (tokenStreamTranscriber) {
                    const final = tokenStreamTranscriber.finalize();
                    postMessage({ type: 'FINALIZE_DONE', payload: { text: final.fullText }, id });
                } else if (utteranceMerger) {
                    // For v4 utterance mode, finalize pending sentence
                    const flushResult = utteranceMerger.finalizePendingSentenceByTimeout();
                    const mergerResult = flushResult || {
                        matureText: utteranceMerger.getMatureText(),
                        immatureText: utteranceMerger.getImmatureText(),
                        matureCursorTime: utteranceMerger.getMatureCursorTime(),
                    };
                    postMessage({ type: 'FINALIZE_DONE', payload: mergerResult, id });
                } else if (transcriptionService) {
                    const finalResult = transcriptionService.finalize();
                    postMessage({ type: 'FINALIZE_DONE', payload: finalResult, id });
                }
                break;

            // ---- v4 Utterance-based pipeline ----

            case 'INIT_V4_SERVICE': {
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                utteranceMerger = new UtteranceBasedMerger(payload.config || {});
                postMessage({ type: 'INIT_V4_SERVICE_DONE', id });
                break;
            }

            case 'PROCESS_V4_CHUNK_WITH_FEATURES': {
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                if (!utteranceMerger) {
                    throw new Error('UtteranceBasedMerger not initialized');
                }

                const model = modelManager.getModel();
                if (!model) {
                    throw new Error('Model not loaded');
                }

                // Transcribe using pre-computed mel features
                const v4TranscribeResult = await model.transcribe(null, 16000, {
                    precomputedFeatures: {
                        features: payload.features,
                        T: payload.T,
                        melBins: payload.melBins,
                    },
                    returnTimestamps: true,
                    enableProfiling: false,
                    timeOffset: payload.timeOffset || 0,
                    // Incremental decoder cache for the overlap prefix
                    ...(payload.incrementalCache ? {
                        incremental: {
                            cacheKey: payload.incrementalCache.cacheKey,
                            prefixSeconds: payload.incrementalCache.prefixSeconds,
                        },
                    } : {}),
                });

                // Feed ASR result into the utterance merger
                const asrResult: ASRResult = {
                    utterance_text: v4TranscribeResult.utterance_text,
                    words: v4TranscribeResult.words?.map((w: any) => ({
                        text: w.text,
                        start_time: w.start_time,
                        end_time: w.end_time,
                        confidence: w.confidence,
                    })),
                    end_time: payload.endTime || 0,
                    segment_id: payload.segmentId,
                };

                const v4MergerResult = utteranceMerger.processASRResult(asrResult);
                const asrWords = asrResult.words || [];
                const asrStartTime = asrWords.length > 0 ? asrWords[0].start_time : 0;
                const asrEndTime = asrWords.length > 0 ? asrWords[asrWords.length - 1].end_time : 0;
                const mergeDebug = utteranceMerger.getLastDebugSnapshot?.() || v4MergerResult.debug || null;

                postMessage({
                    type: 'PROCESS_V4_CHUNK_WITH_FEATURES_DONE',
                    payload: {
                        // Merger state
                        matureText: v4MergerResult.matureText,
                        immatureText: v4MergerResult.immatureText,
                        matureCursorTime: v4MergerResult.matureCursorTime,
                        fullText: v4MergerResult.fullText,
                        // Raw ASR metrics
                        metrics: v4TranscribeResult.metrics,
                        // Sentence info
                        totalSentences: v4MergerResult.totalSentences,
                        matureSentenceCount: v4MergerResult.allMatureSentences.length,
                        pendingSentence: v4MergerResult.pendingSentence?.text || null,
                        stats: v4MergerResult.stats,
                        debug: {
                            segmentId: payload.segmentId,
                            windowStartSec: payload.timeOffset || 0,
                            windowEndSec: payload.endTime || 0,
                            asrText: asrResult.utterance_text || '',
                            asrWordCount: asrWords.length,
                            asrStartSec: asrStartTime,
                            asrEndSec: asrEndTime,
                            merge: mergeDebug,
                        },
                    },
                    id,
                });
                break;
            }

            case 'V4_FINALIZE_TIMEOUT': {
                if (!utteranceMerger) {
                    throw new Error('UtteranceBasedMerger not initialized');
                }
                const timeoutResult = utteranceMerger.finalizePendingSentenceByTimeout();
                const finalizeDebug = utteranceMerger.getLastDebugSnapshot?.() || null;
                postMessage({
                    type: 'V4_FINALIZE_TIMEOUT_DONE',
                    payload: timeoutResult ? {
                        matureText: timeoutResult.matureText,
                        immatureText: timeoutResult.immatureText,
                        matureCursorTime: timeoutResult.matureCursorTime,
                        fullText: timeoutResult.fullText,
                        debug: {
                            finalizeReason: 'timeout',
                            merge: finalizeDebug,
                        },
                    } : null,
                    id,
                });
                break;
            }

            case 'V4_RESET': {
                if (utteranceMerger) {
                    utteranceMerger.reset();
                }
                postMessage({ type: 'V4_RESET_DONE', id });
                break;
            }

            // ---- v5 Token timeline pipeline (DISABLED) ----

            /*
            case 'INIT_V5_STREAM': {
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                const model = modelManager.getModel();
                if (!model) {
                    throw new Error('Model not loaded');
                }
                localAgreementMerger = new LocalAgreementMerger(
                    mapV5ConfigToLocalAgreement(payload?.config || {})
                );
                v5FastDecoderState = null;
                v5FastDecoderStateTime = 0;
                v5Sequence = 0;
                v5CorrectionPasses = 0;
                v5CorrectionAgreementHits = 0;
                v5CacheSamples = 0;
                v5CacheHits = 0;
                v5LastNowSec = 0;
                v5CachedStableTokens = [];
                v5CachedStableText = '';
                v5CachedSentences = [];
                v5LastMatureCursorTime = -1;
                postMessage({ type: 'INIT_V5_STREAM_DONE', id });
                break;
            }

            case 'PROCESS_V5_FAST': {
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                if (!localAgreementMerger) {
                    throw new Error('LocalAgreementMerger not initialized');
                }
                const model = modelManager.getModel();
                if (!model) {
                    throw new Error('Model not loaded');
                }

                const tokenChunk = await v5TranscribeTokenChunk(model, payload, 'fast');
                recordV5CacheTelemetry(tokenChunk.cacheDiagnostics);
                const state = buildLocalAgreementMergeState(tokenChunk, payload, 'fast');

                postMessage({
                    type: 'PROCESS_V5_FAST_DONE',
                    payload: toV5StatePayloadWithDecodeMeta(state, tokenChunk),
                    id,
                });
                break;
            }

            case 'PROCESS_V5_CORRECTION': {
                if (!modelManager) {
                    throw new Error('ModelManager not initialized');
                }
                if (!localAgreementMerger) {
                    throw new Error('LocalAgreementMerger not initialized');
                }
                const model = modelManager.getModel();
                if (!model) {
                    throw new Error('Model not loaded');
                }

                const tokenChunk = await v5TranscribeTokenChunk(model, payload, 'correction');
                recordV5CacheTelemetry(tokenChunk.cacheDiagnostics);
                const before = localAgreementMerger.getCurrentState();
                const state = buildLocalAgreementMergeState(tokenChunk, payload, 'correction');
                updateV5CorrectionTelemetry(before, state);

                postMessage({
                    type: 'PROCESS_V5_CORRECTION_DONE',
                    payload: toV5StatePayloadWithDecodeMeta(state, tokenChunk),
                    id,
                });
                break;
            }

            case 'V5_FINALIZE_SILENCE': {
                if (!localAgreementMerger) {
                    throw new Error('LocalAgreementMerger not initialized');
                }
                const nowSec = Number.isFinite(payload?.nowSec) ? Number(payload.nowSec) : v5LastNowSec;
                const state = localAgreementMerger.flush(nowSec, ++v5Sequence);
                v5LastNowSec = nowSec;
                postMessage({ type: 'V5_FINALIZE_SILENCE_DONE', payload: toV5StatePayloadLegacyFinal(state), id });
                break;
            }

            case 'V5_RESET': {
                if (localAgreementMerger) {
                    localAgreementMerger.reset();
                }
                v5FastDecoderState = null;
                v5FastDecoderStateTime = 0;
                v5Sequence = 0;
                v5CorrectionPasses = 0;
                v5CorrectionAgreementHits = 0;
                v5CacheSamples = 0;
                v5CacheHits = 0;
                v5LastNowSec = 0;
                v5CachedStableTokens = [];
                v5CachedStableText = '';
                v5CachedSentences = [];
                v5LastMatureCursorTime = -1;
                postMessage({ type: 'V5_RESET_DONE', id });
                break;
            }
            */

            default:
                console.warn('[TranscriptionWorker] Unknown message type:', type);
        }
    } catch (err: any) {
        console.error('[TranscriptionWorker] Error:', err);
        postMessage({ type: 'ERROR', payload: err.message, id });
    }
};
