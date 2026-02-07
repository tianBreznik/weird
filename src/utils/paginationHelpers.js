import { hyphenateSync } from 'hyphen/en';
import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';

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
 * ============================================================================
 * CRITICAL: BOTTOM MARGIN MISMATCH
 * ============================================================================
 * 
 * There is an intentional mismatch between the bottom margin used for calculations
 * and the bottom margin used for actual page padding:
 * 
 * - getAvailableHeight() uses: 32px for non-first pages
 * - calculatePagePadding() uses: 48px for non-first pages
 * 
 * This mismatch was present in the original code (commit d3dd93cc) and is preserved
 * to maintain exact pagination behavior. The algorithm calculates available space
 * using 32px (more conservative), but pages use 48px padding (more space).
 * 
 * ⚠️ WARNING: If you change one value, you MUST understand the impact on pagination.
 * Changing this mismatch will alter how text is distributed across pages.
 * 
 * ============================================================================
 */

/**
 * Creates a measurement container that matches the real DOM structure exactly.
 * Used for accurate page height calculations during pagination.
 * Appends to document.body with a .pdf-viewer wrapper (desktop) for CSS inheritance.
 */
export const createMeasureContainer = (isDesktop, pageWidth, pageHeight) => {
  const container = document.createElement('div');
  container.className = 'page-container';
  container.style.position = 'absolute';
  container.style.visibility = 'hidden';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = isDesktop ? `${pageWidth}px` : '100%';
  container.style.height = pageHeight + 'px';
  // Desktop: no container padding (page-sheet is direct child, matches PDFViewer.css structure)
  // Mobile: container has padding for centering
  container.style.padding = isDesktop ? '0' : '2rem 1.5rem 0.5rem';
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
  // Desktop: page-body has padding: 3rem 2.5rem (48px top/bottom) - matches PDFViewer.css
  // Mobile: no explicit padding on body (handled by container)
  if (isDesktop) {
    body.style.padding = '3rem 2.5rem';
    body.style.boxSizing = 'border-box';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    // Body height = pageHeight (636px) - padding top (48px) - padding bottom (48px) = 540px
    body.style.height = (pageHeight - 48 - 48) + 'px';
    body.style.minHeight = (pageHeight - 48 - 48) + 'px';
    body.style.maxHeight = (pageHeight - 48 - 48) + 'px';
  }
  
  // CRITICAL: Add .page-content wrapper to match real DOM structure
  // Desktop: .page-content uses height: auto and flex: 1 1 auto (matches PDFViewer.css)
  //   BUT for measurement, we need to constrain it to available height to accurately measure
  // Mobile: .page-content uses height: 90%, max-height: 95% (matches PageReader.css)
  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.style.width = '100%';
  if (isDesktop) {
    // Desktop: In actual rendering, height: auto and flex: 1 1 auto allows growth
    // But for measurement, we need max-height constraint to match available space
        // Calculate available height: body height (540px) - bottom margin (24px) = 516px
        // Algorithm splits at 516px, but visual overflow is allowed via CSS
        const availableHeight = pageHeight - 48 - 48 - 24; // pageHeight - top padding - bottom padding - bottom margin (24px on desktop)
    pageContent.style.height = 'auto';
    pageContent.style.flex = '1 1 auto';
    pageContent.style.minHeight = '0';
    pageContent.style.maxHeight = availableHeight + 'px'; // Constrain to available height for accurate measurement
    pageContent.style.overflow = 'hidden'; // Clip overflow during measurement
  } else {
    // Mobile: match PageReader.css - height: 90%, max-height: 95%
    pageContent.style.height = '90%';
    pageContent.style.maxHeight = '95%';
  }
  body.appendChild(pageContent);
  
  sheet.appendChild(body);
  // Desktop: wrap in .pdf-viewer so measure container gets same CSS as rendered pages.
  // Append to document.body to avoid layout interference from viewer flex/overflow.
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

  return {
    container,
    sheet,
    body,
    pageContent, // Expose pageContent for content insertion
    destroy: () => (wrapper ? wrapper.remove() : container.remove()),
    setHeading: (hasHeading) => {
      sheet.classList.remove('page-with-heading', 'page-without-heading');
      sheet.classList.add(hasHeading ? 'page-with-heading' : 'page-without-heading');
      // Force reflow to apply CSS changes
      body.offsetHeight;
    },
    getAvailableHeight: (footnotesHeight = 0, isFirstPage = false) => {
      // Return actual available height from CSS-applied styles
      // IMPORTANT: Reserve bottom margin even when there are no footnotes (like a real book)
      // Allow the first page a slightly smaller bottom margin so text can sit lower
      // 
      // For desktop: use 24px bottom margin (reduced from 32px) for calculation
      // Algorithm splits at (540px - 24px = 516px), but visual overflow is allowed via CSS
      // For mobile: calculatePagePadding() adds padding-bottom, so reserve 32px (more conservative)
      const BOTTOM_MARGIN_NO_FOOTNOTES = isDesktop 
        ? (isFirstPage ? 20 : 24) // Desktop: 24px (for calculation, visual overflow allowed) or 20px for first page
        : (isFirstPage ? 20 : 32); // Mobile: 32px (calculatePagePadding adds padding-bottom)
      
      // For desktop PDF viewer, use fixed page height minus page-body padding
      // For mobile, use body.clientHeight (matching original behavior)
      let height;
      if (isDesktop && pageHeight) {
        // Desktop: pageHeight is 636px, page-body has padding: 3rem 2.5rem (48px top/bottom)
        // So body content height = 636px - 48px (top) - 48px (bottom) = 540px
        const bodyPaddingTop = 48; // 3rem ≈ 48px
        const bodyPaddingBottom = 48; // 3rem ≈ 48px
        height = pageHeight - bodyPaddingTop - bodyPaddingBottom;
      } else {
        // Mobile: use body.clientHeight (original behavior)
        // NOTE: The real DOM has .page-content with height: 90% of body, but we measure
        // from body directly to match the original pagination algorithm. This ensures
        // consistent text distribution across pages.
        height = body.clientHeight;
      }
      
      // Reserve bottom margin for calculation (algorithm splits at this height)
      // Visual overflow is allowed via CSS (overflow: visible), so content can extend beyond
      const reservedSpace = footnotesHeight > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES;
      const availableHeight = Math.max(0, height - reservedSpace);
      return availableHeight;
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
export const applyParagraphStylesToContainer = (container, isDesktop, fontFamily) => {
  // Desktop PDF uses 1.35rem (matches PDFViewer.css), mobile uses 1.3rem
  const desktopFontSize = isDesktop ? '1.35rem' : '1.3rem';
  // Desktop PDF uses 1.62 line-height (matches PDFViewer.css), mobile uses 1.35
  const desktopLineHeight = isDesktop ? '1.50' : '1.35';
  const font = fontFamily ?? DEFAULT_CHAPTER_FONT;

  const paragraphs = container.querySelectorAll('p');
  paragraphs.forEach(p => {
    // Only apply if not already set (preserve inline styles from TipTap)
    if (!p.style.fontSize) p.style.fontSize = desktopFontSize;
    if (!p.style.lineHeight) p.style.lineHeight = desktopLineHeight;
    if (!p.style.margin) p.style.margin = '0.35rem 0';
    if (!p.style.fontFamily) p.style.fontFamily = font;
    
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
export const measureFootnotesHeight = (footnoteNumbers, container, allFootnotes, isDesktop, pageWidth) => {
  if (footnoteNumbers.size === 0) return 0;
  
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
  // The extra 1rem padding lifts the footnotes section up visually, but doesn't affect content space
  const EXTRA_FOOTNOTE_PADDING = 16; // 1rem in pixels
  return Math.max(0, height - EXTRA_FOOTNOTE_PADDING);
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
  // Desktop PDF uses 1.4rem (matches PDFViewer.css), mobile uses 1.3rem
  tempContainer.style.fontFamily = font;
  tempContainer.style.fontSize = isDesktop ? '1.4rem' : '1.3rem';
  tempContainer.style.lineHeight = isDesktop ? '1.50' : '1.35';
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
  // Elements containing atomic children
  if (element.querySelector('img, video, [data-karaoke], .karaoke, .poetry')) {
    return true;
  }
  return false;
};

/**
 * Split text element at word boundaries while preserving HTML structure
 * Uses Range API to find the split point that preserves formatting
 */
export const splitTextAtWordBoundary = (element, maxHeight, measure, options = {}) => {
  const { returnCharCount = false, contentWidth, isDesktop, fontFamily } = options;
  const fullText = element.textContent || '';
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

  // Binary search to find split point
  let low = 0;
  let high = fullText.length;
  let bestSplit = 0;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    
    // Create range to get text up to mid position
    const range = document.createRange();
    range.setStart(element, 0);
    
    // Find character position across all text nodes
    let charCount = 0;
    let found = false;
    for (const textNode of textNodes) {
      const nodeLength = textNode.textContent.length;
      if (charCount + nodeLength >= mid) {
        const offset = mid - charCount;
        // Find word boundary near this position
        const text = textNode.textContent;
        let wordBoundary = offset;
        
        // Move to nearest word boundary (space or start of word)
        while (wordBoundary < text.length && !/\s/.test(text[wordBoundary])) {
          wordBoundary++;
        }
        if (wordBoundary === text.length && wordBoundary > 0) {
          // Move back to previous space
          while (wordBoundary > 0 && !/\s/.test(text[wordBoundary - 1])) {
            wordBoundary--;
          }
        }

        // Avoid breaking immediately after punctuation like ",", ".", "?" etc.
        // If the candidate break is right after punctuation, look for an earlier space.
        if (
          wordBoundary > 0 &&
          /[,\.;:!?]/.test(text[wordBoundary - 1])
        ) {
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
        found = true;
        break;
      }
      charCount += nodeLength;
    }
    
    if (!found) {
      range.setEnd(element, element.childNodes.length);
    }

    // Create clone with content up to range
    const clone = element.cloneNode(true);
    const cloneRange = range.cloneContents();
    clone.innerHTML = '';
    clone.appendChild(cloneRange);
    
    // Apply font styles to clone to match actual rendering
    const desktopFontSize = isDesktop ? '1.35rem' : '1.3rem';
    const desktopLineHeight = isDesktop ? '1.50' : '1.35';
    if (!clone.style.fontSize) clone.style.fontSize = desktopFontSize;
    if (!clone.style.lineHeight) clone.style.lineHeight = desktopLineHeight;
    
    // Use same structure as checkElementFits/calculateRemainingHeight (page-content-main wrapper)
    const tempMeasureContainer = document.createElement('div');
    const measureWidth = (isDesktop && contentWidth) ? contentWidth : measure.body.clientWidth;
    tempMeasureContainer.style.width = measureWidth + 'px';
    tempMeasureContainer.style.position = 'absolute';
    tempMeasureContainer.style.visibility = 'hidden';
    const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
    measureParent.appendChild(tempMeasureContainer);
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'page-content-main';
    contentWrapper.appendChild(clone);
    applyParagraphStylesToContainer(contentWrapper, isDesktop, fontFamily);
    tempMeasureContainer.appendChild(contentWrapper);
    const height = tempMeasureContainer.offsetHeight;
    measureParent.removeChild(tempMeasureContainer);

    if (height <= maxHeight + 2) {
      bestSplit = mid;
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (bestSplit === 0) {
    return {
      first: null,
      second: element.outerHTML,
      firstCharCount: returnCharCount ? 0 : undefined,
    };
  }
  
  // Check if entire element fits (for returnCharCount calculation)
  const fullClone = element.cloneNode(true);
  // Apply font styles to clone to match actual rendering (same as binary search)
  const desktopFontSize = isDesktop ? '1.35rem' : '1.3rem';
  const desktopLineHeight = isDesktop ? '1.50' : '1.35';
  if (!fullClone.style.fontSize) fullClone.style.fontSize = desktopFontSize;
  if (!fullClone.style.lineHeight) fullClone.style.lineHeight = desktopLineHeight;
  
  // Use same structure as checkElementFits/calculateRemainingHeight (page-content-main wrapper)
  const tempMeasureContainer2 = document.createElement('div');
  const measureWidth2 = (isDesktop && contentWidth) ? contentWidth : measure.body.clientWidth;
  tempMeasureContainer2.style.width = measureWidth2 + 'px';
  tempMeasureContainer2.style.position = 'absolute';
  tempMeasureContainer2.style.visibility = 'hidden';
  const measureParent2 = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
  measureParent2.appendChild(tempMeasureContainer2);
  const contentWrapper2 = document.createElement('div');
  contentWrapper2.className = 'page-content-main';
  contentWrapper2.appendChild(fullClone);
  applyParagraphStylesToContainer(contentWrapper2, isDesktop, fontFamily);
  tempMeasureContainer2.appendChild(contentWrapper2);
  const fullHeight = tempMeasureContainer2.offsetHeight;
  measureParent2.removeChild(tempMeasureContainer2);
  
  if (fullHeight <= maxHeight + 2) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Create the split using Range API
  const range = document.createRange();
  range.setStart(element, 0);
  
  // Find the actual split point at word boundary
  let charCount = 0;
  let splitFound = false;
  for (const textNode of textNodes) {
    const nodeLength = textNode.textContent.length;
    if (charCount + nodeLength >= bestSplit) {
      const offset = bestSplit - charCount;
      const text = textNode.textContent;
      let wordBoundary = offset;
      
      // Find nearest word boundary (prefer space before current position)
      while (wordBoundary > 0 && !/\s/.test(text[wordBoundary - 1])) {
        wordBoundary--;
      }
      if (wordBoundary === 0 && offset < text.length) {
        // If at start, find next space
        while (wordBoundary < text.length && !/\s/.test(text[wordBoundary])) {
          wordBoundary++;
        }
      }

      // Avoid breaking immediately after punctuation; prefer an earlier space.
      if (
        wordBoundary > 0 &&
        /[,\.;:!?]/.test(text[wordBoundary - 1])
      ) {
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
      splitFound = true;
      break;
    }
    charCount += nodeLength;
  }
  
  if (!splitFound) {
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Extract first and second parts
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
  // This ensures clean breaks at word boundaries
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

  // Calculate character count for first part
  const firstCharCount = returnCharCount ? bestSplit : undefined;

  return {
    first: firstHTML,
    second: secondHTML,
    firstCharCount,
  };
};

/**
 * Split text element at sentence boundaries (more granular than word boundaries)
 * Tries to split at sentence ends (. ! ?) followed by space/capital letter
 */
export const splitTextAtSentenceBoundary = (element, maxHeight, measure, splitTextAtWordBoundary, options = {}) => {
  const { returnCharCount = false, contentWidth, isDesktop, fontFamily } = options;
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

  // Try to fit as many sentences as possible
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

    // Measure height
    const clone = element.cloneNode(true);
    const cloneRange = range.cloneContents();
    clone.innerHTML = '';
    clone.appendChild(cloneRange);
    
    // Apply font styles to clone to match actual rendering
    const desktopFontSize = isDesktop ? '1.35rem' : '1.3rem';
    const desktopLineHeight = '1.35';
    if (!clone.style.fontSize) clone.style.fontSize = desktopFontSize;
    if (!clone.style.lineHeight) clone.style.lineHeight = desktopLineHeight;
    
    // Use same structure as checkElementFits/calculateRemainingHeight (page-content-main wrapper)
    const tempMeasureContainer = document.createElement('div');
    const measureWidth = (isDesktop && contentWidth) ? contentWidth : measure.body.clientWidth;
    tempMeasureContainer.style.width = measureWidth + 'px';
    tempMeasureContainer.style.position = 'absolute';
    tempMeasureContainer.style.visibility = 'hidden';
    const measureParent = (isDesktop && measure.pageContent) ? measure.pageContent : measure.body;
    measureParent.appendChild(tempMeasureContainer);
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'page-content-main';
    contentWrapper.appendChild(clone);
    applyParagraphStylesToContainer(contentWrapper, isDesktop, fontFamily);
    tempMeasureContainer.appendChild(contentWrapper);
    const height = tempMeasureContainer.offsetHeight;
    measureParent.removeChild(tempMeasureContainer);

    if (height <= maxHeight + 2) {
      bestFit = i + 1;
    } else {
      break;
    }
  }

  if (bestFit === 0) {
    // Can't fit even one sentence, fall back to word boundary
    return splitTextAtWordBoundary(element, maxHeight, measure, { ...options, contentWidth, isDesktop, fontFamily });
  }

  if (bestFit === sentenceBoundaries.length) {
    // All sentences fit
    return {
      first: element.outerHTML,
      second: null,
      firstCharCount: returnCharCount ? fullText.length : undefined,
    };
  }

  // Split at sentence boundary
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
    fontFamily: chapter.fontFamily || null,
    backgroundImageUrl: chapter.backgroundImageUrl || null,
    isFirstPage: chapter.isFirstPage || false,
    isCover: chapter.isCover || false,
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

