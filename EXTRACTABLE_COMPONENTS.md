# Extractable Components from calculatePages

## Overview
This document lists all components (functions, utilities, managers) that can be extracted from the `calculatePages` function.

---

## 1. **Initialization & Setup Components**

### 1.1. `initializePaginationContext(chapters)`
**Lines:** ~445-483  
**Purpose:** Set up initial context for pagination  
**Returns:** Context object with:
- `viewport`, `viewportHeight`, `safeInsetTop`, `safeInsetBottom`
- `sortedChapters` (sorted: first page → cover → regular)
- `allFootnotes`, `footnoteContentToNumber` Map
- `isDesktop`, `pageWidth`, `pageHeight`

**Status:** ✅ Can extract

---

### 1.2. `createMeasurementEnvironment(isDesktop, pageWidth, pageHeight)`
**Lines:** ~518-670  
**Purpose:** Create measurement container and helpers  
**Returns:** Object with:
- `measure` (measurement container)
- `contentWidth`
- `applyParagraphStylesToContainer` function

**Status:** ✅ Partially extracted (`createMeasureContainer` already in helpers)

---

## 2. **Chapter Processing Components**

### 2.1. `buildChapterContentBlocks(chapter)`
**Lines:** ~702-788  
**Purpose:** Build array of content blocks from chapter + subchapters  
**Returns:** Array of content blocks with:
- `type` ('chapter' or 'subchapter')
- `title`, `content`, `epigraph`
- `chapterId`, `subchapterId`
- `includeChapterTitle` flag

**Status:** ✅ Can extract

---

### 2.2. `processContentBlock(block, chapter, context)`
**Lines:** ~2060-2787  
**Purpose:** Process a single content block (epigraph, HTML, pagination, videos)  
**Contains:**
- Epigraph page creation
- HTML content processing
- Image loading
- Element pagination loop
- Video page creation

**Status:** ⚠️ Large (~700 lines), but self-contained

**Sub-components:**
- `createEpigraphPage(block, chapter, chapterIndex, chapterPageIndex)` - Lines ~2063-2095
- `processHTMLContent(block, isDesktop)` - Lines ~2097-2186
- `extractVideosFromContent(htmlContent)` - Lines ~2115-2147
- `paginateElements(elements, block, chapter, context)` - Lines ~2200-2756
- `createVideoPages(videoElements, chapter, chapterIndex, chapterPageIndex)` - Lines ~2763-2784

---

## 3. **Element Pagination Components**

### 3.1. `paginateElement(element, context)`
**Lines:** ~2200-2756  
**Purpose:** Paginate a single element (fit, split, or push to next page)  
**Returns:** Result object indicating what happened

**Status:** ✅ Can extract (large but focused)

**Sub-components:**
- `calculateAvailableHeight(element, context)` - Lines ~2238-2262
- `checkElementFits(element, context)` - Lines ~2264-2290
- `handleAtomicElement(element, context)` - Lines ~2338-2352
- `handleSplittableElement(element, context)` - Lines ~2353-2754

---

### 3.2. `handleKaraokeElement(element, blockMeta, context)`
**Lines:** ~1948-2058  
**Purpose:** Handle karaoke element pagination (splits across pages)  
**Returns:** `true` if handled, `false` otherwise

**Status:** ✅ Can extract (~110 lines)

**Dependencies:**
- `assignLetterTimingsToChars` ✅ (already extracted)
- `splitTextAtWordBoundary` ✅ (already extracted)
- `measureFootnotesHeight` ✅ (already extracted)
- `extractFootnotesFromContent` ✅ (already extracted)

---

### 3.3. `splitElementIfNeeded(element, remainingHeight, context)`
**Lines:** ~2445-2573 (within handleSplittableElement)  
**Purpose:** Split element at sentence/word boundaries if needed  
**Returns:** Split result or null

**Status:** ✅ Can extract

**Uses:**
- `splitTextAtSentenceBoundary` ✅ (already extracted)
- `splitTextAtWordBoundary` ✅ (already extracted)

---

## 4. **Page Creation Components**

### 4.1. `createPageFromElements(elements, blockMeta, chapter, context)`
**Lines:** ~1340-1506 (`pushPage` function)  
**Purpose:** Create a page object from accumulated elements  
**Returns:** Page object

**Status:** ✅ Can extract (~170 lines)

**Contains:**
- Empty paragraph removal (for first page)
- Footnote extraction and replacement
- Footnote section rendering
- Content wrapper creation
- Background video detection
- Page object creation

**Sub-components:**
- `removeEmptyParagraphs(elements, isStandaloneFirstPage)` - Lines ~1348-1403
- `processFootnotesInContent(content, footnoteContentToNumber, allFootnotes)` - Lines ~1405-1428
- `calculatePagePadding(footnotes, hasKaraoke, isStandaloneFirstPage)` - Lines ~1440-1464
- `createPageObject(blockMeta, chapter, content, footnotes, context)` - Lines ~1475-1489

---

### 4.2. `initializeNewPage(initialHeading, context)`
**Lines:** ~794-800 (`startNewPage` function)  
**Purpose:** Reset page state for new page  
**Returns:** Updated context

**Status:** ✅ Can extract (simple)

---

## 5. **Content Processing Components**

### 5.1. `processHTMLContent(htmlContent, isDesktop)`
**Lines:** ~2097-2186  
**Purpose:** Process HTML content (replace dashes, extract videos, load images)  
**Returns:** Processed HTML and video elements

