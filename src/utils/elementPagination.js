import { 
  extractFootnotesFromContent, 
  measureFootnotesHeight, 
  applyParagraphStylesToContainer,
  isAtomicElement,
  splitTextAtSentenceBoundary,
  splitTextAtWordBoundary
} from './paginationHelpers';
import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';
import {
  ATOMIC_IMAGE_BUFFER_PX,
  countWordsFromHtml,
  getReservedBottomSpace,
} from './pageGeometry';
import { getPaginationPolicy } from './paginationPolicies';

// #region agent log
const __dbgPack = (hypothesisId, location, message, data) => {
  fetch('http://127.0.0.1:7653/ingest/96f45e2d-ed9d-4760-b26e-aea9516709c8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '14aad6' },
    body: JSON.stringify({
      sessionId: '14aad6',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

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
  chapterPageIndex,
  preserveTypography = false,
}) => {
  // Calculate footnotes that would be on this page (current + this element's footnotes)
  const testFootnotes = new Set(currentPageFootnotes);
  const elementFootnotes = extractFootnotesFromContent(element.outerHTML, footnoteContentToNumber);
  elementFootnotes.forEach(num => testFootnotes.add(num));
  
  // Measure footnote height first, then get available height
  const tempFootnotesContainer = document.createElement('div');
  tempFootnotesContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
  measure.body.appendChild(tempFootnotesContainer);
  const footnotesHeight = measureFootnotesHeight(
    testFootnotes,
    tempFootnotesContainer,
    allFootnotes,
    isDesktop,
    pageWidth,
    measure.measureCache
  );
  measure.body.removeChild(tempFootnotesContainer);
  
  // Special first page + book intro page 1: tight bottom reserve (not the 40px band).
  const isStandaloneFirstPage = chapter.isFirstPage && chapterPageIndex === 0;
  const useTightBottomReserve =
    isStandaloneFirstPage ||
    (!!preserveTypography && !chapter.isCover && !chapter.isFirstPage && chapterPageIndex === 0);
  const baseAvailableHeight = measure.getAvailableHeight(footnotesHeight, useTightBottomReserve);
  
  return {
    baseAvailableHeight,
    contentAvailableHeight: baseAvailableHeight,
    testFootnotes,
    elementFootnotes,
    footnotesHeight,
    isStandaloneFirstPage,
    useTightBottomReserve,
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
  finalReservedSpace = 0,
  policy = null,
}) => {
  const activePolicy = policy || getPaginationPolicy(isDesktop);
  const testElements = [...currentPageElements, element.outerHTML];
  const tempTotalContainer = document.createElement('div');
  // Use the same content width for both desktop and mobile so that the
  // measurement container matches the real page-content width.
  const measureWidth =
    (Number.isFinite(contentWidth) && contentWidth > 0)
      ? contentWidth
      : (measure.pageContent?.clientWidth || measure.body?.clientWidth || 0);
  tempTotalContainer.style.width = measureWidth + 'px';
  // Always prefer measure.pageContent when available so that mobile
  // measurements pass through the same .page-content structure as the
  // live reader (height/max-height: 100%, overflow: hidden, etc.).
  const measureParent = measure.pageContent || measure.body;
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
  } else {
    overflowAmount = totalContentHeight - totalAvailableHeight;
    elementFits = overflowAmount <= activePolicy.overflowTolerance;
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
  // Match checkElementFits: use contentWidth for both desktop and mobile
  // so width aligns with the real page-content.
  const measureWidth =
    (Number.isFinite(contentWidth) && contentWidth > 0)
      ? contentWidth
      : (measure.pageContent?.clientWidth || measure.body?.clientWidth || 0);
  tempCurrentPageContainer.style.width = measureWidth + 'px';
  // Always prefer measure.pageContent when available so mobile measurements
  // go through the same .page-content structure as the real reader.
  const measureParent = measure.pageContent || measure.body;
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
    // #region agent log
    __dbgPack('E', 'elementPagination.js:handleAtomicElement', 'atomic-push-whole', {
      tag: element.tagName,
      preview: (element.textContent || '').trim().slice(0, 60),
      pageElsBefore: currentPageElements.length,
    });
    // #endregion
    if (currentPageElements.length > 0) {
      pushPage(block);
    }
    startNewPage(isHeadingElement);
    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
  }
};

/**
 * Check if element should be split — delegates to desktop vs mobile policy.
 */
export const shouldSplitElement = ({
  element,
  elementFits,
  remainingContentHeight,
  overflowAmount,
  isStandaloneFirstPage,
  elementIndex,
  elementsLength,
  policy = null,
  isDesktop = typeof window !== 'undefined' ? window.innerWidth > 768 : true,
}) => {
  const activePolicy = policy || getPaginationPolicy(isDesktop);
  const ctx = {
    element,
    remainingContentHeight,
    overflowAmount,
    isStandaloneFirstPage,
    elementIndex,
    elementsLength,
  };

  if (elementFits) {
    if (activePolicy.preferKeepTogetherWhenFits) {
      return false;
    }
    return activePolicy.shouldSplitWhenFits(ctx);
  }
  return activePolicy.shouldAttemptSplitWhenOverflow(ctx);
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
  block,
  policy = null,
}) => {
  const activePolicy = policy || getPaginationPolicy(isDesktop);
  const { first, second } = splitResult;

  const pushWholeToNext = () => {
    if (currentPageElements.length > 0) {
      pushPage(block);
    }
    startNewPage(false);
    elementFootnotes.forEach((num) => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
  };

  const keepWholeHere = () => {
    elementFootnotes.forEach((num) => currentPageFootnotes.add(num));
    currentPageElements.push(element.outerHTML);
  };

  const measureWidth =
    (Number.isFinite(contentWidth) && contentWidth > 0)
      ? contentWidth
      : (measure.pageContent?.clientWidth || measure.body?.clientWidth || 0);
  const measureParent = measure.pageContent || measure.body;

  /** Append HTML to current page contents and measure overflow (margin-collapse correct). */
  const measureAppendedOverflow = (html) => {
    const testContainer = document.createElement('div');
    testContainer.style.width = measureWidth + 'px';
    measureParent.appendChild(testContainer);
    const wrapper = document.createElement('div');
    wrapper.className = 'page-content-main';
    wrapper.style.paddingBottom = (finalReservedSpace || 0) + 'px';
    [...currentPageElements, html].forEach((el) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      wrapper.appendChild(temp.firstElementChild || temp);
    });
    applyParagraphStylesToContainer(wrapper, isDesktop);
    testContainer.appendChild(wrapper);
    const height = testContainer.offsetHeight;
    measureParent.removeChild(testContainer);
    const available = baseAvailableHeight + (finalReservedSpace || 0);
    return height - available;
  };

  const fullElementFitsRelaxed =
    measureAppendedOverflow(element.outerHTML) <= activePolicy.overflowTolerance;

  // Solo fragment measure ignores margin-collapse with the previous block, so word/sentence
  // split can return first=null even when the whole short paragraph still fits on this page.
  // That false-negative pushes the paragraph to the next page and leaves a visible gap.
  if (!first || remainingContentHeight <= 0) {
    // #region agent log
    if (!isDesktop) {
      __dbgPack('D', 'elementPagination.js:processSplitResult', 'no-first-fragment', {
        hasFirst: !!first,
        remainingContentHeight: Math.round(remainingContentHeight),
        fullElementFitsRelaxed,
        action: fullElementFitsRelaxed ? 'keep-whole' : 'push-whole',
        preview: (element.textContent || '').trim().slice(0, 60),
        pageEls: currentPageElements.length,
      });
    }
    // #endregion
    if (fullElementFitsRelaxed) {
      keepWholeHere();
    } else {
      pushWholeToNext();
    }
    return;
  }
  
  const firstPartWordCount = countWordsFromHtml(first);
  const secondPartWordCount = countWordsFromHtml(second);
  
  // Measure how much space the first part would actually use
  const firstPartHeight = (() => {
    const firstPartTestContainer = document.createElement('div');
    firstPartTestContainer.style.width = measureWidth + 'px';
    measureParent.appendChild(firstPartTestContainer);
    const firstPartContentWrapper = document.createElement('div');
    firstPartContentWrapper.className = 'page-content-main';
    firstPartContentWrapper.style.paddingBottom = finalReservedSpace + 'px';
    [...currentPageElements, first].forEach((el) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      firstPartContentWrapper.appendChild(temp.firstElementChild || temp);
    });
    applyParagraphStylesToContainer(firstPartContentWrapper, isDesktop);
    firstPartTestContainer.appendChild(firstPartContentWrapper);
    const height = firstPartTestContainer.offsetHeight;
    measureParent.removeChild(firstPartTestContainer);
    return height;
  })();
  
  // firstPartHeight includes paddingBottom; baseAvailableHeight already subtracted
  // the same reserve — add it back so R is not double-counted short.
  const firstPartRemainingSpace =
    baseAvailableHeight + (finalReservedSpace || 0) - firstPartHeight;

  const decision = activePolicy.decideAfterProposedSplit({
    firstPartRemainingSpace,
    overflowAmount,
    firstPartWordCount,
    secondPartWordCount,
    second,
    fullElementFitsRelaxed,
  });

  // #region agent log
  if (!isDesktop) {
    __dbgPack('C', 'elementPagination.js:processSplitResult', 'split-decision', {
      decision,
      firstPartRemainingSpace: Math.round(firstPartRemainingSpace),
      firstPartHeight: Math.round(firstPartHeight),
      baseAvailableHeight: Math.round(baseAvailableHeight),
      finalReservedSpace,
      firstPartWordCount,
      secondPartWordCount,
      fullElementFitsRelaxed,
      remainingContentHeight: Math.round(remainingContentHeight),
      overflowAmount: Math.round(overflowAmount || 0),
      firstPreview: (String(first).replace(/<[^>]*>/g, ' ').trim()).slice(0, 50),
      secondPreview: (String(second || '').replace(/<[^>]*>/g, ' ').trim()).slice(0, 50),
      pageEls: currentPageElements.length,
      chapterPage: block?.subchapterTitle || null,
    });
  }
  // #endregion

  if (decision === 'keep-whole') {
    keepWholeHere();
    return;
  }
  if (decision === 'push-whole') {
    pushWholeToNext();
    return;
  }
  
  // accept-split — but never turn the page if the tail still fits below the first part.
  const measureBothPartsOverflow = () => {
    if (!second) return Infinity;
    const testContainer = document.createElement('div');
    testContainer.style.width = measureWidth + 'px';
    measureParent.appendChild(testContainer);
    const wrapper = document.createElement('div');
    wrapper.className = 'page-content-main';
    wrapper.style.paddingBottom = (finalReservedSpace || 0) + 'px';
    [...currentPageElements, first, second].forEach((el) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      wrapper.appendChild(temp.firstElementChild || temp);
    });
    applyParagraphStylesToContainer(wrapper, isDesktop);
    testContainer.appendChild(wrapper);
    const height = testContainer.offsetHeight;
    measureParent.removeChild(testContainer);
    const available = baseAvailableHeight + (finalReservedSpace || 0);
    return height - available;
  };

  const bothOverflow = measureBothPartsOverflow();
  const withBothHeight = (() => {
    if (!second) return firstPartHeight;
    const testContainer = document.createElement('div');
    testContainer.style.width = measureWidth + 'px';
    measureParent.appendChild(testContainer);
    const wrapper = document.createElement('div');
    wrapper.className = 'page-content-main';
    wrapper.style.paddingBottom = (finalReservedSpace || 0) + 'px';
    [...currentPageElements, first, second].forEach((el) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      wrapper.appendChild(temp.firstElementChild || temp);
    });
    applyParagraphStylesToContainer(wrapper, isDesktop);
    testContainer.appendChild(wrapper);
    const height = testContainer.offsetHeight;
    measureParent.removeChild(testContainer);
    return height;
  })();
  const tailDelta = withBothHeight - firstPartHeight;
  const tailFitsOnSamePage =
    second &&
    (bothOverflow <= activePolicy.overflowTolerance ||
      tailDelta <= firstPartRemainingSpace + activePolicy.overflowTolerance);

  const firstFootnotes = extractFootnotesFromContent(first, footnoteContentToNumber);
  firstFootnotes.forEach((num) => currentPageFootnotes.add(num));
  currentPageElements.push(first);

  if (tailFitsOnSamePage) {
    const secondFootnotes = extractFootnotesFromContent(
      second,
      footnoteContentToNumber
    );
    secondFootnotes.forEach((num) => currentPageFootnotes.add(num));
    currentPageElements.push(second);
    return;
  }

  pushPage(block);
  startNewPage(false);
  if (second) {
    const secondFootnotes = extractFootnotesFromContent(
      second,
      footnoteContentToNumber
    );
    secondFootnotes.forEach((num) => currentPageFootnotes.add(num));
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
  startNewPage,
  policy = null,
  /** false for first page / cover / intro chapter — don't force canonical type in measure */
  preserveTypography = false,
}) => {
  const activePolicy = policy || getPaginationPolicy(isDesktop);
  const isHeadingElement = /^H[1-6]$/i.test(element.tagName || '');
  const isSubchapterTitle = /^H[4-6]$/i.test(element.tagName || '');
  const blockFont = block?.fontFamily ?? DEFAULT_CHAPTER_FONT;
  const canonicalTypography = !preserveTypography;
  const applyWithFont = (container, isDesktopFlag) =>
    applyParagraphStylesToContainer(container, isDesktopFlag, blockFont, { canonicalTypography });

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
    isStandaloneFirstPage,
    useTightBottomReserve,
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
    chapterPageIndex,
    preserveTypography,
  });
  
  // STEP 2: Check if element fits
  // Desktop: body padding already accounted for in contentAvailableHeight (no content padding-bottom).
  // Mobile: padding-bottom matches rendered page-content-main; never reserve a footnote band
  // (footnotes are display:none on screen — tooltip UX only).
  // Intro / special first page use the tight first-page band, not the 40px number band.
  const finalReservedSpace = isDesktop
    ? 0
    : getReservedBottomSpace({
        isDesktop: false,
        isFirstPage: useTightBottomReserve,
        footnotesHeight: 0,
      });
  
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
    finalReservedSpace,
    policy: activePolicy,
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
        effectiveElementFits = remainingContentHeight >= (measured + ATOMIC_IMAGE_BUFFER_PX);
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
      // Fits under tolerance → keep whole. Mobile never split-when-fits.
      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
      currentPageElements.push(element.outerHTML);
    } else {
      // Element doesn't fit — word-split (mobile) or sentence-split (desktop) to fill.
      const attemptSplit = activePolicy.shouldAttemptSplitWhenOverflow({
        remainingContentHeight,
        element,
      });

      // #region agent log
      if (!isDesktop) {
        __dbgPack('A', 'elementPagination.js:paginateElement', 'overflow-path', {
          tag: element.tagName,
          preview: (element.textContent || '').trim().slice(0, 70),
          attemptSplit,
          remainingContentHeight: Math.round(remainingContentHeight),
          currentPageContentHeight: Math.round(currentPageContentHeight),
          contentAvailableHeight: Math.round(contentAvailableHeight),
          baseAvailableHeight: Math.round(baseAvailableHeight),
          finalReservedSpace,
          totalAvailableHeight: Math.round(totalAvailableHeight),
          totalContentHeight: Math.round(totalContentHeight),
          overflowAmount: Math.round(overflowAmount || 0),
          useTightBottomReserve,
          pageEls: currentPageElements.length,
          chapterPageIndex,
          policyId: activePolicy.id,
        });
      }
      // #endregion

      if (attemptSplit) {
        const splitOpts = {
          contentWidth,
          isDesktop,
          fontFamily: blockFont,
          canonicalTypography: !preserveTypography,
          ...(!isDesktop
            ? {
                currentPageElements: [...currentPageElements],
                baseAvailableHeight,
                finalReservedSpace,
                overflowTolerance: activePolicy.overflowTolerance,
              }
            : {}),
        };
        let splitResult = activePolicy.preferWordSplit
          ? splitTextAtWordBoundary(element, remainingContentHeight, measure, splitOpts)
          : splitTextAtSentenceBoundary(element, remainingContentHeight, measure, splitTextAtWordBoundary, splitOpts);
        if (!splitResult.first && !splitResult.second) {
          splitResult = splitTextAtWordBoundary(element, remainingContentHeight, measure, splitOpts);
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
          block,
          policy: activePolicy,
        });
      } else {
        // Remaining space too small to mid-split. Before bouncing the whole block,
        // re-check page-context fit (margin-collapse) — short paragraphs often still fit.
        const measureWidth =
          (Number.isFinite(contentWidth) && contentWidth > 0)
            ? contentWidth
            : (measure.pageContent?.clientWidth || measure.body?.clientWidth || 0);
        const measureParent = measure.pageContent || measure.body;
        let fitsRelaxed = false;
        try {
          const testContainer = document.createElement('div');
          testContainer.style.width = measureWidth + 'px';
          measureParent.appendChild(testContainer);
          const wrapper = document.createElement('div');
          wrapper.className = 'page-content-main';
          wrapper.style.paddingBottom = (finalReservedSpace || 0) + 'px';
          [...currentPageElements, element.outerHTML].forEach((el) => {
            const temp = document.createElement('div');
            temp.innerHTML = el;
            wrapper.appendChild(temp.firstElementChild || temp);
          });
          applyWithFont(wrapper, isDesktop);
          testContainer.appendChild(wrapper);
          const height = testContainer.offsetHeight;
          measureParent.removeChild(testContainer);
          const available = baseAvailableHeight + (finalReservedSpace || 0);
          fitsRelaxed = (height - available) <= activePolicy.overflowTolerance;
        } catch (e) {
          fitsRelaxed = false;
        }

        // #region agent log
        if (!isDesktop) {
          __dbgPack('B', 'elementPagination.js:paginateElement', 'skip-split-min-remaining', {
            remainingContentHeight: Math.round(remainingContentHeight),
            fitsRelaxed,
            action: fitsRelaxed ? 'keep-relaxed' : 'push-whole',
            preview: (element.textContent || '').trim().slice(0, 70),
            pageEls: currentPageElements.length,
            finalReservedSpace,
            baseAvailableHeight: Math.round(baseAvailableHeight),
          });
        }
        // #endregion

        if (fitsRelaxed) {
          elementFootnotes.forEach(num => currentPageFootnotes.add(num));
          currentPageElements.push(element.outerHTML);
        } else {
          if (currentPageElements.length > 0) {
            pushPage(block);
          }
          startNewPage(false);
          elementFootnotes.forEach(num => currentPageFootnotes.add(num));
          currentPageElements.push(element.outerHTML);
        }
      }
    }
  }
  
  return { pageHasHeading };
};

