# calculatePages Function Analysis

## Overview
The `calculatePages` function is ~2500 lines and can be split into logical sections.

## Current Structure (Lines 445-2955)

### 1. **Initialization & Setup** (~225 lines: 445-670)
**Purpose:** Set up environment, sort chapters, create measurement tools

**Contains:**
- Viewport calculations
- Chapter sorting (first page → cover → regular)
- Footnote setup (getAllFootnotes, create map)
- Desktop/mobile detection
- Page dimensions (width/height)
- Measurement container creation (already extracted to `createMeasureContainer`)
- Content width calculation
- Helper function definitions (most already extracted)

**Can extract to:** `initializePaginationContext()`

---

### 2. **Chapter Processing Loop** (~2100 lines: 680-2788)
**Purpose:** Process each chapter and its content blocks

**Structure:**
```
for each chapter:
  - Determine chapterIndex
  - Build contentBlocks (chapter + subchapters)
  - Handle empty pages for special pages
  - Extract background videos
  
  for each contentBlock:
    - Create epigraph page (if exists)
    - Process HTML content (parse, load images)
    - Extract videos
    - Main element pagination loop
    - Create video pages
```

**Can split into:**
- **2a. Build Chapter Content Blocks** (~50 lines: 680-788)
  - Extract to: `buildChapterContentBlocks(chapter)`
  
- **2b. Process Content Block** (~2000 lines: 2060-2787)
  - Epigraph handling
  - HTML processing
  - Element pagination loop
  - Video page creation
  - Extract to: `processContentBlock(block, chapter, ...)`

---

### 3. **Element Pagination Logic** (~550 lines: 2200-2756)
**Purpose:** Paginate individual elements within a content block

**Contains:**
- Heading state management
- Background video handling
- Karaoke element handling
- Available height calculation
- Element fitting logic (atomic vs splittable)
- Text splitting (sentence/word boundaries)

**Can extract to:** `paginateElement(element, context, ...)`

**Key functions already extracted:**
- `splitTextAtSentenceBoundary` ✅
- `splitTextAtWordBoundary` ✅
- `isAtomicElement` ✅
- `handleKaraokeElement` (needs extraction - ~110 lines)

---

### 4. **Page Creation Functions** (~170 lines: 1340-1506)
**Purpose:** Create page objects from accumulated elements

**Contains:**
- `pushPage(blockMeta)` - Creates page from currentPageElements
- `startNewPage(initialHeading)` - Resets page state

**Can extract to:** `createPageFromElements(elements, context, ...)`

---

### 5. **Post-Processing** (~165 lines: 2790-2955)
**Purpose:** Finalize pages, apply hyphenation, restore position

**Contains:**
- Cleanup (measure.destroy())
- Calculate totalPages per chapter
- Verify page order
- Apply hyphenation asynchronously
- Restore initial position

**Can split into:**
- **5a. Finalize Pages** (~50 lines: 2790-2846)
  - Extract to: `finalizePages(newPages)`
  
- **5b. Apply Hyphenation** (~50 lines: 2852-2905)
  - Extract to: `applyHyphenationToPages(pages, setPages)`
  
- **5c. Restore Position** (~50 lines: 2907-2954)
  - Extract to: `restoreInitialPosition(newPages, initialPosition, setters)`

---

## Footnote Handling (Cross-Cutting Concern)

Footnotes appear in multiple places throughout the function:

### 1. **Initialization** (Lines 468-474)
- `getAllFootnotes(chapters)` - Get all footnotes globally
- `footnoteContentToNumber` Map - Map content to global numbers
- **Location:** Setup section
- **Status:** ✅ Already extracted to helpers (`extractFootnotesFromContent`)

### 2. **Helper Functions** (Lines 805-903)
- `extractFootnotesFromContent(htmlContent)` - Extract footnote refs from HTML
- `measureFootnotesHeight(footnoteNumbers, container)` - Measure footnote section height
- **Location:** Helper functions (inside chapter loop)
- **Status:** ✅ Already extracted to `paginationHelpers.js`

### 3. **Page State Tracking** (Line 792, 797)
- `currentPageFootnotes` - Set tracking footnotes on current page
- Reset in `startNewPage()`
- **Location:** Inside chapter processing loop
- **Status:** Part of page state management

### 4. **Element Pagination** (Lines 2240-2261, 2342, 2552, 2665, etc.)
- Extract footnotes from each element
- Calculate footnote height for available space
- Track footnotes as elements are added
- **Location:** Element pagination loop
- **Used in:** Available height calculation, element fitting logic

### 5. **Page Creation** (Lines 1405-1445)
- Extract footnotes from `currentPageElements`
- Replace `^[content]` with superscript numbers
- Render footnote section HTML
- Calculate footnote height for padding
- **Location:** `pushPage()` function
- **Status:** Needs extraction

### Footnote Flow:
```
1. Setup: Get all footnotes → Create map
2. During pagination: Extract from elements → Track in currentPageFootnotes → Calculate height
3. Page creation: Extract from content → Replace with superscripts → Render section → Calculate padding
```

**Recommendation:** Footnotes are a cross-cutting concern. Consider:
- Creating a `FootnoteManager` class/object to handle all footnote operations
- Or pass footnote context through function parameters
- Keep footnote helpers in `paginationHelpers.js` (already done)

---

## Proposed Extraction Plan

### Phase 1: Extract Helper Functions ✅ DONE
- All helper functions extracted to `paginationHelpers.js`
- Footnote helpers: `extractFootnotesFromContent`, `measureFootnotesHeight` ✅

### Phase 2: Extract Page Creation Logic
1. Extract `pushPage` → `createPageFromElements()`
   - **Includes:** Footnote extraction, replacement, rendering, height calculation
2. Extract `startNewPage` → `initializeNewPage()`
   - **Includes:** Reset `currentPageFootnotes`

### Phase 3: Extract Content Processing
1. Extract `buildChapterContentBlocks()` 
2. Extract `processContentBlock()` (large, but self-contained)
3. Extract `handleKaraokeElement()` (if not already extracted)

### Phase 4: Extract Element Pagination
1. Extract `paginateElement()` - the main element processing logic
   - **Includes:** Footnote extraction per element, height calculation

### Phase 5: Extract Post-Processing
1. Extract `finalizePages()`
2. Extract `applyHyphenationToPages()`
3. Extract `restoreInitialPosition()`

### Phase 6: Extract Main Function
1. Create `usePagePagination` hook
2. Wire everything together

---

## Benefits of This Approach

1. **Testability:** Each function can be tested independently
2. **Maintainability:** Clear separation of concerns
3. **Readability:** Main function becomes an orchestrator
4. **Reusability:** Functions can be reused elsewhere
5. **Debugging:** Easier to isolate issues

---

## Estimated Line Counts After Extraction

- Main `calculatePages`: ~200-300 lines (orchestration)
- Helper functions: ~800 lines (already extracted)
- Page creation: ~200 lines
- Content processing: ~500 lines
- Element pagination: ~400 lines
- Post-processing: ~200 lines

**Total:** ~2300 lines (same, but better organized)
