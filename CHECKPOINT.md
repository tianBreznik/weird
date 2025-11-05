# Project Checkpoint - Current State

## Session Snapshot (UI/UX + Editor fixes)

- Chapter header actions reworked and positioned on the LEFT of titles, with layout order: Edit • Add • Del • Drag-handle. Titles remain centered and unaffected.
- Action container anchors flush to the left of the header (`right: 100%` with a small gutter), so actions never overlap long titles.
- Bottom-right global buttons now appear side by side (Editor Mode | + Add New Chapter) instead of stacked; still fixed to bottom-right.
- Isolated inline chapter action buttons now render labels via SVG text to fully decouple font rendering and prevent hover-induced font changes. Width is computed from the actual text (getComputedTextLength) with padding so labels never clip. Size tuned to small/compact: ~13px text, 18px SVG height, minimal padding.
- Subchapter header alignment preserved (counter-acts parent indent) so actions/titles line up consistently for chapters and subchapters.

> Tip: If you want actions on the RIGHT again later, only the container alignment in `Chapter.css` and the JSX order in `Chapter.jsx` need flipping.

## ✅ Completed Features

### Core Functionality
- ✅ Book writing website with table of contents
- ✅ Expandable chapters with inline content display
- ✅ Editor mode (device ID whitelisting)
- ✅ Firestore integration for chapters and subchapters
- ✅ Drag-and-drop reordering for chapters and subchapters
- ✅ Anonymous bookmarking (localStorage) - saves last reading position

### Editor Features
- ✅ Rich text editor with contentEditable
- ✅ Toolbar with formatting buttons:
  - Bold, Italic, Strikethrough, Underline
  - Text color picker (applies immediately)
  - Highlight color picker (H-swatch, click to apply)
  - Align left/center/right
- ✅ Real-time formatting (WYSIWYG)
- ✅ Keyboard shortcuts (Cmd/Ctrl+B/I/U/L/E/R)
- ✅ Autosave status indicator
- ✅ Side panel editor layout (doesn't cover content)

### Media Support
- ✅ Image upload (base64, no Firebase Storage billing)
  - Automatic compression/resizing (max 1200x1200px)
  - JPEG conversion with quality 0.8
  - Stored directly in Firestore contentHtml
- ✅ Video embedding (YouTube/Vimeo)
  - YouTube uses `youtube-nocookie.com` for minimal branding
  - Paste URL or embed code
  - Responsive iframe display

### Styling
- ✅ Academic article aesthetic (Times New Roman font)
- ✅ Vintage Windows XP-style toolbar buttons
- ✅ Full-bleed editor design
- ✅ Responsive images and videos

## 📁 Current File Structure

```
src/
├── components/
│   ├── Chapter.jsx              # Chapter display component
│   ├── Chapter.css              # Chapter styling
│   ├── ChapterEditor.jsx         # Main editor component
│   ├── ChapterEditor.css        # Editor styling
│   ├── DraggableChapter.jsx     # Drag wrapper for chapters
│   └── SortableSubchapters.jsx   # Sortable subchapter list
├── pages/
│   └── EditorSetup.jsx          # Device ID setup modal
├── services/
│   ├── firestore.js             # Firestore CRUD operations
│   └── storage.js               # Image base64 conversion (no Firebase Storage)
├── hooks/
│   └── useEditorMode.js         # Editor mode hook
├── utils/
│   ├── deviceAuth.js            # Device ID whitelisting
│   ├── bookmark.js              # Bookmark save/load
│   └── markdown.js              # Custom markdown rendering
├── firebase.js                  # Firebase initialization
└── App.jsx                      # Main app component
```

## 🔧 Configuration

### Environment Variables (.env.local)
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=overstimulata-dc860
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Firebase Setup
- Firestore database with nested structure:
  - `/books/{bookId}/chapters/{chapterId}`
  - `/books/{bookId}/chapters/{chapterId}/subchapters/{subchapterId}`
- No Firebase Storage enabled (using base64 for images)
- No Firebase Auth enabled (using device ID whitelisting)

## 🎨 Current Design Notes

- **Editor**: Side panel (620px wide), full-height, no rounded corners
- **Toolbar**: Full-bleed, vintage Windows XP style buttons
- **Buttons**: Semi-transparent with solid borders, darken when pressed
- **Colors**: Background #fafafa for toolbar, white for content area
- **Typography**: Times New Roman throughout

## 🚧 TODO / Future Features

### Video Hosting (Pending Decision)
- [ ] Decide on video hosting solution:
  - Option 1: Cloudflare R2 (free tier: 10GB storage)
  - Option 2: Firebase Storage (pay per usage)
  - Option 3: Self-hosted solution
- [ ] Implement chosen video hosting solution
- [ ] Custom HTML5 video player for unbranded videos

### Potential Enhancements
- [ ] Karaoke MP3 feature (audio sync with text highlighting)
- [ ] Custom markdown shortcuts (typing `**bold**` applies formatting)
- [ ] Image drag-and-drop directly into editor
- [ ] Video upload functionality (once hosting decided)
- [ ] Chapter export/import
- [ ] Search functionality

## 📝 Notes

- Images are stored as base64 data URIs in Firestore (no Storage billing)
- Videos currently use YouTube/Vimeo embeds (has platform branding)
- Bookmark uses localStorage (anonymous, no auth required)
- Editor mode requires device ID whitelisting (no Firebase Auth)
- Drag handles only visible in editor mode

## 🔄 Last Updated
Checkpoint created: Current session

