import { 
  extractFootnotesFromContent, 
  measureFootnotesHeight, 
  applyParagraphStylesToContainer,
  isAtomicElement,
  splitTextAtSentenceBoundary,
  splitTextAtWordBoundary
} from './paginationHelpers';
import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';

/**
 * Calculate available height for an element considering footnotes
 */
export const calculateAvailableHeightForElement = ({
  element,
  currentPageFootnotes,
  footnoteContentToNumber,
  allFootnotes,
  measure,
  contentWidth,
  isDesktop,
  pageWidth,
  chapter,
  chapterPageIndex
}) => {
  // Calculate footnotes that would be on this page (current + this element's footnotes)
  const testFootnotes = new Set(currentPageFootnotes);
  const elementFootnotes = extractFootnotesFromContent(element.outerHTML, footnoteContentToNumber);
  elementFootnotes.forEach(num => testFootnotes.add(num));
  
  // Measure footnote height first, then get available height
  const tempFootnotesContainer = document.createElement('div');
  tempFootnotesContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
  measure.body.appendChild(tempFootnotesContainer);
  const footnotesHeight = measureFootnotesHeight(testFootnotes, tempFootnotesContainer, allFootnotes, isDesktop, pageWidth);
  measure.body.removeChild(tempFootnotesContainer);
  
  // Get available height - it will use footnotes height if provided, or bottom margin if not
  const isStandaloneFirstPage = chapter.isFirstPage && chapterPageIndex === 0;
  const isFirstPage = isStandaloneFirstPage;
  const baseAvailableHeight = measure.getAvailableHeight(footnotesHeight, isFirstPage);
  
  return {
    baseAvailableHeight,
    contentAvailableHeight: baseAvailableHeight,
    testFootnotes,
    elementFootnotes,
    footnotesHeight,
    isStandaloneFirstPage
  };
};

/**
 * Check if element fits by measuring TOTAL content (current page + element)
 */
export const checkElementFits = ({
  element,
  currentPageElements,
  contentAvailableHeight,
  isStandaloneFirstPage,
  pageHasHeading,
  contentWidth,
  isDesktop,
  measure,
  applyParagraphStylesToContainer,
  finalReservedSpace = 0
}) => {
  const testElements = [...currentPageElements, element.outerHTML];
  const tempTotalContainer = document.createElement('div');
  tempTotalContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
  // For desktop, append to pageContent to match actual DOM structure; for mobile, body is fine
  const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
  measureParent.appendChild(tempTotalContainer);
  
  // Wrap in page-content-main with padding-bottom to match actual rendering
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'page-content-main';
  if (finalReservedSpace > 0) {
    contentWrapper.style.paddingBottom = finalReservedSpace + 'px';
  }
  
  testElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    contentWrapper.appendChild(temp.firstElementChild || temp);
  });
  
  // Apply base paragraph styles to match actual rendering
  applyParagraphStylesToContainer(contentWrapper, isDesktop);
  tempTotalContainer.appendChild(contentWrapper);
  
  const totalContentHeight = tempTotalContainer.offsetHeight;
  measureParent.removeChild(tempTotalContainer);
  
  // Element fits if total content height (with padding) fits in contentAvailableHeight + padding
  // Add safety margin to prevent overflow due to rounding/measurement differences.
  // Use same margin (2) regardless of pageHasHeading - a larger margin (8) when subchapter
  // heading is on page caused content to break earlier and leave visible empty space.
  const safetyMargin = isStandaloneFirstPage ? -100 : 2;
  const totalAvailableHeight = contentAvailableHeight + (finalReservedSpace || 0);
  let elementFits;
  let overflowAmount;
  if (isStandaloneFirstPage) {
    elementFits = true;
    overflowAmount = 0;
  } else if (isDesktop) {
    // Desktop: allow a small positive overflow (up to ~15px) so paragraphs that
    // visually fit near the bottom of the page do NOT trigger a split.
    overflowAmount = totalContentHeight - totalAvailableHeight;
    elementFits = overflowAmount <= 15;
  } else {
    // Mobile: keep the stricter safety-margin based check.
    overflowAmount = totalContentHeight - totalAvailableHeight;
    elementFits = totalContentHeight <= totalAvailableHeight - safetyMargin;
  }
  
  return { elementFits, totalContentHeight, overflowAmount, totalAvailableHeight };
};

