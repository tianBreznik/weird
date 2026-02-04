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
  const elementFits = isStandaloneFirstPage ? true : (totalContentHeight <= totalAvailableHeight - safetyMargin);
  
  return { elementFits, totalContentHeight };
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
  
  const { elementFits, totalContentHeight } = checkElementFits({
    element,
    currentPageElements,
    contentAvailableHeight,
    isStandaloneFirstPage,
    pageHasHeading,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer,
    finalReservedSpace
  });
  
  // STEP 3: Calculate remaining height
  const { remainingContentHeight, currentPageContentHeight } = calculateRemainingHeight({
    currentPageElements,
    contentAvailableHeight,
    contentWidth,
    isDesktop,
    measure,
    applyParagraphStylesToContainer
  });
  
  // Subchapter diagnostics: log key values when processing subchapter content
  if (isDesktop && block.type === 'subchapter') {
    const tag = element.tagName?.toLowerCase() || '?';
    const textPreview = (element.textContent || '').substring(0, 60) + ((element.textContent?.length || 0) > 60 ? '...' : '');
    // Measure element height using same structure as checkElementFits/calculateRemainingHeight
    const tempElOnly = document.createElement('div');
    tempElOnly.style.width = contentWidth + 'px';
    const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
    measureParent.appendChild(tempElOnly);
    const elOnlyWrapper = document.createElement('div');
    elOnlyWrapper.className = 'page-content-main';
    const tempInner = document.createElement('div');
    tempInner.innerHTML = element.outerHTML;
    elOnlyWrapper.appendChild(tempInner.firstElementChild || tempInner);
    applyParagraphStylesToContainer(elOnlyWrapper, isDesktop);
    tempElOnly.appendChild(elOnlyWrapper);
    const elementOnlyHeight = tempElOnly.offsetHeight;
    measureParent.removeChild(tempElOnly);
    console.log('[subchapter] element check:', {
      tag,
      elementFits,
      elementOnlyHeight,
      totalContentHeight,
      contentAvailableHeight: baseAvailableHeight,
      remainingContentHeight,
      currentPageContentHeight,
      currentPageElementsCount: currentPageElements.length,
      textPreview
    });
  }
  
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
      
      applyParagraphStylesToContainer(finalContentWrapper, isDesktop);
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
          isDesktop
        });
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure, {
            contentWidth,
            isDesktop
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
        
        // Log space usage after adding element
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
          const elementText = element.textContent || '';
          const textPreview = elementText.substring(0, 100) + (elementText.length > 100 ? '...' : '');

        }
      }
    } else {
      // Element doesn't fit - try to split it first
      if (block.type === 'subchapter' && isDesktop) {
        console.log('[subchapter] element does NOT fit:', {
          remainingContentHeight,
          tag: element.tagName?.toLowerCase(),
          textPreview: (element.textContent || '').substring(0, 60) + '...'
        });
      }
      if (remainingContentHeight > 0) {
        // Use remainingContentHeight to split - this accounts for existing page content
        // Try sentence-level splitting first, then word boundary
        let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary, {
          contentWidth,
          isDesktop
        });
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure, {
            contentWidth,
            isDesktop
          });
        }
        
        const { first, second } = splitResult;
        if (block.type === 'subchapter' && isDesktop) {
          console.log('[subchapter] split result:', {
            hasFirst: !!first,
            hasSecond: !!second,
            remainingContentHeight,
            firstChars: first ? first.length : 0
          });
        }
        
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
          applyParagraphStylesToContainer(firstPartWrapper, isDesktop);
          tempFirstPartOnly.appendChild(firstPartWrapper);
          const firstPartHeight = tempFirstPartOnly.offsetHeight;
          measureParentFirst.removeChild(tempFirstPartOnly);
          
          const firstPartFits = firstPartHeight <= remainingContentHeight;
          if (block.type === 'subchapter' && isDesktop) {
            console.log('[subchapter] first part verification:', {
              firstPartHeight,
              remainingContentHeight,
              firstPartFits,
              diff: firstPartHeight - remainingContentHeight
            });
          }
          
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
            if (block.type === 'subchapter' && isDesktop) {
              console.log('[subchapter] first part did NOT fit → pushing whole element to next page');
            }
            if (currentPageElements.length > 0) {
              pushPage(block);
            }
            startNewPage(false);
            elementFootnotes.forEach(num => currentPageFootnotes.add(num));
            currentPageElements.push(element.outerHTML);
          }
        } else {
          // No split possible (first is empty) - start new page with entire element
          if (block.type === 'subchapter' && isDesktop) {
            console.log('[subchapter] no split possible (first empty) → pushing whole element to next page', {
              remainingContentHeight,
              tag: element.tagName?.toLowerCase()
            });
          }
          if (currentPageElements.length > 0) {
            pushPage(block);
          }
          startNewPage(false);
          elementFootnotes.forEach(num => currentPageFootnotes.add(num));
          currentPageElements.push(element.outerHTML);
        }
      } else {
        // Can't fit even part of element (no remaining space) - start new page with entire element
        if (block.type === 'subchapter' && isDesktop) {
          console.log('[subchapter] remainingContentHeight <= 0 → pushing whole element to next page');
        }
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

