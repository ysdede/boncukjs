import { createMemo } from 'solid-js';
import './Timestamp.css';

function Timestamp(props) {
  const parts = createMemo(() => {
    const seconds = props.seconds;
    if (typeof seconds === 'number' && !isNaN(seconds)) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 10);
      return {
        hours: String(h).padStart(2, '0'),
        minutes: String(m).padStart(2, '0'),
        seconds: String(s).padStart(2, '0'),
        milliseconds: String(ms)
      };
    }
    return {
      hours: '00',
      minutes: '00',
      seconds: '00',
      milliseconds: '0'
    };
  });

  return (
    <span class="timestamp-wrapper">{parts().hours}:{parts().minutes}:{parts().seconds}.<span class="milliseconds">{parts().milliseconds}</span></span>
  );
}

export default Timestamp; 