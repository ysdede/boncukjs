import { onMount, onCleanup, For, Show } from 'solid-js';
import './WordAlternativesPopup.css';

export default function WordAlternativesPopup(props) {
  let popupRef;

  const handleSelect = (alternative) => {
    if (props.onSelect) props.onSelect(alternative);
  };

  const handleClose = () => {
    if (props.onClose) props.onClose();
  };

  // Action to handle clicks outside the popup
  const clickOutside = (node) => {
    const handleClick = (event) => {
      if (node && !node.contains(event.target) && !event.defaultPrevented) {
        handleClose();
      }
    };

    // Use timeout to prevent immediate closing on the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);

    onCleanup(() => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClick, true);
    });
  };

  // Calculate the style string for positioning
  const yTransform = () => props.placement === 'top' ? 'translateY(-100%)' : 'translateY(0)';
  const origin = () => props.placement === 'top' ? 'bottom center' : 'top center';
  const popupStyle = () => `top: ${props.position.top}px; left: ${props.position.left}px; transform: translateX(-50%) ${yTransform()}; transform-origin: ${origin()};`;

  return (
    <div
      ref={popupRef}
      class="alternatives-popup"
      style={popupStyle()}
      use:clickOutside
    >
      <Show 
        when={props.alternatives && props.alternatives.length > 0}
        fallback={<div class="no-alternatives">No alternatives available.</div>}
      >
        <ul class="alternatives-list">
          <For each={props.alternatives}>
            {(alt, i) => (
              <li 
                class="alternative-item"
                onClick={() => handleSelect(alt)}
                title={`Select "${alt.text}"`}
              >
                <span class="alternative-text">{alt.text}</span>
                <Show when={alt.confidence != null}>
                  <span class="alternative-confidence">({(alt.confidence * 100).toFixed(0)}%)</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
              <button class="btn btn-icon-xs btn-ghost" onClick={handleClose} title="Close">
          <span class="material-icons">close</span>
        </button>
    </div>
  );
} 