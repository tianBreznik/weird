/**
 * Handle field notes element pagination (one page per field notes block)
 * Returns the page object if handled, null otherwise
 */
export const handleFieldNotesElement = ({
  element,
  blockMeta,
  chapter,
  chapterIndex,
  chapterPageIndex,
  pushPage,
  startNewPage,
  getCurrentPageElements, // Add function to check current page elements
  chapterHasFieldNotes // Add flag to know if chapter only has field notes
}) => {
  // Check if this is a field notes block
  const isFieldNotes = element.hasAttribute('data-field-notes-block');
  if (!isFieldNotes) return null;
  
  const fieldNotesId = element.getAttribute('data-field-notes-id') || `field-notes-${Date.now()}`;
  const imageUrl = element.getAttribute('data-image-url') || 
                  element.querySelector('img')?.getAttribute('src') || 
                  '';
  
  if (!imageUrl) {
    console.warn('[FieldNotes] No image URL found for field notes block:', fieldNotesId);
    return null;
  }
  
  // Field notes blocks always create a new page (one page per block)
  // IMPORTANT: Only push current page if it has actual content
  // For field-notes-only chapters, we should NOT push any regular content pages
  // CRITICAL: Check for content BEFORE calling pushPage to prevent empty pages
  if (pushPage) {
    if (getCurrentPageElements) {
      const currentElements = getCurrentPageElements();
      // Only push if there's actual content (not empty)
      // This prevents creating empty pages before field notes pages
      if (currentElements.length > 0 && currentElements.some(el => el.trim().length > 0)) {
        // There's actual content, push it
        pushPage(blockMeta);
      }
      // If empty or only whitespace, don't push - field notes will be the only page(s)
    } else {
      // Fallback: if getCurrentPageElements not provided, pushPage will check internally
      // pushPage checks `if (!currentPageElements.length) return;` so it should be safe
      // But we're being extra cautious here
      pushPage(blockMeta);
    }
  }
  // If pushPage is not provided or getCurrentPageElements shows empty, skip pushing
  
  // Start a new page for the field notes (clears currentPageElements)
  // This ensures currentPageElements is empty after field notes processing
  if (startNewPage) {
    startNewPage(false);
  }
  
  // Ensure currentPageElements is definitely empty after starting new page
  // This is a safeguard in case anything else tries to add to it
  
  // Create a page object for the field notes
  // Escape imageUrl for use in inline style
  const escapedImageUrl = imageUrl.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const fieldNotesPage = {
    chapterId: chapter.id,
    chapterIndex: chapterIndex,
    pageIndex: chapterPageIndex,
    content: `<div class="field-notes-page" data-field-notes-id="${fieldNotesId}" data-image-url="${imageUrl}" style="background-image: url('${escapedImageUrl}');"></div>`,
    hasHeading: false,
    hasFieldNotes: true, // Flag to indicate this is a field notes page
    chapterTitle: chapter.title,
    subchapterTitle: blockMeta?.subchapterTitle || null,
    isCover: chapter.isCover || false,
    isFirstPage: chapter.isFirstPage || false,
    isVideo: false,
    isEpigraph: false,
    backgroundVideo: null,
  };
  
  return fieldNotesPage;
};

/**
 * Check if a chapter has field notes blocks
 */
export const hasFieldNotesBlocks = (htmlContent) => {
  if (!htmlContent) return false;
  return htmlContent.includes('data-field-notes-block');
};

