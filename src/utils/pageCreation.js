import { renderFootnotesSection } from './footnotes';
import {
  BOTTOM_MARGIN_FIRST_PAGE,
  BOTTOM_MARGIN_KARAOKE,
  BOTTOM_MARGIN_MOBILE,
  FOOTNOTE_BAND_MAX,
  fitFootnotesToBand,
} from './pageGeometry';
import { measureFootnotesHeight } from './paginationHelpers';

/**
 * Remove empty paragraphs from the start of elements array
 * Used for standalone first page to fit more content on small screens
 */
export const removeEmptyParagraphs = (elements, isStandaloneFirstPage, isDesktop = false) => {
  if (!isStandaloneFirstPage) return elements;
  
  // For desktop, remove more empty paragraphs to fit content better
  // For mobile, use screen height-based logic
  let maxRemovals;
  if (isDesktop) {
    maxRemovals = 3; // Remove up to 6 empty paragraphs on desktop
  } else {
  const deviceScreenHeight = typeof window !== 'undefined' && window.screen ? window.screen.height : 1000;
    maxRemovals = deviceScreenHeight <= 700 ? 5 : deviceScreenHeight <= 850 ? 1 : 0;
  }
  
  const initialLength = elements.length;
  let removedFromArray = 0;
  
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
  
  
  return filteredElements;
};

/** Escape text for use in HTML title attribute */
const escapeTitle = (s) => String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/&/g, '&amp;');

/** Convert number to Unicode superscript (e.g. 1 → ¹, 12 → ¹²) for plain-text tooltips */
const toSuperscript = (n) => String(n).replace(/[0-9]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);

/**
 * Process footnotes in content: replace ^[content] with superscript numbers
 */
export const processFootnotesInContent = (content, footnoteContentToNumber, allFootnotes) => {
  const footnoteRegex = /\^\[([^\]]+)\]/g;
  const pageFootnotes = [];
  
  const processedContent = content.replace(footnoteRegex, (match, footnoteContent) => {
    const trimmedContent = footnoteContent.trim();
    // Hyphenation adds soft hyphens (\u00AD) to content before we run; getAllFootnotes
    // parses the original un-hyphenated content. Normalize by removing soft hyphens
    // so the lookup matches.
    const normalizedContent = trimmedContent.replace(/\u00AD/g, '');
    const globalNumber = footnoteContentToNumber.get(normalizedContent) || footnoteContentToNumber.get(trimmedContent);
    if (globalNumber) {
      // Find the full footnote data
      const footnote = allFootnotes.find(fn => fn.globalNumber === globalNumber);
      if (footnote && !pageFootnotes.find(fn => fn.globalNumber === globalNumber)) {
        pageFootnotes.push(footnote);
      }
      const titleContent = footnote?.content ?? trimmedContent;
      const titleWithSuperscript = escapeTitle(toSuperscript(globalNumber) + ' ' + titleContent);
      return `<sup class="footnote-ref" data-footnote-number="${globalNumber}" title="${titleWithSuperscript}">${globalNumber}</sup>`;
    }
    // Fallback: use local numbering if not found in global map
    return `<sup class="footnote-ref">?</sup>`;
  });
  
  // Sort footnotes by global number
  pageFootnotes.sort((a, b) => a.globalNumber - b.globalNumber);
  
  return { processedContent, pageFootnotes };
};

/**
 * Calculate page padding based on karaoke and page type.
 * Must match getReservedBottomSpace() so packer fill and rendered padding stay in sync.
 * Mobile bottom pad is the page-number band only (footnotes are display:none).
 */
