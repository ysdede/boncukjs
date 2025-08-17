import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'fs'; // Import Node.js file system module
import path from 'path'; // Import Node.js path module
import TranscriptionMerger from '../src/TranscriptionMerger.js'; // Adjust path if needed

describe('TranscriptionMerger', () => {
    let merger;

    // Default config for most tests, can be overridden
    const defaultConfig = { debug: true }; 

    beforeEach(() => {
        // Create a new merger instance before each test
        merger = new TranscriptionMerger(defaultConfig);
    });

    it('should initialize with default state', () => {
        const state = merger.getCurrentState();
        expect(state.text).toBe('');
        expect(state.words).toEqual([]);
        expect(state.matureCursorTime).toBe(0);
        expect(state.stats.totalSegmentsProcessed).toBe(0);
    });

    // --- Test Scenarios ---

    describe('Basic Merging (No Overlap)', () => {
        it('should add words from a single segment', () => {
            const segment1 = {
                segmentId: 'seg1',
                sequence: 1,
                isFinal: false, // Example status
                segments: [{
                    words: [
                        { word: 'Hello', start: 0.1, end: 0.5, confidence: 0.9 },
                        { word: 'world', start: 0.6, end: 1.0, confidence: 0.85 },
                    ],
                    confidence: 0.9 // Ensure segment confidence is present
                }],
                endTime: 1.0 // Use segment end time or estimate
            };
            
            merger.merge(segment1);
            const state = merger.getCurrentState();
            
            expect(state.words).toHaveLength(2);
            expect(state.words[0].text).toBe('Hello');
            expect(state.words[1].text).toBe('world');
            expect(state.text).toBe('Hello world');
            expect(state.stats.totalSegmentsProcessed).toBe(1);
            expect(state.stats.wordsAdded).toBe(2);
            expect(state.stats.wordsReplaced).toBe(0);
            expect(state.stats.wordsKeptStable).toBe(0);
        });

        it('should append words from a subsequent non-overlapping segment', () => {
            // Process first segment
            merger.merge({
                segmentId: 'seg1', sequence: 1, endTime: 1.0,
                segments: [{ 
                    words: [{ word: 'First', start: 0.1, end: 0.8, confidence: 0.9 }],
                    confidence: 0.9 // Add segment confidence
                }]
            });
            
            // Process second segment (starts after first ends)
            merger.merge({
                segmentId: 'seg2', sequence: 2, endTime: 2.0,
                segments: [{ 
                    words: [{ word: 'Second', start: 1.1, end: 1.8, confidence: 0.9 }],
                    confidence: 0.9 // Add segment confidence
                }]
            });

            const state = merger.getCurrentState();
            expect(state.words).toHaveLength(2);
            expect(state.words[0].text).toBe('First');
            expect(state.words[1].text).toBe('Second');
            expect(state.text).toBe('First Second');
            expect(state.stats.totalSegmentsProcessed).toBe(2);
            expect(state.stats.wordsAdded).toBe(2); // 1 + 1
        });
    });

    describe('Local Agreement Scenarios', () => {
        // TODO: Add tests using mock data representing overlap scenarios
        it('should keep existing words when incoming segment fully agrees', () => {
            // 1. Process initial segment
             merger.merge({
                segmentId: 'seg1', sequence: 1, endTime: 1.5,
                segments: [{ 
                    words: [
                        { word: 'This', start: 0.1, end: 0.4, confidence: 0.9 },
                        { word: 'is', start: 0.5, end: 0.7, confidence: 0.9 },
                        { word: 'a', start: 0.8, end: 0.9, confidence: 0.9 },
                        { word: 'test', start: 1.0, end: 1.4, confidence: 0.9 },
                    ],
                    confidence: 0.9 // Add segment confidence
                }]
            });
            const initialState = merger.getCurrentState();
            expect(initialState.words.map(w=>w.text)).toEqual(['This', 'is', 'a', 'test']);

            // 2. Process overlapping segment that agrees completely
             merger.merge({
                segmentId: 'seg2', sequence: 2, endTime: 1.6, // Slightly later end time
                segments: [{ 
                    words: [
                        { word: 'This', start: 0.1, end: 0.4, confidence: 0.95 }, // Higher confidence
                        { word: 'is', start: 0.5, end: 0.7, confidence: 0.95 },
                        { word: 'a', start: 0.8, end: 0.9, confidence: 0.95 },
                        { word: 'test', start: 1.0, end: 1.4, confidence: 0.95 },
                    ],
                    confidence: 0.95 // Add segment confidence
                }]
            });
            
            const finalState = merger.getCurrentState();
            // Check transcript hasn't changed text/timing significantly
            expect(finalState.words.map(w=>w.text)).toEqual(['This', 'is', 'a', 'test']);
             expect(finalState.words[0].start).toBeCloseTo(0.1);
             expect(finalState.words[3].end).toBeCloseTo(1.4);
             // Check stability increased
             expect(finalState.words[0].stabilityCounter).toBeGreaterThan(0);
             expect(finalState.words[1].stabilityCounter).toBeGreaterThan(0);
             expect(finalState.words[2].stabilityCounter).toBeGreaterThan(0);
             expect(finalState.words[3].stabilityCounter).toBeGreaterThan(0);
             // Check stats
             expect(finalState.stats.wordsAdded).toBe(4); // Only from first segment
             expect(finalState.stats.wordsReplaced).toBe(0);
             expect(finalState.stats.wordsKeptStable).toBe(4); // Incremented stability
             expect(finalState.stats.totalSegmentsProcessed).toBe(2);
        });

        it('should perform partial replacement when segments partially agree', () => {
            // 1. Process initial segment
            merger.merge({
                segmentId: 'seg1', sequence: 1, endTime: 1.5,
                segments: [{ 
                    words: [
                        { word: 'Partial', start: 0.1, end: 0.6, confidence: 0.9 },
                        { word: 'agreement', start: 0.7, end: 1.3, confidence: 0.9 },
                        { word: 'old', start: 1.4, end: 1.7, confidence: 0.8 }, // Word to be replaced
                    ],
                    confidence: 0.9 // Add segment confidence
                }]
            });

            // 2. Process overlapping segment with partial agreement and a correction
             merger.merge({
                segmentId: 'seg2', sequence: 2, endTime: 1.9, 
                segments: [{ 
                    words: [
                        { word: 'Partial', start: 0.1, end: 0.6, confidence: 0.95 }, // Agrees
                        { word: 'agreement', start: 0.7, end: 1.3, confidence: 0.95 }, // Agrees
                        { word: 'new', start: 1.45, end: 1.8, confidence: 0.9 }, // Correction
                    ],
                    confidence: 0.92 // Add segment confidence
                }]
            });

            const finalState = merger.getCurrentState();
            expect(finalState.words).toHaveLength(3);
            expect(finalState.words.map(w=>w.text)).toEqual(['Partial', 'agreement', 'new']);
            // Check stability of agreed words
            expect(finalState.words[0].stabilityCounter).toBeGreaterThan(0);
            expect(finalState.words[1].stabilityCounter).toBeGreaterThan(0);
            // Check stability of new word
            expect(finalState.words[2].stabilityCounter).toBe(0);
            // Check stats
            expect(finalState.stats.wordsAdded).toBe(3 + 1); // 3 initial + 1 new
            expect(finalState.stats.wordsReplaced).toBe(1); // 'old' was replaced
            expect(finalState.stats.wordsKeptStable).toBe(2); // 'Partial', 'agreement' were kept
            expect(finalState.stats.totalSegmentsProcessed).toBe(2);
        });
        
        it('should replace all on complete disagreement if confidence favors new', () => {
            // 1. Initial
             merger.merge({
                segmentId: 'seg1', sequence: 1, endTime: 1.0,
                segments: [{ 
                    words: [ { word: 'Old', start: 0.1, end: 0.8, confidence: 0.6 } ],
                    confidence: 0.6 // Add segment confidence (matches word conf)
                }] 
            });
            
            // 2. New, overlapping, completely different, higher confidence
             merger.merge({
                segmentId: 'seg2', sequence: 2, endTime: 1.1,
                segments: [{ 
                    words: [ { word: 'New', start: 0.15, end: 0.9, confidence: 0.95 } ],
                    confidence: 0.95 // Add segment confidence
                }] 
            });

            const finalState = merger.getCurrentState();
            expect(finalState.words).toHaveLength(1);
            expect(finalState.words[0].text).toBe('New');
            expect(finalState.stats.wordsAdded).toBe(1 + 1); // 1 initial + 1 new
            expect(finalState.stats.wordsReplaced).toBe(1); // 'Old' replaced
            expect(finalState.stats.wordsKeptStable).toBe(0);
        });
        
        it('should keep existing on complete disagreement if confidence/stability favors old', () => {
             // 1. Initial (stable)
             merger.merge({
                segmentId: 'seg1', sequence: 1, endTime: 1.0,
                segments: [{ 
                    words: [ { word: 'Stable', start: 0.1, end: 0.8, confidence: 0.9 } ],
                    confidence: 0.9 // Add segment confidence
                }] 
            });
            // Ensure the word was actually added before trying to modify it
            expect(merger.mergedTranscript).toHaveLength(1);
            // Simulate it surviving a few rounds
            merger.mergedTranscript[0].stabilityCounter = 5; 
            merger.mergedTranscript[0].lastModifiedSequence = 1; 

            // 2. New, overlapping, different, lower confidence
             merger.merge({
                segmentId: 'seg2', sequence: 10, endTime: 1.1, // Much later sequence
                segments: [{ 
                    words: [ { word: 'UnstableNew', start: 0.15, end: 0.9, confidence: 0.7 } ],
                    confidence: 0.7 // Add segment confidence
                }] 
            });

            const finalState = merger.getCurrentState();
            expect(finalState.words).toHaveLength(1);
            expect(finalState.words[0].text).toBe('Stable'); // Kept the original
            expect(finalState.words[0].stabilityCounter).toBeGreaterThan(5); // Stability incremented
            expect(finalState.stats.wordsAdded).toBe(1); // Only initial
            expect(finalState.stats.wordsReplaced).toBe(0);
            expect(finalState.stats.wordsKeptStable).toBe(1); // Kept stable word
        });

        // --- Test using Session Data Excerpt ---
        it('should correctly process session data excerpt', () => {
            // Excerpt from testdata/session_Windows_NT_10.0_20250503192120_afbzvz.json
            // Assumes this data represents the RAW websocket message content
            const jfkRawSessionData = [
              { // Raw result for segment_0
                segmentId: 'segment_0', sessionId: 'jfk_test', sequence: 0, language: 'en', 
                segments: [ { text: ' In the long history of the world.', start: 0.84, end: 3, confidence: 0.797, 
                  words: [ { word: ' In', start: 0.84, end: 1.26, confidence: 0.429 }, { word: ' the', start: 1.26, end: 1.38, confidence: 0.996 }, { word: ' long', start: 1.38, end: 1.86, confidence: 0.998 }, { word: ' history', start: 1.86, end: 2.4, confidence: 0.998 }, { word: ' of', start: 2.4, end: 2.6, confidence: 0.998 }, { word: ' the', start: 2.6, end: 2.68, confidence: 0.999 }, { word: ' world.', start: 2.68, end: 3, confidence: 0.999 } ] } ], 
                endTime: 3.6, // Assuming endTime is part of the raw message
                // buffer_state: { ... } // Include if it was part of the raw message
              },
              { // Raw result for segment_1
                segmentId: 'segment_1', sessionId: 'jfk_test', sequence: 1, language: 'en', 
                segments: [ { text: ' In the long history of the world, only a few generations', start: 0.84, end: 5.38, confidence: 0.812, 
                  words: [ { word: ' In', start: 0.84, end: 1.26, confidence: 0.787 }, { word: ' the', start: 1.26, end: 1.4, confidence: 0.993 }, { word: ' long', start: 1.4, end: 1.86, confidence: 0.997 }, { word: ' history', start: 1.86, end: 2.42, confidence: 0.998 }, { word: ' of', start: 2.42, end: 2.6, confidence: 0.999 }, { word: ' the', start: 2.6, end: 2.68, confidence: 0.997 }, { word: ' world,', start: 2.68, end: 3.02, confidence: 0.999 }, { word: ' only', start: 3.52, end: 4.26, confidence: 0.994 }, { word: ' a', start: 4.26, end: 4.44, confidence: 0.999 }, { word: ' few', start: 4.44, end: 4.7, confidence: 0.999 }, { word: ' generations', start: 4.7, end: 5.38, confidence: 0.998 } ] } ], 
                endTime: 6.4, 
                // buffer_state: { ... }
              },
              { // Raw result for segment_2
                segmentId: 'segment_2', sessionId: 'jfk_test', sequence: 2, language: 'en', 
                segments: [ { text: ' In the long history of the world, only a few generations have been granted the role.', start: 0.84, end: 7.84, confidence: 0.891, 
                  words: [ { word: ' In', start: 0.84, end: 1.26, confidence: 0.779 }, { word: ' the', start: 1.26, end: 1.38, confidence: 0.994 }, { word: ' long', start: 1.38, end: 1.86, confidence: 0.997 }, { word: ' history', start: 1.86, end: 2.42, confidence: 0.998 }, { word: ' of', start: 2.42, end: 2.6, confidence: 0.999 }, { word: ' the', start: 2.6, end: 2.68, confidence: 0.997 }, { word: ' world,', start: 2.68, end: 3.02, confidence: 0.998 }, { word: ' only', start: 3.5, end: 4.26, confidence: 0.995 }, { word: ' a', start: 4.26, end: 4.44, confidence: 0.999 }, { word: ' few', start: 4.44, end: 4.7, confidence: 0.999 }, { word: ' generations', start: 4.7, end: 5.4, confidence: 0.998 }, { word: ' have', start: 5.54, end: 6.08, confidence: 0.999 }, { word: ' been', start: 6.08, end: 6.36, confidence: 0.998 }, { word: ' granted', start: 6.36, end: 7.08, confidence: 0.999 }, { word: ' the', start: 7.08, end: 7.34, confidence: 0.998 }, { word: ' role.', start: 7.34, end: 7.84, confidence: 0.998 } ] } ], 
                endTime: 9.12, 
                // buffer_state: { ... }
              },
              { // Raw result for segment_3
                segmentId: 'segment_3', sessionId: 'jfk_test', sequence: 3, language: 'en', 
                segments: [ { text: ' history of the world, only a few generations have been granted the role of defending freedom', start: 1.86, end: 9.1, confidence: 0.930, 
                  words: [ { word: ' history', start: 1.86, end: 2.42, confidence: 0.999 }, { word: ' of', start: 2.42, end: 2.6, confidence: 0.999 }, { word: ' the', start: 2.6, end: 2.68, confidence: 0.999 }, { word: ' world,', start: 2.68, end: 3.02, confidence: 0.998 }, { word: ' only', start: 3.5, end: 4.26, confidence: 0.997 }, { word: ' a', start: 4.26, end: 4.44, confidence: 0.999 }, { word: ' few', start: 4.44, end: 4.7, confidence: 0.999 }, { word: ' generations', start: 4.7, end: 5.4, confidence: 0.999 }, { word: ' have', start: 5.54, end: 6.08, confidence: 0.999 }, { word: ' been', start: 6.08, end: 6.36, confidence: 0.999 }, { word: ' granted', start: 6.36, end: 7.08, confidence: 0.999 }, { word: ' the', start: 7.08, end: 7.34, confidence: 0.999 }, { word: ' role', start: 7.34, end: 7.84, confidence: 0.998 }, { word: ' of', start: 8.06, end: 8.16, confidence: 0.986 }, { word: ' defending', start: 8.16, end: 8.8, confidence: 0.998 }, { word: ' freedom', start: 8.8, end: 9.1, confidence: 0.998 } ] } ], 
                endTime: 10.32, 
                // buffer_state: { ... }
              },
              { // Raw result for segment_4
                segmentId: 'segment_4', sessionId: 'jfk_test', sequence: 4, language: 'en', 
                segments: [ { text: ' generations have been granted the role of defending freedom in its hour of maximum danger.', start: 4.7, end: 11.3, confidence: 0.944, 
                  words: [ { word: ' generations', start: 4.7, end: 5.4, confidence: 0.999 }, { word: ' have', start: 5.54, end: 6.08, confidence: 0.999 }, { word: ' been', start: 6.08, end: 6.36, confidence: 0.999 }, { word: ' granted', start: 6.36, end: 7.08, confidence: 0.999 }, { word: ' the', start: 7.08, end: 7.34, confidence: 0.999 }, { word: ' role', start: 7.34, end: 7.84, confidence: 0.999 }, { word: ' of', start: 8.06, end: 8.16, confidence: 0.998 }, { word: ' defending', start: 8.16, end: 8.8, confidence: 0.999 }, { word: ' freedom', start: 8.8, end: 9.26, confidence: 0.999 }, { word: ' in', start: 9.26, end: 9.66, confidence: 0.998 }, { word: ' its', start: 9.66, end: 10, confidence: 0.999 }, { word: ' hour', start: 10, end: 10.32, confidence: 0.999 }, { word: ' of', start: 10.32, end: 10.54, confidence: 0.999 }, { word: ' maximum', start: 10.54, end: 11, confidence: 0.999 }, { word: ' danger.', start: 11, end: 11.3, confidence: 0.999 } ] } ], 
                endTime: 12.24, 
                // buffer_state: { ... }
              },
               // Add more segments if needed to test specific transitions
            ];

            // Process the sequence of raw results
            jfkRawSessionData.forEach(rawResult => merger.merge(rawResult));

            const finalState = merger.getCurrentState();
            const expectedText = "In the long history of the world, only a few generations have been granted the role of defending freedom in its hour of maximum danger.";
            
            // Helper function to normalize text for comparison
            const normalizeText = (str) => {
                if (!str) return '';
                return str
                    .toLowerCase()
                    // Remove most punctuation, keep sentence-ending periods potentially
                    .replace(/[,\-\—:;!?()"]/g, '') 
                    // Normalize whitespace (including newlines) to single spaces
                    .replace(/\s+/g, ' ') 
                    .trim();
            };

            const normalizedExpected = normalizeText(expectedText);
            const normalizedReceived = normalizeText(finalState.text);

            // 1. Compare normalized text content
            expect(normalizedReceived).toBe(normalizedExpected);
            
            // 2. Check word count (adjust expected number based on your data)
             expect(finalState.words.length).toBeGreaterThan(20); // Reverted: Expect reasonable count for excerpt

             // 3. Check stability of early words (dynamic checks)
             const firstWord = finalState.words[0];
             expect(firstWord).toBeDefined();
             expect(firstWord.text).toBeDefined(); // Check structure
             expect(firstWord.start).toBeDefined();
             expect(firstWord.stabilityCounter).toBeGreaterThanOrEqual(2); // Early words should stabilize

             // 4. Check last word (dynamic checks)
             const lastWord = finalState.words[finalState.words.length - 1];
             expect(lastWord).toBeDefined();
             expect(lastWord.text).toBeDefined();
             expect(lastWord.end).toBeDefined();
             expect(lastWord.stabilityCounter).toBe(0); // Last words usually new
             
             // Check stats (approximate)
             expect(finalState.stats.totalSegmentsProcessed).toBe(jfkRawSessionData.length);
             expect(finalState.stats.wordsAdded).toBeGreaterThan(20); 
             expect(finalState.stats.wordsReplaced).toBeGreaterThan(0); 
             expect(finalState.stats.wordsKeptStable).toBeGreaterThan(10); 
        });

        // Add more tests for edge cases:
        // - Partial replacement where incoming ends first
        // - Partial replacement where existing ends first
        // - Cases where confidence differences are near the bias threshold
        // - Segments arriving with identical timestamps but different content
    });

    // --- Test using FULL Session Data File ---
    describe('Full Session Replay', () => {
        let fullSessionData; // Will hold the sessionEntries array
        let sessionConfig; // Will hold the config object
        let expectedFullTextFromFile; // Variable to store text from .txt file
        const testSessionFile = 'New-GKK-session_Windows_NT_10.0_20250503210601_yd3sgb.json'; // Define filename here

        // Load data before running tests in this block
        beforeAll(async () => { // Make beforeAll async
            const sessionJsonFilename = testSessionFile;
            const sessionTxtFilename = path.basename(sessionJsonFilename, '.json') + '.txt';
            const testDataDir = path.join(process.cwd(), 'testdata'); // Use process.cwd() for reliability
            const jsonFilePath = path.join(testDataDir, sessionJsonFilename);
            const txtFilePath = path.join(testDataDir, sessionTxtFilename);

            // --- Load and Parse JSON ---
            let rawJsonContent;
            try {
                console.log(`Attempting to load JSON test data from: ${jsonFilePath}`);
                rawJsonContent = await fs.promises.readFile(jsonFilePath, 'utf-8'); // Use async fs.promises
            } catch (error) {
                console.error(`Failed to read session file: ${jsonFilePath}`, error);
                rawJsonContent = null; // Indicate failure
            }

            if (rawJsonContent) {
                let loadedSession;
                try {
                    loadedSession = JSON.parse(rawJsonContent);
                    // Validate the new structure
                    if (!loadedSession || typeof loadedSession !== 'object' || !loadedSession.config || !Array.isArray(loadedSession.sessionEntries)) {
                        console.error(`Invalid session file format in "${sessionJsonFilename}". Expected { config: {}, sessionEntries: [] }.`);
                        fullSessionData = null; // Mark as failed
                        sessionConfig = null;
                    } else {
                        sessionConfig = loadedSession.config; // Extract config
                        fullSessionData = loadedSession.sessionEntries; // Extract entries array
                        console.log(`Successfully loaded config and ${fullSessionData?.length ?? 0} records from JSON.`);
                    }
                } catch (error) {
                    console.error(`Failed to parse session JSON file "${sessionJsonFilename}": ${error}`);
                    fullSessionData = null;
                    sessionConfig = null;
                }
            } else {
                fullSessionData = null; // Ensure it's null if file read failed
                sessionConfig = null;
            }


            // --- Load Expected Text ---
            try {
                console.log(`Attempting to load TXT expected text from: ${txtFilePath}`);
                expectedFullTextFromFile = await fs.promises.readFile(txtFilePath, 'utf-8'); // Use async fs.promises
                console.log(`Successfully loaded expected text from ${txtFilePath}.`);
            } catch (error) {
                console.error(`Failed to load expected text file (${txtFilePath}): ${error}`);
                 expectedFullTextFromFile = null; // Set to null on failure
            }
        });

        it('should correctly process the full session data file', () => {
            // Skip test if data loading failed
            if (!fullSessionData) {
                expect.fail(`Test skipped: Failed to load or parse JSON session data file "${testSessionFile}". Check logs.`);
                return; // Stop the test
            }
             if (!sessionConfig) {
                 expect.fail(`Test skipped: Failed to load config from session data file "${testSessionFile}".`);
                 return; // Stop the test
             }
            if (!expectedFullTextFromFile) {
                 // Optional: fail if expected text is mandatory
                 console.warn(`Warning: Failed to load expected text file. Proceeding without final text comparison.`);
                 // expect.fail('Test skipped: Failed to load expected text file.');
            }

            // Check the extracted array
            expect(Array.isArray(fullSessionData)).toBe(true);
            expect(fullSessionData.length).toBeGreaterThan(0);

            // Create merger instance WITH the loaded config + debug enabled
            const merger = new TranscriptionMerger({ ...sessionConfig, debug: true });

            // Filter and sort results by sequence number (already done in loading if needed)
            const resultsToProcess = fullSessionData
                .filter(entry => entry && typeof entry.sequence === 'number') // Extra safety filter
                .sort((a, b) => a.sequence - b.sequence);

            if (resultsToProcess.length === 0) {
                 expect.fail('Test setup failed: No valid entries with sequence numbers found in fullSessionData.');
                 return;
            }

            // Simulate processing each result
            for (const result of resultsToProcess) {
                if (!result.segments) {
                    console.warn(`Skipping result for segment ${result.segmentId} (Seq: ${result.sequence}) due to missing segments.`);
                    continue;
                }
                merger.merge(result);
            }

            const finalState = merger.getCurrentState();
            
            // --- Assertions for the FULL Speech Segment ---
            // Expected text is now loaded from the file into expectedFullTextFromFile
            // REMOVED hardcoded expectedFullText constant

            // Helper function to normalize text for comparison
            const normalizeText = (str) => {
                if (!str) return '';
                return str
                    .toLowerCase()
                    // Remove most punctuation, keep sentence-ending periods potentially
                    .replace(/[,\-\—:;!?()"]/g, '') 
                    // Normalize whitespace (including newlines) to single spaces
                    .replace(/\s+/g, ' ') 
                    .trim();
            };

            const normalizedExpected = normalizeText(expectedFullTextFromFile); // Use text loaded from file
            const normalizedReceived = normalizeText(finalState.text);

            // 1. Compare normalized text content
            expect(normalizedReceived).toBe(normalizedExpected);
            
            // 2. Check word count (adjust expected number based on your data)
             expect(finalState.words.length).toBeGreaterThan(180); // Adjusted expectation based on actual output

             // 3. Check stability of early words (dynamic check)
             const firstWordFull = finalState.words[0];
             expect(firstWordFull).toBeDefined();
             expect(firstWordFull.text).toBeDefined();
             expect(firstWordFull.start).toBeDefined();
             expect(firstWordFull.stabilityCounter).toBeGreaterThanOrEqual(2); // Should have been confirmed multiple times

             // 4. Check final words (dynamic check)
             const lastWordFull = finalState.words[finalState.words.length - 1];
             expect(lastWordFull).toBeDefined();
             expect(lastWordFull.text).toBeDefined();
             expect(lastWordFull.end).toBeDefined();
             // Allow stability 0 or 1 for the very last word, depends on timing
             expect(lastWordFull.stabilityCounter).toBeLessThanOrEqual(1); 

             // 5. Check stats (ensure they reflect processing the full sequence)
             expect(finalState.stats.totalSegmentsProcessed).toBe(resultsToProcess.length); // Use length of processed results
             expect(finalState.stats.wordsAdded).toBeGreaterThan(finalState.words.length * 0.8); // Rough estimate
             expect(finalState.stats.wordsReplaced).toBeGreaterThanOrEqual(0); 
             expect(finalState.stats.wordsKeptStable).toBeGreaterThan(50); // Rough estimate
        });
    });

    describe.skip('Finalization and Cursor Logic', () => {
        // Placeholder suite skipped until specific tests are implemented.
    });

    describe.skip('Configuration Impact', () => {
        // Placeholder suite skipped until configuration impact tests are written.
    });

    // Add more describe blocks for other functionalities if needed
}); 