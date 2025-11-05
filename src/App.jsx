import { useEffect, useState } from 'react';
import { Chapter } from './components/Chapter';
import { ChapterEditor } from './components/ChapterEditor';
import { EditorSetup } from './pages/EditorSetup';
import { useEditorMode } from './hooks/useEditorMode';
import { getChapters, getSubchapters, addChapter, addSubchapter, updateChapter, updateSubchapter, deleteChapter, deleteSubchapter } from './services/firestore';
import './App.css';
import { getBookmark } from './utils/bookmark';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableChapter } from './components/DraggableChapter';

const BOOK_ID = 'primary';

function App() {
  const { isEditor } = useEditorMode();
  const [showSetup, setShowSetup] = useState(false);
  const [editingChapter, setEditingChapter] = useState(null);
  const [showNewChapterEditor, setShowNewChapterEditor] = useState(false);
  const [parentChapterForNewSub, setParentChapterForNewSub] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [defaultExpandedChapterId, setDefaultExpandedChapterId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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
          return { id: c.id, title: c.title, content: c.contentHtml ?? '', children: subs.map((s) => ({ id: s.id, title: s.title, content: s.contentHtml ?? '' })) };
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
    } catch (e) {
      console.error('[Firestore] Load error', e);
      setLoadError(e?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = () => {
    setLoading(true);
    load();
  };

  return (
    <div className={`app eink ${editingChapter || showNewChapterEditor || parentChapterForNewSub ? 'with-editor' : ''}`}>
      <header className="app-header">
        <div className="header-content">
          <p className="book-concept">
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
                    onEdit={setEditingChapter}
                    onAddSubchapter={(chapter) => setParentChapterForNewSub(chapter)}
                    onDelete={(chapterId, isSubchapter = false, parentChapterId = null) => {
                      if (isSubchapter && parentChapterId) {
                        deleteSubchapter(BOOK_ID, parentChapterId, chapterId).then(() => refresh());
                      } else {
                        deleteChapter(BOOK_ID, chapterId).then(() => refresh());
                      }
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
        <button className="setup-link" onClick={() => setShowSetup(true)}>
          {isEditor ? '✓ Editor Mode' : '⚙ Setup'}
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
          onSave={async (data) => {
            if (editingChapter) {
              // Check if it's a main chapter or subchapter
              const isMainChapter = chapters.some(c => c.id === editingChapter.id);
              if (isMainChapter) {
                await updateChapter(BOOK_ID, editingChapter.id, data);
              } else {
                // For subchapters, we need to find the parent chapter ID
                const parentChapter = chapters.find(c => 
                  c.children.some(child => child.id === editingChapter.id)
                );
                if (parentChapter) {
                  await updateSubchapter(BOOK_ID, parentChapter.id, editingChapter.id, data);
                }
              }
            } else if (parentChapterForNewSub) {
              await addSubchapter(BOOK_ID, parentChapterForNewSub.id, data);
            } else {
              await addChapter(BOOK_ID, data);
            }
            refresh();
            setEditingChapter(null);
            setShowNewChapterEditor(false);
            setParentChapterForNewSub(null);
          }}
          onCancel={() => {
            setEditingChapter(null);
            setShowNewChapterEditor(false);
            setParentChapterForNewSub(null);
          }}
          onDelete={(chapterId) => {
            if (editingChapter) {
              // Check if it's a main chapter or subchapter
              const isMainChapter = chapters.some(c => c.id === editingChapter.id);
              if (isMainChapter) {
                deleteChapter(BOOK_ID, editingChapter.id).then(() => refresh());
              } else {
                // For subchapters, we need to find the parent chapter ID
                const parentChapter = chapters.find(c => 
                  c.children.some(child => child.id === editingChapter.id)
                );
                if (parentChapter) {
                  deleteSubchapter(BOOK_ID, parentChapter.id, editingChapter.id).then(() => refresh());
                }
              }
            } else {
              deleteChapter(BOOK_ID, chapterId).then(() => refresh());
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
