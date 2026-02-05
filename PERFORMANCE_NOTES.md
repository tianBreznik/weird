# Performance – issues that can get worse over time

Problems that can cause lag or extra work the longer the app stays open.

---

## 1. **tiptapExtensions.js – InlineImage** (fixed)

- **Issue:** Each inline image in the editor added a `setInterval(..., 100)` and a `MutationObserver` that were never cleaned up when the node was removed. So every inline image = one interval running every 100ms for the life of the page.
- **Fix:** Add a `destroy()` to the InlineImage node view that clears the interval and disconnects the observer.

---

## 2. **tiptapExtensions.js – CustomImage** (fixed)

- **Issue:** Block images register `editor.on('selectionUpdate', checkSelection)` and (on mobile) a `setInterval(checkSelection, 300)`. The interval was only cleared after 60s via `setTimeout`; if the image node was destroyed before that, the interval and listener were never removed.
- **Fix:** Add a `destroy()` that clears the poll interval and calls `editor.off('selectionUpdate', checkSelection)`.

---

## 3. **DesktopPageReader – page element cache** (fixed)

- **Issue:** `pageElementCacheRef` stores DOM nodes. If React re-creates a page (e.g. after an update), the cache can keep references to detached nodes. We then call `getBoundingClientRect()` on detached nodes and never refresh the cache.
- **Fix:** When using a cached element, check `document.contains(pageElement)`; if false, delete it from the cache and re-query (or use `getElementById` again).

---

## 4. **ChapterEditor – pollSelection** (optional)

- **Issue:** While the editor is open, a `requestAnimationFrame` loop runs every frame to poll selection and refresh the toolbar. That’s continuous work for as long as the editor is mounted.
- **Note:** Only runs when the editor is open. Can be throttled (e.g. run every 2nd frame or every 100ms) if editor-open performance is an issue.

---

## 5. **DitheredLoader**

- When the loader is visible, two rAF loops run (noise + sparkles). They stop when `active` is false. No unbounded growth; only active during loading.

---

## 6. **FeatherCursor**

- Already addressed: cursor:none no longer applied to every hovered element; particle count capped; dampening loop has a frame cap.

---

## 7. **PageReader / useKaraokePlayer**

- Per-slice click/touch listeners are guarded by `slice.dataset.clickHandlerAdded` so we don’t add duplicates. IntersectionObserver is disconnected in cleanup. No obvious accumulation.
