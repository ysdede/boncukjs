import { Show } from 'solid-js';
import { useWidgets } from '../stores/widgetStore';
import './BaseWidget.css';

/**
 * BaseWidget – Unified container for dock widgets.
 *
 * Props:
 *   id          – unique widget id (required)
 *   title       – string shown in header (required)
 *   actions     – solid-js JSX | fn returning JSX – optional header right side
 *   class       – additional classes for root
 *   collapsible – enable collapse toggle (default true)
 *   children    – widget body content
 */
export default function BaseWidget(props) {
  const [{ widgets }] = useWidgets();
  const [, { toggleCollapse, removeWidget }] = useWidgets();

  const widgetState = () => widgets().find((w) => w.id === props.id) || {};
  const collapsed = () => widgetState().collapsed;

  const handleToggle = () => {
    if (props.collapsible === false) return;
    toggleCollapse(props.id);
  };

  const handleClose = () => {
    removeWidget(props.id);
  };

  return (
    <div class={`dock-widget ${props.class || ''}`} data-collapsed={collapsed()}>
      {/* Header */}
      <div class="dock-widget__header">
        <div class="dock-widget__title" onDblClick={handleToggle} title="Double-click to toggle">
          {props.title}
        </div>
        <div class="dock-widget__spacer" />
        {/* Optional actions */}
        <Show when={typeof props.actions === 'function' ? props.actions() : props.actions}>
          {(actions) => <div class="dock-widget__actions">{actions()}</div>}
        </Show>
        {/* Built-in buttons */}
        <Show when={props.collapsible !== false}>
          <button class="dock-widget__btn" onClick={handleToggle} aria-label="Toggle widget">
            <span class="material-icons text-xs">
              {collapsed() ? 'unfold_more' : 'unfold_less'}
            </span>
          </button>
        </Show>
        <button class="dock-widget__btn" onClick={handleClose} aria-label="Remove widget">
          <span class="material-icons text-xs">close</span>
        </button>
      </div>

      {/* Body */}
      <Show when={!collapsed()}>
        <div class="dock-widget__body">{props.children}</div>
      </Show>
    </div>
  );
} 