import { Show } from 'solid-js';
import { useUI } from '../stores/uiStore';

function ThemeToggle() {
  const [ui, { toggleDarkMode }] = useUI();

  return (
    <button
      class="header-button-modern theme-toggle"
      onClick={toggleDarkMode}
      aria-label={ui.darkMode ? "Switch to light mode" : "Switch to dark mode"}
      title={ui.darkMode ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Show 
        when={ui.darkMode} 
        fallback={<span class="material-icons text-lg">brightness_2</span>}
      >
        <span class="material-icons text-lg">wb_sunny</span>
      </Show>
    </button>
  );
}

export default ThemeToggle; 