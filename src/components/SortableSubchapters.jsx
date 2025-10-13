import { DndContext, closestCenter } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DraggableRow = ({ item, render, id }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, width: '100%' };
  return (
    <div ref={setNodeRef} style={style}>
      {render({ attributes, listeners })}
    </div>
  );
};

export const SortableSubchapters = ({ items, onReorder, renderRow }) => {
  const [local, setLocal] = useState(items);

  // Keep local list in sync if parent updates children
  useEffect(() => {
    setLocal(items);
  }, [items]);

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (!over || active.id === over.id) return;
        const oldIndex = local.findIndex(i => i.id === active.id);
        const newIndex = local.findIndex(i => i.id === over.id);
        const reordered = arrayMove(local, oldIndex, newIndex);
        setLocal(reordered);
        await onReorder(reordered.map(i => i.id));
      }}
    >
      <SortableContext items={local.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {local.map((item, index) => (
          <DraggableRow
            key={item.id}
            id={item.id}
            item={item}
            render={({ attributes, listeners }) => renderRow(item, { ...attributes, ...listeners }, index)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};


