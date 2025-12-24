import { hyphenateSync } from 'hyphen/en';

// Apply hyphenation to HTML content - the hyphen library automatically skips HTML tags
// IMPORTANT: We EXCLUDE karaoke blocks themselves from this page-level hyphenation.
// Karaoke text has its OWN controlled hyphenation pipeline (using the same library)
// so that highlighting logic can stay in sync with where soft hyphens are inserted.
const applyHyphenationToHTML = (html) => {
  if (!html) return html;
  try {
    // Check if content contains karaoke blocks (both data-karaoke-block and data-karaoke attributes)
    if (html.includes('data-karaoke-block') || html.includes('data-karaoke')) {
      // Match karaoke blocks - can be div with data-karaoke-block or any element with data-karaoke
      const karaokeBlockRegex = /(<[^>]*(?:data-karaoke-block|data-karaoke)[^>]*>[\s\S]*?<\/[^>]+>)/gi;
      const karaokeBlocks = [];
      let match;
      
      // Find all karaoke blocks
      while ((match = karaokeBlockRegex.exec(html)) !== null) {
        karaokeBlocks.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0]
        });
      }
      
      // If karaoke blocks found, process in segments
      if (karaokeBlocks.length > 0) {
        let result = '';
        let lastIndex = 0;
        
        for (let i = 0; i < karaokeBlocks.length; i++) {
          const block = karaokeBlocks[i];
          // Hyphenate content before this karaoke block
          const beforeContent = html.slice(lastIndex, block.start);
          if (beforeContent) {
            result += hyphenateSync(beforeContent);
          }
          // Add karaoke block without hyphenation
          result += block.content;
          lastIndex = block.end;
        }
        // Hyphenate remaining content after last karaoke block
        if (lastIndex < html.length) {
          result += hyphenateSync(html.slice(lastIndex));
        }
        return result;
      }
    }
    
    // No karaoke blocks, hyphenate entire content
    return hyphenateSync(html);
  } catch (error) {
    console.warn('[Hyphenation] Error applying hyphenation:', error);
    return html;
  }
};

/**
 * Calculate totalPages for each chapter
 */
export const calculateTotalPagesPerChapter = (newPages) => {
  const pagesByChapter = {};
  newPages.forEach(page => {
    // Skip cover page in chapter grouping
    if (page.isCover) return;
    const key = `${page.chapterIndex}`;
    if (!pagesByChapter[key]) pagesByChapter[key] = [];
    pagesByChapter[key].push(page);
  });
  
  newPages.forEach(page => {
    // Special pages don't need totalPages calculation
    if (page.isCover || page.isFirstPage) return;
    const key = `${page.chapterIndex}`;
    page.totalPages = pagesByChapter[key]?.length || 1;
  });
  
  return newPages;
};

/**
 * Verify and fix page order: first page should be first, then cover, then regular chapters
 */
export const verifyAndFixPageOrder = (newPages) => {
  // Verify first page is at position 0 (if it exists)
  const firstPageIndex = newPages.findIndex(p => p?.isFirstPage);
  const coverPageIndex = newPages.findIndex(p => p?.isCover && !p?.isFirstPage);
  
  if (firstPageIndex !== -1 && firstPageIndex !== 0) {
    console.warn('[PageOrder] First page is not at position 0! Moving it.', { firstPageIndex });
    const firstPage = newPages[firstPageIndex];
    newPages.splice(firstPageIndex, 1);
    newPages.unshift(firstPage);
  }
  
  // Verify cover page is after first page (if both exist)
  if (coverPageIndex !== -1 && firstPageIndex !== -1 && coverPageIndex !== 1) {
    console.warn('[PageOrder] Cover page is not after first page! Moving it.', { coverPageIndex, firstPageIndex });
    const coverPage = newPages[coverPageIndex];
    newPages.splice(coverPageIndex, 1);
    // Insert after first page (position 1)
    newPages.splice(1, 0, coverPage);
  } else if (coverPageIndex !== -1 && firstPageIndex === -1 && coverPageIndex !== 0) {
    // No first page, cover should be first
    console.warn('[PageOrder] Cover page is not first! Moving it.', { coverPageIndex });
    const coverPage = newPages[coverPageIndex];
    newPages.splice(coverPageIndex, 1);
    newPages.unshift(coverPage);
  }
  
  return newPages;
};

/**
 * Finalize pages: calculate totalPages and verify order
 */
