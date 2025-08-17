import { createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { audioManager } from '../AudioManager';
import './BufferVisualizer.css';

function BufferVisualizer(props) {
  let canvasRef;
  let ctx;
  let animationFrameId;

  const [waveformMinMaxData, setWaveformMinMaxData] = createSignal([]);
  const [currentMetrics, setCurrentMetrics] = createSignal({ /* default metrics */ });
  const [currentCanvasWidth, setCurrentCanvasWidth] = createSignal(0);
  
  const bufferDuration = 30; // 30 seconds visualization window

  const fetchVisualizationData = () => {
    if (audioManager && currentCanvasWidth() > 0 && props.visible) {
      setWaveformMinMaxData(audioManager.getVisualizationData(currentCanvasWidth()));
    }
  };

  createEffect(() => {
    if (props.visible) {
      fetchVisualizationData();
    }
  });

  onMount(() => {
    ctx = canvasRef.getContext('2d');
    
    const handleAudioUpdate = (event, data) => {
      if (event === 'visualizationUpdate' && props.visible) {
        fetchVisualizationData();
        if (data.metrics) setCurrentMetrics(data.metrics);
      } else if (event === 'visualizationUpdate' && data.metrics) {
        if (data.metrics) setCurrentMetrics(data.metrics);
      }
    };

    const unsubscribe = audioManager?.subscribe(handleAudioUpdate);
    if (audioManager) setCurrentMetrics(audioManager.getMetrics() || currentMetrics());
    
    const drawLoop = () => {
      if (!ctx || !canvasRef || canvasRef.width === 0) {
          animationFrameId = requestAnimationFrame(drawLoop);
          return;
      }
      if (props.visible) {
          draw();
          animationFrameId = requestAnimationFrame(drawLoop);
      } else {
          animationFrameId = setTimeout(drawLoop, 100);
      }
    };
    animationFrameId = requestAnimationFrame(drawLoop);

    const handleResize = () => {
      if (canvasRef?.parentElement) {
        const newWidth = canvasRef.parentElement.clientWidth;
        if (newWidth !== currentCanvasWidth() && newWidth > 0) {
          setCurrentCanvasWidth(newWidth);
          canvasRef.width = newWidth;
          canvasRef.height = 80;
          fetchVisualizationData();
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (canvasRef?.parentElement) resizeObserver.observe(canvasRef.parentElement);
    handleResize();

    onCleanup(() => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(animationFrameId);
      unsubscribe?.();
      resizeObserver.disconnect();
    });
  });

  const draw = () => {
    if (!ctx || !canvasRef || !waveformMinMaxData() || waveformMinMaxData().length < 2) return;

    const width = canvasRef.width;
    const height = canvasRef.height;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    const computedStyle = getComputedStyle(document.documentElement);
    const bgPanel = computedStyle.getPropertyValue('--bg-panel').trim();
    const textMuted = computedStyle.getPropertyValue('--text-muted').trim();
    const textSecondary = computedStyle.getPropertyValue('--text-secondary').trim();
    const dangerColor = computedStyle.getPropertyValue('--color-danger').trim();
    const successColor = computedStyle.getPropertyValue('--color-success').trim() || '#00C853';
    const infoColor = computedStyle.getPropertyValue('--color-info').trim() || '#2196F3';

    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, 0, width, height);

    const currentTime = audioManager.getCurrentTime();
    const windowStart = currentTime - bufferDuration;

    drawTimeMarkers(width, height, windowStart, textSecondary, textMuted);

    if (props.segments && props.segments.length > 0) {
        props.segments.forEach(segment => {
            const relativeStart = segment.startTime - windowStart;
            const relativeEnd = segment.endTime - windowStart;
            if (relativeEnd > 0 && relativeStart < bufferDuration) {
                const startX = Math.max(0, (relativeStart / bufferDuration)) * width;
                const endX = Math.min(1, (relativeEnd / bufferDuration)) * width;

                if (segment.isPurged) { ctx.fillStyle = 'rgba(128, 128, 128, 0.1)'; }
                else if (segment.isMerged) { ctx.fillStyle = 'rgba(128, 0, 128, 0.2)'; }
                else if (segment.isPartOfMerged) { ctx.fillStyle = 'rgba(255, 165, 0, 0.1)'; }
                else if (segment.isProcessed) { ctx.fillStyle = 'rgba(0, 200, 0, 0.1)'; }
                else { ctx.fillStyle = 'rgba(255, 200, 0, 0.1)'; }

                if (!segment.isPurged && segment.vadStatus && !segment.isMerged && !segment.isPartOfMerged) {
                    if (segment.vadStatus === 'non-speech') { ctx.fillStyle = 'rgba(128, 128, 128, 0.2)'; }
                    else if (segment.vadStatus === 'speech') { ctx.fillStyle = 'rgba(50, 205, 50, 0.1)'; }
                    else if (segment.vadStatus === 'pending') { ctx.fillStyle = segment.isProcessed ? 'rgba(0, 200, 0, 0.1)' : 'rgba(255, 200, 0, 0.1)'; }
                }

                ctx.fillRect(startX, 0, endX - startX, height);
                const strokeStyle = segment.isPurged ? 'rgba(128, 128, 128, 0.3)' :
                                  segment.isMerged ? 'rgba(128, 0, 128, 0.5)' :
                                  segment.vadStatus === 'non-speech' && !segment.isMerged && !segment.isPartOfMerged ? 'rgba(128,128,128,0.5)' :
                                  segment.vadStatus === 'speech' && !segment.isMerged && !segment.isPartOfMerged ? 'rgba(50, 205, 50, 0.3)' :
                                  'rgba(255, 200, 0, 0.5)';
                ctx.strokeStyle = strokeStyle;
                ctx.beginPath();
                ctx.moveTo(startX, 0); ctx.lineTo(startX, height);
                ctx.moveTo(endX, 0); ctx.lineTo(endX, height);
                ctx.stroke();
            }
        });
    }

    ctx.beginPath();
    ctx.strokeStyle = textSecondary;
    ctx.lineWidth = 1;
    const numPoints = waveformMinMaxData().length / 2;
    const step = width / numPoints;
    for (let i = 0; i < numPoints; i++) {
        const x = i * step;
        const minVal = waveformMinMaxData()[i * 2];
        const maxVal = waveformMinMaxData()[i * 2 + 1];
        const yMin = centerY - (minVal * centerY);
        const yMax = centerY - (maxVal * centerY);
        ctx.moveTo(x, yMin);
        ctx.lineTo(x, yMax);
    }
    ctx.stroke();

    if (props.showAdaptiveThreshold && currentMetrics()) {
        const noiseFloor = currentMetrics().noiseFloor || 0.01;
        const snrThresholdDb = props.snrThreshold;
        const snrRatio = Math.pow(10, snrThresholdDb / 10);
        const adaptiveThreshold = noiseFloor * snrRatio;
        ctx.beginPath();
        ctx.strokeStyle = infoColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        const adaptiveYPos = centerY - (adaptiveThreshold * centerY);
        ctx.moveTo(0, adaptiveYPos); ctx.lineTo(width, adaptiveYPos);
        const adaptiveYNeg = centerY + (adaptiveThreshold * centerY);
        ctx.moveTo(0, adaptiveYNeg); ctx.lineTo(width, adaptiveYNeg);
        ctx.stroke();
        ctx.fillStyle = infoColor;
        ctx.font = '10px Arial';
        ctx.fillText(`SNR Threshold (${snrThresholdDb.toFixed(1)}dB)`, 5, adaptiveYPos - 5);
        
        if (props.minSnrThreshold < snrThresholdDb) {
            const minSnrRatio = Math.pow(10, props.minSnrThreshold / 10);
            const minAdaptiveThreshold = noiseFloor * minSnrRatio;
            ctx.beginPath();
            ctx.strokeStyle = successColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            const minAdaptiveYPos = centerY - (minAdaptiveThreshold * centerY);
            ctx.moveTo(0, minAdaptiveYPos); ctx.lineTo(width, minAdaptiveYPos);
            const minAdaptiveYNeg = centerY + (minAdaptiveThreshold * centerY);
            ctx.moveTo(0, minAdaptiveYNeg); ctx.lineTo(width, minAdaptiveYNeg);
            ctx.stroke();
            ctx.fillStyle = successColor;
            ctx.font = '10px Arial';
            ctx.fillText(`Min SNR (${props.minSnrThreshold.toFixed(1)}dB)`, 5, minAdaptiveYPos - 5);
        }
    }
    
    ctx.setLineDash([]);
    
    if (currentMetrics() && currentMetrics().noiseFloor) {
        const noiseFloorLevel = currentMetrics().noiseFloor;
        const noiseFloorY = centerY - (noiseFloorLevel * centerY);
        ctx.beginPath();
        ctx.strokeStyle = successColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 1]);
        ctx.moveTo(0, noiseFloorY); ctx.lineTo(width, noiseFloorY);
        const noiseFloorYNeg = centerY + (noiseFloorLevel * centerY);
        ctx.moveTo(0, noiseFloorYNeg); ctx.lineTo(width, noiseFloorYNeg);
        ctx.stroke();
        ctx.fillStyle = successColor;
        ctx.font = '10px Arial';
        ctx.fillText('Noise Floor', 5, noiseFloorY - 5);
        ctx.setLineDash([]);
    }
    
    if (currentMetrics() && currentMetrics().currentSNR > 0) {
        const snrHeight = Math.min(60, currentMetrics().currentSNR * 2);
        const meterX = width - 30;
        const meterWidth = 20;
        const meterY = height - 10 - snrHeight;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(meterX, height - 70, meterWidth, 60);
        ctx.fillStyle = currentMetrics().currentSNR > currentMetrics().snrThreshold ? successColor : textMuted;
        ctx.fillRect(meterX, meterY, meterWidth, snrHeight);
        const thresholdLineY = height - 10 - (currentMetrics().snrThreshold * 2);
        ctx.beginPath();
        ctx.strokeStyle = dangerColor;
        ctx.moveTo(meterX, thresholdLineY); ctx.lineTo(meterX + meterWidth, thresholdLineY);
        ctx.stroke();
        ctx.fillStyle = textSecondary;
        ctx.font = '10px Arial';
        ctx.fillText(`SNR: ${currentMetrics().currentSNR.toFixed(1)}dB`, meterX - 5, height - 75);
    }
    
    if (currentMetrics() && currentMetrics().isSpeaking) {
        const indicatorX = width - 15;
        const indicatorY = 15;
        const radius = 5;
        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, radius, 0, Math.PI * 2);
        ctx.fillStyle = successColor;
        ctx.fill();
        const time = performance.now() / 1000;
        const rippleRadius = radius + Math.sin(time * 5) * 2;
        ctx.beginPath();
        ctx.arc(indicatorX, indicatorY, rippleRadius, 0, Math.PI * 2);
        ctx.strokeStyle = successColor;
        ctx.stroke();
    }
  };

  const drawTimeMarkers = (width, height, windowStart, textColor, tickColor) => {
    ctx.fillStyle = textColor;
    ctx.font = '10px Arial';
    const markerInterval = 5;
    for (let i = 0; i <= bufferDuration; i += markerInterval) {
        const x = (i / bufferDuration) * width;
        const time = Math.floor(windowStart + i);
        if (time >= 0) {
            ctx.beginPath();
            ctx.strokeStyle = tickColor;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 15);
            ctx.stroke();
            ctx.fillText(`${time}s`, x + 2, 12);
        }
    }
  };

  return (
    <div class="w-full h-20 relative">
      <canvas ref={canvasRef} class="w-full h-full block"></canvas>
    </div>
  );
}

export default BufferVisualizer; 