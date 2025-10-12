import { useState, useEffect } from 'react';
import './ChapterEditor.css';

export const ChapterEditor = ({ chapter, parentChapter, onSave, onCancel, onDelete }) => {
  const [title, setTitle] = useState(chapter?.title || '');
  const [content, setContent] = useState(chapter?.content || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (chapter) {
      setTitle(chapter.title);
      setContent(chapter.content || '');
    } else if (parentChapter) {
      setTitle('');
      setContent('');
    }
  }, [chapter, parentChapter]);

  const handleSave = async () => {
    setSaving(true);
    console.log('Saving data:', { title, contentHtml: content });
    await onSave({ title, contentHtml: content });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this chapter?')) {
      await onDelete(chapter?.id);
      onCancel();
    }
  };

  // Simple markdown shortcuts (we'll implement these later)
  const handleContentChange = (e) => {
    setContent(e.target.value);
  };

  return (
    <div className="editor-overlay">
      <div className="editor-modal">
        <div className="editor-header">
          <h2>
            {chapter ? 'Edit Chapter' : parentChapter ? 'New Subchapter' : 'New Chapter'}
          </h2>
          <button className="close-btn" onClick={onCancel}>✕</button>
        </div>
        
        <div className="editor-content">
          <div className="form-group">
            <label htmlFor="chapter-title">Chapter Title</label>
            <input
              id="chapter-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter chapter title..."
            />
          </div>

          <div className="form-group">
            <label>Chapter Content</label>
            <textarea
              value={content}
              onChange={handleContentChange}
              placeholder="Write your chapter content here..."
              className="content-textarea"
              rows={15}
            />
          </div>

          <div className="shortcuts-help">
            <h4>Custom Shortcuts:</h4>
            <ul>
              <li><code>-text-</code> → Strikethrough</li>
              <li><code>**text**</code> → Bold</li>
              <li><code>*text*</code> → Italic</li>
              <li><code>#text</code> → Heading 1</li>
            </ul>
          </div>
        </div>

        <div className="editor-actions">
          <div className="left-actions">
            {chapter && (
              <button className="btn-delete" onClick={handleDelete}>
                Delete Chapter
              </button>
            )}
          </div>
          <div className="right-actions">
            <button className="btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button 
              className="btn-save" 
              onClick={handleSave}
              disabled={!title.trim() || saving}
            >
              {saving ? 'Saving...' : 'Save Chapter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