export const finalizePages = (newPages) => {
  console.log('[PageOrder] Setting pages, total:', newPages.length);
  console.log('[PageOrder] First 5 pages:', newPages.slice(0, 5).map((p, i) => ({
    index: i,
    isFirstPage: p.isFirstPage,
    isCover: p.isCover,
    isVideo: p.isVideo,
    isEpigraph: p.isEpigraph,
    chapterIndex: p.chapterIndex,
    pageIndex: p.pageIndex,
    chapterId: p.chapterId
  })));
  
  const pagesWithTotals = calculateTotalPagesPerChapter(newPages);
  const orderedPages = verifyAndFixPageOrder(pagesWithTotals);
  
  return orderedPages;
};

/**
 * Apply hyphenation to all pages asynchronously after initial render
 */
export const applyHyphenationToPages = (newPages, setPages) => {
  const applyHyphenationBatch = () => {
    setPages(prevPages => {
      console.log('[Hyphenation] Applying hyphenation, prevPages.length:', prevPages.length, 'newPages.length:', newPages.length);
      
      // Only apply if pages haven't changed (avoid race conditions)
      if (prevPages.length !== newPages.length) {
        console.warn('[Hyphenation] Page count mismatch, skipping hyphenation', {
          prevLength: prevPages.length,
          newLength: newPages.length
        });
        return prevPages;
      }
      
      // Verify page order hasn't changed
      const orderChanged = prevPages.some((page, index) => {
        const expectedPage = newPages[index];
        return !expectedPage || page.chapterIndex !== expectedPage.chapterIndex || page.pageIndex !== expectedPage.pageIndex;
      });
      
      if (orderChanged) {
        console.warn('[Hyphenation] Page order changed, skipping hyphenation');
        return prevPages;
      }
      
      // Preserve the exact order of pages - map maintains order
      const hyphenatedPages = prevPages.map((page, index) => {
        if (page.isCover || page.isEpigraph || page.isVideo) {
          return page; // Skip hyphenation for special pages
        }
        // Only apply if not already hyphenated (check for soft hyphens)
        if (page.content.includes('\u00AD')) {
          return page; // Already hyphenated
        }
        return {
          ...page,
          content: applyHyphenationToHTML(page.content)
        };
      });
      
      console.log('[Hyphenation] Hyphenation complete, returning', hyphenatedPages.length, 'pages');
      return hyphenatedPages;
    });
  };
  
  // Apply hyphenation asynchronously to avoid blocking initial render
  if (window.requestIdleCallback) {
    requestIdleCallback(applyHyphenationBatch, { timeout: 500 });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(applyHyphenationBatch, 100);
  }
};

/**
 * Restore initial position immediately when pages are calculated
 */
export const restoreInitialPosition = (newPages, initialPosition, setters) => {
  const { setCurrentChapterIndex, setCurrentPageIndex, setIsInitializing } = setters;
  
  if (newPages.length === 0) return;
  
  // Find the first page (isFirstPage) - this is the actual first page of content
  const firstPage = newPages.find(p => p.isFirstPage);
  // Find the cover page as fallback
  const coverPage = newPages.find(p => p.isCover && !p.isFirstPage);
  
  if (initialPosition) {
    const { chapterId, pageIndex } = initialPosition;
    // Only restore position if it's NOT the cover page
    if (chapterId !== null) {
      const page = newPages.find(
        (p) => !p.isCover && p.chapterId === chapterId && p.pageIndex === (pageIndex || 0)
      );
      if (page) {
        setCurrentChapterIndex(page.chapterIndex);
        setCurrentPageIndex(page.pageIndex);
      } else if (firstPage) {
        // Fallback to first page if saved position not found
        setCurrentChapterIndex(firstPage.chapterIndex);
        setCurrentPageIndex(firstPage.pageIndex);
      } else if (coverPage) {
        // Fallback to cover page if no first page exists
        setCurrentChapterIndex(coverPage.chapterIndex);
        setCurrentPageIndex(coverPage.pageIndex);
      }
    } else if (firstPage) {
      // No chapterId means start at first page
      setCurrentChapterIndex(firstPage.chapterIndex);
      setCurrentPageIndex(firstPage.pageIndex);
    } else if (coverPage) {
      // Fallback to cover page if no first page exists
      setCurrentChapterIndex(coverPage.chapterIndex);
      setCurrentPageIndex(coverPage.pageIndex);
    }
  } else if (firstPage) {
    // No saved position, start at first page (not cover page)
    setCurrentChapterIndex(firstPage.chapterIndex);
    setCurrentPageIndex(firstPage.pageIndex);
  } else if (coverPage) {
    // Fallback to cover page if no first page exists
    setCurrentChapterIndex(coverPage.chapterIndex);
    setCurrentPageIndex(coverPage.pageIndex);
  }
  
  // Mark initialization as complete
  setIsInitializing(false);
};

