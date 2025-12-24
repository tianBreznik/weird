import { assignLetterTimingsToChars } from './paginationHelpers';
import { splitTextAtWordBoundary } from './paginationHelpers';
import { measureFootnotesHeight } from './paginationHelpers';
import { extractFootnotesFromContent } from './paginationHelpers';

/**
 * Handle karaoke element pagination (splits across pages)
 * Returns true if handled, false otherwise
 */
export const handleKaraokeElement = ({
  element,
  blockMeta,
  chapterIdx,
  newKaraokeSources,
  getCurrentPageFootnotes,
  getCurrentPageElements,
  addToCurrentPageElements,
  addToCurrentPageFootnotes,
  measure,
  footnoteContentToNumber,
  allFootnotes,
  isDesktop,
  pageWidth,
  pageHeight,
  pushPage,
  startNewPage
}) => {
  const dataAttr = element.getAttribute('data-karaoke');
  if (!dataAttr) return false;
  
  let karaokeData;
  try {
    let parsed = dataAttr;
    try {
      parsed = decodeURIComponent(dataAttr);
    } catch {
      // ignore decode errors, fallback to raw JSON
    }
    karaokeData = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    return false;
  }

  let fullText = karaokeData?.text || element.textContent || '';
  // Normalize apostrophes in fullText to match the normalized source text
  // This ensures slice boundaries align with character ranges
  fullText = fullText.replace(/'/g, "'");
  if (!fullText.trim()) {
    return false;
  }

  const karaokeId =
    element.getAttribute('data-karaoke-id') ||
    `karaoke-${chapterIdx}-${blockMeta?.subchapterId || blockMeta?.chapterId}-${Date.now()}`;

  if (!newKaraokeSources[karaokeId]) {
    // Normalize apostrophes in source text to ensure consistency with extracted text.
    // IMPORTANT: We do NOT pre-hyphenate karaoke text. We let the browser's own
    // hyphenation (hyphens:auto + lang="en") decide where to break, exactly like
    // normal paragraphs. All timing/indexing is done on this clean text.
    const normalizedSourceText = (karaokeData.text || '').replace(/'/g, "'");

    const { letterTimings, wordCharRanges } = assignLetterTimingsToChars(
      normalizedSourceText,
      karaokeData.wordTimings || []
    );

    newKaraokeSources[karaokeId] = {
      ...karaokeData,
      letterTimings,
      wordCharRanges,
      text: normalizedSourceText, // Clean text; browser hyphenation handles visual breaks
    };
  }

  // Use the normalized source text for slicing to ensure character positions align
  const sourceText = newKaraokeSources[karaokeId].text;
  let cursor = 0;
  
  console.log('[KaraokePagination] Starting karaoke pagination', {
    karaokeId,
    sourceTextLength: sourceText.length,
    currentPageElementsLength: getCurrentPageElements().length
  });
  
  while (cursor < sourceText.length) {
    // Get current page state (these may change after startNewPage is called)
    const currentPageElements = getCurrentPageElements();
    const currentPageFootnotes = getCurrentPageFootnotes();
    
    // Reserve space for footnotes OR bottom margin when calculating available height for karaoke
    // Karaoke uses a reduced bottom margin (32px) to fit more content
    const footnotesHeight = measureFootnotesHeight(
      currentPageFootnotes,
      measure.body,
      allFootnotes,
      isDesktop,
      pageWidth
    );
    const BOTTOM_MARGIN_KARAOKE = 32; // Reduced from 48px to fit one more line
    // For karaoke, use the reduced bottom margin when no footnotes
    const reservedSpace = currentPageFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_KARAOKE;
    
    // Calculate available height manually for karaoke (similar to getAvailableHeight but with karaoke margin)
    // This ensures karaoke uses its specific bottom margin
    let height;
    if (isDesktop && pageHeight) {
      // Desktop: use fixed page height
      const containerPaddingTop = 32;
      const containerPaddingBottom = 8;
      height = pageHeight - containerPaddingTop - containerPaddingBottom;
    } else {
      // Mobile: use actual rendered height (matching original behavior)
      height = measure.body.clientHeight;
    }
    const availableHeight = Math.max(0, height - reservedSpace);
    const remainingText = sourceText.slice(cursor);

    const tempElement = document.createElement('div');
    tempElement.className = 'karaoke-slice-measure';
    tempElement.style.display = 'block';
    tempElement.style.whiteSpace = 'pre-wrap';
    tempElement.style.margin = '0 0 0.85rem';
    tempElement.textContent = remainingText;

    const { firstCharCount } = splitTextAtWordBoundary(tempElement, availableHeight, measure, {
      returnCharCount: true,
    });

    let charsToUse = firstCharCount || 0;
    if (charsToUse === 0) {
      if (currentPageElements.length > 0) {
        pushPage(blockMeta);
        startNewPage(false);
        continue; // Continue to next iteration with fresh array reference
      }
      // Force minimal chunk (should be rare)
      charsToUse = Math.min(remainingText.length, 80);
    }

    const sliceText = sourceText.slice(cursor, cursor + charsToUse);
    const sliceEl = document.createElement('span');
    sliceEl.className = 'karaoke-slice';
    sliceEl.dataset.karaokeId = karaokeId;
    sliceEl.dataset.karaokeStart = String(cursor);
    sliceEl.dataset.karaokeEnd = String(cursor + charsToUse);
    // Convert newlines to <br> tags for proper rendering
    // We use innerHTML here because textContent would collapse newlines
    // The highlighting system will still work because it reads textContent which converts <br> back to \n
    sliceEl.innerHTML = sliceText.replace(/\n/g, '<br>');

    const measureNode = sliceEl.cloneNode(true);
    measure.pageContent.appendChild(measureNode);
    // Extract and track footnotes from karaoke slice
    const sliceFootnotes = extractFootnotesFromContent(sliceEl.outerHTML, footnoteContentToNumber);
    sliceFootnotes.forEach(num => addToCurrentPageFootnotes(num));
    addToCurrentPageElements(sliceEl.outerHTML);

    cursor += charsToUse;
    
    console.log('[KaraokePagination] After slice', {
      cursor,
      sourceTextLength: sourceText.length,
      charsToUse,
      currentPageElementsLength: getCurrentPageElements().length,
      hasMore: cursor < sourceText.length
    });
    
    if (cursor < sourceText.length) {
      // Push current page before continuing to next slice
      console.log('[KaraokePagination] Pushing page and starting new page', {
        currentPageElementsLength: getCurrentPageElements().length
      });
      pushPage(blockMeta);
      startNewPage(false);
      console.log('[KaraokePagination] After startNewPage', {
        currentPageElementsLength: getCurrentPageElements().length
      });
    }
    // Note: If cursor >= sourceText.length, the current page with the last slice
    // will be pushed by the caller after handleKaraokeElement returns
  }
  
  console.log('[KaraokePagination] Finished karaoke pagination', {
    cursor,
    sourceTextLength: sourceText.length,
    currentPageElementsLength: getCurrentPageElements().length
  });

  return true;
};

