import { createSignal, createEffect, onCleanup, createMemo, Show, For } from 'solid-js';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { useSettings } from '../stores/settingsStore';
import './LLMProcessor.css';

function LLMProcessor(props) {
  // Create a computed value with default to handle undefined props
  const allMatureSentences = createMemo(() => props.allMatureSentences || []);

  const [settings, { updateSetting }] = useSettings();

  const [genAI, setGenAI] = createSignal(null);
  const [model, setModel] = createSignal(null);
  const [analysisData, setAnalysisData] = createSignal({
    id: `story_${Date.now()}`,
    title: "Live Event Coverage",
    segments: [],
    allGeneratedHeadlines: []
  });
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [isNewContentAvailable, setIsNewContentAvailable] = createSignal(false);
  const [isVisible, setIsVisible] = createSignal(true);

  const sentencesForRun = createMemo(() => {
    if (allMatureSentences().length > 0) {
      const matureSentences = allMatureSentences().filter(s => s.isMature && s.detectionMethod !== 'incomplete');
      const unprocessedSentences = matureSentences.filter(s => s.endTime > props.lastProcessedSentenceTimestamp);
      const contextSentences = props.lastProcessedSentenceTimestamp > 0 ?
        matureSentences.filter(s => s.endTime <= props.lastProcessedSentenceTimestamp).slice(-props.sentenceOverlap) : [];
      const candidateSentences = [...contextSentences, ...unprocessedSentences];
      setIsNewContentAvailable(unprocessedSentences.length > 0);
      return candidateSentences.slice(0, props.contextSentenceCount);
    }
    setIsNewContentAvailable(false);
    return [];
  });
  
  const matureSentences = createMemo(() => allMatureSentences().filter(s => s.isMature && s.detectionMethod !== 'incomplete'));
  const processedSentences = createMemo(() => props.lastProcessedSentenceTimestamp > 0 ? matureSentences().filter(s => s.endTime <= props.lastProcessedSentenceTimestamp) : []);
  const usedSentenceCount = createMemo(() => processedSentences().length);
  const totalUsableSentences = createMemo(() => matureSentences().length);
  const pendingSentenceCount = createMemo(() => Math.max(0, totalUsableSentences() - usedSentenceCount()));

  const initializeGemini = async () => {
    if (!settings.geminiApiKey) {
      setError("API Key is required.");
      return;
    }
    
    // Validate API key format
    if (!settings.geminiApiKey.startsWith('AIza')) {
      setError("Invalid API Key format. Gemini API keys should start with 'AIza'.");
      return;
    }
    
    console.log("Initializing Gemini with API key:", settings.geminiApiKey ? `${settings.geminiApiKey.substring(0, 8)}...` : 'undefined');
    console.log("Using model:", props.selectedModelId);
    
    try {
      const newGenAI = new GoogleGenerativeAI(settings.geminiApiKey.trim());
      setGenAI(newGenAI);
      const newModel = newGenAI.getGenerativeModel({
        model: props.selectedModelId,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
        ],
      });
      setModel(newModel);
      setError(null);
      console.log("Gemini Initialized for LLMProcessor with model:", props.selectedModelId);
    } catch (e) {
      let errorMessage = "Failed to initialize Gemini: " + e.message;
      if (e.message.includes('API key not valid')) {
        errorMessage = "Invalid API Key. Please check your Gemini API key in the AI Services settings. Make sure it's a valid key from Google AI Studio.";
      }
      setError(errorMessage);
      console.error(e);
    }
  };

  createEffect(() => {
    if (settings.geminiApiKey && props.selectedModelId) {
      initializeGemini();
    }
  });

  createEffect(() => {
    if (settings.autoGenerateEnabled && !isLoading() && model() && isNewContentAvailable()) {
      if (pendingSentenceCount() >= props.contextSentenceCount) {
        console.log(`Auto-generating: ${pendingSentenceCount()} pending mature sentences reached threshold of ${props.contextSentenceCount}`);
        processNewSentences();
      }
    }
  });
  
  const processNewSentences = async () => {
    if (!model()) {
      setError("Initialize Gemini first by providing an API key in the settings.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const latestSentences = sentencesForRun();
    
    if (latestSentences.length === 0) {
        setError("No new mature sentences to process.");
        setIsLoading(false);
        return;
    }

    const structuredSentences = latestSentences.map((sentence, index) => {
        if (typeof sentence === 'string') return { id: `sentence_${index}`, startTime: 0, endTime: 0, duration: 0, text: sentence };
        const duration = (sentence.endTime || 0) - (sentence.startTime || 0);
        return { id: sentence.id || `sentence_${index}`, startTime: sentence.startTime || 0, endTime: sentence.endTime || 0, duration: duration, text: sentence.text || '' };
    });

    let finalPrompt = props.editablePrompt;
    if (props.includeReasoning) {
        const schemaMarker = '"properties": {';
        const reasoningField = `
        "reasoning": {
          "type": "string",
          "description": "A brief, step-by-step explanation of your thought process for generating the output. Explain how you analyzed the transcript and previous headlines to arrive at your conclusion."
        },`;
        finalPrompt = finalPrompt.replace(schemaMarker, schemaMarker + reasoningField);
    }
    
    let fullPrompt = finalPrompt;

    if (analysisData().allGeneratedHeadlines.length > 0) {
      fullPrompt += "\n\nPreviously generated headlines for this ongoing story (avoid repeating these topics):";
      analysisData().allGeneratedHeadlines.forEach(h => fullPrompt += `\n- ${h}`);
    }

    fullPrompt += "\n\nLatest transcript sentences for the current segment (with timing data):";
    fullPrompt += "\nID | Start Time | End Time | Duration | Text";
    fullPrompt += "\n" + "-".repeat(80);
    
    structuredSentences.forEach(s => {
        const startTime = s.startTime.toFixed(2);
        const endTime = s.endTime.toFixed(2);
        const duration = s.duration.toFixed(2);
        fullPrompt += `\n${s.id} | ${startTime}s | ${endTime}s | ${duration}s | ${s.text}`;
    });

    if (structuredSentences.length > 1) {
        const timeGaps = [];
        for (let i = 1; i < structuredSentences.length; i++) {
            const gap = structuredSentences[i].startTime - structuredSentences[i-1].endTime;
            if (gap > 0.1) timeGaps.push({ between: `${structuredSentences[i-1].id} and ${structuredSentences[i].id}`, gap: gap.toFixed(2) });
        }
        if (timeGaps.length > 0) {
            fullPrompt += "\n\nNotable time gaps between sentences:";
            timeGaps.forEach(gap => { fullPrompt += `\n- ${gap.gap}s gap between ${gap.between}`; });
        }
        const totalSpan = structuredSentences[structuredSentences.length - 1].endTime - structuredSentences[0].startTime;
        fullPrompt += `\n\nTotal time span of this segment: ${totalSpan.toFixed(2)} seconds`;
    }
    
    fullPrompt += "\n\nGenerate your JSON response now:";

    try {
      const result = await model().generateContent({
        contents: [{ role: "user", parts: [{text: fullPrompt}] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      });
      const response = result.response;
      const responseText = response.text();
      if (!responseText) throw new Error("Received an empty response from Gemini.");
      let generatedData;
      try {
        generatedData = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Failed to parse JSON response:", responseText, parseError);
        throw new Error("Invalid JSON response from Gemini. " + parseError.message);
      }
      const isMultiIncidentFormat = generatedData.incidents && Array.isArray(generatedData.incidents);
      const isNewsReportFormat = generatedData.eventTitle && generatedData.eventSummary;
      const isTimelineFormat = generatedData.newHeadlines && generatedData.segmentSummary;
      if (!isMultiIncidentFormat && !isNewsReportFormat && !isTimelineFormat) {
        console.error("Unexpected JSON structure:", generatedData);
        throw new Error("JSON response from Gemini is missing required fields.");
      }

      const newSegment = {
        id: `segment_${Date.now()}`,
        timestamp: new Date().toISOString(),
        transcriptionSentences: structuredSentences.map(s => s.text),
        structuredSentences: structuredSentences,
        sentenceObjects: latestSentences,
        generatedOutput: generatedData,
        usedPrompt: fullPrompt,
        timeSpan: structuredSentences.length > 0 ? {
          startTime: structuredSentences[0].startTime,
          endTime: structuredSentences[structuredSentences.length - 1].endTime,
          duration: structuredSentences[structuredSentences.length - 1].endTime - structuredSentences[0].startTime
        } : null
      };

      let headlinesForHistory = [];
      if (isTimelineFormat) headlinesForHistory = generatedData.newHeadlines;
      else if (isNewsReportFormat) headlinesForHistory = [generatedData.eventTitle];
      else if (isMultiIncidentFormat) headlinesForHistory = generatedData.incidents.map(inc => inc.eventTitle);
      
      const processedSentencesInThisRun = sentencesForRun().filter(s => s.endTime > props.lastProcessedSentenceTimestamp);
      if (processedSentencesInThisRun.length > 0) {
          const lastProcessedSentence = processedSentencesInThisRun[processedSentencesInThisRun.length - 1];
          const usableSentences = allMatureSentences().filter(s => s.isMature && s.detectionMethod !== 'incomplete');
          const legacyIndex = usableSentences.findIndex(s => s.id === lastProcessedSentence.id);
          if (props.onGenerationcomplete) props.onGenerationcomplete({ newIndex: legacyIndex, lastSentenceId: lastProcessedSentence.id, lastSentenceTimestamp: lastProcessedSentence.endTime });
      }
      setAnalysisData(prev => ({ ...prev, segments: [...prev.segments, newSegment], allGeneratedHeadlines: [...prev.allGeneratedHeadlines, ...headlinesForHistory] }));
    } catch (e) {
      setError("Error generating content: " + e.message);
      console.error("Full error object:", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div class="widget-container">
      <div class="widget-header">
        <div class="widget-title-section">
          <div class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
          <h2 class="widget-title">AI Content Analysis</h2>
          <Show when={analysisData().segments.length > 0}>
            <div class="analysis-count-badge">
              {analysisData().segments.length} {analysisData().segments.length === 1 ? 'analysis' : 'analyses'}
            </div>
          </Show>
        </div>
        <div class="widget-actions">
          {/* Compact Control Section */}
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 px-3 py-2 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-600/50 shadow-sm">
              {/* Auto toggle switch */}
              <label class="relative inline-flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={settings.autoGenerateEnabled} 
                  onChange={(e) => updateSetting('autoGenerateEnabled', e.target.checked)} 
                  class="sr-only peer" 
                />
                <div class="relative w-9 h-5 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-blue-500 peer-checked:to-purple-500 group-hover:shadow-md transition-all duration-200"></div>
                <span class="ml-2 text-xs font-medium text-gray-700 dark:text-gray-300">Auto</span>
              </label>
              
              {/* Context sentences threshold */}
              <div class="flex items-center gap-1">
                <div
                  class="w-12 text-center text-xs font-mono bg-transparent border rounded px-1 py-0.5 border-gray-300 dark:border-gray-500"
                  title="Trigger threshold (controlled by 'Context Sentences' in AI Settings)"
                >
                  {settings.contextSentenceCount}
                </div>
              </div>
              
              <div class="w-px h-4 bg-gray-200 dark:bg-gray-600"></div>

              {/* Stats display */}
              <div class="text-xs text-gray-600 dark:text-gray-400 font-mono flex items-center gap-2">
                <div>
                  <span class="font-semibold text-gray-700 dark:text-gray-300">{usedSentenceCount()}</span>
                  <span class="text-gray-500">Used</span>
                </div>
                <div class="text-green-600 dark:text-green-400">
                  <span class="font-semibold">{pendingSentenceCount()}</span>
                  <span>Pending</span>
                </div>
                <div>
                  <span class="font-semibold text-gray-700 dark:text-gray-300">{totalUsableSentences()}</span>
                  <span class="text-gray-500">Total</span>
                </div>
              </div>
            </div>

            {/* Generate button */}
            <button 
              onClick={processNewSentences} 
              disabled={isLoading() || !model() || (!isNewContentAvailable() && !settings.autoGenerateEnabled)} 
              class="btn btn-primary btn-xs flex items-center gap-1" 
              title="Generate analysis"
            >
              <Show when={isLoading()} fallback={
                <>
                  <span class="material-icons text-sm">auto_awesome</span>
                  Generate
                </>
              }>
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Generating...
              </Show>
            </button>
            
            {/* Show/Hide button */}
            <button 
              onClick={() => setIsVisible(!isVisible())}
              class="btn btn-icon-xs btn-ghost" 
              title={isVisible() ? "Hide content" : "Show content"}
            >
              <span class="material-icons">
                {isVisible() ? 'visibility' : 'visibility_off'}
              </span>
            </button>
          </div>
        </div>
      </div>
      
      <Show when={isVisible()}>
        <Show when={isNewContentAvailable() && !settings.autoGenerateEnabled}>
          <div class="mt-2 flex justify-end">
            <div class="px-3 py-1 bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900 dark:to-emerald-900 text-green-800 dark:text-green-200 text-xs font-medium rounded-full shadow-sm animate-pulse border border-green-200 dark:border-green-700">
              ✨ Ready to generate
            </div>
          </div>
        </Show>
        
        <div class="widget-content">
                  <Show when={error()}>
          <div class="status-message error">
            <p class="text-sm">Error: {error()}</p>
          </div>
        </Show>
        
        <Show when={!settings.geminiApiKey}>
          <div class="status-message warning">
            <p class="text-sm">Please provide a Gemini API Key in the AI Services section of the settings panel to enable this feature.</p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              You can get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 underline">Google AI Studio</a>
            </p>
          </div>
        </Show>
          
                  {/* Debug Info for Development */}
        <Show when={!import.meta.env.PROD && settings.geminiApiKey}>
          <div class="status-message info">
            <p class="text-xs">
              Debug: API Key: {settings.geminiApiKey ? `${settings.geminiApiKey.substring(0, 8)}...` : 'Not set'} | 
              Model: {props.selectedModelId} | 
              Initialized: {model() ? 'Yes' : 'No'}
            </p>
          </div>
        </Show>

        <Show when={analysisData().segments.length > 0}>
          <div class="headlines-container overflow-y-auto space-y-4 pr-2">
            <For each={[...analysisData().segments].reverse()}>
              {(segment) => (
                  <div class="segment-card">
                    <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      <div class="flex items-center gap-2 mb-1">
                        <span>Segment from {new Date(segment.timestamp).toLocaleTimeString()}</span>
                        <span class="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
                          {segment.transcriptionSentences.length} sentences
                        </span>
                      </div>
                      <Show when={segment.timeSpan}>
                        <div class="text-xs opacity-75 font-mono">
                          ⏱️ Time span: {segment.timeSpan.startTime.toFixed(2)}s - {segment.timeSpan.endTime.toFixed(2)}s (duration: {segment.timeSpan.duration.toFixed(2)}s)
                        </div>
                      </Show>
                    </div>
                    
                    <Show when={segment.generatedOutput.incidents}>
                      <For each={segment.generatedOutput.incidents}>
                        {(incident, i) => (
                          <div class={`mb-3 ${i() > 0 ? 'pt-3 border-t border-gray-200 dark:border-gray-600' : ''}`}>
                            <p class="font-semibold text-md mb-1">{incident.eventTitle}</p>
                            <p class="text-sm">{incident.eventSummary}</p>
                          </div>
                        )}
                      </For>
                    </Show>
                    <Show when={segment.generatedOutput.eventTitle}>
                      <p class="font-semibold text-md mb-1">{segment.generatedOutput.eventTitle}</p>
                      <p class="mb-2 text-sm">{segment.generatedOutput.eventSummary}</p>
                    </Show>
                    <Show when={segment.generatedOutput.newHeadlines}>
                      <p class="font-semibold">Summary:</p>
                      <p class="mb-2 text-sm">{segment.generatedOutput.segmentSummary}</p>
                      <p class="font-semibold">Headlines:</p>
                      <ul class="list-disc list-inside text-sm mb-2">
                        <For each={segment.generatedOutput.newHeadlines}>
                          {(headline) => <li>{headline}</li>}
                        </For>
                      </ul>
                    </Show>

                    <Show when={segment.generatedOutput.reasoning}>
                      <details class="text-xs mt-2">
                        <summary class="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                          Show AI Reasoning
                        </summary>
                        <div class="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
                          <p>{segment.generatedOutput.reasoning}</p>
                        </div>
                      </details>
                    </Show>

                    <details class="text-xs">
                      <summary class="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                        Show input sentences with timing ({segment.transcriptionSentences.length})
                      </summary>
                      <div class="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-gray-700 dark:text-gray-300">
                        <Show when={segment.structuredSentences} fallback={
                          <For each={segment.transcriptionSentences}>
                            {(sentence, i) => <div class="mb-1">{i() + 1}. {sentence}</div>}
                          </For>
                        }>
                          <div class="font-mono text-xs mb-2 text-gray-500 dark:text-gray-400">
                            ID | Start | End | Duration | Text
                          </div>
                          <For each={segment.structuredSentences}>
                            {(sentence) => (
                              <div class="mb-1 font-mono text-xs leading-relaxed">
                                <span class="text-gray-500 dark:text-gray-400">{sentence.id}</span> | 
                                <span class="text-blue-600 dark:text-blue-400">{sentence.startTime.toFixed(2)}s</span> | 
                                <span class="text-blue-600 dark:text-blue-400">{sentence.endTime.toFixed(2)}s</span> | 
                                <span class="text-green-600 dark:text-green-400">{sentence.duration.toFixed(2)}s</span> | 
                                <span class="text-gray-900 dark:text-gray-100">{sentence.text}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </details>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default LLMProcessor; 