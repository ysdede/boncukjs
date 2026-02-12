/**
 * Shared scaling for raw log-mel display (spectrogram and bar visualizer).
 * Raw mel from the worker is already log(mel_power) - do NOT apply log() again.
 *
 * Typical range: silence ~-11 to -8, speech ~-4 to 0.
 * Fixed scaling avoids "gain hunting" where silence stretches to full brightness.
 */
export const MEL_DISPLAY_MIN_DB = -11.0;
export const MEL_DISPLAY_MAX_DB = 0.0;
export const MEL_DISPLAY_DB_RANGE = MEL_DISPLAY_MAX_DB - MEL_DISPLAY_MIN_DB;

/**
 * Map raw log-mel value to 0..1 for display (same as debug spectrogram).
 * Input is already in log space; no extra log().
 */
export function normalizeMelForDisplay(rawLogMel: number): number {
  const normalized = (rawLogMel - MEL_DISPLAY_MIN_DB) / MEL_DISPLAY_DB_RANGE;
  return Math.max(0, Math.min(1, normalized));
}
