import { useState, useEffect, useRef } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { renderMarkdownWithParagraphs } from '../utils/markdown';
import './Chapter.css';
import { SortableSubchapters } from './SortableSubchapters';
import { setBookmark } from '../utils/bookmark';
import { IsolatedButton } from './IsolatedButton';

export const Chapter = ({ chapter, level = 0, chapterNumber = 1, subChapterNumber = null, parentChapterId = null, onEdit, onAddSubchapter, onDelete, dragHandleProps, defaultExpandedChapterId }) => {
  const [isExpanded, setIsExpanded] = useState(chapter.id === defaultExpandedChapterId);
  const { isEditor } = useEditorMode();
  const contentRef = useRef(null);

  // Generate formal numbering (no "Chapter" label)
  const getFormalNumber = () => {
    if (level === 0) {
      return `${chapterNumber}.`;
    } else {
      return `${chapterNumber}.${subChapterNumber}`;
    }
  };

  // Convert ALL CAPS to Title Case (first letter uppercase, rest lowercase)
  const formatTitle = (title) => {
    if (!title) return title;
    let t = title;
    // If the title is ALL CAPS (and not numeric/punctuation), normalize to lowercase first
    if (t === t.toUpperCase() && t !== t.toLowerCase()) {
      t = t.toLowerCase();
    }
    // Capitalize the first alphabetical character only
    return t.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/, (m) => m.toUpperCase());
  };

  // Apply matching ink bleed shadows to colored text
  useEffect(() => {
    if (!isExpanded || !contentRef.current) return;
    
    // Find all elements with inline color styles
    const coloredElements = contentRef.current.querySelectorAll('[style*="color"]');
    
    coloredElements.forEach((el) => {
      // Skip if it's a background color, not text color
      const style = el.getAttribute('style') || '';
      if (style.includes('background') && !style.includes('color:')) return;
      
      // Get the computed color
      const computedStyle = window.getComputedStyle(el);
      const color = computedStyle.color;
      
      // Skip if it's black/default color (already has proper shadows)
      if (color === 'rgb(0, 0, 0)' || color === '#000000' || color === '#000') return;
      
      // Convert color to rgba format for shadows
      let shadowColor;
      if (color.startsWith('rgb')) {
        // Extract RGB values
        const rgb = color.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          // Use the same RGB values with appropriate opacity for shadows
          shadowColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.5)`;
          const shadowColor2 = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`;
          const shadowColor3 = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)`;
          
          // Apply matching shadows - remove black shadows first
          el.style.textShadow = `0 0 0.8px ${shadowColor}, 0 0.25px 1px ${shadowColor2}, -0.25px 0 1px ${shadowColor3}`;
          el.style.webkitTextStroke = `0.2px ${shadowColor2}`;
        }
      } else if (color.startsWith('#')) {
        // Convert hex to rgb
        const hex = color.replace('#', '');
        // Handle both 3-digit and 6-digit hex
        const r = hex.length === 3 
          ? parseInt(hex[0] + hex[0], 16)
          : parseInt(hex.substring(0, 2), 16);
        const g = hex.length === 3
          ? parseInt(hex[1] + hex[1], 16)
          : parseInt(hex.substring(2, 4), 16);
        const b = hex.length === 3
          ? parseInt(hex[2] + hex[2], 16)
          : parseInt(hex.substring(4, 6), 16);
        shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
        const shadowColor2 = `rgba(${r}, ${g}, ${b}, 0.22)`;
        const shadowColor3 = `rgba(${r}, ${g}, ${b}, 0.18)`;
        
        el.style.textShadow = `0 0 0.8px ${shadowColor}, 0 0.25px 1px ${shadowColor2}, -0.25px 0 1px ${shadowColor3}`;
        el.style.webkitTextStroke = `0.2px ${shadowColor2}`;
      }
    });
  }, [isExpanded, chapter.content]);

  return (
    <div id={`chapter-${chapter.id}`} className={`chapter ${level > 0 ? 'subchapter' : ''} ${isExpanded ? 'expanded' : ''}`} style={{ marginLeft: `${level * 1.5}rem` }}>
      <div className="chapter-header" onClick={() => { const next = !isExpanded; setIsExpanded(next); if (next) setBookmark(chapter.id); }}>
        {/** Title element with class per level for precise styling/hover */}
        <h3 className={level === 0 ? 'chapter-title' : 'subchapter-title'}>
          <span className="chapter-number">{getFormalNumber()}</span> {formatTitle(chapter.title)}
        </h3>
        {isEditor && (
          <div className="chapter-actions-container" onClick={(e) => e.stopPropagation()}>
            <div className="chapter-actions-inline">
              <IsolatedButton label="Edit" variant="edit" onClick={() => onEdit(chapter)} />
              {level === 0 && (
                <IsolatedButton label="Add" variant="add" onClick={() => onAddSubchapter(chapter)} />
              )}
              <IsolatedButton label="Del" variant="delete" onClick={() => onDelete(chapter.id, level > 0, level > 0 ? parentChapterId : null)} />
            </div>
            <span {...(dragHandleProps || {})} style={{ userSelect: 'none' }} aria-label="Drag handle">⋮⋮</span>
          </div>
        )}
      </div>
      
      {isExpanded && (
        <div className="chapter-body">
          {/* Show chapter content if it exists (both main and subchapters) */}
          {chapter.content && (
            <div 
              ref={contentRef}
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
      
      {/* Removed large action buttons block in favor of inline actions */}
    </div>
  );
};

