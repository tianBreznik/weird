import { useEffect, useState, useRef } from 'react';
import { Chapter, applyInkEffectToTextMobile } from './components/Chapter';
import { ChapterEditor } from './components/ChapterEditor';
import { EditorSetup } from './pages/EditorSetup';
import { useEditorMode } from './hooks/useEditorMode';
import { getChapters, getSubchapters, addChapter, addSubchapter, updateChapter, updateSubchapter, deleteChapter, deleteSubchapter, getChapterById, getSubchapterById, reorderChapters } from './services/firestore';
import './App.css';
import { getBookmark } from './utils/bookmark';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableChapter } from './components/DraggableChapter';
import { PageReader } from './components/PageReader';
import { useReadingPosition } from './hooks/useReadingPosition';

const BOOK_ID = 'primary';

function App() {
  const { isEditor, canToggleEditorMode, previewingAsReader, togglePreviewMode } = useEditorMode();
  const [showSetup, setShowSetup] = useState(false);
  const [editingChapter, setEditingChapter] = useState(null);
  const [showNewChapterEditor, setShowNewChapterEditor] = useState(false);
  const [parentChapterForNewSub, setParentChapterForNewSub] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [defaultExpandedChapterId, setDefaultExpandedChapterId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  });
  const { position: readingPosition, savePosition } = useReadingPosition();
  const bookConceptRef = useRef(null);

  // Add/remove body class when editor opens/closes to hide flower image
  useEffect(() => {
    const hasEditor = editingChapter || showNewChapterEditor || parentChapterForNewSub;
    if (hasEditor) {
      document.body.classList.add('editor-open');
    } else {
      document.body.classList.remove('editor-open');
    }
    return () => {
      document.body.classList.remove('editor-open');
    };
  }, [editingChapter, showNewChapterEditor, parentChapterForNewSub]);

  const load = async () => {
    try {
      const chaps = await getChapters(BOOK_ID);
      const withChildren = await Promise.all(
        chaps.map(async (c) => {
          const subs = await getSubchapters(BOOK_ID, c.id);
          return {
            ...c,
            id: c.id,
            content: c.contentHtml ?? '',
            epigraph: c.epigraph ?? '',
            version: c.version ?? 0,
            children: subs.map((s) => ({
              ...s,
              id: s.id,
              content: s.contentHtml ?? '',
              epigraph: s.epigraph ?? '',
              version: s.version ?? 0,
              parentChapterId: c.id,
            })),
          };
        })
      );
      setChapters(withChildren);
      // After loading, try to restore bookmark
      const bm = getBookmark();
      if (bm?.chapterId) {
        setDefaultExpandedChapterId(bm.chapterId);
        // Scroll after paint
        requestAnimationFrame(() => {
          const el = document.getElementById(`chapter-${bm.chapterId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else {
        setDefaultExpandedChapterId(null);
      }
      setLoadError('');
      return withChildren;
    } catch (e) {
      console.error('[Firestore] Load error', e);
      setLoadError(e?.message || 'Failed to load data');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setLoading(true);
    return await load();
  };

  const findParentIdForSubchapter = (subId) => {
    const parent = chapters.find((chapter) =>
      chapter.children?.some((child) => child.id === subId)
    );
    return parent ? parent.id : null;
  };

  const openEditorWithLatest = async (entity) => {
    try {
      const isSubchapter = !!entity.parentChapterId;
      if (isSubchapter) {
        const parentId = entity.parentChapterId ?? findParentIdForSubchapter(entity.id);
        if (!parentId) throw new Error('Parent chapter not found for this subchapter.');
        const fresh = await getSubchapterById(BOOK_ID, parentId, entity.id);
        if (!fresh) throw new Error('Failed to fetch subchapter.');
        setEditingChapter({
          ...fresh,
          content: fresh.contentHtml ?? '',
          epigraph: fresh.epigraph ?? '',
          version: fresh.version ?? 0,
          parentChapterId: parentId,
        });
      } else {
        const fresh = await getChapterById(BOOK_ID, entity.id);
        if (!fresh) throw new Error('Failed to fetch chapter.');
        const matching = chapters.find((chapter) => chapter.id === entity.id);
        setEditingChapter({
          ...fresh,
          content: fresh.contentHtml ?? '',
          epigraph: fresh.epigraph ?? '',
          version: fresh.version ?? 0,
          children: matching?.children ?? [],
        });
      }
    } catch (err) {
      console.error('Failed to load the latest content for editing', err);
      alert('Could not load the latest version. Please refresh and try again.');
    }
  };

  // Apply ink effect to book-concept on mobile
  useEffect(() => {
    if (bookConceptRef.current) {
      applyInkEffectToTextMobile(bookConceptRef.current);
    }
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Disable body/html scrolling when PageReader is active
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const isReaderActive = isMobile && !isEditor && previewingAsReader;
    
    if (isReaderActive) {
      document.body.classList.add('with-page-reader');
      document.documentElement.classList.add('with-page-reader');
    } else {
      document.body.classList.remove('with-page-reader');
      document.documentElement.classList.remove('with-page-reader');
    }
    
    return () => {
      document.body.classList.remove('with-page-reader');
      document.documentElement.classList.remove('with-page-reader');
    };
  }, [isMobile, isEditor, previewingAsReader]);

  // Handle page change in PageReader
  const handlePageChange = (newPosition) => {
    savePosition(newPosition);
  };

  return (
    <div className={`app eink ${editingChapter || showNewChapterEditor || parentChapterForNewSub ? 'with-editor' : ''} ${isMobile && !isEditor && previewingAsReader ? 'with-page-reader' : ''}`}>
      {/* Mobile: Always show PageReader view - the old chapter list view is gone on mobile */}
      {isMobile && chapters.length > 0 && !loading && (
        <>
          <PageReader
            chapters={chapters}
            onPageChange={handlePageChange}
            initialPosition={readingPosition}
            onEditChapter={openEditorWithLatest}
            onAddSubchapter={(chapter) => setParentChapterForNewSub(chapter)}
            onDeleteChapter={async (chapterId) => {
              await deleteChapter(BOOK_ID, chapterId);
              await refresh();
            }}
            onEditSubchapter={openEditorWithLatest}
            onDeleteSubchapter={async (subchapterId, parentChapterId) => {
              await deleteSubchapter(BOOK_ID, parentChapterId, subchapterId);
              await refresh();
            }}
            onReorderChapters={async (orderedIds) => {
              try {
                await reorderChapters(BOOK_ID, orderedIds);
              } catch (err) {
                console.error('Failed to reorder chapters', err);
              }
            }}
            onOpenSettings={() => setShowSetup(true)}
            onAddChapter={() => setShowNewChapterEditor(true)}
            onToggleEditorReader={togglePreviewMode}
          />
        </>
      )}

      {/* Desktop: Scroll-based layout - mobile always uses PageReader now */}
      {!isMobile && (
        <>
          <header className="app-header">
        <div className="header-content">
          <p ref={bookConceptRef} className="book-concept">
          Welcome. You are now entering Dwellings in machinic passage[1] s, a short journey conceived 
          by Ema Maznik and Maks Bricelj for the 5th Industrial Art Biennial. If you’re already near 
          the Prvomajska building in Raša today , you’re free to roam, explore, and listen. But you can 
          also experience these recordings independently, wherever you are; just remember that some of 
          what you’ll hear refers to the specific architecture and atmosphere of Prvomajska.
          <br /><br />
          <b>A few hints before you begin:</b>
          <ul>
            <li>Download the files in advance or make sure you have a stable connection —
            concrete walls might prevent you from downloading.</li>
            <li>Every chapter corresponds to a marked spot. When you reach a mark, open the file
            with the same name and press play.</li>
            <li>Use headphones if you can; they keep the sound clear and let the factory’s
            acoustics work with you.</li>
            <li>Be aware of where you step and your surroundings in general: the factory is a 
              pretty safe environment, but it’s still a ruin. Be careful with uneven ground and 
              dripping water.</li>
          </ul>
          </p>
        </div>
      </header>

      <main className="app-main">
        <div className="container">
          <div className="chapters-list">
            {loading && <p>Loading…</p>}
            {!loading && loadError && (
              <p>Couldn’t load chapters: {loadError}</p>
            )}
            {!loading && !loadError && chapters.length === 0 && (
              <p>No chapters yet (book: {BOOK_ID}).</p>
            )}
            <DndContext 
              collisionDetection={closestCenter}
              onDragEnd={async (event) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                const oldIndex = chapters.findIndex(c => c.id === active.id);
                const newIndex = chapters.findIndex(c => c.id === over.id);
                const reordered = arrayMove(chapters, oldIndex, newIndex);
                setChapters(reordered);
                // Persist order
                const orderedIds = reordered.map(c => c.id);
                try { await reorderChapters(BOOK_ID, orderedIds); } catch {}
              }}
            >
              <SortableContext items={chapters.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {chapters.map((chapter, index) => (
                  <DraggableChapter 
                    key={chapter.id} 
                    chapter={chapter} 
                    chapterNumber={index + 1}
                    onEdit={openEditorWithLatest}
                    onAddSubchapter={(chapter) => setParentChapterForNewSub(chapter)}
                    onDelete={async (chapterId, isSubchapter = false, parentChapterId = null) => {
                      if (isSubchapter && parentChapterId) {
                        await deleteSubchapter(BOOK_ID, parentChapterId, chapterId);
                      } else {
                        await deleteChapter(BOOK_ID, chapterId);
                      }
                      await refresh();
                    }}
                    defaultExpandedChapterId={defaultExpandedChapterId}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      </main>
        </>
      )}

      {/* Bottom actions - only show on desktop, mobile uses TOC footer */}
      {!isMobile && (
        <div className="bottom-actions">
          {canToggleEditorMode && (
            <button 
              className="mode-toggle" 
              onClick={togglePreviewMode}
              tabIndex={window.innerWidth <= 768 ? -1 : 0}
            >
              {previewingAsReader ? 'Nazaj urejat' : 'Knjižni vpogled'}
            </button>
          )}
          <button 
            className="setup-link" 
            onClick={() => setShowSetup(true)}
            tabIndex={window.innerWidth <= 768 ? -1 : 0}
          >
            ⚙ Nastavitve
          </button>
          {isEditor && (
            <button 
              className="add-chapter-btn"
              onClick={() => setShowNewChapterEditor(true)}
              tabIndex={window.innerWidth <= 768 ? -1 : 0}
            >
              + Dodaj poglavje
            </button>
          )}
        </div>
      )}

      {showSetup && <EditorSetup onClose={() => setShowSetup(false)} />}
      
      {(editingChapter || showNewChapterEditor || parentChapterForNewSub) && (
        <ChapterEditor
          chapter={editingChapter}
          parentChapter={parentChapterForNewSub}
          onSave={async (payload) => {
            try {
              if (editingChapter) {
                const { version = 0, ...updateData } = payload;
                const isMainChapter = chapters.some(c => c.id === editingChapter.id);
                if (isMainChapter) {
                  const updated = await updateChapter(BOOK_ID, editingChapter.id, updateData, version);
                  setChapters((prev) =>
                    prev.map((chapter) => {
                      if (chapter.id !== editingChapter.id) return chapter;
                      const html = updated.contentHtml ?? updated.content ?? chapter.content;
                      return {
                        ...chapter,
                        title: updated.title ?? chapter.title,
                        epigraph: updated.epigraph ?? chapter.epigraph,
                        content: html,
                        contentHtml: updated.contentHtml ?? chapter.contentHtml,
                        version: updated.version ?? chapter.version,
                      };
                    })
                  );
                } else {
                  const parentChapter = chapters.find(c =>
                    c.children.some(child => child.id === editingChapter.id)
                  );
                  if (parentChapter) {
                    const updated = await updateSubchapter(BOOK_ID, parentChapter.id, editingChapter.id, updateData, version);
                    setChapters((prev) =>
                      prev.map((chapter) => {
                        if (chapter.id !== parentChapter.id) return chapter;
                        return {
                          ...chapter,
                          children: chapter.children.map((child) => {
                            if (child.id !== editingChapter.id) return child;
                            const html = updated.contentHtml ?? updated.content ?? child.content;
                            return {
                              ...child,
                              title: updated.title ?? child.title,
                              epigraph: updated.epigraph ?? child.epigraph,
                              content: html,
                              contentHtml: updated.contentHtml ?? child.contentHtml,
                              version: updated.version ?? child.version,
                            };
                          }),
                        };
                      })
                    );
                  } else {
                    const err = new Error('Parent chapter not found for subchapter.');
                    err.code = 'parent-not-found';
                    throw err;
                  }
                }
              } else if (parentChapterForNewSub) {
                await addSubchapter(BOOK_ID, parentChapterForNewSub.id, payload);
              } else {
                await addChapter(BOOK_ID, payload);
              }

              const refreshed = await refresh();
              if (editingChapter && refreshed) {
                const updatedEntity = refreshed
                  .flatMap((chapter) => [
                    { ...chapter, parentChapterId: null },
                    ...(chapter.children?.map((child) => ({
                      ...child,
                      parentChapterId: chapter.id,
                      isSubchapter: true,
                    })) ?? []),
                  ])
                  .find((entity) => entity.id === editingChapter.id);

                if (updatedEntity) {
                  setEditingChapter(updatedEntity);
                }
              }
              setEditingChapter(null);
              setShowNewChapterEditor(false);
              setParentChapterForNewSub(null);
            } catch (error) {
              if (error?.code === 'version-conflict') {
                alert('This content was updated in another session. Reloading the latest version so you can merge your changes.');
                const updated = await refresh();
                if (updated && editingChapter) {
                  const updatedMain = updated.find((c) => c.id === editingChapter.id);
                  if (updatedMain) {
                    setEditingChapter(updatedMain);
                  } else {
                    const parentWithChild = updated.find((c) =>
                      c.children?.some((child) => child.id === editingChapter.id)
                    );
                    if (parentWithChild) {
                      const refreshedChild = parentWithChild.children.find((child) => child.id === editingChapter.id);
                      if (refreshedChild) {
                        setEditingChapter(refreshedChild);
                      }
                    }
                  }
                }
              }
              throw error;
            }
          }}
          onCancel={() => {
            setEditingChapter(null);
            setShowNewChapterEditor(false);
            setParentChapterForNewSub(null);
          }}
          onDelete={async (chapterId, isSubchapter = false, parentChapterId = null) => {
            if (editingChapter) {
              // Check if it's a main chapter or subchapter
              const isMainChapter = chapters.some(c => c.id === editingChapter.id);
              if (isMainChapter) {
                await deleteChapter(BOOK_ID, editingChapter.id);
                await refresh();
              } else {
                // For subchapters, we need to find the parent chapter ID
                const parentChapter = chapters.find(c => 
                  c.children.some(child => child.id === editingChapter.id)
                );
                if (parentChapter) {
                  await deleteSubchapter(BOOK_ID, parentChapter.id, editingChapter.id);
                  await refresh();
                }
              }
            } else {
              if (isSubchapter && parentChapterId) {
                await deleteSubchapter(BOOK_ID, parentChapterId, chapterId);
              } else {
                await deleteChapter(BOOK_ID, chapterId);
              }
              await refresh();
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
