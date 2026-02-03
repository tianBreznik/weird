# Polish Notes

## Shared Page (Chapter End + Subchapter Start) — TOC Metadata

### What is a “shared page”?
When a chapter’s last page has enough free space (≥45% of the content area), the first subchapter is flowed onto that same page instead of starting a new one. The result is one page that contains both the end of the chapter and the start of the first subchapter. That page is the “shared page.”

### How it’s labeled for the TOC
The shared page is created when we **push** during subchapter processing (we’re in the subchapter block when we call `pushPage`). So without extra logic, that page would be created with `blockMeta` set to the **subchapter**. That would make the page “owned” by the subchapter for metadata (e.g. `subchapterId`, TOC “first page of subchapter”).

**Implemented behavior:** We treat that first shared page as the **chapter’s last page** for metadata. In `usePagePagination.js`, when we skip the chapter push to allow subchapter flow (`skipPushForFlow`), we set `nextPushIsSharedPage = true`. On the next `pushPage` call (from the subchapter block), we use the **chapter** block’s metadata (e.g. `subchapterId: null`) instead of the subchapter’s, so the page appears in the TOC as the chapter’s last page and the subchapter’s first page is the following page.

### Content vs metadata
- **HTML content** is correct either way: the page always shows chapter end content plus subchapter start content (heading + text).
- **Metadata** (which block “owns” the page for TOC/navigation) is what we adjust: we assign the shared page to the chapter so that “chapter ends here” and “subchapter starts on next page” match user expectations in the TOC.

### If we ever wanted the opposite
If we ever needed that first shared page to be labeled as the **subchapter’s first page** in the TOC (e.g. “subchapter starts on this page”), we’d remove or invert the `nextPushIsSharedPage` / `metaToUse` logic so the page keeps the subchapter’s `blockMeta` when it’s the shared page. Right now the design is: shared page = chapter’s last page for TOC.

---

## Code Quality: Redundant Variables and Constants

### Problem Summary
The codebase has accumulated many redundant local variables and duplicated logic due to incremental, reactive bug fixes rather than systematic design. This makes the code harder to maintain and creates inconsistencies.

### Specific Issues

#### 1. No Shared Constants
Values like `48px` (padding), `540px` (calculated height), `1.35rem` (font size), and bottom margins (`20`, `24`, `32`) are defined locally in multiple functions instead of as module-level constants:

- `bodyPaddingTop = 48` and `bodyPaddingBottom = 48` appear in at least 3 places (`paginationHelpers.js`, `karaokePagination.js`, inline calculations)
- `BOTTOM_MARGIN_NO_FOOTNOTES` is defined locally in `paginationHelpers.js`, `elementPagination.js`, and `pageCreation.js`
- Font sizes (`1.35rem`, `1.4rem`) are defined as `desktopFontSize` in 4+ different functions
- Line heights (`1.62`, `1.35`) are duplicated similarly

#### 2. Duplicated Calculations
The same calculations are repeated inline instead of extracted into shared helper functions:

- `pageHeight - 48 - 48` appears inline multiple times
- Font size/line height logic (`isDesktop ? '1.35rem' : '1.3rem'`) is duplicated in every function that needs it
- Measurement container creation logic is copied in multiple places (`splitTextAtWordBoundary`, `splitTextAtSentenceBoundary`, etc.)

#### 3. Incremental Patching Pattern
Each bug fix added new local variables without refactoring:

- When `splitTextAtWordBoundary` needed consistent measurement, local variables were added instead of extracting shared helpers
- This creates a pattern where similar logic is duplicated with slight variations

#### 4. Inconsistent Values
Different functions use slightly different values for the same purpose:

- `checkContentWithFootnotesFits` uses `1.4rem` while most other functions use `1.35rem`
- This suggests values were changed in one place but not standardized across the codebase

### Root Cause
The codebase appears to have been modified reactively over time. Each bug fix added local variables, duplicating logic instead of refactoring to shared constants and helpers. This is common in production codebases but leads to:

- **Hard-to-maintain code**: Changing a value requires updates in many places
- **Bug-prone inconsistencies**: Like the `1.4rem` vs `1.35rem` discrepancy
- **Difficulty understanding "source of truth"**: It's unclear which values are canonical

### Recommended Refactoring Approach

1. **Create a constants file/module** with all magic numbers:
   - Page dimensions (`636px`, `540px`, `48px` padding)
   - Font sizes (`1.35rem` desktop, `1.3rem` mobile)
   - Line heights (`1.62` desktop, `1.35` mobile)
   - Bottom margins (`20px` first page, `24px` desktop non-first, `32px` mobile/karaoke)

2. **Extract shared helper functions** for common operations:
   - Measurement container creation
   - Font style application
   - Height calculations

3. **Standardize measurement container creation** to use consistent width/parent container logic

4. **Remove local variable definitions** that duplicate constants

### Files Affected
- `src/utils/paginationHelpers.js` (multiple functions)
- `src/utils/elementPagination.js` (multiple functions)
- `src/utils/karaokePagination.js`
- `src/utils/pageCreation.js`

