import { 
  extractFootnotesFromContent, 
  measureFootnotesHeight, 
  applyParagraphStylesToContainer,
  isAtomicElement,
  splitTextAtSentenceBoundary,
  splitTextAtWordBoundary
} from './paginationHelpers';

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
  applyParagraphStylesToContainer
}) => {
  const testElements = [...currentPageElements, element.outerHTML];
  const tempTotalContainer = document.createElement('div');
  tempTotalContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
  measure.body.appendChild(tempTotalContainer);
  
  testElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    tempTotalContainer.appendChild(temp.firstElementChild || temp);
  });
  
  // Apply base paragraph styles to match actual rendering
  applyParagraphStylesToContainer(tempTotalContainer, isDesktop);
  
  const totalContentHeight = tempTotalContainer.offsetHeight;
  measure.body.removeChild(tempTotalContainer);
  
  // Element fits if total content height fits in contentAvailableHeight
  // Add safety margin to prevent overflow due to rounding/measurement differences
  const safetyMargin = isStandaloneFirstPage ? -100 : (pageHasHeading ? 8 : 2);
  const elementFits = isStandaloneFirstPage ? true : (totalContentHeight <= contentAvailableHeight - safetyMargin);
  
  return { elementFits, totalContentHeight };
};

/**
 * Calculate remaining content height on current page
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
  measure.body.appendChild(tempCurrentPageContainer);
  
  currentPageElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    tempCurrentPageContainer.appendChild(temp.firstElementChild || temp);
  });
  
  // Apply base paragraph styles to match actual rendering
  applyParagraphStylesToContainer(tempCurrentPageContainer, isDesktop);
  
  const currentPageContentHeight = tempCurrentPageContainer.offsetHeight;
  measure.body.removeChild(tempCurrentPageContainer);
  
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
    
    return (overflowAmount >= 10 || shouldTrySplitDueToSmallSpace) && 
           finalTotalHeight > baseAvailableHeight && 
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
  firstPartTestContainer.style.width = measure.body.clientWidth + 'px';
  measure.body.appendChild(firstPartTestContainer);
  
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
  measure.body.removeChild(firstPartTestContainer);
  
  const firstPartRemainingSpace = baseAvailableHeight - firstPartHeight;
  
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
  
  // Case 3: First part uses space well - proceed with split
  const firstFootnotes = extractFootnotesFromContent(first, footnoteContentToNumber);
  firstFootnotes.forEach(num => currentPageFootnotes.add(num));
  currentPageElements.push(first);
  
  // Push current page and start new page with second part
  pushPage(block);
  startNewPage(false);
  if (second) {
    const secondFootnotes = extractFootnotesFromContent(second, footnoteContentToNumber);
    secondFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(second);
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
  
  // Update heading state if needed (affects available height)
  if (isSubchapterTitle && !pageHasHeading) {
    pageHasHeading = true;
    measure.setHeading(true);
    measure.body.offsetHeight; // Force reflow
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
  const { elementFits, totalContentHeight } = checkElementFits({
    element,
    currentPageElements,
    contentAvailableHeight,
    isStandaloneFirstPage,
    pageHasHeading,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer
  });
  
  // STEP 3: Calculate remaining height
  const { remainingContentHeight } = calculateRemainingHeight({
    currentPageElements,
    contentAvailableHeight,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer
  });
  
  // STEP 4: Handle element based on whether it fits and if it can be split
  if (isAtomicElement(element)) {
    // Atomic elements (images, videos, headings, karaoke): cannot be split
    handleAtomicElement({
      element,
      elementFits,
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
      measure.body.appendChild(finalTestContainer);
      
      // Simulate the actual rendering with padding-bottom
      const isStandaloneFirstPageCheck = chapter.isFirstPage && chapterPageIndex === 0;
      // NOTE: This uses 32px to match getAvailableHeight() calculation behavior.
      // The actual page padding uses 48px (see calculatePagePadding in pageCreation.js).
      // See CRITICAL comment in paginationHelpers.js for details about this mismatch.
      const BOTTOM_MARGIN_NO_FOOTNOTES = isStandaloneFirstPageCheck ? 20 : 32;
      const finalReservedSpace = testFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES;
      const finalContentWrapper = document.createElement('div');
      finalContentWrapper.className = 'page-content-main';
      finalContentWrapper.style.paddingBottom = finalReservedSpace + 'px';
      
      finalTestElements.forEach(el => {
        const temp = document.createElement('div');
        temp.innerHTML = el;
        finalContentWrapper.appendChild(temp.firstElementChild || temp);
      });
      
      applyParagraphStylesToContainer(finalContentWrapper, isDesktop);
      finalTestContainer.appendChild(finalContentWrapper);
      const finalTotalHeight = finalTestContainer.offsetHeight;
      measure.body.removeChild(finalTestContainer);
      
      // Calculate overflow amount
      let overflowAmount;
      if (isStandaloneFirstPage) {
        overflowAmount = 0;
      } else if (isDesktop && pageHeight) {
        const containerPaddingTop = 32;
        const containerPaddingBottom = 8;
        const fullPageHeight = pageHeight - containerPaddingTop - containerPaddingBottom;
        overflowAmount = finalTotalHeight - fullPageHeight;
      } else {
        overflowAmount = finalTotalHeight - baseAvailableHeight;
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
        // Try to split it
        let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary);
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure);
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
          applyParagraphStylesToContainer,
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
      }
    } else {
      // Element doesn't fit - check if we should even attempt to split
      const shouldSplit = shouldSplitElement({
        element,
        elementFits: false,
        remainingContentHeight,
        finalTotalHeight: 0,
        baseAvailableHeight,
        overflowAmount: 0,
        isStandaloneFirstPage,
        elementIndex,
        elementsLength
      });
      
      if (!shouldSplit) {
        // Skip splitting - push whole element to next page
        if (currentPageElements.length > 0) {
          pushPage(block);
        }
        startNewPage(false);
        elementFootnotes.forEach(num => currentPageFootnotes.add(num));
        currentPageElements.push(element.outerHTML);
        return { pageHasHeading };
      }
      
      if (remainingContentHeight > 0) {
        // Try sentence-level splitting first, then word boundary
        let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary);
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure);
        }
        
        const { first, second } = splitResult;
        
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
          
          // Measure JUST the first part
          const tempFirstPartOnly = document.createElement('div');
          tempFirstPartOnly.style.width = measure.body.clientWidth + 'px';
          measure.body.appendChild(tempFirstPartOnly);
          
          const tempFirst = document.createElement('div');
          tempFirst.innerHTML = first;
          tempFirstPartOnly.appendChild(tempFirst.firstElementChild || tempFirst);
          
          applyParagraphStylesToContainer(tempFirstPartOnly, isDesktop);
          const firstPartHeight = tempFirstPartOnly.offsetHeight;
          measure.body.removeChild(tempFirstPartOnly);
          
          const firstPartFits = firstPartHeight <= remainingContentHeight;
          
          if (firstPartFits) {
            // First part fits - add it to current page
            firstFootnotes.forEach(num => currentPageFootnotes.add(num));
            currentPageElements.push(first);
            
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

