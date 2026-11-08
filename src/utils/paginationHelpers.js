import { hyphenateSync } from 'hyphen/en';
import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';
import {
  DESKTOP_BODY_PADDING_BOTTOM,
  DESKTOP_BODY_PADDING_LEFT,
  DESKTOP_BODY_PADDING_RIGHT,
  DESKTOP_BODY_PADDING_TOP,
  FOOTNOTE_EXTRA_PADDING_PX,
  getDesktopBodyContentHeight,
  getFontSize,
  getLineHeight,
  getOverflowTolerance,
  getReservedBottomSpace,
  MOBILE_PRESERVE_FONT_SIZE,
  MOBILE_LINE_HEIGHT,
} from './pageGeometry';
import { createMeasureCache } from './measureCache';

/**
 * Normalize word for matching (remove diacritics, lowercase, etc.)
 */
export const normalizeWord = (value) => {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/'/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, '');
};

/**
 * Tokenize text into words with positions
 */
export const tokenizeText = (text) => {
  const tokens = [];
  // Use compatible regex without Unicode property escapes for older Safari support
  // \p{L} = letters, \p{N} = numbers - replaced with explicit ranges
  const TOKEN_REGEX = /[a-zA-Z0-9\u00C0-\u017F\u0400-\u04FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF''']+/gu;
  for (const match of text.matchAll(TOKEN_REGEX)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const indices = [];
    for (let i = start; i < end; i += 1) {
      indices.push(i);
    }
    tokens.push({
      raw,
      start,
      end,
      indices,
      normalized: normalizeWord(raw),
    });
  }
  return tokens;
};

/**
 * Assign letter-level timings from word timings
 */
export const assignLetterTimingsToChars = (text, wordTimings = []) => {
  const letterTimings = new Array(text.length).fill(null);
  const wordCharRanges = [];
  const tokens = tokenizeText(text);
  let tokenPointer = 0;

  wordTimings.forEach(({ word, start, end }) => {
    const normalizedWord = normalizeWord(word);
    if (!normalizedWord) {
      wordCharRanges.push(null);
      return;
    }

    let matchedToken = null;
    while (tokenPointer < tokens.length) {
      const candidate = tokens[tokenPointer];
      if (!candidate.normalized) {
        tokenPointer += 1;
        continue;
      }
      if (candidate.normalized === normalizedWord) {
        matchedToken = candidate;
        break;
      }
      tokenPointer += 1;
    }

    if (!matchedToken) {
      wordCharRanges.push(null);
      return;
    }

    const duration = Math.max((end ?? 0) - (start ?? 0), 0.001);
    const indices = matchedToken.indices;
    const spanLength = indices.length || 1;

    indices.forEach((idx, position) => {
      const ratioStart = position / spanLength;
      const ratioEnd = (position + 1) / spanLength;
      letterTimings[idx] = {
        start: (start ?? 0) + duration * ratioStart,
        end: (start ?? 0) + duration * ratioEnd,
      };
    });

    wordCharRanges.push({
      word,
      start,
      end,
      charStart: indices[0],
      charEnd: indices[indices.length - 1] + 1,
      wordIndex: wordCharRanges.length,
    });

    tokenPointer += 1;
  });

  return { letterTimings, wordCharRanges };
};

/**
 * Apply hyphenation to HTML content - the hyphen library automatically skips HTML tags
 * IMPORTANT: We EXCLUDE karaoke blocks themselves from this page-level hyphenation.
 * Karaoke text has its OWN controlled hyphenation pipeline (using the same library)
 * so that highlighting logic can stay in sync with where soft hyphens are inserted.
 */
export const applyHyphenationToHTML = (html) => {
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
        
        // Hyphenation applied successfully
        return result;
      }
    }
    
    // No karaoke blocks, apply hyphenation normally
    const hyphenated = hyphenateSync(html);
    return hyphenated;
  } catch (error) {
    return html;
  }
};

/**
 * Creates a measurement container that matches the real DOM structure exactly.
 * Geometry comes from pageGeometry.js so reader / PDF / karaoke share one source of truth.
 */
export const createMeasureContainer = (isDesktop, pageWidth, pageHeight) => {
  const measureCache = createMeasureCache();
  const container = document.createElement('div');
  container.className = 'page-container';
  container.style.position = 'absolute';
  container.style.visibility = 'hidden';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = isDesktop ? `${pageWidth}px` : '100%';
  // Desktop uses a fixed PDF page height; mobile should track the *visible*
  // viewport height so measurements match what the user sees (iOS Safari
  // URL bar makes 100vh larger than the visible area).
  if (isDesktop) {
    container.style.height = `${pageHeight}px`;
  } else {
    // Prefer the LIVE reader page-container box when mounted — that is the ground
    // truth for what the user sees. Fall back to 100dvh (same as PageReader.css).
    const liveBox =
      typeof document !== 'undefined' &&
      document.querySelector('.page-reader .page-container, .page-turn-surface .page-container');
    const liveRect = liveBox?.getBoundingClientRect?.();
    if (liveRect && liveRect.height > 100 && liveRect.width > 100) {
      container.style.width = `${Math.round(liveRect.width)}px`;
      container.style.height = `${Math.round(liveRect.height)}px`;
    } else {
      container.style.height = '100dvh';
      if (pageHeight && Number.isFinite(pageHeight) && pageHeight > 0) {
        container.style.minHeight = `${pageHeight}px`;
      }
    }
  }
  // Desktop: no container padding (page-sheet is direct child, matches PDFViewer.css structure)
  // Mobile: MUST match live PageReader.css `.page-container { padding: 2rem 1rem 0 }`
  // (older 1.5rem / 0.5rem bottom made measure narrower + shorter → systematic underfill)
  container.style.padding = isDesktop ? '0' : '2rem 1rem 0';
  container.style.boxSizing = 'border-box';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.pointerEvents = 'none';

  const sheet = document.createElement('div');
  sheet.className = 'page-sheet content-page';
  sheet.style.width = isDesktop ? `${pageWidth}px` : 'min(680px, 96vw)';
  // Desktop: sheet has fixed height matching pageHeight (matches PDFViewer.css)
  // Mobile: sheet is 100% of container
  sheet.style.height = isDesktop ? `${pageHeight}px` : '100%';
  sheet.style.display = 'flex';
  sheet.style.flexDirection = 'column';
  sheet.style.alignItems = 'flex-start';
  container.appendChild(sheet);

  const body = document.createElement('section');
  body.className = 'page-body';
  body.style.width = '100%';
  body.style.flex = '1';
  // Desktop: page-body uses overflow: visible (matches PDFViewer.css)
  // Mobile: page-body uses overflow: hidden
  body.style.overflow = isDesktop ? 'visible' : 'hidden';
  if (isDesktop) {
    body.style.paddingTop = `${DESKTOP_BODY_PADDING_TOP}px`;
    body.style.paddingRight = `${DESKTOP_BODY_PADDING_RIGHT}px`;
    body.style.paddingLeft = `${DESKTOP_BODY_PADDING_LEFT}px`;
    body.style.paddingBottom = `${DESKTOP_BODY_PADDING_BOTTOM}px`;
    body.style.boxSizing = 'border-box';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    const bodyHeight = getDesktopBodyContentHeight(pageHeight);
    body.style.height = bodyHeight + 'px';
    body.style.minHeight = bodyHeight + 'px';
    body.style.maxHeight = bodyHeight + 'px';
  }
  
  // CRITICAL: Add .page-content wrapper to match real DOM structure
  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.style.width = '100%';
  if (isDesktop) {
    const availableHeight = pageHeight - DESKTOP_BODY_PADDING_TOP - 10;
    pageContent.style.height = 'auto';
    pageContent.style.flex = '1 1 auto';
    pageContent.style.minHeight = '0';
    pageContent.style.maxHeight = availableHeight + 'px';
    pageContent.style.overflow = 'hidden';
  } else {
    // Mobile: match live body-page CSS (1.3rem / 1.35) — same as PageReader
    pageContent.classList.add('page-content--canonical');
    pageContent.style.height = '100%';
    pageContent.style.maxHeight = '100%';
    pageContent.style.fontSize = getFontSize(false);
    pageContent.style.lineHeight = getLineHeight(false);
  }
  body.appendChild(pageContent);
  
  sheet.appendChild(body);
  // Desktop: wrap in .pdf-viewer so measure container gets same CSS as rendered pages.
  let wrapper = null;
  if (isDesktop) {
    wrapper = document.createElement('div');
    wrapper.className = 'pdf-viewer';
    wrapper.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;pointer-events:none';
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
  } else {
    document.body.appendChild(container);
  }

  const syncToLiveReader = () => {
    if (isDesktop || typeof document === 'undefined') return;
    const liveContainer = document.querySelector(
      '.page-reader .page-container, .page-turn-surface .page-container'
    );
    const liveSheet = document.querySelector(
      '.page-reader .page-sheet.content-page, .page-turn-surface .page-sheet.content-page'
    );
    const liveBody = document.querySelector(
      '.page-reader .page-body.content-body, .page-turn-surface .page-body.content-body'
    );
    if (!liveContainer || !liveBody || liveBody.clientHeight < 80) return;
    const w = Math.round(liveContainer.clientWidth);
    const h = Math.round(liveContainer.clientHeight);
    container.style.width = `${w}px`;
    container.style.height = `${h}px`;
    sheet.style.removeProperty('width');
    sheet.style.removeProperty('max-width');
    if (liveSheet) {
      const sw = Math.round(liveSheet.getBoundingClientRect().width);
      if (sw > 0) {
        sheet.style.width = `${sw}px`;
        sheet.style.maxWidth = `${sw}px`;
      }
    }
    sheet.style.height = '100%';
    void container.offsetHeight;
    void liveBody.clientHeight;
  };

  return {
    container,
    sheet,
    body,
    pageContent,
    measureCache,
    syncToLiveReader,
    destroy: () => {
      measureCache.clear();
      if (wrapper) wrapper.remove();
      else container.remove();
    },
    setHeading: (hasHeading) => {
      sheet.classList.remove('page-with-heading', 'page-without-heading');
      sheet.classList.add(hasHeading ? 'page-with-heading' : 'page-without-heading');
      body.offsetHeight;
    },
    getAvailableHeight: (footnotesHeight = 0, isFirstPage = false) => {
      let height;
      if (isDesktop && pageHeight) {
        height = getDesktopBodyContentHeight(pageHeight);
      } else {
        // One height source: live .page-body when mounted, else measure body.
        // One reserve: page-number band (see getReservedBottomSpace). No vv scaling
        // stack — live box already reflects Safari chrome when the reader is up.
        const liveBody =
          typeof document !== 'undefined' &&
          document.querySelector(
            '.page-reader .page-body.content-body, .page-turn-surface .page-body.content-body'
          );
        const liveH = liveBody && liveBody.clientHeight > 80 ? liveBody.clientHeight : 0;
        height = liveH > 0 ? liveH : body.clientHeight;
      }

      const reservedSpace = getReservedBottomSpace({
        isDesktop,
        isFirstPage,
        footnotesHeight,
      });
      return Math.max(0, height - reservedSpace);
    },
  };
};

/**
 * Apply base paragraph CSS to measurement containers
 * This ensures TipTap HTML (with inline text-align styles) is measured
 * with the same base font/line-height/margin as .page-content p
 * @param {HTMLElement} container
 * @param {boolean} isDesktop
 * @param {string} [fontFamily] - Optional chapter font (subchapters inherit from parent)
 */
export const applyParagraphStylesToContainer = (container, isDesktop, fontFamily, options = {}) => {
  const desktopFontSize = getFontSize(isDesktop);
  const desktopLineHeight = getLineHeight(isDesktop);
  const font = fontFamily ?? DEFAULT_CHAPTER_FONT;
  // First page / cover / intro: match live preserve CSS (.page-content 1.18rem),
  // not MOBILE_FONT_SIZE 1.3rem — that mismatch underfills and spills a trailing word.
  const canonicalTypography = options.canonicalTypography !== false;
  const preserveFontSize = isDesktop ? desktopFontSize : MOBILE_PRESERVE_FONT_SIZE;
  const preserveLineHeight = isDesktop ? desktopLineHeight : MOBILE_LINE_HEIGHT;

  const paragraphs = container.querySelectorAll('p');
  paragraphs.forEach(p => {
  // Mobile canonical: match live reader — metrics from PageReader.css (.page-content--canonical),
  // not inline styles (pack shell must measure the same box the overlay green band uses).
    if (canonicalTypography && !isDesktop) {
      p.style.removeProperty('font-size');
      p.style.removeProperty('line-height');
    } else if (canonicalTypography) {
      p.style.fontSize = desktopFontSize;
      p.style.lineHeight = desktopLineHeight;
    } else {
      // Keep inline paste sizes; otherwise match live inherit from .page-content.
      if (!p.style.fontSize) p.style.fontSize = preserveFontSize;
      if (!p.style.lineHeight) p.style.lineHeight = preserveLineHeight;
    }
    if (!p.style.margin) {
      p.style.margin =
        !isDesktop && canonicalTypography ? '0.15rem 0' : '0.35rem 0';
    }
    if (!p.style.fontFamily) p.style.fontFamily = font;
    // Match live .page-content p justification — without this, measure wraps
    // differently (fewer words/line) and the packer underfills the real page.
    if (!p.style.textAlign) {
      p.style.textAlign = 'justify';
      p.style.textAlignLast = 'left';
    }
    if (!p.style.wordSpacing) p.style.wordSpacing = '-0.08em';
    if (!p.style.letterSpacing) p.style.letterSpacing = '0.01em';
    if (!p.style.textJustify) p.style.textJustify = 'inter-word';
    // Live canonical mobile uses soft hyphens only (hyphens:none on reader).
    if (!isDesktop && canonicalTypography) {
      p.style.hyphens = 'none';
      p.style.webkitHyphens = 'none';
    } else if (!p.style.hyphens) {
      p.style.hyphens = 'auto';
    }
    
    // Ensure empty paragraphs create visible spacing
    const isEmpty = !p.textContent || p.textContent.trim().length === 0 || (p.children.length === 0 && (!p.textContent || p.textContent.trim() === ''));
    const hasOnlyBr = p.children.length === 1 && p.children[0].tagName === 'BR' && (!p.textContent || p.textContent.trim() === '');
    if (isEmpty || hasOnlyBr) {
      // Ensure empty paragraphs have minimum height to create spacing
      if (!p.style.minHeight) p.style.minHeight = '0.7rem';
      if (!p.style.display) p.style.display = 'block';
    }
  });
  
  // Apply poetry block styles to match actual rendering
  const poetryBlocks = container.querySelectorAll('div.poetry');
  poetryBlocks.forEach(poetry => {
    // Apply poetry-specific styles that affect height measurement
    if (!poetry.style.margin) poetry.style.margin = '0.8em 0';
    if (!poetry.style.padding) poetry.style.padding = '0 1em';
    if (!poetry.style.textAlign) poetry.style.textAlign = 'center';
    if (!poetry.style.fontStyle) poetry.style.fontStyle = 'italic';
    
    // Apply styles to paragraphs inside poetry blocks
    const poetryParagraphs = poetry.querySelectorAll('p');
    poetryParagraphs.forEach(p => {
      if (!p.style.margin) p.style.margin = '0.3em 0';
      if (!p.style.lineHeight) p.style.lineHeight = '1.6';
    });
  });
};

/**
 * Extract footnotes from HTML content
 * Supports both legacy ^[content] syntax and TipTap-rendered <sup class="footnote-ref"> nodes
 */
export const extractFootnotesFromContent = (htmlContent, footnoteContentToNumber) => {
  const foundFootnotes = new Set();
  if (!htmlContent) return foundFootnotes;

  // Normalize footnote content for lookup - hyphenation adds soft hyphens (\u00AD)
  // before pagination, but getAllFootnotes parses original content. Remove soft hyphens
  // so lookup matches.
  const normalizeForLookup = (s) => s.replace(/\u00AD/g, '');

  // 1) Legacy syntax ^[content]
  const legacyRegex = /\^\[([^\]]+)\]/g;
  let match;
  while ((match = legacyRegex.exec(htmlContent)) !== null) {
    const footnoteContent = match[1].trim();
    const normalized = normalizeForLookup(footnoteContent);
    const globalNumber = footnoteContentToNumber.get(normalized) || footnoteContentToNumber.get(footnoteContent);
    if (globalNumber) {
      foundFootnotes.add(globalNumber);
    }
  }

  // 2) TipTap HTML <sup class="footnote-ref" data-content="...">
  const supRegex = /<sup([^>]*)>([\s\S]*?)<\/sup>/gi;
  while ((match = supRegex.exec(htmlContent)) !== null) {
    const attrs = match[1] || '';
    const classMatch = attrs.match(/class=["']([^"']*)["']/i);
    if (!classMatch || !classMatch[1].split(/\s+/).includes('footnote-ref')) {
      continue;
    }
    const contentAttrMatch = attrs.match(/data-content=["']([^"']*)["']/i);
    if (!contentAttrMatch || !contentAttrMatch[1]) continue;
    const trimmed = contentAttrMatch[1].trim();
    const normalized = normalizeForLookup(trimmed);
    const globalNumber = footnoteContentToNumber.get(normalized) || footnoteContentToNumber.get(trimmed);
    if (globalNumber) {
      foundFootnotes.add(globalNumber);
    }
  }

  return foundFootnotes;
};

/**
 * Measure actual footnote section height (including padding for browser bar)
 */
export const measureFootnotesHeight = (footnoteNumbers, container, allFootnotes, isDesktop, pageWidth, measureCache = null) => {
  if (footnoteNumbers.size === 0) return 0;

  const cacheKey = [
    'fn',
    isDesktop ? 'd' : 'm',
    pageWidth || 0,
    ...Array.from(footnoteNumbers).sort((a, b) => a - b),
  ];
  if (measureCache) {
    const cached = measureCache.get(cacheKey);
    if (cached != null) return cached;
  }
  
  // Get the actual footnote data for accurate measurement
  const footnotesToMeasure = Array.from(footnoteNumbers)
    .sort((a, b) => a - b)
    .map(num => allFootnotes.find(fn => fn.globalNumber === num))
    .filter(fn => fn != null);
  
  if (footnotesToMeasure.length === 0) return 0;
  
  // Measure within the provided container context for accurate dimensions
  const tempDiv = document.createElement('div');
  tempDiv.className = 'footnotes-section';
  // Apply the same padding-bottom as in CSS
  // Desktop PDF uses 2rem, mobile uses calc(env(safe-area-inset-bottom, 0px) + 2rem + 1rem)
  if (isDesktop) {
    tempDiv.style.paddingBottom = '2rem'; // Desktop doesn't need safe-area-inset
    tempDiv.style.padding = '1rem 1.5rem';
  } else {
    tempDiv.style.paddingBottom = 'calc(env(safe-area-inset-bottom, 0px) + 2rem + 1rem)';
    tempDiv.style.padding = '1rem 1.5rem';
  }
  // Use correct width for desktop PDF
  if (isDesktop && pageWidth) {
    tempDiv.style.width = `${pageWidth - 60}px`; // Account for padding (2rem * 2 = ~60px)
  }
  
  const divider = document.createElement('div');
  divider.className = 'footnotes-divider';
  tempDiv.appendChild(divider);
  
  const list = document.createElement('div');
  list.className = 'footnotes-list';
  // Explicitly set font size for desktop to match CSS (0.9rem)
  if (isDesktop) {
    list.style.fontSize = '0.9rem';
    list.style.lineHeight = '1.5';
  }
  
  // Add actual footnote items with real content
  footnotesToMeasure.forEach((fn) => {
    const item = document.createElement('div');
    item.className = 'footnote-item';
    item.innerHTML = `<sup class="footnote-number">${fn.globalNumber}.</sup><span class="footnote-content">${fn.content}</span>`;
    list.appendChild(item);
  });
  
  tempDiv.appendChild(list);
  container.appendChild(tempDiv);
  
  // Force a reflow to ensure accurate measurement
  container.offsetHeight;
  
  const height = tempDiv.offsetHeight;
  container.removeChild(tempDiv);
  
  // Subtract the extra padding from measurement - it's visual spacing at bottom of footnotes,
  // not space that needs to be reserved between content and footnotes
  const result = Math.max(0, height - FOOTNOTE_EXTRA_PADDING_PX);
  if (measureCache) measureCache.set(cacheKey, result);
  return result;
};

/**
 * Check if content + footnotes fit together
 */
export const checkContentWithFootnotesFits = (contentElements, footnoteNumbers, availableHeight, contentWidth, isDesktop, measure, applyParagraphStylesToContainer, measureFootnotesHeight, allFootnotes, pageWidth, fontFamily) => {
  const font = fontFamily ?? DEFAULT_CHAPTER_FONT;

  // First, try to add all content
  // CRITICAL: Insert into measure.pageContent (not measure.body) to match actual DOM structure
  // Actual structure: .page-body > .page-content > content
  const tempContainer = document.createElement('div');
  tempContainer.style.width = contentWidth + 'px';
  // Apply the same font/line-height/margin rules that .page-content p uses
  tempContainer.style.fontFamily = font;
  tempContainer.style.fontSize = getFontSize(isDesktop);
  tempContainer.style.lineHeight = getLineHeight(isDesktop);
  measure.pageContent.appendChild(tempContainer);

  contentElements.forEach(el => {
    const temp = document.createElement('div');
    temp.innerHTML = el;
    tempContainer.appendChild(temp.firstElementChild || temp);
  });

  // Apply base paragraph styles to match actual rendering
  applyParagraphStylesToContainer(tempContainer, isDesktop, font);
  
  // Check if content alone fits
  const contentHeight = tempContainer.offsetHeight;
  
  // If content alone doesn't fit, content + footnotes definitely won't
  if (contentHeight > availableHeight) {
    measure.pageContent.removeChild(tempContainer);
    return { fits: false, contentHeight, footnotesHeight: 0 };
  }
  
  // Now add footnotes and check total height
  // Footnotes are absolutely positioned, so total height = contentHeight + footnotesHeight
  const footnotesHeight = measureFootnotesHeight(footnoteNumbers, tempContainer, allFootnotes, isDesktop, pageWidth);
  const totalHeight = contentHeight + footnotesHeight;
  
  measure.pageContent.removeChild(tempContainer);
  
  return {
    fits: totalHeight <= availableHeight,
    contentHeight,
    footnotesHeight,
    totalHeight
  };
};

/**
 * Check if element is atomic (cannot be split): images, videos, headings, poetry, dinkus
 * NOTE: Karaoke blocks CAN be split (they have their own splitting logic via handleKaraokeElement)
 */
export const isAtomicElement = (element) => {
  const tagName = element.tagName?.toLowerCase();
  // Atomic elements: images, videos, headings
  if (['img', 'video', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
    return true;
  }
  // NOTE: Karaoke blocks are NOT atomic - they can be split across pages
  // They are handled separately by handleKaraokeElement before this check
  // Poetry blocks - must stay together as a unit
  if (element.classList.contains('poetry') || element.tagName?.toLowerCase() === 'div' && element.classList.contains('poetry')) {
    return true;
  }
  // Dinkus blocks - must stay together as a unit
  if (element.classList.contains('dinkus') || element.querySelector('.dinkus, .dinkus-image')) {
    return true;
  }
  // Paragraph epigraph (quote + author) - keep as one unit
  if (element.classList.contains('paragraph-epigraph')) {
    return true;
  }
  // Elements containing atomic children
  if (element.querySelector('img, video, [data-karaoke], .karaoke, .poetry')) {
    return true;
  }
  return false;
};

/**
 * Measure a fragment clone — either solo against maxHeight, or appended to the
 * current page (margin-collapse correct). Page-context mode is required for
 * even mobile fill; solo measure systematically under-packs.
 */
const measureFragmentFit = ({
  clone,
  maxHeight,
  measure,
  contentWidth,
  isDesktop,
  fontFamily,
  currentPageElements = null,
  baseAvailableHeight = null,
  finalReservedSpace = 0,
  overflowTolerance = 2,
  canonicalTypography = true,
}) => {
  // Preserve pages must measure at live .page-content size (1.18rem), not 1.3rem.
  const fontSize = canonicalTypography
    ? getFontSize(isDesktop)
    : (isDesktop ? getFontSize(true) : MOBILE_PRESERVE_FONT_SIZE);
  const lineHeight = canonicalTypography
    ? getLineHeight(isDesktop)
    : (isDesktop ? getLineHeight(true) : MOBILE_LINE_HEIGHT);
  if (!clone.style.fontSize) clone.style.fontSize = fontSize;
  if (!clone.style.lineHeight) clone.style.lineHeight = lineHeight;

  const measureWidth =
    (Number.isFinite(contentWidth) && contentWidth > 0)
      ? contentWidth
      : (measure.pageContent?.clientWidth || measure.body?.clientWidth || 0);
  const measureParent = measure.pageContent || measure.body;
  const tempMeasureContainer = document.createElement('div');
  tempMeasureContainer.style.width = measureWidth + 'px';
  tempMeasureContainer.style.position = 'absolute';
  tempMeasureContainer.style.visibility = 'hidden';
  measureParent.appendChild(tempMeasureContainer);

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'page-content-main';
  const slack = Number.isFinite(overflowTolerance) ? overflowTolerance : 2;

  const usePageContext =
    Array.isArray(currentPageElements) &&
    Number.isFinite(baseAvailableHeight);

  if (usePageContext) {
    contentWrapper.style.paddingBottom = (finalReservedSpace || 0) + 'px';
    currentPageElements.forEach((el) => {
      const temp = document.createElement('div');
      temp.innerHTML = el;
      contentWrapper.appendChild(temp.firstElementChild || temp);
    });
    contentWrapper.appendChild(clone);
    applyParagraphStylesToContainer(contentWrapper, isDesktop, fontFamily, {
      canonicalTypography,
    });
    tempMeasureContainer.appendChild(contentWrapper);
    const height = tempMeasureContainer.offsetHeight;
    measureParent.removeChild(tempMeasureContainer);
    const available = baseAvailableHeight + (finalReservedSpace || 0);
    return height <= available + slack;
  }

  contentWrapper.appendChild(clone);
  applyParagraphStylesToContainer(contentWrapper, isDesktop, fontFamily, {
    canonicalTypography,
  });
  tempMeasureContainer.appendChild(contentWrapper);
  const height = tempMeasureContainer.offsetHeight;
  measureParent.removeChild(tempMeasureContainer);
  return height <= maxHeight + slack;
};

/**
 * After binary search, walk forward word-by-word while the page still fits.
 * Fixes measure-vs-live slack where the cut lands early but the device has
 * tens of px left (e.g. 107px gap + short tail on the next page).
 */
const extendWordSplitToFillPage = (
  element,
  fullText,
  startAbsoluteEnd,
  resolveWordEnd,
  fitOpts
) => {
  if (
    !Array.isArray(fitOpts.currentPageElements) ||
    !Number.isFinite(fitOpts.baseAvailableHeight)
  ) {
    return startAbsoluteEnd;
  }

  let extended = startAbsoluteEnd;
  const tolerance =
    Number.isFinite(fitOpts.overflowTolerance)
      ? fitOpts.overflowTolerance
      : getOverflowTolerance(!!fitOpts.isDesktop);

  let topUpFitOpts = fitOpts;
  if (!fitOpts.isDesktop && fitOpts.measure?.body) {
    const liveBody =
      typeof document !== 'undefined' &&
      document.querySelector(
        '.page-reader .page-body.content-body, .page-turn-surface .page-body.content-body'
      );
    const measureH = fitOpts.measure.body.clientHeight || 0;
    const liveH = liveBody?.clientHeight || 0;
    const extraH = liveH > measureH ? Math.min(140, liveH - measureH) : 0;
    if (extraH > 0 && Number.isFinite(fitOpts.baseAvailableHeight)) {
      topUpFitOpts = {
        ...fitOpts,
        baseAvailableHeight: fitOpts.baseAvailableHeight + extraH,
      };
    }
  }

  let cursor = extended;
  while (cursor < fullText.length) {
    while (cursor < fullText.length && /\s/.test(fullText[cursor])) {
      cursor += 1;
    }
    if (cursor >= fullText.length) break;

    const { range, absoluteEnd: wordEnd } = resolveWordEnd(
      Math.min(cursor, fullText.length - 1)
    );
    if (wordEnd <= extended) break;

    const clone = element.cloneNode(true);
    clone.innerHTML = '';
    clone.appendChild(range.cloneContents());

    const fits = measureFragmentFit({
      clone,
      ...topUpFitOpts,
      overflowTolerance: tolerance,
    });
    if (!fits) break;
    extended = wordEnd;
    cursor = wordEnd;
  }

  return extended;
};

/**
 * Split text element at word boundaries while preserving HTML structure
 * Uses Range API to find the split point that preserves formatting.
 * Pass currentPageElements + baseAvailableHeight for page-context measuring (mobile).
 */
export const splitTextAtWordBoundary = (element, maxHeight, measure, options = {}) => {
  const {
    returnCharCount = false,
    contentWidth,
    isDesktop,
    fontFamily,
    currentPageElements = null,
    baseAvailableHeight = null,
    finalReservedSpace = 0,
    canonicalTypography = true,
    overflowTolerance: overflowToleranceOpt = null,
  } = options;
  const fullText = element.textContent || '';
  const overflowTolerance =
    Number.isFinite(overflowToleranceOpt)
      ? overflowToleranceOpt
      : getOverflowTolerance(!!isDesktop);
  if (!fullText.trim()) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Get all text nodes with their positions
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      textNodes.push(node);
    }
  }

  if (textNodes.length === 0) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  const fitOpts = {
    maxHeight,
    measure,
    contentWidth,
    isDesktop,
    fontFamily,
    currentPageElements,
    baseAvailableHeight,
    finalReservedSpace,
    canonicalTypography,
    overflowTolerance,
  };

  const resolveWordEnd = (globalCharIndex) => {
    const range = document.createRange();
    range.setStart(element, 0);
    let charCount = 0;
    let absoluteEnd = globalCharIndex;
    for (const textNode of textNodes) {
      const nodeLength = textNode.textContent.length;
      if (charCount + nodeLength >= globalCharIndex) {
        const offset = globalCharIndex - charCount;
        const text = textNode.textContent;
        let wordBoundary = offset;

        while (wordBoundary < text.length && !/\s/.test(text[wordBoundary])) {
          wordBoundary++;
        }
        if (wordBoundary === text.length && wordBoundary > 0) {
          while (wordBoundary > 0 && !/\s/.test(text[wordBoundary - 1])) {
            wordBoundary--;
          }
        }

        if (wordBoundary > 0 && /[,\.;:!?]/.test(text[wordBoundary - 1])) {
          let safeBoundary = wordBoundary - 1;
          while (
            safeBoundary > 0 &&
            (!/\s/.test(text[safeBoundary]) ||
              /[,\.;:!?]/.test(text[safeBoundary - 1]))
          ) {
            safeBoundary--;
          }
          if (safeBoundary > 0 && /\s/.test(text[safeBoundary])) {
            wordBoundary = safeBoundary;
          }
        }

        range.setEnd(textNode, wordBoundary);
        absoluteEnd = charCount + wordBoundary;
        return { range, absoluteEnd };
      }
      charCount += nodeLength;
    }
    range.setEnd(element, element.childNodes.length);
    return { range, absoluteEnd: fullText.length };
  };

  // Binary search to find split point — store the *measured* word end, not mid.
  let low = 0;
  let high = fullText.length;
  let bestSplit = 0;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const { range, absoluteEnd } = resolveWordEnd(mid);

    const clone = element.cloneNode(true);
    const cloneRange = range.cloneContents();
    clone.innerHTML = '';
    clone.appendChild(cloneRange);

    if (measureFragmentFit({ clone, ...fitOpts })) {
      bestSplit = absoluteEnd;
      low = Math.max(mid + 1, absoluteEnd + 1);
    } else {
      high = mid;
    }
  }

  // Prefer keeping the whole block when it fits in page context — but only within
  // the real overflow tolerance (never ~1 line past the page-number band).
  const fullClone = element.cloneNode(true);
  const fullFitOpts = {
    ...fitOpts,
    overflowTolerance: isDesktop ? 2 : 8,
  };
  if (measureFragmentFit({ clone: fullClone, ...fullFitOpts })) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  if (bestSplit === 0) {
    return {
      first: null,
      second: element.outerHTML,
      firstCharCount: returnCharCount ? 0 : undefined,
    };
  }

  const filledEnd = !isDesktop
    ? extendWordSplitToFillPage(
        element,
        fullText,
        bestSplit,
        resolveWordEnd,
        fitOpts
      )
    : bestSplit;

  // Rebuild with the SAME word-end resolver used during binary search.
  const { range, absoluteEnd } = resolveWordEnd(filledEnd);
  if (absoluteEnd <= 0) {
    return {
      first: null,
      second: element.outerHTML,
      firstCharCount: returnCharCount ? 0 : undefined,
    };
  }
  if (absoluteEnd >= fullText.length) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  const firstPart = element.cloneNode(true);
  firstPart.innerHTML = '';
  firstPart.appendChild(range.cloneContents());
  
  const secondPart = element.cloneNode(true);
  secondPart.innerHTML = '';
  const secondRange = document.createRange();
  secondRange.setStart(range.endContainer, range.endOffset);
  secondRange.setEnd(element, element.childNodes.length);
  secondPart.appendChild(secondRange.cloneContents());
  
  // Trim leading whitespace from second part to prevent gaps
  const secondTextNodes = [];
  const secondWalker = document.createTreeWalker(
    secondPart,
    NodeFilter.SHOW_TEXT,
    null
  );
  let secondNode;
  while (secondNode = secondWalker.nextNode()) {
    if (secondNode.textContent.trim()) {
      secondTextNodes.push(secondNode);
    }
  }
  if (secondTextNodes.length > 0 && secondTextNodes[0].textContent) {
    const originalText = secondTextNodes[0].textContent;
    const trimmedText = originalText.replace(/^\s+/, '');
    if (trimmedText !== originalText) {
      secondTextNodes[0].textContent = trimmedText;
    }
  }

  const firstHTML = firstPart.outerHTML;
  const secondHTML = secondPart.outerHTML;
  const firstHasText = !!(firstPart.textContent && firstPart.textContent.trim());
  const secondHasText = !!(secondPart.textContent && secondPart.textContent.trim());

  if (!firstHasText) {
    return {
      first: null,
      second: element.outerHTML,
      firstCharCount: returnCharCount ? 0 : undefined,
    };
  }
  if (!secondHasText) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  return {
    first: firstHTML,
    second: secondHTML,
    firstCharCount: returnCharCount ? absoluteEnd : undefined,
  };
};

/**
 * Split text element at sentence boundaries (more granular than word boundaries)
 * Tries to split at sentence ends (. ! ?) followed by space/capital letter
 */
export const splitTextAtSentenceBoundary = (element, maxHeight, measure, splitTextAtWordBoundary, options = {}) => {
  const {
    returnCharCount = false,
    contentWidth,
    isDesktop,
    fontFamily,
    currentPageElements = null,
    baseAvailableHeight = null,
    finalReservedSpace = 0,
    overflowTolerance = 2,
  } = options;
  const fullText = element.textContent || '';
  if (!fullText.trim()) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Find sentence boundaries: . ! ? followed by space and capital letter (or end of text)
  // Also handle cases where sentence ends at end of text
  const sentenceBoundaries = [];
  const sentenceEndRegex = /([.!?])\s+(?=[A-Z])/g;
  let match;
  
  while ((match = sentenceEndRegex.exec(fullText)) !== null) {
    sentenceBoundaries.push(match.index + match[0].length); // Position after space
  }
  
  // Always include end of text as a boundary
  sentenceBoundaries.push(fullText.length);

  if (sentenceBoundaries.length <= 1) {
    // No sentence boundaries found, fall back to word boundary
    return splitTextAtWordBoundary(element, maxHeight, measure, options);
  }

  // Get all text nodes for Range API
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent.trim()) {
      textNodes.push(node);
    }
  }

  if (textNodes.length === 0) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  const fitOpts = {
    maxHeight,
    measure,
    contentWidth,
    isDesktop,
    fontFamily,
    currentPageElements,
    baseAvailableHeight,
    finalReservedSpace,
    overflowTolerance: 2,
  };

  const usePageContext =
    Array.isArray(currentPageElements) && Number.isFinite(baseAvailableHeight);

  // Try to fit as many sentences as possible (page-context when provided)
  let bestFit = 0;
  for (let i = 0; i < sentenceBoundaries.length; i++) {
    const targetCharCount = sentenceBoundaries[i];
    
    // Create range up to this character position
    const range = document.createRange();
    range.setStart(element, 0);
    
    let charCount = 0;
    let found = false;
    for (const textNode of textNodes) {
      const nodeLength = textNode.textContent.length;
      if (charCount + nodeLength >= targetCharCount) {
        const offset = targetCharCount - charCount;
        range.setEnd(textNode, offset);
        found = true;
        break;
      }
      charCount += nodeLength;
    }
    
    if (!found) {
      range.setEnd(element, element.childNodes.length);
    }

    const clone = element.cloneNode(true);
    const cloneRange = range.cloneContents();
    clone.innerHTML = '';
    clone.appendChild(cloneRange);

    if (measureFragmentFit({ clone, ...fitOpts })) {
      bestFit = i + 1;
    } else {
      break;
    }
  }

  if (bestFit === 0) {
    // Can't fit even one sentence, fall back to word boundary
    return splitTextAtWordBoundary(element, maxHeight, measure, options);
  }

  if (bestFit === sentenceBoundaries.length) {
    // All sentences fit
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Split at sentence boundary (desktop / sentence-first callers).
  // Mobile uses preferWordSplit → splitTextAtWordBoundary directly.
  const firstCharCount = sentenceBoundaries[bestFit - 1];
  
  // Create split using Range API
  const range = document.createRange();
  range.setStart(element, 0);
  
  let charCount = 0;
  for (const textNode of textNodes) {
    const nodeLength = textNode.textContent.length;
    if (charCount + nodeLength >= firstCharCount) {
      const offset = firstCharCount - charCount;
      range.setEnd(textNode, offset);
      break;
    }
    charCount += nodeLength;
  }

  // Extract first and second parts
  const firstPart = element.cloneNode(true);
  firstPart.innerHTML = '';
  firstPart.appendChild(range.cloneContents());
  
  const secondPart = element.cloneNode(true);
  secondPart.innerHTML = '';
  const secondRange = document.createRange();
  secondRange.setStart(range.endContainer, range.endOffset);
  // Set end to after the last child node to ensure we capture all remaining content
  if (element.childNodes.length > 0) {
    const lastChild = element.childNodes[element.childNodes.length - 1];
    if (lastChild.nodeType === Node.TEXT_NODE) {
      secondRange.setEnd(lastChild, lastChild.textContent.length);
    } else {
      // For element nodes, set end to after the last child
  secondRange.setEnd(element, element.childNodes.length);
    }
  } else {
    secondRange.setEnd(element, 0);
  }
  
  // Check if range is collapsed (empty) - if so, there's no remaining content
  const isRangeCollapsed = secondRange.collapsed;
  let secondHasContent = !isRangeCollapsed;
  
  if (secondHasContent) {
    const secondContents = secondRange.cloneContents();
    secondPart.appendChild(secondContents);
    // Double-check that second part has actual text content (not just empty tags)
    const hasTextContent = secondPart.textContent && secondPart.textContent.trim().length > 0;
    if (!hasTextContent) {
      secondPart.innerHTML = '';
      secondHasContent = false;
    }
  }
  
  // Trim leading whitespace from second part to prevent gaps
  // This ensures clean breaks at sentence boundaries
  const secondTextNodes = [];
  const secondWalker = document.createTreeWalker(
    secondPart,
    NodeFilter.SHOW_TEXT,
    null
  );
  let secondNode;
  while (secondNode = secondWalker.nextNode()) {
    if (secondNode.textContent.trim()) {
      secondTextNodes.push(secondNode);
    }
  }
  // Trim leading whitespace from first text node in second part
  if (secondTextNodes.length > 0 && secondTextNodes[0].textContent) {
    const originalText = secondTextNodes[0].textContent;
    const trimmedText = originalText.replace(/^\s+/, '');
    if (trimmedText !== originalText) {
      secondTextNodes[0].textContent = trimmedText;
    }
  }

  // Get outerHTML AFTER trimming to ensure changes are captured
  const firstHTML = firstPart.outerHTML;
  const secondHTML = secondPart.outerHTML;

  return {
    first: firstHTML,
    second: secondHTML,
    firstCharCount: returnCharCount ? firstCharCount : undefined,
  };
};

/**
 * Sort chapters: isFirstPage first, then isCover, then regular chapters by order
 */
export const sortChapters = (chapters) => {
  return [...chapters].sort((a, b) => {
    // First page comes first
    if (a.isFirstPage && !b.isFirstPage) return -1;
    if (!a.isFirstPage && b.isFirstPage) return 1;
    // Cover page comes after first page
    if (a.isCover && !b.isCover) return -1;
    if (!a.isCover && b.isCover) return 1;
    // Then sort by order
    return (a.order || 0) - (b.order || 0);
  });
};

/**
 * Determine chapterIndex: use order field, or special indices for first page/cover
 */
export const determineChapterIndex = (chapter, chapterIdx) => {
  if (chapter.isFirstPage) {
    return -2; // Special index for first page
  } else if (chapter.isCover) {
    return -1; // Special index for cover
  } else {
    return chapter.order !== undefined ? chapter.order : chapterIdx;
  }
};

/**
 * Create empty page for special pages (first page, cover)
 */
export const createEmptyPage = (chapter, chapterIndex, chapterPageIndex, hasFieldNotes = false) => {
  return {
    chapterIndex: chapterIndex,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subchapterId: null,
    subchapterTitle: null,
    pageIndex: chapterPageIndex,
    hasHeading: false,
    hasFieldNotes: hasFieldNotes,
    content: '',
    footnotes: [],
    // Special pages can also have per-chapter border frames, same as regular chapters
    hasBorder: !!chapter.pageBorder,
    borderImageUrl: chapter.pageBorderImageUrl || null,
    borderWidth: chapter.pageBorderWidth || null,
    borderSlicePercent: chapter.pageBorderSlicePercent || null,
    borderImageNaturalWidth: chapter.pageBorderImageNaturalWidth || null,
    borderImageNaturalHeight: chapter.pageBorderImageNaturalHeight || null,
    borderAssetKind: chapter.pageBorderAssetKind || null,
    borderSliceVerticalPercent: chapter.pageBorderSliceVerticalPercent || null,
    borderSliceHorizontalPercent: chapter.pageBorderSliceHorizontalPercent || null,
    fontFamily: chapter.fontFamily || null,
    backgroundImageUrl: chapter.backgroundImageUrl || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
    preserveTypography: !!(chapter.isFirstPage || chapter.isCover),
  };
};

/**
 * Create epigraph page
 */
export const createEpigraphPage = (block, chapter, chapterIndex, chapterPageIndex) => {
  let epigraphText = '';
  let epigraphAuthor = '';
  let epigraphAlign = 'center';
  
  if (block.epigraph && typeof block.epigraph === 'object') {
    epigraphText = (block.epigraph.text || '').trim();
    epigraphAuthor = (block.epigraph.author || '').trim();
    epigraphAlign = block.epigraph.align || 'center';
  } else if (typeof block.epigraph === 'string') {
    epigraphText = block.epigraph.trim();
  }
  
  if (!epigraphText) return null;

  // Prefer the same border/background settings that will be used for the
  // chapter / subchapter content pages for visual continuity. Blocks coming
  // from contentProcessing already carry pageBorder* fields; fall back to
  // chapter-level settings when block-level ones are not present.
  const hasBorder = !!(block.pageBorder || chapter.pageBorder);
  const borderImageUrl = block.pageBorderImageUrl || chapter.pageBorderImageUrl || null;
  const borderWidth = (block.pageBorderImageUrl ? block.pageBorderWidth : null)
    ?? chapter.pageBorderWidth
    ?? null;
  const borderSlicePercent = (block.pageBorderImageUrl ? block.pageBorderSlicePercent : null)
    ?? chapter.pageBorderSlicePercent
    ?? null;
  const borderImageNaturalWidth = (block.pageBorderImageUrl ? block.pageBorderImageNaturalWidth : null)
    ?? chapter.pageBorderImageNaturalWidth
    ?? null;
  const borderImageNaturalHeight = (block.pageBorderImageUrl ? block.pageBorderImageNaturalHeight : null)
    ?? chapter.pageBorderImageNaturalHeight
    ?? null;
  const borderAssetKind = (block.pageBorderImageUrl ? block.pageBorderAssetKind : null)
    ?? chapter.pageBorderAssetKind
    ?? null;
  const borderSliceVerticalPercent = (block.pageBorderImageUrl ? block.pageBorderSliceVerticalPercent : null)
    ?? chapter.pageBorderSliceVerticalPercent
    ?? null;
  const borderSliceHorizontalPercent = (block.pageBorderImageUrl ? block.pageBorderSliceHorizontalPercent : null)
    ?? chapter.pageBorderSliceHorizontalPercent
    ?? null;
  
  return {
    chapterIndex: chapterIndex,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subchapterId: block.subchapterId,
    subchapterTitle: block.type === 'subchapter' ? block.title : null,
    pageIndex: chapterPageIndex,
    hasHeading: false,
    isEpigraph: true,
    epigraphText,
    epigraphAuthor,
    epigraphAlign,
    // Epigraph pages should inherit the same frame and background as the
    // chapter / subchapter they belong to, so the visual frame is identical
    // to the first content page that follows.
    hasBorder,
    borderImageUrl,
    borderWidth,
    borderSlicePercent,
    borderImageNaturalWidth,
    borderImageNaturalHeight,
    borderAssetKind,
    borderSliceVerticalPercent,
    borderSliceHorizontalPercent,
    fontFamily: block.fontFamily || chapter.fontFamily || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
    content: '',
    footnotes: [],
    backgroundImageUrl: chapter.backgroundImageUrl || null,
  };
};

/**
 * Create video page (blank page with fullscreen autoplay video)
 */
export const createVideoPage = (video, chapter, chapterIndex, chapterPageIndex, block) => {
  return {
    chapterIndex: chapterIndex,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subchapterId: block?.subchapterId || null,
    subchapterTitle: block?.type === 'subchapter' ? block.title : null,
    pageIndex: chapterPageIndex,
    hasHeading: false,
    isVideo: true,
    videoSrc: video.src,
    content: '',
    footnotes: [],
    backgroundImageUrl: chapter.backgroundImageUrl || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
  };
};

/**
 * Extract background videos with their targetPage from content blocks
 * Returns Map of pageNumber → videoSrc
 */
export const extractBackgroundVideos = (contentBlocks) => {
  const backgroundVideosByPage = new Map();
  const videoRegex = /<video[^>]*data-video-mode=["']background["'][^>]*data-target-page=["'](\d+)["'][^>]*src=["']([^"']+)["'][^>]*>/gi;
  
  contentBlocks.forEach((block) => {
    const content = block.content || '';
    let match;
    while ((match = videoRegex.exec(content)) !== null) {
      const targetPage = parseInt(match[1], 10);
      const videoSrc = match[2];
      if (targetPage && videoSrc && !isNaN(targetPage)) {
        backgroundVideosByPage.set(targetPage, videoSrc);
      }
    }
  });
  
  return backgroundVideosByPage;
};

