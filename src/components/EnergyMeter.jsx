import { createMemo } from 'solid-js';
import './EnergyMeter.css';

function EnergyMeter(props) {
  const energyLevel = () => props.energyLevel || 0;
  const threshold = () => props.threshold || 0.125;
  const vertical = () => props.vertical !== undefined ? props.vertical : true;
  const height = () => (vertical() ? (props.height || 150) : (props.width || 20));
  const width = () => (vertical() ? (props.width || 30) : (props.height || 150));

  const color = createMemo(() => {
    const level = energyLevel();
    const thres = threshold();
    if (level < thres * 0.8) {
      return 'var(--text-muted)';
    } else if (level < thres) {
      return 'var(--color-warning)';
    } else if (level < thres * 2) {
      return 'var(--color-success)';
    } else {
      return 'var(--color-danger)';
    }
  });

  return (
    <div
      class={`energy-meter ${vertical() ? 'vertical' : 'horizontal'}`}
      style={{ height: `${height()}px`, width: `${width()}px` }}
    >
      <div class="meter-background"></div>
      <div
        class="threshold-marker"
        style={vertical() ? 
          `bottom: ${threshold() * 100}%` : 
          `left: ${threshold() * 100}%`
        }
      ></div>
      <div
        class="energy-level"
        style={
          `${vertical() ? 
            `height: ${energyLevel() * 100}%` : 
            `width: ${energyLevel() * 100}%`}; 
          background-color: ${color()};`
        }
      ></div>
      <div class="value-label">
        {Math.round(energyLevel() * 100)}
      </div>
    </div>
  );
}

export default EnergyMeter; 