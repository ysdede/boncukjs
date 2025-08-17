import { createSignal, onCleanup } from 'solid-js';
import { parakeetService } from '../ParakeetService';

function ModelLoader() {
  const [status, setStatus] = createSignal(parakeetService.isWarmed ? 'ready' : (parakeetService.isLoaded ? 'loaded' : 'idle'));
  const [progress, setProgress] = createSignal(0);

  const unsub = parakeetService.onProgress((evt) => {
    if (evt.phase === 'downloading') {
      setStatus('downloading');
      setProgress(evt.progress);
    } else if (evt.phase === 'loaded') {
      setStatus('loaded');
    } else if (evt.phase === 'warmup') {
      setStatus('warmup');
    } else if (evt.phase === 'ready') {
      setStatus('ready');
    }
  });

  onCleanup(() => unsub());

  const handleClick = async () => {
    if (status() === 'idle') {
      setStatus('downloading');
      try {
        await parakeetService.ensureLoaded();
        setStatus('loaded');
        await parakeetService.warmUp();
        setStatus('ready');
      } catch (err) {
        console.error('[ModelLoader] Failed to load model:', err);
        setStatus('error');
      }
    }
  };

  const icon = () => {
    switch (status()) {
      case 'downloading':
        return 'cloud_download';
      case 'warmup':
        return 'hourglass_top';
      case 'loaded':
        return 'check';
      case 'ready':
        return 'check_circle';
      case 'error':
        return 'error';
      default:
        return 'cloud_download';
    }
  };

  const title = () => {
    switch (status()) {
      case 'downloading':
        return `Downloading model… ${(progress()*100).toFixed(0)}%`;
      case 'warmup':
        return 'Warming up model…';
      case 'loaded':
        return 'Model downloaded – warming up next';
      case 'ready':
        return 'Model ready';
      case 'error':
        return 'Model load failed – click to retry';
      default:
        return 'Load Parakeet model';
    }
  };

  return (
    <button
      class="btn btn-icon-sm btn-ghost relative"
      disabled={status() === 'downloading' || status() === 'warmup' || status() === 'ready'}
      onClick={handleClick}
      title={title()}
    >
      <span class="material-icons">
        {icon()}
      </span>
      {status()==='downloading' && (
        <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" style={{ width: `${(progress()*100).toFixed(0)}%` }} />
      )}
    </button>
  );
}

export default ModelLoader; 