/**
 * Calculate remaining content height on current page.
 * Uses the same DOM structure as checkElementFits (page-content-main wrapper) so measurements
 * are identical and margin collapse / layout match exactly.
 */
export const calculateRemainingHeight = ({
  currentPageElements,
  contentAvailableHeight,
  contentWidth,
  isDesktop,
  measure,
  applyParagraphStylesToContainer
}) => {
  const tempCurrentPageContainer = document.createElement('div');
  tempCurrentPageContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
  const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
  measureParent.appendChild(tempCurrentPageContainer);
  
  // Same structure as checkElementFits: wrap in page-content-main for identical measurement
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'page-content-main';
  currentPageElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    contentWrapper.appendChild(temp.firstElementChild || temp);
  });
  applyParagraphStylesToContainer(contentWrapper, isDesktop);
  tempCurrentPageContainer.appendChild(contentWrapper);
  
  const currentPageContentHeight = tempCurrentPageContainer.offsetHeight;
  measureParent.removeChild(tempCurrentPageContainer);
  
  const remainingContentHeight = Math.max(0, contentAvailableHeight - currentPageContentHeight);
  
  return { currentPageContentHeight, remainingContentHeight };
};

/**
 * Handle atomic element (images, videos, headings, poetry, dinkus)
 */
export const handleAtomicElement = ({
  element,
  elementFits,
  elementFootnotes,
  isHeadingElement,
  currentPageElements,
  currentPageFootnotes,
  pushPage,
  startNewPage,
  block
}) => {
  if (elementFits) {
    // Element fits - add to current page
    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
  } else {
    // Element doesn't fit - start new page
    if (currentPageElements.length > 0) {
      pushPage(block);
    }
    startNewPage(isHeadingElement);
    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
  }
};

/**
 * Check if element should be split (complex logic with multiple conditions)
 */
export const shouldSplitElement = ({
  element,
  elementFits,
  remainingContentHeight,
  finalTotalHeight,
  baseAvailableHeight,
  overflowAmount,
  isStandaloneFirstPage,
  elementIndex,
  elementsLength
}) => {
  // If element fits, check if it actually fits with padding
  if (elementFits) {
    // Desktop: once we've decided the full element "fits" under the relaxed
    // desktop model (including small overflow tolerance), do NOT split it.
    // This prevents unnecessary splits when the whole paragraph could stay on
    // the current page.
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      return false;
    }
    const shouldTrySplitDueToSmallSpace = remainingContentHeight < 50 && 
                                          remainingContentHeight > 0 &&
                                          element.textContent && 
                                          element.textContent.length > 50;
    
    const elementTextLength = element.textContent?.length || 0;
    const isLastElement = elementIndex === elementsLength - 1;
    const isLikelyLastElement = remainingContentHeight < 80 && overflowAmount < 30;
    const isShortElement = elementTextLength < 100 && overflowAmount < 30;
    const overflowTolerance = isStandaloneFirstPage ? 50 : 30;
    const allowSmallOverflow = (isLastElement || isLikelyLastElement || isShortElement || isStandaloneFirstPage) && 
                               overflowAmount < overflowTolerance && 
                               overflowAmount > 0;
    
    const shouldSkipSplitDueToSmallSpace = remainingContentHeight < 20 && 
                                            remainingContentHeight > 0 &&
                                            elementTextLength > 200;
    
    // overflowAmount is already calculated correctly (finalTotalHeight - totalAvailableHeight)
    // So we only need to check overflowAmount, not compare finalTotalHeight to baseAvailableHeight
    return (overflowAmount >= 10 || shouldTrySplitDueToSmallSpace) && 
           !allowSmallOverflow && 
           !shouldSkipSplitDueToSmallSpace;
  } else {
    // Element doesn't fit - check if we should skip splitting
    const elementTextLength = element.textContent?.length || 0;
    return !(remainingContentHeight < 20 && 
             remainingContentHeight > 0 &&
             elementTextLength > 200);
  }
};

