// test-merger.js
// Standalone script to test the TranscriptionMerger logic, specifically for duplication issues.
// Run with: node test-merger.js

import TranscriptionMerger from '../src/TranscriptionMerger.js'; // Adjust path if needed

console.log('--- Merger Duplication Test ---');

// --- Test Data ---
// Represents the state *before* the problematic merge, focusing on the relevant words.
// IMPORTANT: Timestamps and IDs are illustrative examples based on logs.
// The key part is having a finalized word ending a sentence ("back.")
// followed by a new segment potentially starting with the same word ("back").

const initialWords = [
    // ... potentially other words before
    { id: "segment_21_s0_w10_seq21", text: "my", start: 103.1, end: 103.3, confidence: 0.95, finalized: true, sequence: 21 },
    { id: "segment_21_s0_w11_seq21", text: "message.", start: 103.4, end: 103.9, confidence: 0.98, finalized: true, sequence: 21 },
    { id: "segment_22_s1_w43_seq22", text: "I'll", start: 104.1, end: 104.3, confidence: 0.99, finalized: true, sequence: 22 },
    { id: "segment_22_s1_w44_seq22", text: "be", start: 104.3, end: 104.4, confidence: 1.00, finalized: true, sequence: 22 },
    { id: "segment_22_s1_w45_seq22", text: "heading", start: 104.5, end: 104.9, confidence: 0.97, finalized: true, sequence: 22 },
    { id: "segment_18_s0_w14_seq18", text: "back.", start: 105.0, end: 105.3, confidence: 0.96, finalized: true, sequence: 18 }, // The FINALIZED "back." causing issues when preserved
    // Note: Sequence 18 is older, but let's assume it was finalized and preserved by logic
];

// Represents the incoming response that potentially starts with "back"
// Based roughly on segment_23 logs
const segmentResponse = {
    segmentId: "segment_23",
    sequence: 23,
    segments: [
        {
            text: "back The ship is currently anchored off the coast of the Avidya Forest.",
            start: 105.2, // Slightly overlapping/adjacent start time
            end: 108.4,
            confidence: 0.9,
            words: [
                // This is the word causing the duplication when the previous one is preserved
                { word: "back", start: 105.25, end: 105.5, confidence: 0.85 },
                { word: "The", start: 105.8, end: 106.0, confidence: 0.99 },
                { word: "ship", start: 106.1, end: 106.4, confidence: 1.00 },
                { word: "is", start: 106.4, end: 106.5, confidence: 1.00 },
                { word: "currently", start: 106.6, end: 107.1, confidence: 0.98 },
                { word: "anchored", start: 107.2, end: 107.7, confidence: 0.95 },
                { word: "off", start: 107.8, end: 107.9, confidence: 0.90 },
                { word: "the", start: 107.9, end: 108.0, confidence: 0.99 },
                { word: "coast", start: 108.0, end: 108.4, confidence: 0.97 },
                // ... potentially more words
            ]
        }
        // ... potentially more segments in the response
    ],
    // Include other relevant top-level response fields if necessary
};


// --- Test Execution ---

async function runMergeTest() {
    const merger = new TranscriptionMerger();

    // Set initial state (deep copy to avoid modifying test data)
    merger.mergedWords = JSON.parse(JSON.stringify(initialWords));
    // We assume default config for this test, otherwise set it here:
    // merger.updateConfig({ preserveHighConfidenceWords: true, ... });

    console.log(`Initial words loaded: ${merger.mergedWords.length}`);
    console.log('Initial Text:', merger.getFinalText()); // Log text before merge

    // Perform the merge
    console.log(`\nMerging response for ${segmentResponse.segmentId} (Sequence ${segmentResponse.sequence})...`);
    const result = merger.merge(segmentResponse);

    // Check the final text using the *current* getFinalText implementation
    const finalText = merger.getFinalText();
    console.log('\n--- Final Text (Current Logic) ---');
    console.log(finalText);
    console.log('--- End Final Text ---');

    // Check specifically for the duplication
    if (finalText.includes('back. back')) {
        console.error('\n🔴🔴🔴 Duplication "back. back" DETECTED! 🔴🔴🔴');
    } else if (finalText.includes('back.')) {
        console.log('\n🟡 "back." found, but duplication seems absent (or fixed by getFinalText).');
    } else {
        console.warn('\n🟡 "back." not found - check test data or merge logic.');
    }

    console.log(`\nFinal word count in merger state: ${merger.mergedWords.length}`);
}

runMergeTest().catch(console.error);

// --- TODO: Add more test cases as needed --- 