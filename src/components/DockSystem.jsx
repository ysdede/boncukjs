import { For, createEffect } from 'solid-js';
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  makeSortable,
} from '@thisbeyond/solid-dnd';
import { useWidgets } from '../stores/widgetStore';
import BaseWidget from './BaseWidget';

/**
 * DockSystem – render and manage draggable, sortable widgets.
 * Wrap this component inside <WidgetProvider>.
 */
export default function DockSystem() {
  const [{ widgets }] = useWidgets();
  const [, { moveWidget }] = useWidgets();

  // Setup onDragEnd handler
  createEffect(() => {
    // The onDragEnd callback is set via useDragDropContext – easier to attach inside provider root.
  });

  return (
    <DragDropProvider collisionDetector={closestCenter} onDragEnd={({ draggable, droppable }) => {
      if (draggable && droppable) {
        moveWidget(draggable.id, droppable.id);
      }
    }}>
      <DragDropSensors />
      <SortableProvider id="dock-list" items={widgets().map((w) => w.id)}>
        <div class="dock-system flex flex-col gap-4">
          <For each={widgets()}>{(widget) => {
            const SortableWrapper = makeSortable(widget.id);
            return (
              <div use:SortableWrapper>
                <BaseWidget id={widget.id} title={widget.title} collapsible={widget.collapsible} actions={widget.actions}>
                  {/* Render inner component */}
                  {typeof widget.component === 'function' ? (
                    <widget.component {...(widget.props || {})} />
                  ) : (
                    widget.component
                  )}
                </BaseWidget>
              </div>
            );
          }}</For>
        </div>
      </SortableProvider>
    </DragDropProvider>
  );
} 