/**
 * Process split result and decide what to do with it
 */
export const processSplitResult = ({
  splitResult,
  element,
  remainingContentHeight,
  currentPageElements,
  currentPageFootnotes,
  elementFootnotes,
  baseAvailableHeight,
  overflowAmount,
  finalReservedSpace,
  contentWidth,
  isDesktop,
  measure,
  applyParagraphStylesToContainer,
  extractFootnotesFromContent,
  footnoteContentToNumber,
  pushPage,
  startNewPage,
  block
}) => {
  // NOTE (desktop pagination):
  // 1) The primary issue we're tackling now is *when* to trigger a split at all
  //    (checkElementFits / shouldSplitElement). This function only runs once a
  //    split has already been approved.
  // 2) Follow‑up we should revisit later: after splitting, if the "second" part
  //    would also fit on the current page under the relaxed desktop model, we
  //    could abandon the split and keep the whole paragraph on a single page
  //    instead of forcing a tiny tail onto the next page.
  const { first, second } = splitResult;
  
  if (!first || remainingContentHeight <= 0) {
    // Can't split or no space left - push entire element to next page
    if (currentPageElements.length > 0) {
      pushPage(block);
    }
    startNewPage(false);
    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
    return;
  }
  
  // Check if first part is too short (just a few words) - if so, push whole element to next page
  const firstPartText = first.replace(/<[^>]*>/g, '').trim();
  const firstPartWordCount = firstPartText.split(/\s+/).filter(w => w.length > 0).length;
  const isFirstPartTooShort = firstPartWordCount < 2;
  
  if (isFirstPartTooShort) {
    // Push whole element to next page - avoid split that would leave very short first part
    if (currentPageElements.length > 0) {
      pushPage(block);
    }
    startNewPage(false);
    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
    return;
  }
  
  // Measure how much space the first part would actually use
  const firstPartTestContainer = document.createElement('div');
  // Use contentWidth for desktop (accounts for padding), body.clientWidth for mobile
  const measureWidth = (isDesktop && contentWidth) ? contentWidth : measure.body.clientWidth;
  firstPartTestContainer.style.width = measureWidth + 'px';
  // For desktop, append to pageContent to match structure; for mobile, body is fine
  const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
  measureParent.appendChild(firstPartTestContainer);
  
  const firstPartTestElements = [...currentPageElements, first];
  const firstPartContentWrapper = document.createElement('div');
  firstPartContentWrapper.className = 'page-content-main';
  firstPartContentWrapper.style.paddingBottom = finalReservedSpace + 'px';
  
  firstPartTestElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    firstPartContentWrapper.appendChild(temp.firstElementChild || temp);
  });
  
  applyParagraphStylesToContainer(firstPartContentWrapper, isDesktop);
  firstPartTestContainer.appendChild(firstPartContentWrapper);
  const firstPartHeight = firstPartTestContainer.offsetHeight;
  measureParent.removeChild(firstPartTestContainer);
  
  const firstPartRemainingSpace = baseAvailableHeight - firstPartHeight;

  // Desktop vs mobile behavior: we only tweak the heuristics on desktop.
  if (!isDesktop) {
    // Existing mobile behavior: conservative split rules
    // Case 1: First part leaves significant unused space (> 30px) and overflow was small (< 30px)
    if (firstPartRemainingSpace > 30 && overflowAmount < 30) {
      // Don't split - include whole element with small overflow
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
      return;
    }
    
    // Case 2: First part leaves very little to no space (< 15px) and overflow was small (< 30px)
    if (firstPartRemainingSpace < 15 && overflowAmount < 30) {
      // Push whole element to next page - avoid split that would leave tiny first part
      if (currentPageElements.length > 0) {
        pushPage(block);
      }
      startNewPage(false);
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
      return;
    }
    // Case 3 (mobile): fall through to split below.
  } else {
    // Desktop: geometry‑driven rules focused on visual fill.
    const R = firstPartRemainingSpace;
    const O = overflowAmount || 0;

    // Secondary desktop fix:
    // After computing a split, re-check whether keeping the ENTIRE element
    // on this page is acceptable under the relaxed desktop overflow model.
    // If yes, abandon the split and keep the whole paragraph together to
    // avoid tiny tails like "alive." ending up alone on the next page.
    try {
      if (second) {
        const fullElementTestContainer = document.createElement('div');
        const fullMeasureWidth =
          (isDesktop && contentWidth) ? contentWidth : measure.body.clientWidth;
        fullElementTestContainer.style.width = fullMeasureWidth + 'px';
        const fullMeasureParent =
          (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
        fullMeasureParent.appendChild(fullElementTestContainer);

        const fullContentWrapper = document.createElement('div');
        fullContentWrapper.className = 'page-content-main';
        fullContentWrapper.style.paddingBottom = finalReservedSpace + 'px';

        const fullTestElements = [...currentPageElements, element.outerHTML];
        fullTestElements.forEach(el => {
          const temp = document.createElement('div');
          temp.innerHTML = el;
          fullContentWrapper.appendChild(temp.firstElementChild || temp);
        });

        applyParagraphStylesToContainer(fullContentWrapper, isDesktop);
        fullElementTestContainer.appendChild(fullContentWrapper);

        const fullTotalHeight = fullElementTestContainer.offsetHeight;
        fullMeasureParent.removeChild(fullElementTestContainer);

        const fullTotalAvailableHeight = baseAvailableHeight + finalReservedSpace;
        const fullOverflow = fullTotalHeight - fullTotalAvailableHeight;

        // Allow a slightly generous overflow here (matching the relaxed
        // desktop tolerance in checkElementFits). If the whole element fits
        // under this model, keep it on the current page and skip splitting.
        const FULL_DESKTOP_OVERFLOW_TOLERANCE = 15;
        const fullElementFitsRelaxed = fullOverflow <= FULL_DESKTOP_OVERFLOW_TOLERANCE;

        if (fullElementFitsRelaxed) {
          elementFootnotes.forEach(num => currentPageFootnotes.add(num));
          currentPageElements.push(element.outerHTML);
          return;
        }
      }
    } catch (e) {
      // If any measurement fails, fall back to existing desktop logic below.
    }

    // A. Good fill band: use the split to pack the page tighter.
    if (R >= 0 && R <= 40) {
      // proceed to split below
    } else if (R > 40 && O < 20) {
      // B. Plenty of space left and overflow would be small: keep whole element on this page.
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
      return;
    } else if (R < 10 && isFirstPartTooShort) {
      // C. Tiny remaining space and first part is essentially a fragment: push whole element.
      if (currentPageElements.length > 0) {
        pushPage(block);
      }
      startNewPage(false);
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
      return;
    } else {
      // D. Default desktop fallback: we tried to fill but geometry is awkward – push whole element.
      if (currentPageElements.length > 0) {
        pushPage(block);
      }
      startNewPage(false);
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
      return;
    }
  }
  
  // Case 3: First part uses space well - proceed with split
  const firstFootnotes = extractFootnotesFromContent(first, footnoteContentToNumber);
  firstFootnotes.forEach(num => currentPageFootnotes.add(num));
  currentPageElements.push(first);
  
  // Push current page and start new page with second part
  pushPage(block);
  startNewPage(false);
  if (second) {
    if (isDesktop) {
      const tempDiv = document.createElement('div');
    }
    const secondFootnotes = extractFootnotesFromContent(second, footnoteContentToNumber);
    secondFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(second);
  } else {
    if (isDesktop) {
      const elementText = element.textContent || '';



    }
  }
};

