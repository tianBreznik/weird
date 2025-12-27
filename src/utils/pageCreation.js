import { renderFootnotesSection } from './footnotes';
import { measureFootnotesHeight } from './paginationHelpers';

/**
 * Remove empty paragraphs from the start of elements array
 * Used for standalone first page to fit more content on small screens
 */
export const removeEmptyParagraphs = (elements, isStandaloneFirstPage) => {
  if (!isStandaloneFirstPage) return elements;
  
  const deviceScreenHeight = typeof window !== 'undefined' && window.screen ? window.screen.height : 1000;
  const maxRemovals = deviceScreenHeight <= 700 ? 5 : deviceScreenHeight <= 850 ? 1 : 0;
  const initialLength = elements.length;
  let removedFromArray = 0;
  
  console.log('[removeEmptyParagraphs] Device screen height detected:', deviceScreenHeight, 'px, maxRemovals:', maxRemovals);
  
  const filteredElements = [...elements];
  
  while (removedFromArray < maxRemovals && filteredElements.length > 0) {
    const firstElement = filteredElements[0];
    
    // Create a temporary DOM to check if it's an empty paragraph
    const tempCheckDiv = document.createElement('div');
    tempCheckDiv.innerHTML = firstElement;
    const firstParagraph = tempCheckDiv.querySelector('p:first-child');
    
    // If first element is a paragraph, check if it's empty
    if (firstParagraph || firstElement.trim().startsWith('<p')) {
      const checkPara = firstParagraph || tempCheckDiv.querySelector('p');
      if (checkPara) {
        const textContent = checkPara.textContent || '';
        const innerHTML = checkPara.innerHTML || '';
        const hasOnlyBr = checkPara.children.length === 1 && checkPara.children[0].tagName === 'BR';
        const hasOnlyWhitespace = /^[\s\n\r]*$/.test(innerHTML);
        const isEmpty = (textContent.trim().length === 0) && (checkPara.children.length === 0 || hasOnlyBr || hasOnlyWhitespace);
        
        if (isEmpty) {
          filteredElements.shift();
          removedFromArray++;
          console.log('[removeEmptyParagraphs] Removed empty paragraph, removed:', removedFromArray, 'remaining elements:', filteredElements.length);
        } else {
          break;
        }
      } else {
        break;
      }
    } else {
      break;
    }
  }
  
  if (removedFromArray > 0) {
    console.log('[removeEmptyParagraphs] Successfully removed', removedFromArray, 'empty paragraphs. Initial length:', initialLength, 'Final length:', filteredElements.length);
  }
  
  return filteredElements;
};

/**
 * Process footnotes in content: replace ^[content] with superscript numbers
 */
export const processFootnotesInContent = (content, footnoteContentToNumber, allFootnotes) => {
  const footnoteRegex = /\^\[([^\]]+)\]/g;
  const pageFootnotes = [];
  
  const processedContent = content.replace(footnoteRegex, (match, footnoteContent) => {
    const trimmedContent = footnoteContent.trim();
    const globalNumber = footnoteContentToNumber.get(trimmedContent);
    if (globalNumber) {
      // Find the full footnote data
      const footnote = allFootnotes.find(fn => fn.globalNumber === globalNumber);
      if (footnote && !pageFootnotes.find(fn => fn.globalNumber === globalNumber)) {
        pageFootnotes.push(footnote);
      }
      return `<sup class="footnote-ref" data-footnote-number="${globalNumber}">${globalNumber}</sup>`;
    }
    // Fallback: use local numbering if not found in global map
    return `<sup class="footnote-ref">?</sup>`;
  });
  
  // Sort footnotes by global number
  pageFootnotes.sort((a, b) => a.globalNumber - b.globalNumber);
  
  return { processedContent, pageFootnotes };
};

/**
 * Calculate page padding based on footnotes, karaoke, and page type
 * 
 * NOTE: This function uses 48px for non-first pages, but getAvailableHeight() in
 * paginationHelpers.js uses 32px. See the CRITICAL comment in paginationHelpers.js
 * for details about this intentional mismatch.
 */
