import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import './PromptEditorModal.css';

function PromptEditorModal(props) {
  const [internalPromptValue, setInternalPromptValue] = createSignal('');

  // Update internal value when prop changes
  createEffect(() => {
    setInternalPromptValue(props.promptValue);
  });

  const saveAndClose = () => {
    if (props.onSave) props.onSave(internalPromptValue());
    close();
  };

  const close = () => {
    if (props.onClose) props.onClose();
  };

  createEffect(() => {
    if (props.showModal) {
      const handleKeydown = (event) => {
        if (event.key === 'Escape') {
          close();
        }
      };
      window.addEventListener('keydown', handleKeydown);
      onCleanup(() => window.removeEventListener('keydown', handleKeydown));
    }
  });

  return (
    <Show when={props.showModal}>
      <div class="modal-backdrop" onClick={close}>
        <div class="modal-content" onClick={(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2 class="text-xl font-semibold">Edit Prompt Template</h2>
            <button onClick={close} class="btn btn-icon-xs btn-ghost" title="Close">
            <span class="material-icons">close</span>
          </button>
          </div>
          <div class="modal-body">
            <textarea
              value={internalPromptValue()}
              onInput={(e) => setInternalPromptValue(e.target.value)}
              rows="15"
              class="form-control font-mono text-sm"
              placeholder="Enter your custom prompt template..."
            ></textarea>
            <p class="text-xs text-gray-500 mt-2">
              The system will automatically append previously generated headlines and the latest sentences to this template during generation.
            </p>
          </div>
                      <div class="modal-footer">
              <button onClick={close} class="btn btn-sm btn-secondary">Cancel</button>
              <button onClick={saveAndClose} class="btn btn-sm btn-primary">Save and Close</button>
            </div>
        </div>
      </div>
    </Show>
  );
}

export default PromptEditorModal; 