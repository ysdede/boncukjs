import { createSignal, createContext, useContext } from 'solid-js';

// Unique id generator for widgets (simple incremental)
let _widgetId = 0;
function generateWidgetId() {
  return `widget-${_widgetId++}`;
}

// Default widget object structure
// { id, title, component, collapsed, props }

const WidgetContext = createContext();

export function WidgetProvider(props) {
  const [widgets, setWidgets] = createSignal(props.initialWidgets || []);

  /** Add new widget to layout */
  const addWidget = (widget) => {
    const id = widget.id ?? generateWidgetId();
    setWidgets((prev) => [...prev, { ...widget, id }]);
  };

  /** Remove widget by id */
  const removeWidget = (id) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  };

  /** Toggle collapsed state */
  const toggleCollapse = (id) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, collapsed: !w.collapsed } : w))
    );
  };

  /** Reorder widgets (dragId placed before/after dropId) */
  const moveWidget = (dragId, dropId) => {
    setWidgets((prev) => {
      const list = [...prev];
      const fromIndex = list.findIndex((w) => w.id === dragId);
      const toIndex = list.findIndex((w) => w.id === dropId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const [item] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, item);
      return list;
    });
  };

  /** Update widget custom fields */
  const updateWidget = (id, changes) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, ...changes } : w)));
  };

  const value = [
    { widgets },
    { addWidget, removeWidget, toggleCollapse, moveWidget, updateWidget, setWidgets },
  ];

  return <WidgetContext.Provider value={value}>{props.children}</WidgetContext.Provider>;
}

export function useWidgets() {
  return useContext(WidgetContext);
} 