import { onMount, createEffect } from 'solid-js';
import './SegmentWaveform.css';

function SegmentWaveform(props) {
  let canvas;

  const width = () => props.width || 200;
  const height = () => props.height || 10;
  const color = () => props.color || 'var(--waveform-color)';
  const audioData = () => props.audioData;

  const drawWaveform = () => {
    if (!audioData()?.length) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width(), height());

    const step = Math.ceil(audioData().length / width());
    const amp = height() / 2;

    ctx.fillStyle = color();
    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (let i = 0; i < width(); i++) {
      let min = 1.0;
      let max = -1.0;

      for (let j = 0; j < step; j++) {
        const index = (i * step) + j;
        if (index >= audioData().length) break;
        const datum = audioData()[index];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      const yMin = (1 + min) * amp;
      const yMax = (1 + max) * amp;
      const lineHeight = Math.max(1, yMax - yMin);
      ctx.fillRect(i, yMin, 1, lineHeight);
    }
  };

  onMount(() => {
    drawWaveform();
  });

  createEffect(() => {
    // Re-draw when audioData changes
    if (audioData()) {
        drawWaveform();
    }
  });

  return (
    <canvas 
      ref={canvas} 
      width={width()} 
      height={height()} 
      aria-label="Audio waveform preview"
    ></canvas>
  );
}

export default SegmentWaveform; 