**Status:** ✅ Can extract

**Sub-components:**
- `extractVideosFromContent(htmlContent)` - Lines ~2115-2147
- `replaceLongDashes(htmlContent)` - Lines ~2149-2151
- `waitForImagesToLoad(contentDiv)` - Lines ~2160-2185

---

### 5.2. `extractBackgroundVideos(contentBlocks)`
**Lines:** ~773-787  
**Purpose:** Extract background videos with targetPage from all blocks  
**Returns:** Map of pageNumber → videoSrc

**Status:** ✅ Can extract

---

## 6. **Post-Processing Components**

### 6.1. `finalizePages(newPages)`
**Lines:** ~2790-2846  
**Purpose:** Finalize pages (calculate totalPages, verify order)  
**Returns:** Finalized pages array

**Status:** ✅ Can extract

**Sub-components:**
- `calculateTotalPagesPerChapter(newPages)` - Lines ~2792-2807
- `verifyAndFixPageOrder(newPages)` - Lines ~2809-2846

---

### 6.2. `applyHyphenationToPages(pages, setPages)`
**Lines:** ~2852-2905  
**Purpose:** Apply hyphenation to all pages asynchronously  
**Returns:** Promise

**Status:** ✅ Can extract

**Uses:**
- `applyHyphenationToHTML` ✅ (already extracted)

---

### 6.3. `restoreInitialPosition(newPages, initialPosition, setters)`
**Lines:** ~2907-2954  
**Purpose:** Restore user's initial reading position  
**Returns:** void

**Status:** ✅ Can extract

**Setters:**
- `setCurrentChapterIndex`
- `setCurrentPageIndex`
- `setIsInitializing`

---

## 7. **State Management Components**

### 7.1. `PageStateManager`
**Purpose:** Manage page state during pagination  
**State:**
- `currentPageElements` - Array of HTML strings
- `currentPageFootnotes` - Set of footnote numbers
- `pageHasHeading` - Boolean
- `chapterPageIndex` - Number

**Methods:**
- `addElement(element, footnotes)`
- `reset(initialHeading)`
- `hasContent()`

**Status:** ✅ Can extract as class or object

---

### 7.2. `FootnoteManager`
**Purpose:** Centralize all footnote operations  
**State:**
- `allFootnotes` - Array
- `footnoteContentToNumber` - Map

**Methods:**
- `extractFromContent(htmlContent)` - Uses `extractFootnotesFromContent`
- `measureHeight(footnoteNumbers, container)` - Uses `measureFootnotesHeight`
- `getGlobalNumber(content)`
- `processInContent(content)` - Replace `^[content]` with superscripts

**Status:** ✅ Can extract as class or object

---

## 8. **Utility Components**

### 8.1. `sortChapters(chapters)`
**Lines:** ~457-466  
**Purpose:** Sort chapters (first page → cover → regular)  
**Returns:** Sorted chapters array

**Status:** ✅ Can extract (simple)

---

### 8.2. `determineChapterIndex(chapter, chapterIdx)`
**Lines:** ~683-691  
**Purpose:** Determine chapterIndex (special indices for first page/cover)  
**Returns:** chapterIndex number

**Status:** ✅ Can extract (simple)

---

### 8.3. `createEmptyPage(chapter, chapterIndex, chapterPageIndex)`
**Lines:** ~747-761  
**Purpose:** Create empty page for special pages (first page, cover)  
**Returns:** Page object

**Status:** ✅ Can extract (simple)

---

### 8.4. `createEpigraphPage(block, chapter, chapterIndex, chapterPageIndex)`
**Lines:** ~2075-2095  
**Purpose:** Create epigraph page  
**Returns:** Page object

**Status:** ✅ Can extract (simple)

---

### 8.5. `createVideoPage(video, chapter, chapterIndex, chapterPageIndex)`
**Lines:** ~2766-2782  
**Purpose:** Create video page  
**Returns:** Page object

**Status:** ✅ Can extract (simple)

---

## Summary

### Already Extracted ✅
- `normalizeWord`
- `tokenizeText`
- `assignLetterTimingsToChars`
- `applyHyphenationToHTML`
- `createMeasureContainer`
- `applyParagraphStylesToContainer`
- `extractFootnotesFromContent`
- `measureFootnotesHeight`
- `checkContentWithFootnotesFits`
- `isAtomicElement`
- `splitTextAtWordBoundary`
- `splitTextAtSentenceBoundary`

### Ready to Extract (12 components)
1. `initializePaginationContext`
2. `buildChapterContentBlocks`
3. `processContentBlock` (large)
4. `paginateElement` (large)
5. `handleKaraokeElement`
6. `createPageFromElements`
7. `initializeNewPage`
8. `processHTMLContent`
9. `finalizePages`
10. `applyHyphenationToPages`
11. `restoreInitialPosition`
12. `sortChapters` + other small utilities

### Consider as Classes/Objects (2)
1. `PageStateManager` - Manage page state
2. `FootnoteManager` - Centralize footnote operations

---

## Recommended Extraction Order

1. **Small utilities first** (sortChapters, determineChapterIndex, createEmptyPage, etc.)
2. **Page creation** (createPageFromElements, initializeNewPage)
3. **Content processing** (processHTMLContent, extractBackgroundVideos)
4. **Element pagination** (paginateElement, handleKaraokeElement)
5. **Post-processing** (finalizePages, applyHyphenationToPages, restoreInitialPosition)
6. **Main orchestration** (create usePagePagination hook)

