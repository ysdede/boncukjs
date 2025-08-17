// Time Constants
export const BASE_TIME_UNIT = 100; // milliseconds
export const PROCESS_INTERVAL = 2 * BASE_TIME_UNIT;  // 200ms
export const BUFFER_WINDOW = 15;   // 15 seconds
export const MAX_AUDIO_LENGTH = 30; // Maximum audio length in seconds

// Language Constants
export const LANGUAGES = {
  "Turkish": "tr",
  "English": "en",
  "Spanish": "es",
  "French": "fr",
  "German": "de",
  "Italian": "it",
  "Russian": "ru",
  "Chinese": "zh",
  "Japanese": "ja",
  "Arabic": "ar"
};

export const DEFAULT_LANGUAGE = LANGUAGES.English;

// Available Models for Transcription
export const AVAILABLE_MODELS = {
  'parakeet-tdt-0.6b': { id: 'nvidia/parakeet-tdt-0.6b', name: 'Nvidia Parakeet TDT 0.6B' }
};

export const DEFAULT_MODEL = AVAILABLE_MODELS['parakeet-tdt-0.6b'].id;