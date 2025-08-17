import { For } from 'solid-js';
import { LANGUAGES } from '../constants.js';
import './LanguageSelector.css';

function LanguageSelector(props) {
  return (
    <select
      id={props.id || 'language-select'}
      class="language-select"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
      aria-label="Select Language"
    >
      <For each={Object.entries(LANGUAGES)}>
        {([name, code]) => (
          <option value={code}>
            {name}
          </option>
        )}
      </For>
    </select>
  );
}

export default LanguageSelector; 