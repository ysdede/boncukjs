import { createSignal, createEffect, onCleanup, createMemo, Show } from 'solid-js';
import './CompactStatsSnr.css';

function CompactStatsSnr(props) {
  const [metrics, setMetrics] = createSignal({
    currentEnergy: 0, averageEnergy: 0, peakEnergy: 0, rawPeakValue: 0,
    bufferDuration: 0, isSpeaking: false, noiseFloor: 0.01, currentSNR: 0, snrThreshold: 6
  });

  const [aggregatedStats, setAggregatedStats] = createSignal({
    valid: { count: 0, avgDuration: 0 },
    discarded: { count: 0 }
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
      // Get initial data
      const initialMetrics = props.audioManager.getMetrics();
      if (initialMetrics) setMetrics(initialMetrics);
      if (props.audioManager.getAggregatedSegmentMetrics) {
        setAggregatedStats(props.audioManager.getAggregatedSegmentMetrics() || aggregatedStats());
      }
      onCleanup(() => unsubscribe && unsubscribe());
    }
  });

  const baseLatency = createMemo(() => props.audioContext?.baseLatency ?? 'N/A');
  const outputLatency = createMemo(() => props.audioContext?.outputLatency ?? 'N/A');
  const rawSampleRate = createMemo(() => props.audioContext?.sampleRate ?? 'N/A');
  const processorStats = createMemo(() => props.processor?.getStats ? props.processor.getStats() : { processTime: 'N/A' });

  const formatNumber = (num, decimals = 2) => (typeof num === 'number' && !isNaN(num)) ? num.toFixed(decimals) : 'N/A';
  const formatTime = (seconds) => (typeof seconds === 'number' && !isNaN(seconds)) ? `${seconds.toFixed(1)}s` : 'N/A';
  const formatDB = (value) => {
    if (typeof value !== 'number' || isNaN(value)) return 'N/A';
    const db = value > 0 ? 20 * Math.log10(value) : -Infinity;
    return db === -Infinity ? '-∞' : db.toFixed(1);
  };
  const formatLatency = (latency) => (typeof latency === 'number' && !isNaN(latency)) ? `${(latency * 1000).toFixed(1)}ms` : 'N/A';

  const snrPercentage = createMemo(() => Math.min(100, Math.max(0, (metrics().currentSNR / 20) * 100)));
  const thresholdPercentage = createMemo(() => Math.min(100, Math.max(0, (props.snrThreshold / 20) * 100)));
  const minThresholdPercentage = createMemo(() => Math.min(100, Math.max(0, (props.minSnrThreshold / 20) * 100)));

  return (
    <div class={`compact-stats-snr ${props.isHeaderMode ? 'header-mode' : ''}`}>
      <Show
        when={props.isHeaderMode}
        fallback={
          <>
            <div class="main-metrics">
              <div class={`speaking-indicator ${metrics().isSpeaking ? 'active' : ''}`}></div>
              <div class="snr-section">
                <div class="snr-label">SNR</div>
                <div class="snr-bar-container">
                  <div class="snr-bar-bg">
                    <div class={`snr-bar-fill ${metrics().currentSNR > metrics().snrThreshold ? 'active' : ''}`} style={{ width: `${snrPercentage()}%` }}></div>
                    <div class="snr-threshold" style={{ left: `${thresholdPercentage()}%` }}></div>
                    <div class="snr-threshold secondary" style={{ left: `${minThresholdPercentage()}%` }}></div>
                  </div>
                </div>
                <div class={`snr-value ${metrics().currentSNR > metrics().snrThreshold ? 'active' : ''}`}>{formatNumber(metrics().currentSNR, 1)}</div>
              </div>
              <div class="key-metrics">
                <div class="metric-item"><span class="metric-label">Sig</span><span class={`metric-value ${metrics().isSpeaking ? 'active' : ''}`}>{formatDB(metrics().currentEnergy)}</span></div>
                <div class="metric-item"><span class="metric-label">Noise</span><span class="metric-value">{formatDB(metrics().noiseFloor)}</span></div>
                <div class="metric-item"><span class="metric-label">Peak</span><span class="metric-value">{formatDB(metrics().peakEnergy)}</span></div>
              </div>
              <div class="perf-metrics">
                <div class="metric-item"><span class="metric-label">WPM</span><span class="metric-value">{formatNumber(props.wpmRolling, 0)}</span></div>
                <div class="metric-item"><span class="metric-label">Segs</span><span class="metric-value">{aggregatedStats().valid.count}/<span class="discarded">{aggregatedStats().discarded.count}</span></span></div>
                <div class="metric-item"><span class="metric-label">Buf</span><span class="metric-value">{formatTime(metrics().bufferDuration)}</span></div>
              </div>
            </div>
            <div class="secondary-metrics">
              <div class="metric-group"><span class="group-label">Audio:</span><span class="group-value">{typeof rawSampleRate() === 'number' ? rawSampleRate() : 'N/A'}Hz</span><span class="group-value">{formatLatency(baseLatency())}</span><span class="group-value">{formatLatency(outputLatency())}</span></div>
              <div class="metric-group"><span class="group-label">Proc:</span><span class="group-value">{processorStats().processTime}ms</span><span class="group-value">Val: {formatNumber(metrics().rawPeakValue, 3)}</span></div>
              <div class="metric-group"><span class="group-label">WPM Total:</span><span class="group-value">{formatNumber(props.wpmOverall, 0)}</span><span class="group-value">Avg: {formatTime(aggregatedStats().valid.avgDuration)}</span></div>
            </div>
          </>
        }
      >
        <div class="header-metrics">
          <div class="header-row-1">
            <div class="snr-group">
              <div class={`speaking-indicator ${metrics().isSpeaking ? 'active' : ''}`}></div>
              <div class="snr-display">
                <div class="snr-bar-container-header">
                  <div class="snr-bar-bg-header">
                    <div class={`snr-bar-fill ${metrics().currentSNR > metrics().snrThreshold ? 'active' : ''}`} style={{ width: `${snrPercentage()}%` }}></div>
                    <div class="snr-threshold" style={{ left: `${thresholdPercentage()}%` }}></div>
                    <div class="snr-threshold secondary" style={{ left: `${minThresholdPercentage()}%` }}></div>
                  </div>
                </div>
                <div class={`snr-value-fixed ${metrics().currentSNR > metrics().snrThreshold ? 'active' : ''}`}>{formatNumber(metrics().currentSNR, 1)}</div>
              </div>
            </div>
            <div class="audio-metrics-grid">
              <div class={`metric-cell ${metrics().isSpeaking ? 'active' : ''}`}><span class="metric-label-fixed">Sig</span><span class="metric-value-fixed">{formatDB(metrics().currentEnergy)}</span></div>
              <div class="metric-cell"><span class="metric-label-fixed">Avg</span><span class="metric-value-fixed">{formatDB(metrics().averageEnergy)}</span></div>
              <div class="metric-cell"><span class="metric-label-fixed">Peak</span><span class="metric-value-fixed">{formatDB(metrics().peakEnergy)}</span></div>
              <div class="metric-cell"><span class="metric-label-fixed">Noise</span><span class="metric-value-fixed">{formatDB(metrics().noiseFloor)}</span></div>
            </div>
            <div class="perf-metrics-grid">
              <div class="metric-cell"><span class="metric-label-fixed">WPM</span><span class="metric-value-fixed">{formatNumber(props.wpmRolling, 0)}</span></div>
              <div class="metric-cell"><span class="metric-label-fixed">Total</span><span class="metric-value-fixed">{formatNumber(props.wpmOverall, 0)}</span></div>
              <div class="metric-cell"><span class="metric-label-fixed">Segs</span><span class="metric-value-fixed">{aggregatedStats().valid.count}/<span class="discarded">{aggregatedStats().discarded.count}</span></span></div>
            </div>
          </div>
          <div class="header-row-2">
            <div class="system-info-grid">
              <div class="mini-cell"><span class="mini-label-fixed">Audio</span><span class="mini-value-fixed">{typeof rawSampleRate() === 'number' ? rawSampleRate() : 'N/A'}Hz</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">BLat</span><span class="mini-value-fixed">{formatLatency(baseLatency())}</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">OLat</span><span class="mini-value-fixed">{formatLatency(outputLatency())}</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">Proc</span><span class="mini-value-fixed">{processorStats().processTime}ms</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">Val</span><span class="mini-value-fixed">{formatNumber(metrics().rawPeakValue, 3)}</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">Buf</span><span class="mini-value-fixed">{formatTime(metrics().bufferDuration)}</span></div>
              <div class="mini-cell"><span class="mini-label-fixed">Avg</span><span class="mini-value-fixed">{formatTime(aggregatedStats().valid.avgDuration)}</span></div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default CompactStatsSnr; 