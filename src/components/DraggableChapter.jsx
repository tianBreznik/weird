import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { Chapter } from './Chapter';

export const DraggableChapter = ({ chapter, index, ...rest }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    width: '100%'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Chapter
        {...rest}
        chapter={chapter}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
};


