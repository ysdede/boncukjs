
import { describe, it, expect } from 'vitest';
import { drawWaveformPath } from './BufferVisualizer';

// Plain Mock Context without Vitest spies to avoid memory issues
class MockContext {
  beginPath() {}
  moveTo(x: number, y: number) {}
  lineTo(x: number, y: number) {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  setLineDash() {}
  fillText() {}
  roundRect() {}
  fill() {}
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineCap = 'butt';
  globalAlpha = 1;
  shadowBlur = 0;
  shadowColor = '';
  font = '';
  textAlign = 'start';
}

describe('BufferVisualizer Performance Benchmark', () => {
  const width = 800;
  const height = 200;
  const centerY = height / 2;
  const dataSize = 1000;
  const data = new Float32Array(dataSize);
  for (let i = 0; i < dataSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const ctx = new MockContext() as unknown as CanvasRenderingContext2D;

  it('measures performance of inline vs external helper function', () => {
    // Increase iterations now that we don't have mock overhead
    const iterations = 50000;

    // OLD IMPLEMENTATION: Helper defined inside the loop
    const startOld = performance.now();
    for (let k = 0; k < iterations; k++) {
        const numPoints = data.length / 2;
        const step = width / numPoints;

        // Define helper inside
        const drawPath = (offsetX: number, offsetY: number) => {
            if (!ctx) return;
            ctx.beginPath();
            for (let i = 0; i < numPoints; i++) {
                const x = i * step + offsetX;
                let minVal = data[i * 2];
                let maxVal = data[i * 2 + 1];

                let yMin = centerY - (minVal * centerY * 0.9) + offsetY;
                let yMax = centerY - (maxVal * centerY * 0.9) + offsetY;

                if (Math.abs(yMax - yMin) < 1) {
                    yMin = centerY - 0.5 + offsetY;
                    yMax = centerY + 0.5 + offsetY;
                }

                ctx.moveTo(x, yMin);
                ctx.lineTo(x, yMax);
            }
            ctx.stroke();
        };

        // Call it 3 times per frame like in the component
        drawPath(-0.5, -0.5);
        drawPath(0.5, 0.5);
        drawPath(0, 0);
    }
    const endOld = performance.now();
    const timeOld = endOld - startOld;

    // NEW IMPLEMENTATION: Helper imported from module
    const startNew = performance.now();
    for (let k = 0; k < iterations; k++) {
        // Call external helper 3 times
        drawWaveformPath(ctx, data, width, height, -0.5, -0.5);
        drawWaveformPath(ctx, data, width, height, 0.5, 0.5);
        drawWaveformPath(ctx, data, width, height, 0, 0);
    }
    const endNew = performance.now();
    const timeNew = endNew - startNew;

    console.log(`Old implementation time: ${timeOld.toFixed(2)}ms`);
    console.log(`New implementation time: ${timeNew.toFixed(2)}ms`);
    console.log(`Improvement: ${(timeOld - timeNew).toFixed(2)}ms (${((timeOld - timeNew) / timeOld * 100).toFixed(2)}%)`);

    expect(timeNew).toBeLessThanOrEqual(timeOld * 1.2);
  });
});
