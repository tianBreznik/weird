import { useEffect, useState, useRef } from 'react';
import { Chapter, applyInkEffectToTextMobile } from './components/Chapter';
import { ChapterEditor } from './components/ChapterEditor';
import { EditorSetup } from './pages/EditorSetup';
import { useEditorMode } from './hooks/useEditorMode';
import { getChapters, getSubchapters, addChapter, addSubchapter, updateChapter, updateSubchapter, deleteChapter, deleteSubchapter, getChapterById, getSubchapterById } from './services/firestore';
import './App.css';
import { getBookmark } from './utils/bookmark';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableChapter } from './components/DraggableChapter';

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
  const bookConceptRef = useRef(null);

  const load = async () => {
    try {
      console.log('[Firestore] Loading chapters for book:', BOOK_ID);
      const chaps = await getChapters(BOOK_ID);
      console.log('[Firestore] Chapters found:', chaps.length, chaps);
      const withChildren = await Promise.all(
        chaps.map(async (c) => {
          const subs = await getSubchapters(BOOK_ID, c.id);
          console.log('[Firestore] Subchapters for', c.id, subs.length);
          console.log('Chapter data:', c.id, c.title, c.contentHtml);
          return {
            ...c,
            id: c.id,
            content: c.contentHtml ?? '',
            version: c.version ?? 0,
            children: subs.map((s) => ({
              ...s,
              id: s.id,
              content: s.contentHtml ?? '',
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

  return (
    <div className={`app eink ${editingChapter || showNewChapterEditor || parentChapterForNewSub ? 'with-editor' : ''}`}>
      <header className="app-header">
        <div className="header-content">
          <p ref={bookConceptRef} className="book-concept">
            This research examines the complex relationship between gothic ruins and contemporary architectural theory, 
            positioning these decayed structures not as failed architecture but as post-architectural entities that 
            challenge traditional notions of temporality, materiality, and spatial organization. Through an interdisciplinary 
            approach combining architectural history, material studies, and post-humanist theory, this work investigates 
            how ruins function as sites of entanglement where multiple temporal registers, material memories, and 
            spatial configurations intersect and interact. The study argues that gothic ruins, in their state of 
            perpetual decay and transformation, offer a unique lens through which to understand the dynamic relationships 
            between built environments and their ongoing processes of becoming, dissolution, and reconstitution.
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

      <div className="bottom-actions">
        {canToggleEditorMode && (
          <button className="mode-toggle" onClick={togglePreviewMode}>
            {previewingAsReader ? 'Return to Editor Mode' : 'Preview Reader View'}
          </button>
        )}
        <button className="setup-link" onClick={() => setShowSetup(true)}>
          ⚙ Setup
        </button>
        {isEditor && (
          <button 
            className="add-chapter-btn"
            onClick={() => setShowNewChapterEditor(true)}
          >
            + Add New Chapter
          </button>
        )}
      </div>

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
