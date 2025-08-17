import { Show } from 'solid-js';
import './TranscriptionOutput.css';

function TranscriptionOutput(props) {
  const handleCopy = () => {
    navigator.clipboard.writeText(props.text);
    if (props.onCopy) props.onCopy();
  };

  const handleClear = () => {
    if (props.onClear) props.onClear();
  };

  const handleInput = (event) => {
    if (props.onInput) props.onInput(event.target.value);
  }

  return (
    <div class="transcription-output">
      <Show when={false}>
        <div class="actions">
          <button 
            class="btn btn-icon-xs btn-danger" 
            onClick={handleClear}
            disabled={!props.text}
            title="Clear transcription"
          >
            <span class="material-icons">delete_outline</span>
          </button>
          <button 
            class="btn btn-icon-xs btn-ghost" 
            onClick={handleCopy}
            disabled={!props.text}
            title="Copy to clipboard"
          >
            <span class="material-icons">content_copy</span>
          </button>
        </div>
      </Show>
      
      <textarea
        class="transcription-textarea"
        value={props.text}
        onInput={handleInput}
        readonly={props.readonly}
        placeholder={props.placeholder}
      ></textarea>
    </div>
  );
}

export default TranscriptionOutput; 