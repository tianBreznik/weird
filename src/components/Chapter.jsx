import { useState } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { renderMarkdownWithParagraphs } from '../utils/markdown';
import './Chapter.css';
import { SortableSubchapters } from './SortableSubchapters';

export const Chapter = ({ chapter, level = 0, chapterNumber = 1, subChapterNumber = null, parentChapterId = null, onEdit, onAddSubchapter, onDelete, dragHandleProps }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { isEditor } = useEditorMode();

  // Generate formal numbering
  const getFormalNumber = () => {
    if (level === 0) {
      return `${chapterNumber}.`;
    } else {
      return `${chapterNumber}.${subChapterNumber}`;
    }
  };

  return (
    <div className={`chapter ${isExpanded ? 'expanded' : ''}`} style={{ marginLeft: `${level * 1.5}rem` }}>
      <div className="chapter-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        <h3><span className="chapter-number">{getFormalNumber()}</span> {chapter.title}</h3>
        {isEditor && (
          <span {...(dragHandleProps || {})} style={{ cursor: 'grab', marginLeft: '0.5rem', userSelect: 'none' }} aria-label="Drag handle">⋮⋮</span>
        )}
      </div>
      
      {isExpanded && (
        <div className="chapter-body">
          {/* Show chapter content if it exists (both main and subchapters) */}
          {chapter.content && (
            <div 
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdownWithParagraphs(chapter.content) }}
            />
          )}
          
          {/* Render child chapters recursively */}
          {chapter.children && chapter.children.length > 0 && (
            <div className="child-chapters">
              <SortableSubchapters
                items={chapter.children}
                onReorder={async (orderedIds) => {
                  // Persist subchapter order for this chapter
                  try {
                    const { reorderSubchapters } = await import('../services/firestore.js');
                    await reorderSubchapters('primary', chapter.id, orderedIds);
                  } catch {}
                }}
                renderRow={(childChapter, dragHandle, index) => (
                  <Chapter
                    key={childChapter.id}
                    chapter={childChapter}
                    level={level + 1}
                    chapterNumber={chapterNumber}
                    subChapterNumber={index + 1}
                    parentChapterId={chapter.id}
                    dragHandleProps={dragHandle}
                    onEdit={onEdit}
                    onAddSubchapter={onAddSubchapter}
                    onDelete={onDelete}
                  />
                )}
              />
            </div>
          )}
        </div>
      )}
      
      {/* Editor buttons - show for each chapter individually when expanded */}
      {isExpanded && isEditor && (
        <div className="chapter-actions">
          {/* Show edit button for all chapters (both main and sub) */}
          <button className="btn-edit" onClick={() => onEdit(chapter)}>
            Edit Chapter
          </button>
          {/* Show add subchapter button for main chapters (level === 0) */}
          {level === 0 && (
            <button className="btn-add-sub" onClick={() => onAddSubchapter(chapter)}>
              Add Subchapter
            </button>
          )}
          {/* Show delete button for both main chapters and sub-chapters */}
          <button className="btn-delete" onClick={() => onDelete(chapter.id, level > 0, level > 0 ? parentChapterId : null)}>
            Delete Chapter
          </button>
        </div>
      )}
    </div>
  );
};

