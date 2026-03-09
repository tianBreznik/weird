import { useState } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isAcknowledgementsChapter } from '../utils/footnotes';
import './DesktopTOC.css';

export const DesktopTOC = ({
  chapters = [],
  pages = [],
  currentChapterIndex,
  currentPageIndex,
  currentSubchapterId,
  onJumpToPage,
  onEditChapter,
  onAddSubchapter,
  onDeleteChapter,
  onEditSubchapter,
  onDeleteSubchapter,
  onReorderChapters,
}) => {
  const { isEditor } = useEditorMode();
  const [expandedChapters, setExpandedChapters] = useState(new Set());

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Find page number for a chapter or subchapter (global page number in the pages array)
  const findPageNumber = (chapterId, subchapterId = null) => {
    let targetPage = null;
    if (subchapterId) {
      // For subchapters, find the first page of that subchapter (lowest pageIndex)
      const subchapterPages = pages.filter(
        (p) => p.chapterId === chapterId && p.subchapterId === subchapterId
      );
      if (subchapterPages.length === 0) return null;
      targetPage = subchapterPages.sort((a, b) => a.pageIndex - b.pageIndex)[0];
    } else {
      // For chapters, find the first page of that chapter (without subchapter, lowest pageIndex)
      const chapterPages = pages.filter(
        (p) => p.chapterId === chapterId && !p.subchapterId
      );
      if (chapterPages.length === 0) {
        // If chapter has no direct pages, check if it has subchapters and use the first subchapter's first page
        const subchapterPages = pages.filter(
          (p) => p.chapterId === chapterId && p.subchapterId
        );
        if (subchapterPages.length > 0) {
          targetPage = subchapterPages.sort((a, b) => a.pageIndex - b.pageIndex)[0];
        } else {
          return null;
        }
      } else {
        targetPage = chapterPages.sort((a, b) => a.pageIndex - b.pageIndex)[0];
      }
    }
    if (!targetPage) return null;
    // Find the index of this page in the global pages array (1-indexed)
    const globalIndex = pages.findIndex((p) => p === targetPage);
    return globalIndex >= 0 ? globalIndex + 1 : null;
  };

  // Toggle chapter expansion (kept for mobile, not used on desktop anymore)
  const toggleChapter = (chapterId) => {
    const newExpanded = new Set(expandedChapters);
    if (newExpanded.has(chapterId)) {
      newExpanded.delete(chapterId);
    } else {
      newExpanded.add(chapterId);
    }
    setExpandedChapters(newExpanded);
  };

  // Jump to chapter's first page
  const jumpToChapter = (chapter) => {
    const firstPage = pages.find(
      (p) => p.chapterId === chapter.id && p.pageIndex === 0 && !p.subchapterId
    );
    if (!firstPage) {
      // If chapter has no direct pages, check if it has subchapters and use the first subchapter's first page
      const subchapterPages = pages.filter(
        (p) => p.chapterId === chapter.id && p.subchapterId
      );
      if (subchapterPages.length > 0) {
        const sortedPages = subchapterPages.sort((a, b) => a.pageIndex - b.pageIndex);
        const firstSubchapterPage = sortedPages[0];
        if (firstSubchapterPage) {
          onJumpToPage(firstSubchapterPage.chapterIndex, firstSubchapterPage.pageIndex);
        }
      }
    } else {
      onJumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
    }
  };

  // Handle chapter click - always jump to chapter
  const handleChapterClick = (chapter) => {
    jumpToChapter(chapter);
  };

  // Handle chapter double-click (same as single click now)
  const handleChapterDoubleClick = (chapter) => {
    jumpToChapter(chapter);
  };

  // Handle subchapter click
  const handleSubchapterClick = (subchapter, chapterId) => {
    const subchapterPages = pages.filter(
      (p) => p.chapterId === chapterId && p.subchapterId === subchapter.id
    );
    if (subchapterPages.length > 0) {
      const firstPage = subchapterPages[0];
      onJumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
    }
  };

  // Current chapter/subchapter highlighting removed: TOC acts as a neutral index.

  // Sortable chapter row component for drag-and-drop
  const SortableChapterRow = ({
    chapter,
    chapters,
    pages,
    currentChapterIndex,
    currentPageIndex,
    currentSubchapterId,
    expandedChapters,
    setExpandedChapters,
    isEditor,
    findPageNumber,
    handleChapterClick,
    handleChapterDoubleClick,
    handleSubchapterClick,
    onJumpToPage,
    onEditChapter,
    onAddSubchapter,
    onDeleteChapter,
    onEditSubchapter,
    onDeleteSubchapter,
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id });
    
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const isExpanded = expandedChapters.has(chapter.id);
    const pageNum = findPageNumber(chapter.id);
    const hasSubchapters = chapter.children && chapter.children.length > 0;

    return (
      <div ref={setNodeRef} style={style} className="desktop-toc-chapter-row">
        <div
          className="desktop-toc-chapter-item"
          onClick={() => handleChapterClick(chapter)}
          onDoubleClick={() => handleChapterDoubleClick(chapter)}
        >
          <span className="desktop-toc-chapter-title">{chapter.title}</span>
          {isEditor && (
            <div className="desktop-toc-editor-controls">
              <button
                className="desktop-toc-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onEditChapter) onEditChapter(chapter);
                }}
                title="Edit"
              >
                ✎
              </button>
              {!isAcknowledgementsChapter(chapter) && (
                <>
                  <button
                    className="desktop-toc-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddSubchapter(chapter);
                    }}
                    title="Add subchapter"
                  >
                    +
                  </button>
                  <button
                    className="desktop-toc-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChapter(chapter.id);
                    }}
                    title="Delete"
                  >
                    ×
                  </button>
                  <span 
                    className="desktop-toc-drag-handle" 
                    title="Drag to reorder"
                    {...attributes}
                    {...listeners}
                  >
                    ☰
                  </span>
                </>
              )}
            </div>
          )}
          {pageNum && (
            <>
              <span className="desktop-toc-dots" aria-hidden="true" />
              <span className="desktop-toc-page-number">{pageNum}</span>
            </>
          )}
        </div>

        {hasSubchapters && (
          <div className="desktop-toc-subchapters">
            {chapter.children.map((subchapter) => {
              const subPageNum = findPageNumber(chapter.id, subchapter.id) ?? pageNum;
              
              return (
                <div
                  key={subchapter.id}
                  className="desktop-toc-subchapter-item"
                  onClick={() => handleSubchapterClick(subchapter, chapter.id)}
                >
                  <span className="desktop-toc-subchapter-title">{subchapter.title}</span>
                  {isEditor && (
                    <div className="desktop-toc-editor-controls">
                      <button
                        className="desktop-toc-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEditSubchapter) onEditSubchapter({ ...subchapter, parentChapterId: chapter.id });
                        }}
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        className="desktop-toc-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSubchapter(subchapter.id, chapter.id);
                        }}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {subPageNum && (
                    <>
                      <span className="desktop-toc-dots" aria-hidden="true" />
                      <span className="desktop-toc-page-number">{subPageNum}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Get special pages for editor mode
  const firstPageChapter = chapters.find(c => c.isFirstPage);
  const coverPageChapter = chapters.find(c => c.isCover);
  
  // Filter out special pages from regular chapters list (they're shown separately in editor mode)
  const regularChapters = chapters.filter(c => !c.isFirstPage && !c.isCover);

  // Check if special page is current
  const isCurrentSpecialPage = (chapter) => {
    if (!pages || pages.length === 0) return false;
    const currentPage = pages.find(
      (p) => p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex
    );
    if (!currentPage) return false;
    return currentPage.chapterId === chapter.id;
  };

  // Jump to special page
  const jumpToSpecialPage = (chapter) => {
    const specialPage = pages.find(p => p.chapterId === chapter.id);
    if (specialPage) {
      onJumpToPage(specialPage.chapterIndex, specialPage.pageIndex);
    }
  };

  return (
    <div className="desktop-toc-page">
      <div className="desktop-toc-content">
        {/* Special pages for editor mode: First Page and Cover Page */}
        {isEditor && (
          <>
            {firstPageChapter && (
              <div
                className="desktop-toc-chapter-item"
                onClick={() => jumpToSpecialPage(firstPageChapter)}
              >
                <span className="desktop-toc-chapter-title">{firstPageChapter.title || 'Prva stran'}</span>
                <div className="desktop-toc-editor-controls">
                  <button
                    className="desktop-toc-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onEditChapter) onEditChapter(firstPageChapter);
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>
                </div>
              </div>
            )}
            {coverPageChapter && (
              <div
                className="desktop-toc-chapter-item"
                onClick={() => jumpToSpecialPage(coverPageChapter)}
              >
                <span className="desktop-toc-chapter-title">{coverPageChapter.title || 'Naslovna stran'}</span>
                <div className="desktop-toc-editor-controls">
                  <button
                    className="desktop-toc-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onEditChapter) onEditChapter(coverPageChapter);
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {isEditor && onReorderChapters ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={async ({ active, over }) => {
              if (!over || active.id === over.id) return;
              const oldIndex = regularChapters.findIndex(c => c.id === active.id);
              const newIndex = regularChapters.findIndex(c => c.id === over.id);
              if (oldIndex === -1 || newIndex === -1) return;
              const reordered = arrayMove(regularChapters, oldIndex, newIndex);
              const orderedIds = reordered.map(c => c.id);
              if (onReorderChapters) {
                await onReorderChapters(orderedIds);
              }
            }}
          >
            <SortableContext items={regularChapters.map(c => c.id)} strategy={verticalListSortingStrategy}>
              {regularChapters.map((chapter) => {
                return <SortableChapterRow
                  key={chapter.id}
                  chapter={chapter}
                  chapters={chapters}
                  pages={pages}
                  currentChapterIndex={currentChapterIndex}
                  currentPageIndex={currentPageIndex}
                  currentSubchapterId={currentSubchapterId}
                  expandedChapters={expandedChapters}
                  setExpandedChapters={setExpandedChapters}
                  isEditor={isEditor}
                  findPageNumber={findPageNumber}
                  handleChapterClick={handleChapterClick}
                  handleChapterDoubleClick={handleChapterDoubleClick}
                  handleSubchapterClick={handleSubchapterClick}
                  onJumpToPage={onJumpToPage}
                  onEditChapter={onEditChapter}
                  onAddSubchapter={onAddSubchapter}
                  onDeleteChapter={onDeleteChapter}
                  onEditSubchapter={onEditSubchapter}
                  onDeleteSubchapter={onDeleteSubchapter}
                />;
              })}
            </SortableContext>
          </DndContext>
        ) : (
          regularChapters.map((chapter) => {
            const isExpanded = expandedChapters.has(chapter.id);
            const pageNum = findPageNumber(chapter.id);
            const hasSubchapters = chapter.children && chapter.children.length > 0;

            return (
              <div key={chapter.id} className="desktop-toc-chapter-row">
                <div
                  className="desktop-toc-chapter-item"
                  onClick={() => handleChapterClick(chapter)}
                  onDoubleClick={() => handleChapterDoubleClick(chapter)}
                >
                  <span className="desktop-toc-chapter-title">{chapter.title}</span>
                  {isEditor && (
                    <div className="desktop-toc-editor-controls">
                      <button
                        className="desktop-toc-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEditChapter) onEditChapter(chapter);
                        }}
                        title="Edit"
                      >
                        ✎
                      </button>
                      {!isAcknowledgementsChapter(chapter) && (
                        <>
                      <button
                        className="desktop-toc-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddSubchapter(chapter);
                        }}
                        title="Add subchapter"
                      >
                        +
                      </button>
                      <button
                        className="desktop-toc-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteChapter(chapter.id);
                        }}
                        title="Delete"
                      >
                        ×
                      </button>
                        </>
                      )}
                    </div>
                  )}
                  {pageNum && (
                    <>
                      <span className="desktop-toc-dots" aria-hidden="true" />
                      <span className="desktop-toc-page-number">{pageNum}</span>
                    </>
                  )}
                </div>

                {hasSubchapters && (
                  <div className="desktop-toc-subchapters">
                    {chapter.children.map((subchapter) => {
                      const subPageNum = findPageNumber(chapter.id, subchapter.id) ?? pageNum;
                      
                      return (
                        <div
                          key={subchapter.id}
                          className="desktop-toc-subchapter-item"
                          onClick={() => handleSubchapterClick(subchapter, chapter.id)}
                        >
                          <span className="desktop-toc-subchapter-title">{subchapter.title}</span>
                          {isEditor && (
                            <div className="desktop-toc-editor-controls">
                              <button
                                className="desktop-toc-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onEditSubchapter) onEditSubchapter({ ...subchapter, parentChapterId: chapter.id });
                                }}
                                title="Edit"
                              >
                                ✎
                              </button>
                              <button
                                className="desktop-toc-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSubchapter(subchapter.id, chapter.id);
                                }}
                                title="Delete"
                              >
                                ×
                              </button>
                            </div>
                          )}
                          {subPageNum && (
                            <>
                              <span className="desktop-toc-dots" aria-hidden="true" />
                              <span className="desktop-toc-page-number">{subPageNum}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