/**
 * Main function to paginate a single element
 */
export const paginateElement = ({
  element,
  elementIndex,
  elementsLength,
  currentPageElements,
  currentPageFootnotes,
  pageHasHeading,
  chapter,
  chapterPageIndex,
  block,
  measure,
  contentWidth,
  isDesktop,
  pageHeight,
  pageWidth,
  footnoteContentToNumber,
  allFootnotes,
  applyParagraphStylesToContainer,
  extractFootnotesFromContent,
  measureFootnotesHeight,
  isAtomicElement,
  splitTextAtSentenceBoundary,
  splitTextAtWordBoundary,
  pushPage,
  startNewPage
}) => {
  const isHeadingElement = /^H[1-6]$/i.test(element.tagName || '');
  const isSubchapterTitle = /^H[4-6]$/i.test(element.tagName || '');
  const blockFont = block?.fontFamily ?? DEFAULT_CHAPTER_FONT;
  const applyWithFont = (container, isDesktop) => applyParagraphStylesToContainer(container, isDesktop, blockFont);

  // Update heading state for page metadata. Do NOT call measure.setHeading(true) — it can reduce
  // available height when a subchapter is on the page and cause early breaks / empty space.
  if (isSubchapterTitle && !pageHasHeading) {
    pageHasHeading = true;
  }
  
  // Handle background video elements - skip them from content
  if (element.tagName === 'VIDEO') {
    const videoMode = element.getAttribute('data-video-mode') || 'blank-page';
    if (videoMode === 'background') {
      return { skip: true, pageHasHeading };
    }
  }
  
  // STEP 1: Calculate available content height
  const {
    baseAvailableHeight,
    contentAvailableHeight,
    testFootnotes,
    elementFootnotes,
    footnotesHeight,
    isStandaloneFirstPage
  } = calculateAvailableHeightForElement({
    element,
    currentPageFootnotes,
    footnoteContentToNumber,
    allFootnotes,
    measure,
    contentWidth,
    isDesktop,
    pageWidth,
    chapter,
    chapterPageIndex
  });
  
  // STEP 2: Check if element fits
  // Calculate finalReservedSpace (padding-bottom) to pass to checkElementFits
  // Desktop: padding-bottom is NOT added to content (body already has padding)
  // Mobile: padding-bottom IS added to content wrapper
  // For desktop, don't add padding-bottom in measurement (body padding already accounted for)
  // For mobile, add padding-bottom to match actual rendering
  const BOTTOM_MARGIN_NO_FOOTNOTES = isStandaloneFirstPage 
    ? 20 
    : (isDesktop ? 24 : 32); // Desktop: 24px (reduced to allow visual overflow), Mobile: 32px
  const finalReservedSpace = isDesktop 
    ? 0  // Desktop: body padding already accounted for in contentAvailableHeight
    : (testFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES);
  
  const { elementFits, totalContentHeight, overflowAmount, totalAvailableHeight } = checkElementFits({
    element,
    currentPageElements,
    contentAvailableHeight,
    isStandaloneFirstPage,
    pageHasHeading,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer: applyWithFont,
    finalReservedSpace
  });
  
  // STEP 3: Calculate remaining height
  const { remainingContentHeight, currentPageContentHeight } = calculateRemainingHeight({
    currentPageElements,
    contentAvailableHeight,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer: applyWithFont
  });
  
  // DEV: detailed logging for pagination debugging when ?debug=pagination is present.
  // This does not affect behavior; it only writes to console.
  try {
    if (typeof window !== 'undefined' && window.location.search.includes('debug=pagination')) {
      const tag = element.tagName?.toLowerCase() || 'unknown';
      // Show only first 80 chars of text to keep logs readable
      const textPreview = (element.textContent || '').trim().slice(0, 80);
      // Best-effort height of the original element in the measurement container
      let elementHeight = 0;
      try {
        if (element.getBoundingClientRect) {
          elementHeight = element.getBoundingClientRect().height;
        } else if (typeof element.offsetHeight === 'number') {
          elementHeight = element.offsetHeight;
        }
      } catch (e) {}
      // eslint-disable-next-line no-console
      console.log('[PAGINATION]', {
        tag,
        textPreview,
        elementIndex,
        elementsLength,
        isDesktop,
        contentAvailableHeight,
        finalReservedSpace,
        totalAvailableHeight,
        totalContentHeight,
        remainingContentHeight,
        elementFits,
        elementHeight,
      });
      // Also expose per-page debug info when the element did NOT fit.
      if (!elementFits && chapter && typeof chapterPageIndex === 'number') {
        const key = `${chapter.id || chapter.title || 'unknown'}:${chapterPageIndex}`;
        window.__paginationDebug = window.__paginationDebug || {};
        window.__paginationDebug[key] = {
          overflowAmount: overflowAmount || 0,
          totalAvailableHeight,
          totalContentHeight,
        };
      }
    }
  } catch (e) {
    // ignore logging errors
  }
  
  // STEP 4: Handle element based on whether it fits and if it can be split
  if (isAtomicElement(element)) {
    // Atomic elements (images, videos, headings, karaoke): cannot be split
    // For block images, prefer the height we measured earlier in processHTMLContent
    // (stored on data-measured-height) over any fresh DOM measurements, because the
    // element is now detached from the DOM and getBoundingClientRect() will be 0.
    let effectiveElementFits = elementFits;
    const tagName = element.tagName?.toLowerCase();
    const isBlockImage =
      tagName === 'img' && element.getAttribute('data-inline') !== 'true';
    if (isBlockImage) {
      const measured = element.dataset && element.dataset.measuredHeight
        ? parseFloat(element.dataset.measuredHeight)
        : 0;
      if (measured && measured > 0) {
        const IMAGE_BUFFER = 8; // px breathing room
        effectiveElementFits = remainingContentHeight >= (measured + IMAGE_BUFFER);
      }
    }

    handleAtomicElement({
      element,
      elementFits: effectiveElementFits,
      elementFootnotes,
      isHeadingElement,
      currentPageElements,
      currentPageFootnotes,
      pushPage,
      startNewPage,
      block
    });
    return { pageHasHeading };
  } else {
    // Splittable text elements: can be split at sentence/word boundaries
    if (elementFits) {
      // Element fits - double-check that the total page content (with padding) still fits
      const finalTestElements = [...currentPageElements, element.outerHTML];
      const finalTestContainer = document.createElement('div');
      finalTestContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
      // For desktop, append to pageContent to match actual DOM structure; for mobile, body is fine
      const finalMeasureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
      finalMeasureParent.appendChild(finalTestContainer);
      
      // Simulate the actual rendering with padding-bottom
      const isStandaloneFirstPageCheck = chapter.isFirstPage && chapterPageIndex === 0;
      // Match getAvailableHeight() calculation: desktop uses 24px for non-first pages (reduced to allow visual overflow), 20px for first page
      // Mobile uses 32px for non-first pages, 20px for first page
      const BOTTOM_MARGIN_NO_FOOTNOTES = isStandaloneFirstPageCheck 
        ? 20 
        : (isDesktop ? 24 : 32); // Desktop: 24px (reduced to allow visual overflow), Mobile: 32px
      const finalReservedSpace = testFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES;
      const finalContentWrapper = document.createElement('div');
      finalContentWrapper.className = 'page-content-main';
      finalContentWrapper.style.paddingBottom = finalReservedSpace + 'px';
      
      finalTestElements.forEach(el => {
        const temp = document.createElement('div');
        temp.innerHTML = el;
        finalContentWrapper.appendChild(temp.firstElementChild || temp);
      });
      
      applyWithFont(finalContentWrapper, isDesktop);
      finalTestContainer.appendChild(finalContentWrapper);
      const finalTotalHeight = finalTestContainer.offsetHeight;
      finalMeasureParent.removeChild(finalTestContainer);
      
      // Calculate overflow amount
      // finalTotalHeight includes content + padding (finalReservedSpace)
      // baseAvailableHeight is the available height for content (excluding reserved space)
      // On desktop: baseAvailableHeight = 508px, finalReservedSpace = 32px, so total = 540px (body height)
      // On mobile: baseAvailableHeight already accounts for reserved space
      // So we compare finalTotalHeight to baseAvailableHeight + finalReservedSpace
      let overflowAmount;
      let totalAvailableHeight;
      if (isStandaloneFirstPage) {
        overflowAmount = 0;
        totalAvailableHeight = baseAvailableHeight + finalReservedSpace;
      } else {
        // Compare against the total available height (content area + reserved space)
        // This matches the actual body height on desktop (540px)
        totalAvailableHeight = baseAvailableHeight + finalReservedSpace;
        overflowAmount = finalTotalHeight - totalAvailableHeight;
      }
      
      // Check if we should split
      const shouldSplit = shouldSplitElement({
        element,
        elementFits: true,
        remainingContentHeight,
        finalTotalHeight,
        baseAvailableHeight,
        overflowAmount,
        isStandaloneFirstPage,
        elementIndex,
        elementsLength
      });
      
      if (shouldSplit) {
        // Use remainingContentHeight to split - this accounts for existing page content
        // The split functions measure just the element, so we need to pass the remaining space
        let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary, {
          contentWidth,
          isDesktop,
          fontFamily: blockFont
        });
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure, {
            contentWidth,
            isDesktop,
            fontFamily: blockFont
          });
        }
        
        processSplitResult({
          splitResult,
          element,
          remainingContentHeight,
          currentPageElements,
          currentPageFootnotes,
          elementFootnotes,
          baseAvailableHeight,
          overflowAmount,
          finalReservedSpace,
          contentWidth,
          isDesktop,
          measure,
          applyParagraphStylesToContainer: applyWithFont,
          extractFootnotesFromContent,
          footnoteContentToNumber,
          pushPage,
          startNewPage,
          block
        });
      } else {
        // Content fits - add to current page
        elementFootnotes.forEach(num => currentPageFootnotes.add(num));
        currentPageElements.push(element.outerHTML);
        
        // Log space usage after adding element
        if (isDesktop) {
          const { currentPageContentHeight: usedHeight } = calculateRemainingHeight({
            currentPageElements,
            contentAvailableHeight: baseAvailableHeight,
            contentWidth,
            isDesktop,
            measure,
            applyParagraphStylesToContainer: applyWithFont
          });
          const remainingSpace = baseAvailableHeight - usedHeight;
          const elementText = element.textContent || '';
          const textPreview = elementText.substring(0, 100) + (elementText.length > 100 ? '...' : '');

        }
      }
    } else {
      // Element doesn't fit - try to split it first
      if (remainingContentHeight > 0) {
        // Use remainingContentHeight to split - this accounts for existing page content
        // Try sentence-level splitting first, then word boundary
        let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary, {
          contentWidth,
          isDesktop,
          fontFamily: blockFont
        });
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure, {
            contentWidth,
            isDesktop,
            fontFamily: blockFont
          });
        }
        
        const { first, second } = splitResult;
        
        // If split succeeded, process it
        if (first) {
          // Verify first part actually fits with updated footnotes
          const firstFootnotes = extractFootnotesFromContent(first, footnoteContentToNumber);
          const testFootnotesWithFirst = new Set([...currentPageFootnotes, ...firstFootnotes]);
          
          // Recalculate available height with first part's footnotes
          const tempFootnotesContainerFirst = document.createElement('div');
          tempFootnotesContainerFirst.style.width = contentWidth + 'px';
          measure.body.appendChild(tempFootnotesContainerFirst);
          const footnotesHeightWithFirst = measureFootnotesHeight(testFootnotesWithFirst, tempFootnotesContainerFirst, allFootnotes, isDesktop, pageWidth);
          measure.body.removeChild(tempFootnotesContainerFirst);
          
          const isFirstPage = chapter.isFirstPage;
          const baseAvailableHeightWithFirst = measure.getAvailableHeight(footnotesHeightWithFirst, isFirstPage);
          
          // Measure first part using same structure as checkElementFits/calculateRemainingHeight
          const tempFirstPartOnly = document.createElement('div');
          tempFirstPartOnly.style.width = contentWidth + 'px';
          const measureParentFirst = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
          measureParentFirst.appendChild(tempFirstPartOnly);
          const firstPartWrapper = document.createElement('div');
          firstPartWrapper.className = 'page-content-main';
          const tempFirst = document.createElement('div');
          tempFirst.innerHTML = first;
          firstPartWrapper.appendChild(tempFirst.firstElementChild || tempFirst);
          applyWithFont(firstPartWrapper, isDesktop);
          tempFirstPartOnly.appendChild(firstPartWrapper);
          const firstPartHeight = tempFirstPartOnly.offsetHeight;
          measureParentFirst.removeChild(tempFirstPartOnly);
          
          const firstPartFits = firstPartHeight <= remainingContentHeight;
          
          if (firstPartFits) {
            // First part fits - add it to current page
            firstFootnotes.forEach(num => currentPageFootnotes.add(num));
            currentPageElements.push(first);
            
            // Log space usage before finalizing page
            if (isDesktop) {
              const { currentPageContentHeight: usedHeight } = calculateRemainingHeight({
                currentPageElements,
                contentAvailableHeight: baseAvailableHeight,
                contentWidth,
                isDesktop,
                measure,
                applyParagraphStylesToContainer
              });
              const remainingSpace = baseAvailableHeight - usedHeight;
              const tempFirst = document.createElement('div');
              tempFirst.innerHTML = first || '';
              const firstText = tempFirst.textContent || '';
              const firstPreview = firstText.substring(0, 100) + (firstText.length > 100 ? '...' : '');

            }
            
            // Finalize current page
            if (currentPageElements.length > 0) {
              pushPage(block);
            }
            
            // Start new page with second part
            startNewPage(false);
            
            if (second) {
              const secondFootnotes = extractFootnotesFromContent(second, footnoteContentToNumber);
              secondFootnotes.forEach(num => currentPageFootnotes.add(num));
              currentPageElements.push(second);
              
              // Log space usage after adding second part to new page
              if (isDesktop) {
                const { currentPageContentHeight: usedHeight } = calculateRemainingHeight({
                  currentPageElements,
                  contentAvailableHeight: baseAvailableHeight,
                  contentWidth,
                  isDesktop,
                  measure,
                  applyParagraphStylesToContainer
                });
                const remainingSpace = baseAvailableHeight - usedHeight;
                const tempSecond = document.createElement('div');
                tempSecond.innerHTML = second || '';
                const secondText = tempSecond.textContent || '';
                const secondPreview = secondText.substring(0, 100) + (secondText.length > 100 ? '...' : '');

              }
            }
          } else {
            // First part doesn't actually fit - start new page with entire element
            if (currentPageElements.length > 0) {
              pushPage(block);
            }
            startNewPage(false);
            elementFootnotes.forEach(num => currentPageFootnotes.add(num));
            currentPageElements.push(element.outerHTML);
          }
        } else {
          // No split possible (first is empty) - start new page with entire element
          if (currentPageElements.length > 0) {
            pushPage(block);
          }
          startNewPage(false);
          elementFootnotes.forEach(num => currentPageFootnotes.add(num));
          currentPageElements.push(element.outerHTML);
        }
      } else {
        // Can't fit even part of element (no remaining space) - start new page with entire element
        if (currentPageElements.length > 0) {
          pushPage(block);
        }
        startNewPage(false);
        elementFootnotes.forEach(num => currentPageFootnotes.add(num));
        currentPageElements.push(element.outerHTML);
      }
    }
  }
  
  return { pageHasHeading };
};