export const calculatePagePadding = (pageFootnotes, currentPageFootnotes, hasKaraoke, isStandaloneFirstPage, measure, allFootnotes, isDesktop, pageWidth) => {
  // Footnotes are absolutely positioned at bottom of page-body
  // Content needs padding-bottom to reserve space for footnotes OR bottom margin
  const footnotesHeight = pageFootnotes.length > 0 
    ? measureFootnotesHeight(currentPageFootnotes, measure.body, allFootnotes, isDesktop, pageWidth)
    : 0;
  
  // Standard bottom margin when there are no footnotes (for consistent page spacing)
  // CRITICAL: ONLY standalone first page uses smaller bottom margin (20px) to allow text to sit lower
  // 
  // NOTE: This uses 48px, but getAvailableHeight() uses 32px for calculations.
  // This mismatch was present in the original code and is preserved to maintain exact pagination behavior.
  // The algorithm calculates with 32px (more conservative), but pages use 48px padding (more space).
  const BOTTOM_MARGIN_NO_FOOTNOTES = isStandaloneFirstPage ? 20 : 48; // standalone first page: 20px, others: 48px (matches original pushPage)
  
  // Bottom margin for karaoke pages (reduced to fit more content)
  const BOTTOM_MARGIN_KARAOKE = 32; // Reduced from 48px to fit one more line
  
  // Always wrap content with padding-bottom: either for footnotes or for bottom margin
  // Use larger margin for karaoke pages
  const bottomMargin = hasKaraoke ? BOTTOM_MARGIN_KARAOKE : BOTTOM_MARGIN_NO_FOOTNOTES;
  const reservedSpace = pageFootnotes.length > 0 ? footnotesHeight : bottomMargin;
  
  return reservedSpace;
};

/**
 * Create a page object from accumulated elements
 */
export const createPageFromElements = ({
  elements,
  blockMeta,
  chapter,
  chapterIndex,
  chapterPageIndex,
  pageHasHeading,
  currentPageFootnotes,
  footnoteContentToNumber,
  allFootnotes,
  hasFieldNotes = false,
  measure,
  backgroundVideosByPage,
  isDesktop,
  pageWidth
}) => {
  if (!elements.length) return null;
  
  // CRITICAL: For standalone first page, remove empty paragraphs from the start BEFORE processing
  const isStandaloneFirstPage = chapter.isFirstPage && chapterPageIndex === 0;
  const filteredElements = removeEmptyParagraphs(elements, isStandaloneFirstPage);
  
  // Process footnotes in content: replace ^[content] with superscript numbers
  let processedContent = filteredElements.join('');
  const { processedContent: contentWithFootnotes, pageFootnotes } = processFootnotesInContent(
    processedContent,
    footnoteContentToNumber,
    allFootnotes
  );
  processedContent = contentWithFootnotes;
  
  // Add footnotes section at the bottom if there are any
  let footnotesHtml = '';
  if (pageFootnotes.length > 0) {
    footnotesHtml = renderFootnotesSection(pageFootnotes);
  }
  
  // Check if page has karaoke elements
  const hasKaraoke = filteredElements.some(el => 
    el.includes('karaoke-slice') || el.includes('data-karaoke')
  );
  
  // Calculate padding
  const reservedSpace = calculatePagePadding(
    pageFootnotes,
    currentPageFootnotes,
    hasKaraoke,
    isStandaloneFirstPage,
    measure,
    allFootnotes,
    isDesktop,
    pageWidth
  );
  
  const contentWrapper = `<div class="page-content-main" style="padding-bottom: ${reservedSpace}px;">${processedContent}</div>${footnotesHtml}`;
  
  // Check if this page should have a background video (1-indexed page number)
  const pageNumber = chapterPageIndex + 1; // Convert 0-indexed to 1-indexed
  const backgroundVideoSrc = backgroundVideosByPage?.get(pageNumber) || null;
  
  const newPage = {
    chapterIndex: chapterIndex,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subchapterId: blockMeta.subchapterId,
    subchapterTitle: blockMeta.type === 'subchapter' ? blockMeta.title : null,
    pageIndex: chapterPageIndex,
    hasHeading: pageHasHeading,
    hasFieldNotes: hasFieldNotes || false,
    content: contentWrapper,
    footnotes: pageFootnotes, // Store footnotes for this page
    backgroundVideo: backgroundVideoSrc,
    backgroundImageUrl: chapter.backgroundImageUrl || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
  };
  
  console.log('[PageOrder] Creating page from content:', {
    chapterIndex: newPage.chapterIndex,
    chapterId: newPage.chapterId,
    chapterTitle: newPage.chapterTitle,
    isCover: newPage.isCover,
    isFirstPage: newPage.isFirstPage,
    pageIndex: newPage.pageIndex,
    contentLength: newPage.content.length,
    hasContent: newPage.content.length > 0
  });
  
  return newPage;
};

/**
 * Initialize a new page (reset page state)
 */
export const initializeNewPage = (initialHeading, measure, pageState) => {
  pageState.currentPageElements = [];
  pageState.pageHasHeading = initialHeading;
  pageState.currentPageFootnotes = new Set();
  measure.pageContent.innerHTML = '';
  measure.setHeading(initialHeading);
};

