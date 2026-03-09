import { useState, useEffect, useRef } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isAcknowledgementsChapter } from '../utils/footnotes';
import './MobileTOC.css';

export const MobileTOC = ({
  chapters = [],
  pages = [],
  currentChapterIndex,
  currentPageIndex,
  currentSubchapterId,
  // subchapterPageMap is currently unused; kept for future metadata-based jumps
  isOpen,
  dragProgress = 0,
  onClose,
  onJumpToPage,
  onEditChapter,
  onAddSubchapter,
  onDeleteChapter,
  onEditSubchapter,
  onDeleteSubchapter,
  onReorderChapters,
  onOpenSettings,
  onAddChapter,
  onToggleEditorReader,
}) => {
  const { isEditor, canToggleEditorMode, previewingAsReader } = useEditorMode();
  const [expandedChapters, setExpandedChapters] = useState(new Set());
  const [isClosing, setIsClosing] = useState(false);

  // Temporary: log a sample page shape so we can align subchapter navigation on mobile
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    // Log one regular page and, if available, one subchapter page so we can see the shape.
    const firstPage = pages[0];
    const firstSubPage = pages.find((p) => p.subchapterId != null) || null;
    // eslint-disable-next-line no-console
    console.log('[mobile-toc] sample page[0]', firstPage);
    if (firstSubPage) {
      // eslint-disable-next-line no-console
      console.log('[mobile-toc] sample subchapter page', firstSubPage);
    }
  }, [pages]);
  const closeTimerRef = useRef(null);

  // Configure drag sensors for touch devices
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );
  const [showSettingsButton, setShowSettingsButton] = useState(false);
  // Track double-tap state
  const lastTapRef = useRef({ time: 0, chapterId: null });
  const singleTapTimeoutRef = useRef(null);
  // Track triple-tap for revealing settings button
  const tripleTapRef = useRef({ taps: 0, lastTapTime: 0, timeout: null });

  const handleClose = () => {
    if (singleTapTimeoutRef.current) {
      clearTimeout(singleTapTimeoutRef.current);
      singleTapTimeoutRef.current = null;
    }
    if (closeTimerRef.current) return; // already closing
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setIsClosing(false);
      onClose();
    }, 420);
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
      if (tripleTapRef.current.timeout) clearTimeout(tripleTapRef.current.timeout);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Find page number for a chapter or subchapter (global page number in the pages array)
  const findPageNumber = (chapterId, subchapterId = null, subchapterTitle = null) => {
    let targetPage = null;
    if (subchapterId || subchapterTitle) {
      // For subchapters, try several strategies in order:
      // 1) Match by subchapterId
      // 2) Match by subchapterTitle (heading page)
      // 3) Fallback to chapterId + subchapterId (desktop-style)
      let subchapterPages = [];
      if (subchapterId) {
        subchapterPages = pages.filter((p) => p.subchapterId === subchapterId);
      }
      if (subchapterPages.length === 0 && subchapterTitle) {
        subchapterPages = pages.filter((p) => p.subchapterTitle === subchapterTitle);
      }
      if (subchapterPages.length === 0 && subchapterId) {
        subchapterPages = pages.filter(
          (p) => p.chapterId === chapterId && p.subchapterId === subchapterId
        );
      }
      if (subchapterPages.length === 0) return null;
      // Sort by pageIndex and get the first one
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
          // Sort by pageIndex and get the first one
          targetPage = subchapterPages.sort((a, b) => a.pageIndex - b.pageIndex)[0];
        } else {
          return null;
        }
      } else {
        // Sort by pageIndex and get the first one
        targetPage = chapterPages.sort((a, b) => a.pageIndex - b.pageIndex)[0];
      }
    }
    if (!targetPage) return null;
    // Find the index of this page in the global pages array (1-indexed)
    const globalIndex = pages.findIndex((p) => p === targetPage);
    return globalIndex >= 0 ? globalIndex + 1 : null;
  };

  // Toggle chapter expansion
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
          handleClose();
        }
      }
    } else {
      onJumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
      handleClose();
    }
  };

  // Handle chapter click with double-tap detection
  const handleChapterClick = (chapter, chapterIndex) => {
    const hasSubchapters = chapter.children && chapter.children.length > 0;
    
    // If chapter has no subchapters, single tap jumps directly
    if (!hasSubchapters) {
      jumpToChapter(chapter);
      return;
    }

    // For chapters with subchapters: single tap toggles, double tap jumps
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current.time;
    const isDoubleTap = 
      lastTapRef.current.chapterId === chapter.id && 
      timeSinceLastTap < 300; // 300ms threshold for double-tap

    // Clear any pending single-tap action
    if (singleTapTimeoutRef.current) {
      clearTimeout(singleTapTimeoutRef.current);
      singleTapTimeoutRef.current = null;
    }

    if (isDoubleTap) {
      // Double-tap: jump to chapter
      jumpToChapter(chapter);
      // Reset tap tracking
      lastTapRef.current = { time: 0, chapterId: null };
    } else {
      // Single-tap: toggle expand/collapse (delayed to allow double-tap detection)
      lastTapRef.current = { time: now, chapterId: chapter.id };
      singleTapTimeoutRef.current = setTimeout(() => {
        toggleChapter(chapter.id);
        singleTapTimeoutRef.current = null;
      }, 300); // Wait 300ms to see if it's a double-tap
    }
  };

  // Handle subchapter click: mirror DesktopTOC behavior (chapterId + subchapterId),
  // and fall back to the same page-number logic used for the displayed page number.
  const handleSubchapterClick = (subchapter, chapterId) => {
    if (!pages || pages.length === 0) return;

    // First try: direct match on chapterId + subchapterId, sorted by pageIndex.
    let targetPage = pages
      .filter(
        (p) =>
          p.chapterId === chapterId &&
          p.subchapterId === subchapter.id
      )
      .sort((a, b) => a.pageIndex - b.pageIndex)[0];

    // Second try: reuse findPageNumber (same logic as the page number display).
    if (!targetPage) {
      const globalPageNum = findPageNumber(chapterId, subchapter.id, subchapter.title);
      if (globalPageNum) {
        const pageIndex = globalPageNum - 1;
        targetPage = pages[pageIndex];
      }
    }

    if (!targetPage) return;

    onJumpToPage(targetPage.chapterIndex, targetPage.pageIndex);
    handleClose();
  };

  // Check if chapter/subchapter is current
  const isCurrentChapter = (chapterId) => {
    if (!pages || pages.length === 0) return false;
    const currentPage = pages.find(
      (p) => p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex
    );
    if (!currentPage) return false;
    // Check if this page belongs to the chapter and is not a subchapter page
    return currentPage.chapterId === chapterId && !currentPage.subchapterId;
  };

  const isCurrentSubchapter = (subchapterId) => {
    if (!subchapterId || !currentSubchapterId) return false;
    return currentSubchapterId === subchapterId;
  };

  // Sortable chapter row component for drag-and-drop
  const SortableChapterRow = ({
    chapter,
    chapterIndex,
    chapters,
    pages,
    currentChapterIndex,
    currentPageIndex,
    currentSubchapterId,
    expandedChapters,
    setExpandedChapters,
    lastTapRef,
    singleTapTimeoutRef,
    isEditor,
    isCurrentChapter,
    isCurrentSubchapter,
    findPageNumber,
    handleChapterClick,
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
    const isCurrent = isCurrentChapter(chapter.id);
    const pageNum = findPageNumber(chapter.id);
    const hasSubchapters = chapter.children && chapter.children.length > 0;

    return (
      <div ref={setNodeRef} style={style} className="mobile-toc-chapter-row">
        <div
          className={`mobile-toc-chapter-item ${isCurrent ? 'mobile-toc-current' : ''} ${isExpanded ? 'mobile-toc-expanded' : ''}`}
          onClick={() => handleChapterClick(chapter, chapterIndex)}
        >
          <span className="mobile-toc-chapter-title">{chapter.title}</span>
          {isEditor && (
            <div className="mobile-toc-editor-controls-inline">
              <button
                className="mobile-toc-btn-icon"
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
                className="mobile-toc-btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddSubchapter(chapter);
                }}
                title="Add subchapter"
              >
                +
              </button>
              <button
                className="mobile-toc-btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChapter(chapter.id);
                }}
                title="Delete"
              >
                ×
              </button>
              <span 
                className="mobile-toc-drag-handle-inline" 
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
              <span className="mobile-toc-dots" aria-hidden="true" />
              <span className="mobile-toc-page-number">{pageNum}</span>
            </>
          )}
        </div>

        {isExpanded && hasSubchapters && (
          <div className="mobile-toc-subchapters">
            {chapter.children.map((subchapter) => {
              const isCurrentSub = isCurrentSubchapter(subchapter.id);
              const subPageNum = findPageNumber(chapter.id, subchapter.id) ?? pageNum;
              
              return (
                <div
                  key={subchapter.id}
                  className={`mobile-toc-subchapter-item ${isCurrentSub ? 'mobile-toc-current' : ''}`}
                  onClick={() => handleSubchapterClick(subchapter, chapter.id)}
                >
                  <span className="mobile-toc-subchapter-title">{subchapter.title}</span>
                  {isEditor && (
                    <div className="mobile-toc-editor-controls-inline">
                      <button
                        className="mobile-toc-btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEditSubchapter) onEditSubchapter({ ...subchapter, parentChapterId: chapter.id });
                        }}
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        className="mobile-toc-btn-icon"
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
                      <span className="mobile-toc-dots" aria-hidden="true" />
                      <span className="mobile-toc-page-number">{subPageNum}</span>
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

  // Always render overlay so we can update it via DOM during drag
  // This prevents React re-renders from affecting page content
  // Don't early return - always render the full component so DOM updates work

  // Calculate transform based on drag progress
  // When closed: translateY = -100% (fully above viewport)
  // When dragging: translateY = -100% + (progress * 100%) (slides down like a curtain)
  // When open: translateY = 0% (fully visible)
  const translateY = isOpen ? 0 : Math.max(-100, -100 + (dragProgress * 100));
  const baseOpacity = isOpen ? 1 : Math.max(0, Math.min(1, dragProgress));
  // Make text fully visible during drag, independent of overlay opacity
  const textOpacity = (isOpen || dragProgress > 0) ? 1 : 0;
  // Text color: bright during drag/open, slightly dimmer when fully closed
  const textColor = (isOpen || dragProgress > 0) ? 'white' : 'rgba(255, 255, 255, 0.6)';
  // Disable transition during drag, enable it when snapping to final position
  const isDragging = dragProgress > 0 && dragProgress < 1 && !isOpen;

  // During the closing phase we want the overlay fully visible so that the
  // CSS `.mobile-toc-overlay.mobile-toc-closing` rules (including blur) can
  // animate. For dragging, keep opacity at 1 so the text feels like a solid
  // curtain being pulled down, without showing the background yet.
  // When closing, let CSS handle opacity so the transition runs cleanly.
  // Only use inline opacity for drag-progress and open/closed states.
  const overlayOpacity = isClosing
    ? undefined
    : (isOpen || dragProgress > 0 ? 1 : 0);

  return (
    <div 
      className={`mobile-toc-overlay ${isOpen && !isClosing ? 'mobile-toc-open' : ''} ${isClosing ? 'mobile-toc-closing' : ''}`}
      style={{ opacity: overlayOpacity, pointerEvents: (isOpen || dragProgress > 0) ? 'auto' : 'none' }}
    >
      <div 
        className="mobile-toc-container"
        style={{ 
          transform: `translateY(${translateY}%)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.3s ease-out',
          opacity: 1,
          color: textColor
        }}
      >
        <div 
          className="mobile-toc-header"
          onTouchStart={(e) => {
            // Triple tap detection for revealing settings button
            // Only trigger on the header area, not the close button
            if (e.target.closest('.mobile-toc-close')) return;
            
            const now = Date.now();
            const taps = tripleTapRef.current.taps;
            
            // Clear existing timeout
            if (tripleTapRef.current.timeout) {
              clearTimeout(tripleTapRef.current.timeout);
            }
            
            // Check if this is a new tap (within 500ms of last tap)
            if (taps === 0 || (now - tripleTapRef.current.lastTapTime) < 500) {
              tripleTapRef.current.taps = taps + 1;
              tripleTapRef.current.lastTapTime = now;
              
              // If we've reached 3 taps, reveal settings button
              if (tripleTapRef.current.taps >= 3) {
                setShowSettingsButton(true);
                tripleTapRef.current.taps = 0;
              } else {
                // Set timeout to reset tap count
                tripleTapRef.current.timeout = setTimeout(() => {
                  tripleTapRef.current.taps = 0;
                }, 500);
              }
            } else {
              // Reset if too much time passed
              tripleTapRef.current.taps = 1;
              tripleTapRef.current.lastTapTime = now;
            }
          }}
        >
          <button className="mobile-toc-close" onClick={handleClose}>
            ×
          </button>
        </div>
        
        <div className="mobile-toc-content">
          {/* Filter chapters: hide special pages (first page, cover) in viewer mode, show in editor mode */}
          {(() => {
            // Get special pages for editor mode
            const firstPageChapter = chapters.find(c => c.isFirstPage);
            const coverPageChapter = chapters.find(c => c.isCover);
            
            // Filter out special pages from regular chapters list (they're shown separately in editor mode)
            const regularChapters = chapters.filter(c => !c.isFirstPage && !c.isCover);
            
            return (
              <>
                {/* Special pages for editor mode: First Page and Cover Page */}
                {isEditor && firstPageChapter && (
                  <div
                    className={`mobile-toc-chapter-item ${currentChapterIndex === firstPageChapter.order && currentPageIndex === 0 ? 'mobile-toc-current' : ''}`}
                    onClick={() => {
                      const firstPage = pages.find(p => p.chapterId === firstPageChapter.id);
                      if (firstPage) {
                        onJumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
                        handleClose();
                      }
                    }}
                  >
                    <span className="mobile-toc-chapter-title">{firstPageChapter.title || 'Prva stran'}</span>
                    {isEditor && (
                      <div className="mobile-toc-editor-controls-inline">
                        <button
                          className="mobile-toc-btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onEditChapter) {
                              onEditChapter(firstPageChapter);
                            }
                          }}
                          title="Edit"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {isEditor && coverPageChapter && (
                  <div
                    className={`mobile-toc-chapter-item ${currentChapterIndex === coverPageChapter.order && currentPageIndex === 0 ? 'mobile-toc-current' : ''}`}
                    onClick={() => {
                      const coverPage = pages.find(p => p.chapterId === coverPageChapter.id);
                      if (coverPage) {
                        onJumpToPage(coverPage.chapterIndex, coverPage.pageIndex);
                        handleClose();
                      }
                    }}
                  >
                    <span className="mobile-toc-chapter-title">{coverPageChapter.title || 'Naslovna stran'}</span>
                    {isEditor && (
                      <div className="mobile-toc-editor-controls-inline">
                        <button
                          className="mobile-toc-btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onEditChapter) {
                              onEditChapter(coverPageChapter);
                            }
                          }}
                          title="Edit"
                        >
                          ✎
                        </button>
                      </div>
                    )}
                  </div>
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
                {regularChapters.map((chapter, chapterIndex) => {
                  return <SortableChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    chapterIndex={chapterIndex}
                    chapters={chapters}
                    pages={pages}
                    currentChapterIndex={currentChapterIndex}
                    currentPageIndex={currentPageIndex}
                    currentSubchapterId={currentSubchapterId}
                    expandedChapters={expandedChapters}
                    setExpandedChapters={setExpandedChapters}
                    lastTapRef={lastTapRef}
                    singleTapTimeoutRef={singleTapTimeoutRef}
                    isEditor={isEditor}
                    isCurrentChapter={isCurrentChapter}
                    isCurrentSubchapter={isCurrentSubchapter}
                    findPageNumber={findPageNumber}
                    handleChapterClick={handleChapterClick}
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
            regularChapters.map((chapter, chapterIndex) => {
            const isExpanded = expandedChapters.has(chapter.id);
            const isCurrent = isCurrentChapter(chapter.id);
            const pageNum = findPageNumber(chapter.id);
            const hasSubchapters = chapter.children && chapter.children.length > 0;

            return (
              <div key={chapter.id} className="mobile-toc-chapter-row">
                <div
                  className={`mobile-toc-chapter-item ${isCurrent ? 'mobile-toc-current' : ''} ${isExpanded ? 'mobile-toc-expanded' : ''}`}
                  onClick={() => handleChapterClick(chapter, chapterIndex)}
                >
                  <span className="mobile-toc-chapter-title">{chapter.title}</span>
                  {isEditor && (
                    <div className="mobile-toc-editor-controls-inline">
                      <button
                        className="mobile-toc-btn-icon"
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
                        className="mobile-toc-btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddSubchapter(chapter);
                        }}
                        title="Add subchapter"
                      >
                        +
                      </button>
                      <button
                        className="mobile-toc-btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteChapter(chapter.id);
                        }}
                        title="Delete"
                      >
                        ×
                      </button>
                      <span className="mobile-toc-drag-handle-inline" title="Drag to reorder">☰</span>
                        </>
                      )}
                    </div>
                  )}
                  {/* Don't show page numbers for special pages */}
                  {pageNum && !chapter.isFirstPage && !chapter.isCover && (
                    <>
                      <span className="mobile-toc-dots" aria-hidden="true" />
                      <span className="mobile-toc-page-number">{pageNum}</span>
                    </>
                  )}
                </div>

                {isExpanded && hasSubchapters && (
                  <div className="mobile-toc-subchapters">
                    {chapter.children.map((subchapter) => {
                      const isCurrentSub = isCurrentSubchapter(subchapter.id);
                      const subPageNum = findPageNumber(chapter.id, subchapter.id) ?? pageNum;
                      
                      return (
                        <div
                          key={subchapter.id}
                          className={`mobile-toc-subchapter-item ${isCurrentSub ? 'mobile-toc-current' : ''}`}
                          onClick={() => handleSubchapterClick(subchapter, chapter.id)}
                        >
                          <span className="mobile-toc-subchapter-title">{subchapter.title}</span>
                          {isEditor && (
                            <div className="mobile-toc-editor-controls-inline">
                              <button
                                className="mobile-toc-btn-icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onEditSubchapter) onEditSubchapter({ ...subchapter, parentChapterId: chapter.id });
                                }}
                                title="Edit"
                              >
                                ✎
                              </button>
                              <button
                                className="mobile-toc-btn-icon"
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
                              <span className="mobile-toc-dots" aria-hidden="true" />
                              <span className="mobile-toc-page-number">{subPageNum}</span>
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
          
          {/* Footer with action buttons - inside scrollable content */}
          <div className="mobile-toc-footer">
            {/* Settings button - hidden by default, revealed with triple tap on TOC header */}
            {(showSettingsButton || isEditor) && (
            <button
              className="mobile-toc-footer-btn"
              onClick={() => {
                if (onOpenSettings) onOpenSettings();
                handleClose();
              }}
            >
              Nastavitve
            </button>
            )}
            {isEditor && (
              <button
                className="mobile-toc-footer-btn"
                onClick={() => {
                  if (onAddChapter) onAddChapter();
                  handleClose();
                }}
              >
                Dodaj poglavje
              </button>
            )}
            {canToggleEditorMode && (
              <button
                className="mobile-toc-footer-btn"
                onClick={() => {
                  if (onToggleEditorReader) onToggleEditorReader();
                }}
              >
                {previewingAsReader ? 'Nazaj na urejevalnik' : 'Knjižni vpogled'}
              </button>
            )}
          </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

