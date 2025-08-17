import { createSignal, createEffect, onCleanup, createMemo, Show } from 'solid-js';
import './StatsWidget.css';

function StatsWidget(props) {
  const [metrics, setMetrics] = createSignal({
    currentEnergy: 0, averageEnergy: 0, peakEnergy: 0, rawPeakValue: 0,
    bufferDuration: 0, isSpeaking: false, noiseFloor: 0.01, currentSNR: 0, snrThreshold: 6
  });

  const [aggregatedStats, setAggregatedStats] = createSignal({
    valid: { count: 0, avgDuration: 0, avgEnergyIntegralEquivalent: 0, avgNormalizedEnergyPerSecond: 0 },
    discarded: { count: 0, reasons: {} }
  });

  createEffect(() => {
    if (props.audioManager) {
      const unsubscribe = props.audioManager.subscribe((event, data) => {
        if (event === 'visualizationUpdate' && data.metrics) {
          setMetrics(data.metrics);
        }
        if (event === 'aggregatedStatsUpdated' && data) {
          setAggregatedStats(data);
        }
      });
      setMetrics(props.audioManager.getMetrics() || metrics());
      if (props.audioManager.getAggregatedSegmentMetrics) {
        setAggregatedStats(props.audioManager.getAggregatedSegmentMetrics() || aggregatedStats());
      }
      onCleanup(() => unsubscribe && unsubscribe());
    }
  });

  const baseLatency = createMemo(() => props.audioContext?.baseLatency ?? 'N/A');
  const outputLatency = createMemo(() => props.audioContext?.outputLatency ?? 'N/A');
  const rawSampleRate = createMemo(() => props.audioContext?.sampleRate ?? 'N/A');
  const processorStats = createMemo(() => props.processor?.getStats ? props.processor.getStats() : { bufferSize: 'N/A', processTime: 'N/A' });
  
  const formatNumber = (num, decimals = 2) => (typeof num === 'number' && !isNaN(num)) ? num.toFixed(decimals) : 'N/A';
  const formatTime = (seconds) => (typeof seconds === 'number' && !isNaN(seconds)) ? `${seconds.toFixed(1)}s` : 'N/A s';
  const formatDB = (value, includeUnit = true) => {
    if (typeof value !== 'number' || isNaN(value)) return 'N/A';
    const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
    const numStr = db === -Infinity ? '-Inf' : db.toFixed(1);
    return includeUnit ? `${numStr} dB` : numStr;
  };
  const formatLatency = (latency) => (typeof latency === 'number' && !isNaN(latency)) ? `${(latency * 1000).toFixed(1)} ms` : 'N/A ms';
  const formatSNR = (snr, includeUnit = true) => (typeof snr === 'number' && !isNaN(snr)) ? `${snr.toFixed(1)} dB` : snr.toFixed(1);

  const displaySampleRate = createMemo(() => (typeof rawSampleRate() === 'number' ? String(rawSampleRate()) : 'N/A'));
  const displayValidSegments = createMemo(() => String(aggregatedStats().valid.count));
  const displayDiscardedSegments = createMemo(() => String(aggregatedStats().discarded.count));
  const discardedTitle = createMemo(() => Object.entries(aggregatedStats().discarded.reasons).map(([reason, count]) => `${reason}: ${count}`).join('\n') || 'No discards');
  const validTitle = createMemo(() => `Avg Duration: ${formatTime(aggregatedStats().valid.avgDuration)}\nAvg Energy Int: ${formatNumber(aggregatedStats().valid.avgEnergyIntegralEquivalent, 2)}\nAvg Norm. Energy/s: ${formatNumber(aggregatedStats().valid.avgNormalizedEnergyPerSecond, 2)}`);

  return (
    <div class="stats-widget">
      <div class="flex items-center gap-1">
        <div class={`signal-indicator ${metrics().isSpeaking ? 'active' : ''}`}></div>
        <div class="stats-row">
          <div class="stat-item">
            <span class="stat-label">Sig:</span>
            <span class={`stat-value ${metrics().isSpeaking ? 'speaking' : ''}`}>{formatDB(metrics().currentEnergy, false)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Avg:</span>
            <span class="stat-value">{formatDB(metrics().averageEnergy, false)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Pk:</span>
            <span class="stat-value">{formatDB(metrics().peakEnergy, false)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">SNR:</span>
            <span class={`stat-value ${metrics().currentSNR > metrics().snrThreshold ? 'speaking' : ''}`}>{formatSNR(metrics().currentSNR, false)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Noise:</span>
            <span class="stat-value">{formatDB(metrics().noiseFloor, false)}</span>
          </div>
          <span class="shared-db-unit">dB</span>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Val:</span>
            <span class="stat-value">{formatNumber(metrics().rawPeakValue, 3)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Buf:</span>
            <span class="stat-value">{formatTime(metrics().bufferDuration)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">Rate:</span>
            <span class="stat-value">{displaySampleRate()} Hz</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">BLat:</span>
            <span class="stat-value">{formatLatency(baseLatency())}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">OLat:</span>
            <span class="stat-value">{formatLatency(outputLatency())}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">WPM (All):</span>
            <span class="stat-value">{formatNumber(props.wpmOverall, 0)}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item">
            <span class="stat-label">WPM (1m):</span>
            <span class="stat-value">{formatNumber(props.wpmRolling, 0)}</span>
          </div>
          <Show when={props.processor}>
            <div class="divider"></div>
            <div class="stat-item">
              <span class="stat-label">Proc:</span>
              <span class="stat-value">{processorStats().processTime} ms</span>
            </div>
          </Show>
          <div class="divider"></div>
          <div class="stat-item segments-stat" title={validTitle()}>
            <span class="stat-label">Valid Seg:</span>
            <span class="stat-value">{displayValidSegments()}</span>
          </div>
          <div class="divider"></div>
          <div class="stat-item segments-stat" title={discardedTitle()}>
            <span class="stat-label">Discarded Seg:</span>
            <span class="stat-value">{displayDiscardedSegments()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatsWidget; 