export const calculatePagePadding = (pageFootnotes, currentPageFootnotes, hasKaraoke, isStandaloneFirstPage, measure, allFootnotes, isDesktop, pageWidth) => {
  if (hasKaraoke) return BOTTOM_MARGIN_KARAOKE;
  if (isStandaloneFirstPage) return BOTTOM_MARGIN_FIRST_PAGE;
  // Mobile content wrapper padding; desktop uses body padding (paddingBottom forced to 0 below).
  return isDesktop ? 0 : BOTTOM_MARGIN_MOBILE;
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
  pageWidth,
  /** Mutable Set of spilled footnote numbers carried from previous pages */
  footnoteSpill = null,
  /** Skip mobile canonical font/line-height (first page, cover, intro chapter) */
  preserveTypography = false,
}) => {
  if (!elements.length) return null;
  
  // CRITICAL: For standalone first page, remove empty paragraphs from the start BEFORE processing
  const isStandaloneFirstPage = chapter.isFirstPage && chapterPageIndex === 0;
  // Book page 1 (first regular / intro chapter) uses the same tight bottom reserve.
  const useTightBottomReserve =
    isStandaloneFirstPage ||
    (!!preserveTypography && !chapter.isCover && !chapter.isFirstPage && chapterPageIndex === 0);
  const filteredElements = removeEmptyParagraphs(elements, isStandaloneFirstPage, isDesktop);
  
  // Log elements being used to create page on desktop
  if (isDesktop) {
    const pageElements = filteredElements.map((el, idx) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      return {
        index: idx,
        text: temp.textContent || '', // Full text
        html: el // Full HTML
      };
    });
  }
  
  // Process footnotes in content: replace ^[content] with superscript numbers
  let processedContent = filteredElements.join('');
  const { processedContent: contentWithFootnotes, pageFootnotes } = processFootnotesInContent(
    processedContent,
    footnoteContentToNumber,
    allFootnotes
  );
  processedContent = contentWithFootnotes;

  // Merge content footnotes with any spilled defs from earlier pages, then fit to band.
  const candidateNumbers = new Set([
    ...(footnoteSpill ? Array.from(footnoteSpill) : []),
    ...pageFootnotes.map((fn) => fn.globalNumber),
  ]);
  let footnotesForSection = pageFootnotes;
  if (candidateNumbers.size > 0 && measure?.body) {
    const { fitted, spill } = fitFootnotesToBand(
      candidateNumbers,
      (set) => measureFootnotesHeight(
        set,
        measure.body,
        allFootnotes,
        isDesktop,
        pageWidth,
        measure.measureCache
      ),
      FOOTNOTE_BAND_MAX
    );
    footnotesForSection = Array.from(fitted)
      .sort((a, b) => a - b)
      .map((num) => allFootnotes.find((fn) => fn.globalNumber === num))
      .filter(Boolean);
    if (footnoteSpill) {
      footnoteSpill.clear();
      spill.forEach((num) => footnoteSpill.add(num));
    }
  } else if (footnoteSpill) {
    footnoteSpill.clear();
  }
  
  // Add footnotes section at the bottom if there are any (PDF export; hidden on-screen)
  let footnotesHtml = '';
  if (footnotesForSection.length > 0) {
    footnotesHtml = renderFootnotesSection(footnotesForSection);
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
    useTightBottomReserve,
    measure,
    allFootnotes,
    isDesktop,
    pageWidth
  );
  
  // For desktop, .page-body already has padding; mobile page-content-main gets the
  // same BOTTOM_MARGIN_MOBILE the packer subtracted (not a footnote band).
  const paddingBottom = isDesktop ? 0 : reservedSpace;
  const contentWrapper = `<div class="page-content-main" style="${paddingBottom > 0 ? `padding-bottom: ${paddingBottom}px;` : ''}">${processedContent}</div>${footnotesHtml}`;
  
  // Check if this page should have a background video (1-indexed page number)
  const pageNumber = chapterPageIndex + 1; // Convert 0-indexed to 1-indexed
  const backgroundVideoSrc = backgroundVideosByPage?.get(pageNumber) || null;
  
  const newPage = {
    chapterIndex: chapterIndex,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subchapterId: blockMeta.subchapterId,
    subchapterTitle: blockMeta.type === 'subchapter' ? blockMeta.title : null,
    // Pages inherit border setting from the source block (chapter or subchapter)
    hasBorder: !!(blockMeta.pageBorder),
    borderImageUrl: blockMeta.pageBorderImageUrl || null,
    borderWidth: blockMeta.pageBorderWidth || null,
    borderSlicePercent: blockMeta.pageBorderSlicePercent || null,
    borderImageNaturalWidth: blockMeta.pageBorderImageNaturalWidth || null,
    borderImageNaturalHeight: blockMeta.pageBorderImageNaturalHeight || null,
    borderAssetKind: blockMeta.pageBorderAssetKind || null,
    borderSliceVerticalPercent: blockMeta.pageBorderSliceVerticalPercent || null,
    borderSliceHorizontalPercent: blockMeta.pageBorderSliceHorizontalPercent || null,
    fontFamily: blockMeta.fontFamily || null,
    pageIndex: chapterPageIndex,
    hasHeading: pageHasHeading,
    hasFieldNotes: hasFieldNotes || false,
    content: contentWrapper,
    footnotes: footnotesForSection, // Fitted-to-band footnotes for this page (spill carried forward)
    backgroundVideo: backgroundVideoSrc,
    backgroundImageUrl: chapter.backgroundImageUrl || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
    preserveTypography:
      !!(preserveTypography || chapter.isFirstPage || chapter.isCover),
  };
  
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

