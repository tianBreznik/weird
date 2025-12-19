import { 
  parseFootnotes, 
  getAllFootnotes, 
  renderFootnotesInContent, 
  renderFootnotesSection,
  generateAcknowledgementsContent 
} from '../utils/footnotes';
import { hyphenateSync } from 'hyphen/en';

// Apply hyphenation to HTML content - the hyphen library automatically skips HTML tags
// IMPORTANT: We EXCLUDE karaoke blocks themselves from this page-level hyphenation.
// Karaoke text has its OWN controlled hyphenation pipeline (using the same library)
// so that highlighting logic can stay in sync with where soft hyphens are inserted.
const applyHyphenationToHTML = (html) => {
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
    console.warn('[Hyphenation] Error applying hyphenation:', error);
    return html;
  }
};

const ensureWordSliceInitialized = (karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar) => {
    if (!sliceElement || !sliceElement.isConnected) {
      console.warn('[[INIT]] Cannot initialize slice - not connected');
      return false;
    }

    if (sliceElement.querySelectorAll('.karaoke-word').length > 0) {
      return true;
    }

    const source = karaokeSourcesRef.current[karaokeId];
    if (!source) {
      console.warn('[[INIT]] Cannot initialize slice - no source found');
      return false;
    }

    // Use the source text directly for this slice to preserve newlines.
    // This is more reliable than reading textContent which may have lost <br> tags.
    // IMPORTANT: This text does NOT contain soft hyphens; browser hyphenation
    // (hyphens:auto + lang=\"en\") will insert them at render time, exactly like
    // normal paragraphs. Our indexing logic uses this clean text.
    const sourceText = source.text || '';
    const sliceStart = startChar;
    const sliceEnd = typeof endChar === 'number' ? endChar : sliceStart + sourceText.length;
    let text = sourceText.slice(sliceStart, sliceEnd);
    // Normalize apostrophes to match the original text format used in tokenization
    // Convert curly apostrophes (U+2019) to straight apostrophes (U+0027) for consistency
    text = text.replace(/'/g, "'");
    if (!text.trim()) {
      console.warn('[[INIT]] Cannot initialize slice - no text content');
      return false;
    }

    const fragment = document.createDocumentFragment();
    
    // POLISH NOTE:
    // -------------------------------
    // For hyphenated words that wrap across lines during karaoke playback,
    // we currently highlight the word as a single inline span using the
    // ::after overlay. Browsers render that overlay only over the first
    // visual fragment of a wrapped inline, so the continuation of a
    // hyphenated word on the next line does not receive the gold overlay.
    //
    // Fixing this “properly” would require either:
    //   (1) returning to per-character spans and driving highlight at
    //       character level (sacrificing native hyphenation behaviour), or
    //   (2) a layout-aware JS solution that inspects getClientRects() and
    //       injects fragment-level overlays.
    //
    // For now we accept this limitation as a known polish issue so that we
    // can keep the browser’s native, book-like hyphenation for karaoke text.
    const wordMetadata = source.wordCharRanges || [];

// console.log('[[INIT]] Initializing slice with word-level highlighting', {
//       karaokeId,
//       sliceStart,
//       sliceEnd,
//       textLength: text.length,
//       wordCount: wordMetadata.length,
//     });

    let localCursor = 0;
    wordMetadata.forEach((word, wordIndex) => {
      if (!word) return;
      if (word.charEnd <= sliceStart || word.charStart >= sliceEnd) {
        return;
      }

      const localStart = Math.max(0, word.charStart - sliceStart);
      const localEnd = Math.min(text.length, word.charEnd - sliceStart);
      if (localEnd <= localStart) {
        return;
      }

      if (localStart > localCursor) {
        // Convert newlines to <br> elements when appending text
        const textBeforeWord = text.slice(localCursor, localStart);
        const parts = textBeforeWord.split('\n');
        parts.forEach((part, idx) => {
          if (idx > 0) {
            // Insert <br> before each part except the first
            const br = document.createElement('br');
            // Force the <br> to be visible by ensuring it's in the DOM
            fragment.appendChild(br);
          }
          if (part) {
            fragment.appendChild(document.createTextNode(part));
          }
        });
        localCursor = localStart;
      }

      const wordText = text.slice(localStart, localEnd);
      const wordSpan = document.createElement('span');
      wordSpan.className = 'karaoke-word';
      wordSpan.dataset.wordIndex = String(word.wordIndex);
      if (typeof word.start === 'number') {
        wordSpan.dataset.start = String(word.start);
      }
      if (typeof word.end === 'number') {
        wordSpan.dataset.end = String(word.end);
      }
      // Store the literal word text for the ::after overlay. This text has no
      // manual soft hyphens; browser hyphenation will decide where to break.
      wordSpan.dataset.word = wordText;

      // OPTION A: Keep the DOM as close as possible to normal text so the browser
      // can apply its own hyphenation. We do NOT wrap every character in spans.
      // Instead, we leave the word as a single text node, and the highlight uses
      // .karaoke-word::after + --karaoke-fill to animate the whole word.
      wordSpan.appendChild(document.createTextNode(wordText));

      // Check if there's punctuation immediately after this word and attach it to prevent line breaks
      const nextWord = wordMetadata[wordIndex + 1];
      const nextWordStart = nextWord ? Math.max(0, nextWord.charStart - sliceStart) : text.length;
      const textAfterWord = text.slice(localEnd, nextWordStart);
      
      // Extract punctuation immediately after the word (before any spaces or newlines)
      const punctuationMatch = textAfterWord.match(/^([.,!?;:]+)/);
      if (punctuationMatch) {
        const punctuation = punctuationMatch[1];
        // Attach punctuation to the word span to prevent line breaks
        punctuation.split('').forEach((punct) => {
          const punctSpan = document.createElement('span');
          punctSpan.className = 'karaoke-char karaoke-punctuation';
          punctSpan.style.whiteSpace = 'nowrap';
          punctSpan.style.display = 'inline';
          punctSpan.textContent = punct;
          punctSpan.dataset.char = punct;
          wordSpan.appendChild(punctSpan);
        });
        localCursor = localEnd + punctuation.length;
      } else {
        localCursor = localEnd;
      }
      
      // Also handle spaces after punctuation to prevent line breaks starting with punctuation
      if (localCursor < text.length && localCursor < nextWordStart) {
        const nextChar = text[localCursor];
        if (nextChar === ' ' && localCursor + 1 < text.length) {
          const charAfterSpace = text[localCursor + 1];
          // If space is followed by punctuation, attach the space to the word to prevent breaking
          if (/[.,!?;:]/.test(charAfterSpace)) {
            const spaceSpan = document.createElement('span');
            spaceSpan.className = 'karaoke-char';
            spaceSpan.style.whiteSpace = 'nowrap';
            spaceSpan.textContent = ' ';
            spaceSpan.dataset.char = '\u00A0';
            wordSpan.appendChild(spaceSpan);
            localCursor++;
          }
        }
      }

      fragment.appendChild(wordSpan);
      
      // Now handle any remaining text after the word (including newlines) that wasn't processed above
      // This includes newlines that come after punctuation/spaces
      if (localCursor < nextWordStart) {
        const remainingAfterText = text.slice(localCursor, nextWordStart);
        // Split by newlines and insert <br> elements
        const remainingParts = remainingAfterText.split('\n');
        remainingParts.forEach((part, partIdx) => {
          if (partIdx > 0) {
            // Insert <br> before each part except the first
            fragment.appendChild(document.createElement('br'));
          }
          if (part) {
            // Add any remaining text (spaces, etc.) as text nodes
            fragment.appendChild(document.createTextNode(part));
          }
        });
        localCursor = nextWordStart; // Update cursor to account for all processed text
      } else {
        localCursor = nextWordStart;
      }
    });

    if (localCursor < text.length) {
      // Convert newlines to <br> elements when appending remaining text
      const remainingText = text.slice(localCursor);
      const parts = remainingText.split('\n');
      parts.forEach((part, idx) => {
        if (idx > 0) {
          // Insert <br> before each part except the first
          fragment.appendChild(document.createElement('br'));
        }
        if (part) {
          fragment.appendChild(document.createTextNode(part));
        }
      });
    }

    sliceElement.innerHTML = '';
    sliceElement.appendChild(fragment);
    
    // Force a reflow to ensure <br> tags are rendered correctly
    // This fixes the issue where <br> tags aren't visible until a layout recalculation
    void sliceElement.offsetHeight;
    
// console.log('[[INIT]] Slice initialized successfully with words');
    return true;
  };
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { applyInkEffectToTextMobile } from './Chapter';
import { ReaderTopBar } from './ReaderTopBar';
import { MobileTOC } from './MobileTOC';
import './PageReader.css';

const PROJECT_CREDIT = 'Overstimulata Collective';

const normalizeWord = (value) => {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/’/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, '');
};

const tokenizeText = (text) => {
  const tokens = [];
  const TOKEN_REGEX = /[\p{L}\p{N}'’]+/gu;
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

const assignLetterTimingsToChars = (text, wordTimings = []) => {
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
 * PageReader component - Kindle-like page-based reading experience for mobile
 * Splits content into pages based on actual content height and handles navigation
 */
export const PageReader = ({ 
  chapters, 
  onPageChange, 
  initialPosition,
  onEditChapter,
  onAddSubchapter,
  onDeleteChapter,
  onEditSubchapter,
  onDeleteSubchapter,
  onReorderChapters,
  onOpenSettings,
  onAddChapter,
  onToggleEditorReader,
}) => {
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pages, setPages] = useState([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayPage, setDisplayPage] = useState(null); // The page currently displayed
  const [isInitializing, setIsInitializing] = useState(true); // Track if we're still initializing
  const hasUserInteractedRef = useRef(false); // Track if user has swiped/interacted at least once
  const [backgroundImageReady, setBackgroundImageReady] = useState(false); // Track if current page background is loaded
  const hasShownFirstPageWithBackgroundRef = useRef(false); // Track if we've shown the first page with its background loaded
  const [isTOCOpen, setIsTOCOpen] = useState(false);
  const [tocDragProgress, setTocDragProgress] = useState(0); // 0 = fully closed, 1 = fully open
  const tocDragProgressRef = useRef(0); // Use ref to avoid re-renders during drag
  const tocDragStartYRef = useRef(null);
  const containerRef = useRef(null);
  const pageContainerRef = useRef(null);
  const touchStartRef = useRef(null);
  const touchCurrentRef = useRef(null);
  const swipeInProgressRef = useRef(false);
  const [karaokeSources, setKaraokeSources] = useState({});
  const karaokeSourcesRef = useRef({});
  useEffect(() => {
    karaokeSourcesRef.current = karaokeSources;
  }, [karaokeSources]);

  // Karaoke controller: manages playback across page slices
  const karaokeControllersRef = useRef(new Map()); // karaokeId -> controller
  const audioUnlockedRef = useRef(false);
  const currentKaraokeSliceRef = useRef(null); // { karaokeId, sliceElement, startChar, endChar }
  const backgroundVideoRef = useRef(null);
  const blankPageVideoRef = useRef(null);
  const [videoUnmuted, setVideoUnmuted] = useState(false);

  // Calculate pages for all chapters based on actual content height
  // Includes subchapters in the flow
  // Now works on both mobile and desktop
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!chapters || chapters.length === 0) {
      setPages([]);
      return;
    }

    // Don't recalculate if pages already exist (unless chapters changed)
    if (pages.length > 0) return;

    const calculatePages = async () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport ? viewport.height : window.innerHeight;
      const safeInsetTop = viewport ? viewport.offsetTop : 0;
      const safeInsetBottom = viewport
        ? Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
        : 0;
      
      const newPages = [];
      const newKaraokeSources = {};

      // Sort chapters: isFirstPage first, then isCover, then regular chapters by order
      const sortedChapters = [...chapters].sort((a, b) => {
        // First page comes first
        if (a.isFirstPage && !b.isFirstPage) return -1;
        if (!a.isFirstPage && b.isFirstPage) return 1;
        // Cover page comes after first page
        if (a.isCover && !b.isCover) return -1;
        if (!a.isCover && b.isCover) return 1;
        // Then sort by order
        return (a.order || 0) - (b.order || 0);
      });

      // Get all footnotes globally for numbering
      const allFootnotes = getAllFootnotes(chapters);
      // Create a map of footnote content to global number for quick lookup
      const footnoteContentToNumber = new Map();
      allFootnotes.forEach((fn) => {
        footnoteContentToNumber.set(fn.content.trim(), fn.globalNumber);
      });

      // Determine if we're calculating for desktop PDF or mobile
      const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
      
      // Desktop PDF page dimensions: 800px width, 1000px min-height
      // Mobile uses viewport dimensions
      const pageWidth = isDesktop ? 800 : undefined; // undefined = use CSS min(680px, 96vw)
      const pageHeight = isDesktop ? 1000 : viewportHeight;
      
      // Create measurement container that exactly matches rendered page structure
      // This ensures measurement accuracy by using the same CSS classes
      const createMeasureContainer = () => {
        const container = document.createElement('div');
        container.className = 'page-container';
        container.style.position = 'absolute';
        container.style.visibility = 'hidden';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = isDesktop ? `${pageWidth}px` : '100%';
        container.style.height = pageHeight + 'px';
        container.style.padding = '2rem 1.5rem 0.5rem';
        container.style.boxSizing = 'border-box';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.style.pointerEvents = 'none';

        const sheet = document.createElement('div');
        sheet.className = 'page-sheet content-page';
        sheet.style.width = isDesktop ? `${pageWidth}px` : 'min(680px, 96vw)';
        sheet.style.height = '100%';
        sheet.style.display = 'flex';
        sheet.style.flexDirection = 'column';
        sheet.style.alignItems = 'flex-start';
        container.appendChild(sheet);

        const body = document.createElement('section');
        body.className = 'page-body';
        body.style.width = '100%';
        body.style.flex = '1';
        body.style.overflow = 'hidden';
        // For desktop, ensure body has explicit height for accurate measurement
        if (isDesktop && pageHeight) {
          // Container is pageHeight (1000px), padding is 2rem top + 0.5rem bottom
          // Sheet is 100% height, body fills remaining space
          // Calculate: pageHeight - container padding top - container padding bottom
          const containerPaddingTop = 32; // 2rem ≈ 32px
          const containerPaddingBottom = 8; // 0.5rem ≈ 8px
          body.style.height = (pageHeight - containerPaddingTop - containerPaddingBottom) + 'px';
          body.style.minHeight = (pageHeight - containerPaddingTop - containerPaddingBottom) + 'px';
          body.style.maxHeight = (pageHeight - containerPaddingTop - containerPaddingBottom) + 'px';
        }
        sheet.appendChild(body);
        document.body.appendChild(container);

        return {
          container,
          sheet,
          body,
          destroy: () => container.remove(),
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
            const BOTTOM_MARGIN_NO_FOOTNOTES = isFirstPage ? 20 : 32; // first page: ~1.25rem, others: ~2rem in pixels
            
            // For desktop PDF viewer, use fixed page height (1000px) minus container padding
            // For mobile, use actual body.clientHeight
            let height;
            if (isDesktop && pageHeight) {
              // Desktop: pageHeight is 1000px, container has padding: 2rem 1.5rem 0.5rem
              // So body height = 1000px - (2rem top + 0.5rem bottom) = 1000px - ~40px = ~960px
              const containerPaddingTop = 32; // 2rem ≈ 32px
              const containerPaddingBottom = 8; // 0.5rem ≈ 8px
              height = pageHeight - containerPaddingTop - containerPaddingBottom;
            } else {
              // Mobile: use actual rendered height
              height = body.clientHeight;
            }
            
            // When footnotes exist, they replace the bottom margin (footnotes are larger)
            // When no footnotes, use the bottom margin for consistent spacing
            const reservedSpace = footnotesHeight > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES;
            const availableHeight = Math.max(0, height - reservedSpace);
// console.log('[getAvailableHeight] Returning:', availableHeight, '(full height:', height, '- reserved space:', reservedSpace, footnotesHeight > 0 ? '(footnotes)' : '(bottom margin)', 'isDesktop:', isDesktop);
            return availableHeight;
          },
        };
      };

      const measure = createMeasureContainer();
      
      // Calculate content width for measurements (accounting for padding)
      // Desktop PDF: 800px - 60px padding = 740px
      // Mobile: use measure.body.clientWidth (dynamic based on viewport)
      const contentWidth = isDesktop && pageWidth 
        ? pageWidth - 60  // 2rem * 2 = ~60px padding
        : measure.body.clientWidth;

      // Helper to apply base paragraph CSS to measurement containers
      // This ensures TipTap HTML (with inline text-align styles) is measured
      // with the same base font/line-height/margin as .page-content p
      // Desktop PDF uses 1.3rem, mobile uses 1.3rem (updated)
      const desktopFontSize = isDesktop ? '1.3rem' : '1.3rem';
      const desktopLineHeight = isDesktop ? '1.35' : '1.35';
      const applyParagraphStylesToContainer = (container) => {
        const paragraphs = container.querySelectorAll('p');
        paragraphs.forEach(p => {
          // Only apply if not already set (preserve inline styles from TipTap)
          if (!p.style.fontSize) p.style.fontSize = desktopFontSize;
          if (!p.style.lineHeight) p.style.lineHeight = desktopLineHeight;
          if (!p.style.margin) p.style.margin = '0.35rem 0';
          if (!p.style.fontFamily) p.style.fontFamily = "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif";
          
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

      // Process chapters sequentially (now sorted: first page, cover, then regular)
      console.log('[PageOrder] Processing chapters:', sortedChapters.map(ch => ({
        id: ch.id,
        title: ch.title,
        isFirstPage: ch.isFirstPage,
        isCover: ch.isCover,
        hasContent: !!(ch.contentHtml || ch.content)
      })));
      
      for (let chapterIdx = 0; chapterIdx < sortedChapters.length; chapterIdx++) {
        const chapter = sortedChapters[chapterIdx];
        
        // Determine chapterIndex: use order field, or special indices for first page/cover
        let chapterIndex;
        if (chapter.isFirstPage) {
          chapterIndex = -2; // Special index for first page
        } else if (chapter.isCover) {
          chapterIndex = -1; // Special index for cover
        } else {
          chapterIndex = chapter.order !== undefined ? chapter.order : chapterIdx;
        }
        
        console.log('[PageOrder] Processing chapter:', {
          chapterId: chapter.id,
          title: chapter.title,
          isFirstPage: chapter.isFirstPage,
          isCover: chapter.isCover,
          chapterIndex: chapterIndex,
          hasContent: !!(chapter.contentHtml || chapter.content)
        });
        
        // Build content array: chapter content + all subchapter content
        const contentBlocks = [];
        const hasChapterContent = !!(chapter.contentHtml || chapter.content);
        
        if (hasChapterContent) {
          contentBlocks.push({
            type: 'chapter',
            title: chapter.title,
            content: chapter.contentHtml || chapter.content,
            epigraph: chapter.epigraph ?? null,
            chapterId: chapter.id,
            subchapterId: null,
          });
        }
        
        if (chapter.children && chapter.children.length > 0) {
          let isFirstSubchapter = true;
          chapter.children.forEach((subchapter) => {
            if (subchapter.contentHtml || subchapter.content) {
              contentBlocks.push({
                type: 'subchapter',
                title: subchapter.title,
                content: subchapter.contentHtml || subchapter.content,
                epigraph: subchapter.epigraph ?? null,
                chapterId: chapter.id,
                subchapterId: subchapter.id,
                includeChapterTitle: !hasChapterContent && isFirstSubchapter, // Include chapter title if chapter has no content
              });
              isFirstSubchapter = false;
            }
          });
        }

        // Special pages (first page, cover) should always create at least one page, even if empty
        // Regular chapters with no content are skipped
        if (contentBlocks.length === 0) {
          if (chapter.isFirstPage || chapter.isCover) {
            // Create an empty page for special pages
            console.log('[PageOrder] Creating empty page for special chapter:', {
              chapterId: chapter.id,
              title: chapter.title,
              isFirstPage: chapter.isFirstPage,
              isCover: chapter.isCover,
              chapterIndex: chapterIndex
            });
            const emptyPage = {
              chapterIndex: chapterIndex,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              subchapterId: null,
              subchapterTitle: null,
              pageIndex: 0,
              hasHeading: false,
              content: '',
              footnotes: [],
              backgroundImageUrl: chapter.backgroundImageUrl || null,
              isFirstPage: chapter.isFirstPage || false,
              isCover: chapter.isCover || false,
            };
            newPages.push(emptyPage);
          } else {
            console.log('[PageOrder] Skipping chapter with no content:', {
              chapterId: chapter.id,
              title: chapter.title,
              isFirstPage: chapter.isFirstPage,
              isCover: chapter.isCover
            });
          }
          continue;
        }

        // First, collect all background videos with their targetPage from all blocks
        // Use regex to avoid expensive DOM creation for every block
        const backgroundVideosByPage = new Map(); // Map<pageNumber, videoSrc>
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

        let chapterPageIndex = 0;
        let currentPageElements = [];
        let pageHasHeading = false;
        let currentPageFootnotes = new Set(); // Track footnote numbers on current page

        const startNewPage = (initialHeading = false) => {
          currentPageElements = [];
          pageHasHeading = initialHeading;
          currentPageFootnotes = new Set();
          measure.body.innerHTML = '';
          measure.setHeading(initialHeading);
        };

        // Helper to extract footnotes from HTML content
        // Supports both legacy ^[content] syntax and TipTap-rendered
        // <sup class="footnote-ref" data-content="..."> nodes.
        const extractFootnotesFromContent = (htmlContent) => {
          const foundFootnotes = new Set();
          if (!htmlContent) return foundFootnotes;

          // 1) Legacy syntax ^[content]
          const legacyRegex = /\^\[([^\]]+)\]/g;
          let match;
          while ((match = legacyRegex.exec(htmlContent)) !== null) {
            const footnoteContent = match[1].trim();
            const globalNumber = footnoteContentToNumber.get(footnoteContent);
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
            const globalNumber = footnoteContentToNumber.get(trimmed);
            if (globalNumber) {
              foundFootnotes.add(globalNumber);
            }
          }

          return foundFootnotes;
        };

        // Helper to measure actual footnote section height (including padding for browser bar)
        const measureFootnotesHeight = (footnoteNumbers, container) => {
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
            item.innerHTML = `<span class="footnote-number">${fn.globalNumber}.</span><span class="footnote-content">${fn.content}</span>`;
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

        // Helper to check if content + footnotes fit together
        const checkContentWithFootnotesFits = (contentElements, footnoteNumbers, availableHeight) => {
          // First, try to add all content
          // Apply base paragraph styles to match actual rendering (without .page-content container rules)
          const tempContainer = document.createElement('div');
          tempContainer.style.width = contentWidth + 'px';
          // Apply the same font/line-height/margin rules that .page-content p uses
          // Desktop PDF uses 1.3rem, mobile uses 1.3rem (updated)
          tempContainer.style.fontFamily = "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif";
          tempContainer.style.fontSize = isDesktop ? '1.3rem' : '1.3rem';
          tempContainer.style.lineHeight = isDesktop ? '1.35' : '1.35';
          measure.body.appendChild(tempContainer);
          
          contentElements.forEach(el => {
            const temp = document.createElement('div');
            temp.innerHTML = el;
            tempContainer.appendChild(temp.firstElementChild || temp);
          });
          
          // Apply base paragraph styles to match actual rendering
          applyParagraphStylesToContainer(tempContainer);
          
          // Check if content alone fits
          const contentHeight = tempContainer.offsetHeight;
          
          // If content alone doesn't fit, content + footnotes definitely won't
          if (contentHeight > availableHeight) {
            measure.body.removeChild(tempContainer);
            return { fits: false, contentHeight, footnotesHeight: 0 };
          }
          
          // Now add footnotes and check total height
          // Footnotes are absolutely positioned, so total height = contentHeight + footnotesHeight
          const footnotesHeight = measureFootnotesHeight(footnoteNumbers, tempContainer);
          const totalHeight = contentHeight + footnotesHeight;
          
          measure.body.removeChild(tempContainer);
          
          return {
            fits: totalHeight <= availableHeight,
            contentHeight,
            footnotesHeight,
            totalHeight
          };
        };

        // Check if element is atomic (cannot be split): images, videos, headings, poetry, dinkus
        // NOTE: Karaoke blocks CAN be split (they have their own splitting logic via handleKaraokeElement)
        const isAtomicElement = (element) => {
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

        // REMOVED: tryFillRemainingSpace function - no longer needed with simplified pagination
        // The simplified algorithm doesn't do gap-filling, just straightforward pagination
        const tryFillRemainingSpace_DEPRECATED = (currentElementIndex, elementsArray) => {
          // This function is no longer used - kept for reference only
          return false;
// console.log('[tryFillRemainingSpace] Called with elementIndex:', currentElementIndex, 'elementsArray length:', elementsArray?.length);
          
          if (!elementsArray || !Array.isArray(elementsArray)) {
// console.log('[tryFillRemainingSpace] Invalid elementsArray, returning false');
            return false;
          }
          if (currentElementIndex + 1 >= elementsArray.length) {
// console.log('[tryFillRemainingSpace] No more elements ahead, returning false');
            return false; // No more elements
          }
          
          // CRITICAL: Rebuild current page in measure.body to get accurate height
          // Current page elements are in currentPageElements array but may not be in DOM
          // We need to measure with actual current page content + footnotes
          const tempContainer = document.createElement('div');
          tempContainer.style.width = contentWidth + 'px';
          measure.body.appendChild(tempContainer);
          
          // Add all current page elements to temp container for measurement
          // Note: In the actual page, content is wrapped in .page-content-main with padding-bottom
          // But for measurement, we add elements directly to see their natural height
          currentPageElements.forEach(el => {
            const temp = document.createElement('div');
            temp.innerHTML = el;
            tempContainer.appendChild(temp.firstElementChild || temp);
          });
          
          // Apply base paragraph styles to match actual rendering
          applyParagraphStylesToContainer(tempContainer);
          
          // Measure current page height with footnotes
          const footnotesHeight = measureFootnotesHeight(currentPageFootnotes, tempContainer);
          const currentHeight = tempContainer.offsetHeight;
          // Pass footnotes height so getAvailableHeight can use it instead of bottom margin when footnotes exist
          const baseAvailableHeight = measure.getAvailableHeight(footnotesHeight);
          
          // CRITICAL: getAvailableHeight already accounts for footnotes (or bottom margin)
          // So remainingSpace = baseAvailableHeight - currentHeight
          const remainingSpace = baseAvailableHeight - currentHeight;
          
// console.log('[tryFillRemainingSpace] Measurement:', {
//            currentHeight,
//            footnotesHeight,
//            totalUsed: currentHeight + footnotesHeight,
//            baseAvailableHeight,
//            remainingSpace,
//            currentPageElementsCount: currentPageElements.length,
//            currentPageFootnotesCount: currentPageFootnotes.size,
//            viewportHeight: window.innerHeight,
//            measureBodyHeight: measure.body.offsetHeight,
//            measureBodyScrollHeight: measure.body.scrollHeight
//          });
          
          // Clean up temp container
          measure.body.removeChild(tempContainer);
          
          // Try to fill any gap, no matter how small
          if (remainingSpace <= 0) {
// console.log('[tryFillRemainingSpace] No remaining space (remainingSpace <= 0). Details:', {
//              currentHeight,
//              footnotesHeight,
//              totalUsed: currentHeight + footnotesHeight,
//              baseAvailableHeight,
//              difference: baseAvailableHeight - currentHeight - footnotesHeight,
//              'NOTE': 'If difference is negative, content is overflowing. If positive but small, might be measurement issue.'
//            });
            return false;
          }
          
// console.log('[tryFillRemainingSpace] ✅ GAP DETECTED! Remaining space:', remainingSpace, 'px');
// console.log('[tryFillRemainingSpace] 📊 Page A Summary:', {
//            baseAvailableHeight,
//            currentHeight,
//            footnotesHeight,
//            remainingSpace,
//            note: 'This is the gap we need to fill'
//          });
          
          let filledAny = false;
          let lookAheadIndex = currentElementIndex + 1;
          
// console.log('[tryFillRemainingSpace] Starting to look ahead from index:', lookAheadIndex);
          
          // Keep looking ahead until we can't fit any more
          while (lookAheadIndex < elementsArray.length) {
            const nextElement = elementsArray[lookAheadIndex];
// console.log('[tryFillRemainingSpace] Checking element at index:', lookAheadIndex, 'tagName:', nextElement?.tagName, 'isAtomic:', isAtomicElement(nextElement));
            
            // Recalculate remaining space after each addition
            // Use contentWidth for desktop, measure.body.clientWidth for mobile
            const tempContainer2 = document.createElement('div');
            tempContainer2.style.width = contentWidth + 'px';
            measure.body.appendChild(tempContainer2);
            
            // Add current page elements
            currentPageElements.forEach(el => {
              const temp = document.createElement('div');
              temp.innerHTML = el;
              tempContainer2.appendChild(temp.firstElementChild || temp);
            });
            
            const currentHeightBefore = tempContainer2.offsetHeight;
            const testFootnotes = new Set(currentPageFootnotes);
            const nextElementFootnotes = extractFootnotesFromContent(nextElement.outerHTML);
            nextElementFootnotes.forEach(num => testFootnotes.add(num));
            const footnotesHeightBefore = measureFootnotesHeight(testFootnotes, tempContainer2);
            // CRITICAL: Reserve footnote space first, then calculate remaining content space
            // getAvailableHeight uses footnotes height when provided, or bottom margin when not
            const baseAvailableHeight = measure.getAvailableHeight(footnotesHeightBefore);
            const remainingSpaceBefore = baseAvailableHeight - currentHeightBefore;
            
            measure.body.removeChild(tempContainer2);
            
            // Measure the next element's size
            const nextElementTemp = document.createElement('div');
            nextElementTemp.style.width = measure.body.clientWidth + 'px';
            measure.body.appendChild(nextElementTemp);
            const nextElementClone = nextElement.cloneNode(true);
            nextElementTemp.appendChild(nextElementClone);
            const nextElementHeight = nextElementTemp.offsetHeight;
            measure.body.removeChild(nextElementTemp);
            
// console.log('[tryFillRemainingSpace] 📏 Next Element (Page B) Size:', {
//              elementIndex: lookAheadIndex,
//              elementHeight: nextElementHeight,
//              remainingSpaceOnPageA: remainingSpaceBefore,
//              canFit: nextElementHeight <= remainingSpaceBefore,
//              textPreview: nextElement.textContent?.substring(0, 100)
//            });
            
            // Try to fill any gap, no matter how small
            if (remainingSpaceBefore <= 0) break;
            
            // Try atomic elements first
            if (isAtomicElement(nextElement)) {
// console.log('[tryFillRemainingSpace] Trying atomic element');
              const nextElementFootnotes = extractFootnotesFromContent(nextElement.outerHTML);
              const testFootnotesWithNext = new Set([...currentPageFootnotes, ...nextElementFootnotes]);
              
              // Check if content fits in space after reserving footnotes
              const testFootnotesHeightForAtomic = measureFootnotesHeight(testFootnotesWithNext, measure.body);
              const baseAvailableHeightForAtomic = measure.getAvailableHeight(testFootnotesHeightForAtomic);
              const contentAvailableHeightForAtomic = baseAvailableHeightForAtomic;
              
              const tempCheckContainerAtomic = document.createElement('div');
              tempCheckContainerAtomic.style.width = measure.body.clientWidth + 'px';
              measure.body.appendChild(tempCheckContainerAtomic);
              
              [...currentPageElements, nextElement.outerHTML].forEach(el => {
                const temp = document.createElement('div');
                temp.innerHTML = el;
                tempCheckContainerAtomic.appendChild(temp.firstElementChild || temp);
              });
              
              // Apply base paragraph styles to match actual rendering
              applyParagraphStylesToContainer(tempCheckContainerAtomic);
              
              const contentHeightAtomic = tempCheckContainerAtomic.offsetHeight;
              measure.body.removeChild(tempCheckContainerAtomic);
              
              const nextFitCheck = {
                fits: contentHeightAtomic <= contentAvailableHeightForAtomic,
                contentHeight: contentHeightAtomic,
                footnotesHeight: testFootnotesHeightForAtomic,
                totalHeight: contentHeightAtomic + testFootnotesHeightForAtomic
              };
              
// console.log('[tryFillRemainingSpace] Atomic element fit check:', nextFitCheck);
              
              if (nextFitCheck.fits) {
// console.log('[tryFillRemainingSpace] Atomic element FITS! Adding to current page');
                // Add the entire atomic element
                nextElementFootnotes.forEach(num => currentPageFootnotes.add(num));
                currentPageElements.push(nextElement.outerHTML);
                filledAny = true;
                lookAheadIndex++;
                continue;
              }
              // Atomic element doesn't fit, stop
// console.log('[tryFillRemainingSpace] Atomic element does NOT fit, stopping');
              break;
            } else {
              // Splittable element: try entire first, then split
// console.log('[tryFillRemainingSpace] Trying splittable element, text preview:', nextElement.textContent?.substring(0, 50));
              const nextElementFootnotes = extractFootnotesFromContent(nextElement.outerHTML);
              const testFootnotesWithNext = new Set([...currentPageFootnotes, ...nextElementFootnotes]);
              
              // Try entire element first
              // Check if content fits in space after reserving footnotes
              // Use contentWidth for desktop, measure.body.clientWidth for mobile
              const tempFootnotesContainerAtomic2 = document.createElement('div');
              tempFootnotesContainerAtomic2.style.width = contentWidth + 'px';
              measure.body.appendChild(tempFootnotesContainerAtomic2);
              const testFootnotesHeightForAtomic = measureFootnotesHeight(testFootnotesWithNext, tempFootnotesContainerAtomic2);
              measure.body.removeChild(tempFootnotesContainerAtomic2);
              const baseAvailableHeightForAtomic = measure.getAvailableHeight(testFootnotesHeightForAtomic);
              const contentAvailableHeightForAtomic = baseAvailableHeightForAtomic;
              
              const tempCheckContainerAtomic = document.createElement('div');
              tempCheckContainerAtomic.style.width = contentWidth + 'px';
              measure.body.appendChild(tempCheckContainerAtomic);
              
              [...currentPageElements, nextElement.outerHTML].forEach(el => {
                const temp = document.createElement('div');
                temp.innerHTML = el;
                tempCheckContainerAtomic.appendChild(temp.firstElementChild || temp);
              });
              
              // Apply base paragraph styles to match actual rendering
              applyParagraphStylesToContainer(tempCheckContainerAtomic);
              
              const contentHeightAtomic = tempCheckContainerAtomic.offsetHeight;
              measure.body.removeChild(tempCheckContainerAtomic);
              
              const nextFitCheck = {
                fits: contentHeightAtomic <= contentAvailableHeightForAtomic,
                contentHeight: contentHeightAtomic,
                footnotesHeight: testFootnotesHeightForAtomic,
                totalHeight: contentHeightAtomic + testFootnotesHeightForAtomic
              };
              
// console.log('[tryFillRemainingSpace] Entire element fit check:', nextFitCheck);
              
              if (nextFitCheck.fits) {
// console.log('[tryFillRemainingSpace] Entire element FITS! Adding to current page');
                // Add entire element
                nextElementFootnotes.forEach(num => currentPageFootnotes.add(num));
                currentPageElements.push(nextElement.outerHTML);
                filledAny = true;
                lookAheadIndex++;
                continue;
              }
              
              // Entire element doesn't fit, try to split it
              // CRITICAL: remainingContentHeight should be the space available for content
              // getAvailableHeight already accounts for footnotes (or bottom margin)
              // So: remainingContentHeight = baseAvailableHeight - currentHeightBefore
              // This gives us the space between content and footnotes (or bottom margin) that we can fill
              const baseAvailableHeightForSplit = measure.getAvailableHeight(footnotesHeightBefore);
              const remainingContentHeight = Math.max(0, baseAvailableHeightForSplit - currentHeightBefore);
              
// console.log('[tryFillRemainingSpace] Entire element does NOT fit. Trying to split.', {
//                baseAvailableHeight: baseAvailableHeightForSplit,
//                currentHeightBefore,
//                footnotesHeightBefore,
//                remainingContentHeight,
//                baseAvailableHeight: baseAvailableHeightForSplit,
//                currentHeightBefore,
//                footnotesHeightBefore,
//                remainingContentHeight,
//                'NOTE': 'This is the space we have to fit a split portion'
//              });
              
              // Try to split even for very small spaces (5px minimum)
              if (remainingContentHeight >= 5) {
// console.log('[tryFillRemainingSpace] Attempting to split element with', remainingContentHeight, 'px available');
                // Try sentence-level splitting
                let splitResult = splitTextAtSentenceBoundary(nextElement, remainingContentHeight);
// console.log('[tryFillRemainingSpace] Sentence split result:', {
//                  hasFirst: !!splitResult.first,
//                  hasSecond: !!splitResult.second,
//                  firstPreview: splitResult.first?.substring(0, 50),
//                  secondPreview: splitResult.second?.substring(0, 50)
//                });
                
                if (!splitResult.first && !splitResult.second) {
// console.log('[tryFillRemainingSpace] Sentence split failed, trying word boundary');
                  splitResult = splitTextAtWordBoundary(nextElement, remainingContentHeight);
// console.log('[tryFillRemainingSpace] Word split result:', {
//                    hasFirst: !!splitResult.first,
//                    hasSecond: !!splitResult.second,
//                    firstPreview: splitResult.first?.substring(0, 50),
//                    secondPreview: splitResult.second?.substring(0, 50)
//                  });
                }
                
// console.log('[tryFillRemainingSpace] Final split result:', {
//                  hasFirst: !!splitResult.first,
//                  hasSecond: !!splitResult.second,
//                  firstPreview: splitResult.first?.substring(0, 50),
//                  secondPreview: splitResult.second?.substring(0, 50)
//                });
                
                if (splitResult.first) {
                  const firstPartFootnotes = extractFootnotesFromContent(splitResult.first);
                  const testFootnotesWithFirst = new Set([...currentPageFootnotes, ...firstPartFootnotes]);
                  // Check if first part fits in space after reserving footnotes
                  // Use contentWidth for desktop, measure.body.clientWidth for mobile
                  const tempFootnotesContainerFirst = document.createElement('div');
                  tempFootnotesContainerFirst.style.width = contentWidth + 'px';
                  measure.body.appendChild(tempFootnotesContainerFirst);
                  const firstPartFootnotesHeight = measureFootnotesHeight(testFootnotesWithFirst, tempFootnotesContainerFirst);
                  measure.body.removeChild(tempFootnotesContainerFirst);
                  const baseAvailableHeightForFirstPart = measure.getAvailableHeight(firstPartFootnotesHeight);
                  const firstPartContentAvailableHeight = baseAvailableHeightForFirstPart;
                  
                  const tempCheckContainerFirstPart = document.createElement('div');
                  tempCheckContainerFirstPart.style.width = contentWidth + 'px';
                  measure.body.appendChild(tempCheckContainerFirstPart);
                  
                  [...currentPageElements, splitResult.first].forEach(el => {
                    const temp = document.createElement('div');
                    temp.innerHTML = el;
                    tempCheckContainerFirstPart.appendChild(temp.firstElementChild || temp);
                  });
                  
                  const firstPartContentHeight = tempCheckContainerFirstPart.offsetHeight;
                  measure.body.removeChild(tempCheckContainerFirstPart);
                  
                  const firstPartFitCheck = {
                    fits: firstPartContentHeight <= firstPartContentAvailableHeight,
                    contentHeight: firstPartContentHeight,
                    footnotesHeight: firstPartFootnotesHeight,
                    totalHeight: firstPartContentHeight + firstPartFootnotesHeight
                  };
                  
// console.log('[tryFillRemainingSpace] First part fit check:', firstPartFitCheck);
                  
                  if (firstPartFitCheck.fits) {
// console.log('[tryFillRemainingSpace] First part FITS! Adding to current page');
                    // Add first part
                    firstPartFootnotes.forEach(num => currentPageFootnotes.add(num));
                    currentPageElements.push(splitResult.first);
                    
                    // Replace element with remaining part
                    if (splitResult.second) {
                      const tempDiv2 = document.createElement('div');
                      tempDiv2.innerHTML = splitResult.second;
                      elementsArray[lookAheadIndex] = tempDiv2.firstElementChild;
                    } else {
                      elementsArray.splice(lookAheadIndex, 1);
                    }
                    filledAny = true;
                    break; // Stop after splitting, continue with next iteration
                  } else {
// console.log('[tryFillRemainingSpace] First part does NOT fit');
                  }
                }
              } else {
// console.log('[tryFillRemainingSpace] remainingContentHeight too small (< 5px), not attempting split');
              }
              // Can't fit any part, stop looking ahead
// console.log('[tryFillRemainingSpace] Cannot fit any part of element, stopping');
              break;
            }
          }
          
// console.log('[tryFillRemainingSpace] Finished. filledAny:', filledAny);
          return filledAny;
        };

        const pushPage = (blockMeta) => {
          if (!currentPageElements.length) return;
          
          // Process footnotes in content: replace ^[content] with superscript numbers
          let processedContent = currentPageElements.join('');
          
          // Extract footnotes from content and replace with superscript
          const footnoteRegex = /\^\[([^\]]+)\]/g;
          const pageFootnotes = [];
          
          processedContent = processedContent.replace(footnoteRegex, (match, footnoteContent) => {
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
          
          // Add footnotes section at the bottom if there are any
          // NOTE: Hyphenation is deferred until after pagination to improve performance
          // It will be applied when pages are rendered
          
          // Wrap content in a container and position footnotes absolutely at bottom
          let footnotesHtml = '';
          if (pageFootnotes.length > 0) {
            footnotesHtml = renderFootnotesSection(pageFootnotes);
          }
          
          // Footnotes are absolutely positioned at bottom of page-body
          // Content needs padding-bottom to reserve space for footnotes OR bottom margin
          // measureFootnotesHeight already includes browser bar padding in its measurement
          const footnotesHeight = pageFootnotes.length > 0 
            ? measureFootnotesHeight(currentPageFootnotes, measure.body)
            : 0;
          
          // Standard bottom margin when there are no footnotes (for consistent page spacing)
          const BOTTOM_MARGIN_NO_FOOTNOTES = 48; // ~4.5rem in pixels (increased to prevent unnecessary splits)
          
          // Bottom margin for karaoke pages (reduced to fit more content)
          const BOTTOM_MARGIN_KARAOKE = 32; // Reduced from 48px to fit one more line
          
          // Check if page has karaoke elements
          const hasKaraoke = currentPageElements.some(el => 
            el.includes('karaoke-slice') || el.includes('data-karaoke')
          );
          
          // Always wrap content with padding-bottom: either for footnotes or for bottom margin
          // Use larger margin for karaoke pages
          const bottomMargin = hasKaraoke ? BOTTOM_MARGIN_KARAOKE : BOTTOM_MARGIN_NO_FOOTNOTES;
          const reservedSpace = pageFootnotes.length > 0 ? footnotesHeight : bottomMargin;
          const contentWrapper = `<div class="page-content-main" style="padding-bottom: ${reservedSpace}px;">${processedContent}</div>${footnotesHtml}`;
          
          // Check if this page should have a background video (1-indexed page number)
          const pageNumber = chapterPageIndex + 1; // Convert 0-indexed to 1-indexed
          const backgroundVideoSrc = backgroundVideosByPage.get(pageNumber) || null;

          const newPage = {
            chapterIndex: chapterIndex,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            subchapterId: blockMeta.subchapterId,
            subchapterTitle: blockMeta.type === 'subchapter' ? blockMeta.title : null,
            pageIndex: chapterPageIndex,
            hasHeading: pageHasHeading,
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
          
          newPages.push(newPage);
          chapterPageIndex += 1;
          
          startNewPage(false);
        };

        startNewPage(false);

        // Split text element at sentence boundaries (more granular than word boundaries)
          // Tries to split at sentence ends (. ! ?) followed by space/capital letter
          function splitTextAtSentenceBoundary(element, maxHeight, options = {}) {
            const { returnCharCount = false } = options;
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
              return splitTextAtWordBoundary(element, maxHeight, options);
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
            
            // Create a temporary container to measure just the clone
            const tempMeasureContainer = document.createElement('div');
            tempMeasureContainer.style.width = measure.body.clientWidth + 'px';
            tempMeasureContainer.style.position = 'absolute';
            tempMeasureContainer.style.visibility = 'hidden';
            measure.body.appendChild(tempMeasureContainer);
            tempMeasureContainer.appendChild(clone);
            const height = clone.offsetHeight; // Measure the clone itself, not the body
            measure.body.removeChild(tempMeasureContainer);
            
            if (height <= maxHeight + 2) {
              bestFit = i + 1;
            } else {
              break;
            }
          }

          if (bestFit === 0) {
            // Can't fit even one sentence, fall back to word boundary
            return splitTextAtWordBoundary(element, maxHeight, options);
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
          secondRange.setEnd(element, element.childNodes.length);
          secondPart.appendChild(secondRange.cloneContents());
          
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
        }

          // Split text element at word boundaries while preserving HTML structure
          // Uses Range API to find the split point that preserves formatting
          function splitTextAtWordBoundary(element, maxHeight, options = {}) {
            const { returnCharCount = false } = options;
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
            
            // Create a temporary container to measure just the clone
            const tempMeasureContainer = document.createElement('div');
            tempMeasureContainer.style.width = measure.body.clientWidth + 'px';
            tempMeasureContainer.style.position = 'absolute';
            tempMeasureContainer.style.visibility = 'hidden';
            measure.body.appendChild(tempMeasureContainer);
            tempMeasureContainer.appendChild(clone);
            const height = clone.offsetHeight; // Measure the clone itself, not the body
            measure.body.removeChild(tempMeasureContainer);
            
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
          
          // Check if entire element fits
          const fullClone = element.cloneNode(true);
          // Create a temporary container to measure just the clone
          const tempMeasureContainer2 = document.createElement('div');
          tempMeasureContainer2.style.width = measure.body.clientWidth + 'px';
          tempMeasureContainer2.style.position = 'absolute';
          tempMeasureContainer2.style.visibility = 'hidden';
          measure.body.appendChild(tempMeasureContainer2);
          tempMeasureContainer2.appendChild(fullClone);
          const fullHeight = fullClone.offsetHeight; // Measure the clone itself, not the body
          measure.body.removeChild(tempMeasureContainer2);
          
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
        }

        const handleKaraokeElement = (element, blockMeta) => {
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
            // hyphenation (hyphens:auto + lang=\"en\") decide where to break, exactly like
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
          while (cursor < sourceText.length) {
            // Reserve space for footnotes OR bottom margin when calculating available height for karaoke
            // Karaoke uses a reduced bottom margin (32px) to fit more content
            const footnotesHeight = measureFootnotesHeight(currentPageFootnotes);
            const BOTTOM_MARGIN_KARAOKE = 32; // Reduced from 48px to fit one more line
            // For karaoke, use the reduced bottom margin when no footnotes
            const reservedSpace = currentPageFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_KARAOKE;
            const fullHeight = measure.body.clientHeight;
            const availableHeight = Math.max(0, fullHeight - reservedSpace);
            const remainingText = sourceText.slice(cursor);

            const tempElement = document.createElement('div');
            tempElement.className = 'karaoke-slice-measure';
            tempElement.style.display = 'block';
            tempElement.style.whiteSpace = 'pre-wrap';
            tempElement.style.margin = '0 0 0.85rem';
            tempElement.textContent = remainingText;

            const { firstCharCount } = splitTextAtWordBoundary(tempElement, availableHeight, {
              returnCharCount: true,
            });

            let charsToUse = firstCharCount || 0;
            if (charsToUse === 0) {
              if (currentPageElements.length > 0) {
                pushPage(blockMeta);
                startNewPage(false);
                continue;
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
            measure.body.appendChild(measureNode);
            // Extract and track footnotes from karaoke slice
            const sliceFootnotes = extractFootnotesFromContent(sliceEl.outerHTML);
            sliceFootnotes.forEach(num => currentPageFootnotes.add(num));
            currentPageElements.push(sliceEl.outerHTML);

            cursor += charsToUse;
            if (cursor < sourceText.length) {
              pushPage(blockMeta);
              startNewPage(false);
            }
          }

          return true;
        };

        for (let blockIdx = 0; blockIdx < contentBlocks.length; blockIdx++) {
          const block = contentBlocks[blockIdx];
          
          // Create epigraph page if epigraph exists
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
          
          if (epigraphText) {
            newPages.push({
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
              isFirstPage: chapter.isFirstPage || false,
              isCover: chapter.isCover || false,
              content: '',
              footnotes: [],
              backgroundImageUrl: chapter.backgroundImageUrl || null,
            });
            chapterPageIndex += 1;
          }
          
          const tempContainer = document.createElement('div');
          tempContainer.style.position = 'absolute';
          tempContainer.style.visibility = 'hidden';
          tempContainer.style.width = '90vw';
          tempContainer.style.padding = '1rem';
          tempContainer.style.top = '-9999px';
          tempContainer.style.left = '-9999px';
          document.body.appendChild(tempContainer);

          const contentDiv = document.createElement('div');
          contentDiv.className = 'chapter-content';
          contentDiv.style.fontFamily = "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif";
          contentDiv.style.fontSize = isDesktop ? '1.3rem' : '1.3rem'; // Match .page-content p font-size (1.3rem for both)
          contentDiv.style.lineHeight = isDesktop ? '1.35' : '1.35'; // Match .page-content p line-height (1.35 for both)
          contentDiv.style.color = '#0a0a0a';
          
          let htmlContent = block.content;
          
          // Extract blank-page videos from content before processing (remove them)
          // Also remove background videos from content (they're matched by targetPage during pagination)
          const videoElements = [];
          const videoRegex = /<video[^>]*>[\s\S]*?<\/video>/gi;
          let videoMatch;
          const videosToRemove = [];
          while ((videoMatch = videoRegex.exec(htmlContent)) !== null) {
            const videoHtml = videoMatch[0];
            const videoSrcMatch = videoHtml.match(/src=["']([^"']+)["']/i);
            const videoModeMatch = videoHtml.match(/data-video-mode=["']([^"']+)["']/i);
            const mode = videoModeMatch ? videoModeMatch[1] : 'blank-page';
            
            if (videoSrcMatch) {
              const videoData = {
                src: videoSrcMatch[1],
                html: videoHtml,
                mode: mode,
              };
              
              if (mode === 'blank-page') {
                // Remove blank-page videos from content (they'll be on separate pages)
                videoElements.push(videoData);
                videosToRemove.push(videoMatch[0]);
              } else if (mode === 'background') {
                // Remove background videos from content (they're matched by targetPage during pagination)
                videosToRemove.push(videoMatch[0]);
              }
            }
          }
          // Remove blank-page and background videos from content
          videosToRemove.forEach(videoHtml => {
            htmlContent = htmlContent.replace(videoHtml, '');
          });
          
          // Replace long dashes with short hyphens
          // Replace em dash (—) and en dash (–) with regular hyphen (-)
          htmlContent = htmlContent.replace(/—/g, '-').replace(/–/g, '-');
          
          // Handle title rendering
          // Titles are now part of the editor content (h3 / h4 inside contentHtml),
          // so we no longer prepend additional heading elements here.
          
          contentDiv.innerHTML = htmlContent;
          tempContainer.appendChild(contentDiv);

          await new Promise((resolve) => {
            const images = contentDiv.querySelectorAll('img');
            if (images.length === 0) {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve());
              });
            } else {
              let loaded = 0;
              const checkComplete = () => {
                loaded++;
                if (loaded === images.length) {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => resolve());
                  });
                }
              };
              images.forEach((img) => {
                if (img.complete) {
                  checkComplete();
                } else {
                  img.onload = checkComplete;
                  img.onerror = checkComplete;
                }
              });
            }
          });

          const elements = Array.from(contentDiv.children);
          
          console.log('[PageOrder] Processing block content:', {
            blockType: block.type,
            chapterId: block.chapterId,
            subchapterId: block.subchapterId,
            htmlContentLength: htmlContent.length,
            elementsCount: elements.length,
            elementTags: elements.map(el => el.tagName),
            isCover: chapter.isCover,
            isFirstPage: chapter.isFirstPage
          });

          // Main pagination loop: process each element
          // SIMPLIFIED ALGORITHM: Fundamentally consider footnotes, no gap-filling complexity
          for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
            const element = elements[elementIndex];
            const isHeadingElement = /^H[1-6]$/i.test(element.tagName || '');
            const isSubchapterTitle = /^H[4-6]$/i.test(element.tagName || '');
            
            // Update heading state if needed (affects available height)
            // IMPORTANT: Only apply page-with-heading when there's a subchapter title (h4-h6)
            // Chapter titles (h3) alone don't need the extra padding-top
            // IMPORTANT: Do this BEFORE calculating available height so measurements are accurate
            if (isSubchapterTitle && !pageHasHeading) {
              pageHasHeading = true;
              measure.setHeading(true);
              // Force a reflow to ensure CSS changes take effect before measurement
              measure.body.offsetHeight;
            }

            // Handle background video elements - skip them from content (they're matched by page number)
            if (element.tagName === 'VIDEO') {
              const videoMode = element.getAttribute('data-video-mode') || 'blank-page';
              if (videoMode === 'background') {
                // Skip this element - don't add it to page content, it's matched by targetPage
                continue;
              }
            }

            // Handle karaoke elements (they manage their own pagination)
            if (
              element.classList?.contains('karaoke-object') ||
              element.hasAttribute?.('data-karaoke') ||
              element.querySelector?.('.karaoke-object')
            ) {
              if (handleKaraokeElement(element, block)) {
                continue;
              }
            }

            // STEP 1: Calculate available content height
            // This is the fundamental consideration: footnotes reserve space FIRST
            // Calculate footnotes that would be on this page (current + this element's footnotes)
            const testFootnotes = new Set(currentPageFootnotes);
            const elementFootnotes = extractFootnotesFromContent(element.outerHTML);
            elementFootnotes.forEach(num => testFootnotes.add(num));
            
            // Measure footnote height first, then get available height
            // Get available height AFTER heading state is set (if it changed)
            // Mobile: use measure.body.clientWidth, Desktop: use contentWidth
            const tempFootnotesContainer = document.createElement('div');
            tempFootnotesContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
            measure.body.appendChild(tempFootnotesContainer);
            const footnotesHeight = measureFootnotesHeight(testFootnotes, tempFootnotesContainer);
            measure.body.removeChild(tempFootnotesContainer);
            
            // Get available height - it will use footnotes height if provided, or bottom margin if not
            // baseAvailableHeight already accounts for footnotes (subtracts them from page height)
            const baseAvailableHeight = measure.getAvailableHeight(footnotesHeight);
            const contentAvailableHeight = baseAvailableHeight;

            // STEP 2: Check if element fits by measuring TOTAL content (current page + element)
            // This ensures we account for footnotes correctly
            const testElements = [...currentPageElements, element.outerHTML];
            const tempTotalContainer = document.createElement('div');
            // Mobile: use measure.body.clientWidth, Desktop: use contentWidth
            tempTotalContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
            measure.body.appendChild(tempTotalContainer);
            
            testElements.forEach(el => {
              const temp = document.createElement('div');
              temp.innerHTML = el;
              tempTotalContainer.appendChild(temp.firstElementChild || temp);
            });
            
            // Apply base paragraph styles to match actual rendering
            applyParagraphStylesToContainer(tempTotalContainer);
            
            const totalContentHeight = tempTotalContainer.offsetHeight;
            measure.body.removeChild(tempTotalContainer);
            
            // Element fits if total content height fits in contentAvailableHeight
            // contentAvailableHeight already accounts for footnotes (baseAvailableHeight - footnotesHeight)
            // Add safety margin to prevent overflow due to rounding/measurement differences
            // Use larger margin for pages with headings (they have more complex layout)
            const safetyMargin = pageHasHeading ? 8 : 2;
            const elementFits = totalContentHeight <= contentAvailableHeight - safetyMargin;
            
            // Calculate remaining space for splitting (if needed)
            // IMPORTANT: Apply paragraph styles to get accurate measurement
            const tempCurrentPageContainer = document.createElement('div');
            // Mobile: use measure.body.clientWidth, Desktop: use contentWidth
            tempCurrentPageContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
            measure.body.appendChild(tempCurrentPageContainer);
            
            currentPageElements.forEach(el => {
              const temp = document.createElement('div');
              temp.innerHTML = el;
              tempCurrentPageContainer.appendChild(temp.firstElementChild || temp);
            });
            
            // Apply base paragraph styles to match actual rendering
            applyParagraphStylesToContainer(tempCurrentPageContainer);
            
            const currentPageContentHeight = tempCurrentPageContainer.offsetHeight;
            measure.body.removeChild(tempCurrentPageContainer);
            
            const remainingContentHeight = Math.max(0, contentAvailableHeight - currentPageContentHeight);
            
            // Debug: log the calculation to see why remainingContentHeight might be wrong
            if (currentPageElements.length > 0) {
// console.log('[Pagination] Remaining height calculation:', {
//                contentAvailableHeight,
//                currentPageContentHeight,
//                remainingContentHeight,
//                currentPageElementsCount: currentPageElements.length,
//                lastElementPreview: currentPageElements[currentPageElements.length - 1]?.substring(0, 100)
//              });
            }
            
            // STEP 4: Handle element based on whether it fits and if it can be split
            // Log every element to see which ones are being processed
            const elementText = element.textContent?.substring(0, 100) || '';
// console.log('[Pagination] Processing element:', {
//              tagName: element.tagName,
//              className: element.className,
//              textPreview: elementText + (element.textContent?.length > 100 ? '...' : ''),
//              textLength: element.textContent?.length,
//              elementFits,
//              remainingContentHeight,
//              isAtomic: isAtomicElement(element),
//              currentPageElementsCount: currentPageElements.length
//            });
            
            if (isAtomicElement(element)) {
              // Atomic elements (images, videos, headings, karaoke): cannot be split
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
            } else {
              // Splittable text elements: can be split at sentence/word boundaries
              if (elementFits) {
                // Element fits - add to current page
                // Double-check that the total page content (with padding) still fits
                const finalTestElements = [...currentPageElements, element.outerHTML];
                const finalTestContainer = document.createElement('div');
                // Mobile: use measure.body.clientWidth, Desktop: use contentWidth
                finalTestContainer.style.width = isDesktop ? contentWidth + 'px' : measure.body.clientWidth + 'px';
                measure.body.appendChild(finalTestContainer);
                
                // Simulate the actual rendering with padding-bottom
                // Calculate reserved space: footnotes height if footnotes exist, otherwise bottom margin
                // Use a slightly smaller bottom margin for the first page so text can sit lower
                const BOTTOM_MARGIN_NO_FOOTNOTES = block.chapter && block.chapter.isFirstPage ? 15 : 32;
                const finalReservedSpace = testFootnotes.size > 0 ? footnotesHeight : BOTTOM_MARGIN_NO_FOOTNOTES;
                const finalContentWrapper = document.createElement('div');
                finalContentWrapper.className = 'page-content-main';
                finalContentWrapper.style.paddingBottom = finalReservedSpace + 'px';
                
                finalTestElements.forEach(el => {
                  const temp = document.createElement('div');
                  temp.innerHTML = el;
                  finalContentWrapper.appendChild(temp.firstElementChild || temp);
                });
                
                // Apply base paragraph styles to match actual rendering
                applyParagraphStylesToContainer(finalContentWrapper);
                
                finalTestContainer.appendChild(finalContentWrapper);
                const finalTotalHeight = finalTestContainer.offsetHeight;
                measure.body.removeChild(finalTestContainer);
                
                // If total height (content + padding) exceeds baseAvailableHeight, try to split instead of pushing
                // BUT: If overflow is very small (< 20px) AND this is likely the last element (small remaining space),
                // just include it anyway (better UX than splitting)
                // ALSO: If remainingContentHeight is very small (< 30px) and element is long enough, try to split
                // This prevents paragraphs from being pushed to next page when there's a tiny bit of space left
                // MOBILE: Use baseAvailableHeight (which already accounts for footnotes)
                // DESKTOP: Use fullPageHeight for direct comparison
                let overflowAmount;
                if (isDesktop && pageHeight) {
                  // Desktop: compare against full page height
                  const containerPaddingTop = 32; // 2rem ≈ 32px
                  const containerPaddingBottom = 8; // 0.5rem ≈ 8px
                  const fullPageHeight = pageHeight - containerPaddingTop - containerPaddingBottom;
                  overflowAmount = finalTotalHeight - fullPageHeight;
                } else {
                  // Mobile: use baseAvailableHeight (previous working logic)
                  overflowAmount = finalTotalHeight - baseAvailableHeight;
                }
                const shouldTrySplitDueToSmallSpace = remainingContentHeight < 50 && 
                                                      remainingContentHeight > 0 &&
                                                      element.textContent && 
                                                      element.textContent.length > 50; // Relaxed: try split with more space and shorter elements
                
                // Only allow small overflow tolerance if:
                // 1. This is the last element in the array (no more elements to process), OR
                // 2. Remaining space is very small (< 80px) AND overflow is small (< 30px), OR
                // 3. Element is short (< 100 chars) and overflow is small (< 30px) - allow short elements to fit
                // This prevents multiple elements from overflowing while allowing the last element or short elements to fit
                const elementTextLength = element.textContent?.length || 0; // Declare early for use below
                const isLastElement = elementIndex === elements.length - 1;
                const isLikelyLastElement = remainingContentHeight < 80 && overflowAmount < 30;
                const isShortElement = elementTextLength < 100 && overflowAmount < 30;
                const allowSmallOverflow = (isLastElement || isLikelyLastElement || isShortElement) && overflowAmount < 30 && overflowAmount > 0;
                
                // Only attempt split if overflow is significant (>= 20px) or there's very little space left
                // BUT: Allow small overflow (< 20px) only for the last element or when remaining space is very small
                // ALSO: Skip split if remaining space is very small (< 50px) and element is long - push whole element instead
                const shouldSkipSplitDueToSmallSpace = remainingContentHeight < 20 && 
                                                        remainingContentHeight > 0 &&
                                                        elementTextLength > 200; // Relaxed: only skip if very little space AND very long element
                
                if ((overflowAmount >= 10 || shouldTrySplitDueToSmallSpace) && finalTotalHeight > baseAvailableHeight && !allowSmallOverflow && !shouldSkipSplitDueToSmallSpace) { // Relaxed: reduced overflow threshold from 20px to 10px
// console.log('[Pagination] Attempting split:', {
//                    reason: overflowAmount >= 20 ? 'overflows with padding' : 'small remaining space',
//                    finalTotalHeight,
//                    baseAvailableHeight,
//                    overflowAmount,
//                    remainingContentHeight,
//                    elementText: element.textContent?.substring(0, 100)
//                  });
                  
                  // Content doesn't actually fit with padding OR there's very little space left - try to split it
                  // Use remainingContentHeight for splitting (space left on current page)
                  let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight);
                  if (!splitResult.first && !splitResult.second) {
                    splitResult = splitTextAtWordBoundary(element, remainingContentHeight);
                  }
                  
                  const { first, second } = splitResult;
                  
                  if (first && remainingContentHeight > 0) {
                    // Check if first part is too short (just a few words) - if so, push whole element to next page
                    const firstPartText2 = first.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags to get text
                    const firstPartWordCount2 = firstPartText2.split(/\s+/).filter(w => w.length > 0).length;
                    const isFirstPartTooShort2 = firstPartWordCount2 < 2; // Relaxed: Less than 2 words is too short
                    
// console.log('[Pagination] Split result check (elementFits=false):', {
//                      firstPartText: firstPartText2.substring(0, 100),
//                      firstPartWordCount: firstPartWordCount2,
//                      isFirstPartTooShort: isFirstPartTooShort2,
                      remainingContentHeight
//                    });
                    
                    // If first part is too short, push whole element to next page immediately
                    if (isFirstPartTooShort2) {
// console.log('[Pagination] First part too short, pushing whole element to next page (elementFits=false)');
                      // Push whole element to next page - avoid split that would leave very short first part
                      if (currentPageElements.length > 0) {
                        pushPage(block);
                      }
                      startNewPage(false);
                      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                      currentPageElements.push(element.outerHTML);
                      continue; // Skip to next element in the loop
                    }
                    // Check if first part is too short (just a few words) - if so, push whole element to next page
                    const firstPartText = first.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags to get text
                    const firstPartWordCount = firstPartText.split(/\s+/).filter(w => w.length > 0).length;
                    const isFirstPartTooShort = firstPartWordCount < 2; // Relaxed: Less than 2 words is too short
                    
// console.log('[Pagination] Split result check:', {
//                      firstPartText: firstPartText.substring(0, 100),
//                      firstPartWordCount,
//                      isFirstPartTooShort,
//                      firstPartText: firstPartText.substring(0, 100),
//                      firstPartWordCount,
//                      isFirstPartTooShort,
                      remainingContentHeight
//                    });
                    
                    // If first part is too short, push whole element to next page immediately (before measuring)
                    if (isFirstPartTooShort) {
// console.log('[Pagination] First part too short, pushing whole element to next page');
                      // Push whole element to next page - avoid split that would leave very short first part
                      if (currentPageElements.length > 0) {
                        pushPage(block);
                      }
                      startNewPage(false);
                      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                      currentPageElements.push(element.outerHTML);
                      // Skip the rest of the split logic and continue to next element in the loop
                      continue;
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
                    
                    applyParagraphStylesToContainer(firstPartContentWrapper);
                    firstPartTestContainer.appendChild(firstPartContentWrapper);
                    const firstPartHeight = firstPartTestContainer.offsetHeight;
                    measure.body.removeChild(firstPartTestContainer);
                    
                    const firstPartRemainingSpace = baseAvailableHeight - firstPartHeight;
                    
                    // Case 1: First part leaves significant unused space (> 30px) and overflow was small (< 30px)
                    // -> Don't split, include whole element with small overflow (relaxed thresholds)
                    if (firstPartRemainingSpace > 30 && overflowAmount < 30) {
                      // Don't split - include whole element with small overflow
                      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                      currentPageElements.push(element.outerHTML);
                    }
                    // Case 2: First part leaves very little to no space (< 15px) and overflow was small (< 30px)
                    // -> Push whole element to next page instead of splitting (avoids unnecessary tiny first part)
                    else if (firstPartRemainingSpace < 15 && overflowAmount < 30) {
                      // Push whole element to next page - avoid split that would leave tiny first part
                      if (currentPageElements.length > 0) {
                        pushPage(block);
                      }
                      startNewPage(false);
                      elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                      currentPageElements.push(element.outerHTML);
                    }
                    // Case 4: First part uses space well - proceed with split
                    else {
                      // First part uses space well - proceed with split
                      const firstFootnotes = extractFootnotesFromContent(first);
                      firstFootnotes.forEach(num => currentPageFootnotes.add(num));
                      currentPageElements.push(first);
                      
                      // Push current page and start new page with second part
                      pushPage(block);
                      startNewPage(false);
                      if (second) {
                        const secondFootnotes = extractFootnotesFromContent(second);
                        secondFootnotes.forEach(num => currentPageFootnotes.add(num));
                        currentPageElements.push(second);
                      }
                    }
                  } else {
                    // Can't split or no space left - push entire element to next page
                    if (currentPageElements.length > 0) {
                      pushPage(block);
                    }
                    startNewPage(false);
                    elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                    currentPageElements.push(element.outerHTML);
                  }
                } else {
                  // Content fits - add to current page
                  elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                  currentPageElements.push(element.outerHTML);
                }
              } else {
                // Element doesn't fit - check if we should even attempt to split
                // If remaining space is very small and element is long, pushing whole element might be better
// console.log('[Pagination] Element does not fit - checking if we can split:', {
//                  remainingContentHeight,
//                  elementText: element.textContent?.substring(0, 100),
//                  elementFits,
//                  currentPageElementsCount: currentPageElements.length
//                });
                
                // Check if we should skip splitting and push whole element instead
                // Conditions: very small remaining space (< 20px) AND element is long enough that split would be awkward
                const elementTextLength = element.textContent?.length || 0;
                const shouldSkipSplit = remainingContentHeight < 20 && 
                                        remainingContentHeight > 0 &&
                                        elementTextLength > 200; // Relaxed: only skip if very little space AND very long element
                
                if (shouldSkipSplit) {
// console.log('[Pagination] Skipping split - remaining space too small, pushing whole element to next page');
                  // Push whole element to next page instead of attempting split
                  if (currentPageElements.length > 0) {
                    pushPage(block);
                  }
                  startNewPage(false);
                  elementFootnotes.forEach(num => currentPageFootnotes.add(num));
                  currentPageElements.push(element.outerHTML);
                  continue; // Skip to next element
                }
                
                if (remainingContentHeight > 0) {
                  // Debug: log element structure to understand why splitting might fail
// console.log('[Pagination] Attempting to split element:', {
//                    tagName: element.tagName,
//                    className: element.className,
//                    textLength: element.textContent?.length,
//                    htmlPreview: element.outerHTML.substring(0, 200),
//                    remainingContentHeight,
//                    isParagraph: element.tagName === 'P',
//                    hasBrTags: element.querySelectorAll('br').length,
//                    childCount: element.childNodes.length
//                  });
                  
                  // Try sentence-level splitting first, then word boundary
                  let splitResult = splitTextAtSentenceBoundary(element, remainingContentHeight);
// console.log('[Pagination] Sentence split result:', {
//                    hasFirst: !!splitResult.first,
//                    hasSecond: !!splitResult.second,
//                    firstPreview: splitResult.first?.substring(0, 100),
//                    secondPreview: splitResult.second?.substring(0, 100)
//                  });
                  
                  if (!splitResult.first && !splitResult.second) {
// console.log('[Pagination] Sentence split failed, trying word boundary');
                    splitResult = splitTextAtWordBoundary(element, remainingContentHeight);
// console.log('[Pagination] Word boundary split result:', {
//                      hasFirst: !!splitResult.first,
//                      hasSecond: !!splitResult.second,
//                      firstPreview: splitResult.first?.substring(0, 100),
//                      secondPreview: splitResult.second?.substring(0, 100)
//                    });
                  }
                  
                  const { first, second } = splitResult;
                  
                  // Log the actual text content to see where the split happened
                  if (first || second) {
                    const tempDiv1 = document.createElement('div');
                    if (first) tempDiv1.innerHTML = first;
                    const firstText = tempDiv1.textContent || '';
                    
                    const tempDiv2 = document.createElement('div');
                    if (second) tempDiv2.innerHTML = second;
                    const secondText = tempDiv2.textContent || '';
                    
// console.log('[Pagination] Split text content:', {
//                      firstText: firstText.substring(0, 200) + (firstText.length > 200 ? '...' : ''),
//                      secondText: secondText.substring(0, 200) + (secondText.length > 200 ? '...' : ''),
//                      firstTextLength: firstText.length,
//                      secondTextLength: secondText.length,
//                      splitPoint: firstText.length,
//                      originalTextLength: element.textContent?.length
//                    });
                  }
                  
                  if (first) {
                    // Verify first part actually fits with updated footnotes
                    const firstFootnotes = extractFootnotesFromContent(first);
                    const testFootnotesWithFirst = new Set([...currentPageFootnotes, ...firstFootnotes]);
                    
                    // Recalculate available height with first part's footnotes
                    const tempFootnotesContainerFirst = document.createElement('div');
                    tempFootnotesContainerFirst.style.width = contentWidth + 'px';
                    measure.body.appendChild(tempFootnotesContainerFirst);
                    const footnotesHeightWithFirst = measureFootnotesHeight(testFootnotesWithFirst, tempFootnotesContainerFirst);
                    measure.body.removeChild(tempFootnotesContainerFirst);
                    
                    // baseAvailableHeight already accounts for footnotes, but we need to recalculate with new footnotes
                    const baseAvailableHeightWithFirst = measure.getAvailableHeight(footnotesHeightWithFirst);
                    const contentAvailableHeightWithFirst = baseAvailableHeightWithFirst;
                    
                    // Measure JUST the first part (not the entire page)
                    // We already know there's remainingContentHeight available, so check if first part fits in that
                    const tempFirstPartOnly = document.createElement('div');
                    tempFirstPartOnly.style.width = measure.body.clientWidth + 'px';
                    measure.body.appendChild(tempFirstPartOnly);
                    
                    const tempFirst = document.createElement('div');
                    tempFirst.innerHTML = first;
                    tempFirstPartOnly.appendChild(tempFirst.firstElementChild || tempFirst);
                    
                    // Apply base paragraph styles to match actual rendering
                    applyParagraphStylesToContainer(tempFirstPartOnly);
                    
                    const firstPartHeight = tempFirstPartOnly.offsetHeight;
                    measure.body.removeChild(tempFirstPartOnly);
                    
                    // Check if first part fits in the remaining space
                    const firstPartFits = firstPartHeight <= remainingContentHeight;
                    
// console.log('[Pagination] First part fit check:', {
//                      firstPartHeight,
//                      remainingContentHeight,
//                      firstPartFits,
//                      difference: remainingContentHeight - firstPartHeight,
//                      currentPageElementsCount: currentPageElements.length,
//                      firstPartHTML: first.substring(0, 150),
//                      note: 'first is the HTML string of the first portion of the split paragraph'
//                    });
                    
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
                        const secondFootnotes = extractFootnotesFromContent(second);
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
          }

          // Finalize last page if there's any content
          if (currentPageElements.length > 0) {
            pushPage(block);
          }

          // Create video pages after block content (blank pages with fullscreen autoplay videos)
          if (videoElements.length > 0) {
            videoElements.forEach((video) => {
              newPages.push({
                chapterIndex: chapterIndex,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                subchapterId: block.subchapterId,
                subchapterTitle: block.type === 'subchapter' ? block.title : null,
                pageIndex: chapterPageIndex,
                hasHeading: false,
                isVideo: true,
                videoSrc: video.src,
                content: '',
                footnotes: [],
                backgroundImageUrl: chapter.backgroundImageUrl || null,
                isFirstPage: chapter.isFirstPage || false,
                isCover: chapter.isCover || false,
              });
              chapterPageIndex += 1;
            });
          }

          document.body.removeChild(tempContainer);
        }
      }

      measure.destroy();

      // Update totalPages for each chapter (exclude cover page from grouping)
      const pagesByChapter = {};
      newPages.forEach(page => {
        // Skip cover page in chapter grouping
        if (page.isCover) return;
        const key = `${page.chapterIndex}`;
        if (!pagesByChapter[key]) pagesByChapter[key] = [];
        pagesByChapter[key].push(page);
      });
      
      newPages.forEach(page => {
        // Special pages don't need totalPages calculation
        if (page.isCover || page.isFirstPage) return;
        const key = `${page.chapterIndex}`;
        page.totalPages = pagesByChapter[key]?.length || 1;
      });

      // Verify page order: first page should be first, then cover, then regular chapters
      console.log('[PageOrder] Setting pages, total:', newPages.length);
      console.log('[PageOrder] First 5 pages:', newPages.slice(0, 5).map((p, i) => ({
        index: i,
        isFirstPage: p.isFirstPage,
        isCover: p.isCover,
        isVideo: p.isVideo,
        isEpigraph: p.isEpigraph,
        chapterIndex: p.chapterIndex,
        pageIndex: p.pageIndex,
        chapterId: p.chapterId
      })));
      
      // Verify first page is at position 0 (if it exists)
      const firstPageIndex = newPages.findIndex(p => p?.isFirstPage);
      const coverPageIndex = newPages.findIndex(p => p?.isCover && !p?.isFirstPage);
      
      if (firstPageIndex !== -1 && firstPageIndex !== 0) {
        console.warn('[PageOrder] First page is not at position 0! Moving it.', { firstPageIndex });
        const firstPage = newPages[firstPageIndex];
        newPages.splice(firstPageIndex, 1);
        newPages.unshift(firstPage);
      }
      
      // Verify cover page is after first page (if both exist)
      if (coverPageIndex !== -1 && firstPageIndex !== -1 && coverPageIndex !== 1) {
        console.warn('[PageOrder] Cover page is not after first page! Moving it.', { coverPageIndex, firstPageIndex });
        const coverPage = newPages[coverPageIndex];
        newPages.splice(coverPageIndex, 1);
        // Insert after first page (position 1)
        newPages.splice(1, 0, coverPage);
      } else if (coverPageIndex !== -1 && firstPageIndex === -1 && coverPageIndex !== 0) {
        // No first page, cover should be first
        console.warn('[PageOrder] Cover page is not first! Moving it.', { coverPageIndex });
        const coverPage = newPages[coverPageIndex];
        newPages.splice(coverPageIndex, 1);
        newPages.unshift(coverPage);
      }
      
      // Set pages immediately for faster initial render
      setPages(newPages);
      setKaraokeSources(newKaraokeSources);
      
      // Apply hyphenation to all pages asynchronously after initial render
      // This improves performance by not blocking the initial page display
      // Use requestIdleCallback to apply hyphenation when browser is idle
      const applyHyphenationBatch = () => {
        setPages(prevPages => {
          console.log('[Hyphenation] Applying hyphenation, prevPages.length:', prevPages.length, 'newPages.length:', newPages.length);
          
          // Only apply if pages haven't changed (avoid race conditions)
          if (prevPages.length !== newPages.length) {
            console.warn('[Hyphenation] Page count mismatch, skipping hyphenation', {
              prevLength: prevPages.length,
              newLength: newPages.length
            });
            return prevPages;
          }
          
          // Verify page order hasn't changed
          const orderChanged = prevPages.some((page, index) => {
            const expectedPage = newPages[index];
            return !expectedPage || page.chapterIndex !== expectedPage.chapterIndex || page.pageIndex !== expectedPage.pageIndex;
          });
          
          if (orderChanged) {
            console.warn('[Hyphenation] Page order changed, skipping hyphenation');
            return prevPages;
          }
          
          // Preserve the exact order of pages - map maintains order
          const hyphenatedPages = prevPages.map((page, index) => {
            if (page.isCover || page.isEpigraph || page.isVideo) {
              return page; // Skip hyphenation for special pages
            }
            // Only apply if not already hyphenated (check for soft hyphens)
            if (page.content.includes('\u00AD')) {
              return page; // Already hyphenated
            }
            return {
              ...page,
              content: applyHyphenationToHTML(page.content)
            };
          });
          
          console.log('[Hyphenation] Hyphenation complete, returning', hyphenatedPages.length, 'pages');
          return hyphenatedPages;
        });
      };
      
      // Apply hyphenation asynchronously to avoid blocking initial render
      if (window.requestIdleCallback) {
        requestIdleCallback(applyHyphenationBatch, { timeout: 500 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(applyHyphenationBatch, 100);
      }
      
      // Restore initial position immediately when pages are calculated
      // Start at first page (isFirstPage) if no bookmark, not cover page
      if (newPages.length > 0) {
        // Find the first page (isFirstPage) - this is the actual first page of content
        const firstPage = newPages.find(p => p.isFirstPage);
        // Find the cover page as fallback
        const coverPage = newPages.find(p => p.isCover && !p.isFirstPage);
        
        if (initialPosition) {
          const { chapterId, pageIndex } = initialPosition;
          // Only restore position if it's NOT the cover page
          if (chapterId !== null) {
            const page = newPages.find(
              (p) => !p.isCover && p.chapterId === chapterId && p.pageIndex === (pageIndex || 0)
            );
            if (page) {
              setCurrentChapterIndex(page.chapterIndex);
              setCurrentPageIndex(page.pageIndex);
            } else if (firstPage) {
              // Fallback to first page if saved position not found
              setCurrentChapterIndex(firstPage.chapterIndex);
              setCurrentPageIndex(firstPage.pageIndex);
            } else if (coverPage) {
              // Fallback to cover page if no first page exists
              setCurrentChapterIndex(coverPage.chapterIndex);
              setCurrentPageIndex(coverPage.pageIndex);
            }
          } else if (firstPage) {
            // No chapterId means start at first page
            setCurrentChapterIndex(firstPage.chapterIndex);
            setCurrentPageIndex(firstPage.pageIndex);
          } else if (coverPage) {
            // Fallback to cover page if no first page exists
            setCurrentChapterIndex(coverPage.chapterIndex);
            setCurrentPageIndex(coverPage.pageIndex);
          }
        } else if (firstPage) {
          // No saved position, start at first page (not cover page)
          setCurrentChapterIndex(firstPage.chapterIndex);
          setCurrentPageIndex(firstPage.pageIndex);
        } else if (coverPage) {
          // Fallback to cover page if no first page exists
          setCurrentChapterIndex(coverPage.chapterIndex);
          setCurrentPageIndex(coverPage.pageIndex);
        }
        // Mark initialization as complete
        setIsInitializing(false);
      }
    };

    // Start calculation immediately but use requestAnimationFrame to ensure DOM is ready
    // This allows the loading GIF to appear right away while calculation happens
    // Use double RAF to ensure React has rendered the loading state first
    const rafId1 = requestAnimationFrame(() => {
      const rafId2 = requestAnimationFrame(() => {
        // Start calculation - loading state should already be visible
        calculatePages();
      });
      return () => cancelAnimationFrame(rafId2);
    });

    return () => {
      cancelAnimationFrame(rafId1);
    };
  }, [chapters, initialPosition, pages.length]);

  // Position restoration is now handled in the page calculation effect
  // to ensure it happens immediately when pages are ready

  // Unlock audio context on first user interaction
  const unlockAudioContext = useCallback(async () => {
    if (audioUnlockedRef.current) {
// console.log('Audio already unlocked');
      return;
    }
    
// console.log('Unlocking audio context...');
    
    // Try multiple methods to unlock audio
    let unlocked = false;
    
    // Method 1: Try with a dummy audio element
    try {
      const dummyAudio = new Audio();
      dummyAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      dummyAudio.volume = 0;
      dummyAudio.preload = 'auto';
      
// console.log('Attempting to play dummy audio...');
      const playPromise = dummyAudio.play();
      if (playPromise !== undefined) {
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Play timeout')), 1000);
        });
        
        try {
          await Promise.race([playPromise, timeoutPromise]);
// console.log('Dummy audio played successfully');
          dummyAudio.pause();
          dummyAudio.currentTime = 0;
          unlocked = true;
        } catch (playErr) {
          console.warn('Dummy audio play failed or timed out', playErr);
          // Try to pause anyway
          try {
            dummyAudio.pause();
          } catch {}
        }
      } else {
// console.log('play() returned undefined, assuming success');
        unlocked = true;
      }
    } catch (err) {
      console.warn('Dummy audio method failed', err);
    }
    
    // Method 2: Try with AudioContext (more reliable)
    if (!unlocked) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          if (ctx.state === 'suspended') {
            await ctx.resume();
// console.log('AudioContext resumed');
          }
          unlocked = true;
        }
      } catch (err) {
        console.warn('AudioContext method failed', err);
      }
    }
    
    // Always mark as unlocked after user gesture - the actual audio.play() will handle any restrictions
    // The user gesture (swipe) is the key requirement, not the dummy audio
    audioUnlockedRef.current = true;
// console.log('Audio marked as unlocked (user gesture detected)');
    window.dispatchEvent(new CustomEvent('audioUnlocked'));
// console.log('audioUnlocked event dispatched');
  }, []);

  // Get or create karaoke controller for a given karaokeId
  const getKaraokeController = useCallback((karaokeId) => {
    if (karaokeControllersRef.current.has(karaokeId)) {
      return karaokeControllersRef.current.get(karaokeId);
    }

    const source = karaokeSourcesRef.current[karaokeId];
    if (!source) return null;

    const audio = new Audio(source.audioUrl);
    audio.preload = 'auto';
    // Only set crossOrigin if we need it for Web Audio API (we don't currently)
    // audio.crossOrigin = 'anonymous';
    
    // Add error handler for debugging
    audio.addEventListener('error', (e) => {
      console.error('[KARAOKE AUDIO] Audio error', {
        error: audio.error,
        code: audio.error?.code,
        message: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: source.audioUrl
      });
    });
    
    // Log when audio is loaded
    audio.addEventListener('loadeddata', () => {
      console.log('[KARAOKE AUDIO] Audio loaded', {
        readyState: audio.readyState,
        duration: audio.duration,
        src: source.audioUrl
      });
    });

    let rafId = null;
    let currentSlice = null;

    const cancelAnimation = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const updateHighlighting = () => {
      if (!currentSlice) return;
      const { sliceElement, startChar, letterTimings } = currentSlice;
      if (!sliceElement || !sliceElement.isConnected) return;

      const current = audio.currentTime;
      const chars = Array.from(sliceElement.textContent || '');
      
      chars.forEach((char, localIdx) => {
        const globalIdx = startChar + localIdx;
        const timing = letterTimings[globalIdx];
        if (!timing) return;

        const span = sliceElement.childNodes[localIdx];
        if (!span || span.nodeType !== Node.TEXT_NODE) return;

        // For text nodes, we need to wrap them in spans for highlighting
        // This will be done during initialization
      });
    };

    const step = () => {
      if (!currentSlice) {
        cancelAnimation();
        return;
      }

      const { sliceElement, startChar, endChar } = currentSlice;
      if (!sliceElement || !sliceElement.isConnected) {
        cancelAnimation();
        return;
      }

      const current = audio.currentTime;
      const wordMetadata = source?.wordCharRanges || [];
      
      // Update highlighting for words in this slice
      let wordSpans = sliceElement.querySelectorAll('.karaoke-word');
      
      // Debug: log first few times to verify loop is running
      if (!currentSlice._stepCount) {
        currentSlice._stepCount = 0;
      }
      currentSlice._stepCount++;
      
      if (currentSlice._stepCount <= 3 || currentSlice._stepCount % 60 === 0) {
// console.log('Step function running (word-level)', { 
//          stepCount: currentSlice._stepCount,
//          wordSpanCount: wordSpans.length, 
//          startChar, 
//          endChar, 
//          currentTime: current,
//          audioPlaying: !audio.paused,
//          audioReadyState: audio.readyState
//        });
      }
      
      if (wordSpans.length === 0) {
        if (!currentSlice._loggedNoSpans) {
          console.warn('No karaoke-word spans found in slice!', {
            sliceElement: sliceElement,
            sliceHTML: sliceElement.innerHTML.substring(0, 100),
            hasChildren: sliceElement.children.length
          });
          currentSlice._loggedNoSpans = true;
        }
        
        // If this is early in playback (first 10 frames), try to re-initialize the slice
        if (currentSlice._stepCount <= 10 && sliceElement && sliceElement.isConnected) {
          // Try to initialize the slice one more time
          const wasInitialized = ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar);
          if (wasInitialized) {
// console.log('[[STEP]] Re-initialized slice on frame', currentSlice._stepCount);
            // Re-query spans after initialization
            const newSpans = sliceElement.querySelectorAll('.karaoke-word');
            if (newSpans.length > 0) {
              // Continue with the new spans
              wordSpans = newSpans;
              currentSlice._loggedNoSpans = false; // Reset so we can log again if needed
            }
          }
        }
        
        // If still no spans, continue the loop in case they appear later
        if (wordSpans.length === 0) {
          rafId = requestAnimationFrame(step);
          return;
        }
      }
      
      wordSpans.forEach((span) => {
        const wordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
        if (wordIndex < 0) return;
        
        // If we're resuming mid-slice, skip words before resumeWordIndex (mark them as complete)
        const resumeWordIndex = currentSlice.resumeWordIndex;
        if (typeof resumeWordIndex === 'number' && wordIndex < resumeWordIndex) {
          span.classList.add('karaoke-word-complete');
          span.classList.remove('karaoke-word-active');
          span.style.setProperty('--karaoke-fill', '1');
          return;
        }
        
        const startStr = span.dataset.start;
        const endStr = span.dataset.end;
        if (!startStr || !endStr) {
          return;
        }

        const start = parseFloat(startStr);
        const end = parseFloat(endStr);
        if (Number.isNaN(start) || Number.isNaN(end)) {
          return;
        }

        if (current >= end) {
          span.classList.add('karaoke-word-complete');
          span.classList.remove('karaoke-word-active');
          span.style.setProperty('--karaoke-fill', '1');
        } else if (current >= start) {
          const duration = Math.max(end - start, 0.001);
          const progress = Math.min(Math.max((current - start) / duration, 0), 1);
          span.classList.add('karaoke-word-active');
          span.classList.remove('karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', progress.toFixed(3));
        } else {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', '0');
        }
      });

      // If we're resuming and have passed the resume point, clear the waiting flag
      if (typeof currentSlice.resumeWordIndex === 'number' && controller.waitingForNextPage) {
        const resumeWord = wordMetadata[currentSlice.resumeWordIndex];
        if (resumeWord && typeof resumeWord.start === 'number' && current >= resumeWord.start) {
          // We've passed the resume point, clear the waiting flag
          controller.waitingForNextPage = false;
          controller.resumeWordIndex = null;
          controller.resumeTime = null;
// console.log('[[RESUME]] Cleared waitingForNextPage - passed resume point', {
//            resumeWordIndex: currentSlice.resumeWordIndex,
//            currentTime: current,
//            resumeWordStart: resumeWord.start,
//          });
        }
      }

      // After updating spans, detect if we've reached the end of this slice
      // If there is more text beyond this slice, we pause and wait for the next page-frame
      const fullTextLength = source?.text ? source.text.length : 0;
      const hasMoreTextBeyondSlice = fullTextLength > 0 && endChar < fullTextLength;

      if (hasMoreTextBeyondSlice && wordSpans.length > 0) {
        const lastSpan = wordSpans[wordSpans.length - 1];
        const lastWordIndex = parseInt(lastSpan.dataset.wordIndex ?? '-1', 10);
        const lastWord = lastWordIndex >= 0 ? wordMetadata[lastWordIndex] : null;
        if (lastWord && typeof lastWord.end === 'number') {
          const sliceEnded = current >= lastWord.end;
          if (sliceEnded && !controller.waitingForNextPage) {
            let nextWordIndex = lastWordIndex + 1;
            let nextWord = null;
            while (nextWordIndex < wordMetadata.length) {
              const candidate = wordMetadata[nextWordIndex];
              if (candidate && typeof candidate.start === 'number') {
                nextWord = candidate;
                break;
              }
              nextWordIndex += 1;
            }

            controller.resumeWordIndex = nextWord ? nextWord.wordIndex : lastWord.wordIndex;
            controller.resumeTime = nextWord
              ? nextWord.start
              : lastWord.end + 0.01;
            controller.waitingForNextPage = true;
// console.log('[[PAGE END]] Karaoke slice reached page end, pausing for next page', {
//              karaokeId,
//              sliceStartChar: startChar,
//              sliceEndChar: endChar,
//              lastWordIndex,
//              nextWordIndex: nextWord ? nextWord.wordIndex : null,
//              resumeWordIndex: controller.resumeWordIndex,
//              resumeTime: controller.resumeTime,
//              currentTime: current,
//            });
            audio.pause();
            cancelAnimation();
            return;
          }
        }
      }

      rafId = requestAnimationFrame(step);
    };

    // Reset highlighting for all slices of this karaoke block
    const resetHighlighting = (sliceElement = null) => {
      // If a specific slice is provided, reset only that slice
      if (sliceElement) {
        const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
        wordSpans.forEach((span) => {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', '0');
        });
        return;
      }

      // Otherwise, reset all slices for this karaoke block
      const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
      allSlices.forEach((slice) => {
        const wordSpans = slice.querySelectorAll('.karaoke-word');
        wordSpans.forEach((span) => {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', '0');
        });
      });
    };

    // Handle audio ended event - reset highlighting and clear resume state
    audio.addEventListener('ended', () => {
// console.log('[[ENDED]] Audio finished, resetting highlighting and state', { karaokeId });
      resetHighlighting();
      cancelAnimation();
      currentSlice = null;
      controller.resumeWordIndex = null;
      controller.resumeTime = null;
      controller.waitingForNextPage = false;
      // Remove playing attribute from all slices of this karaoke
      const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
      allSlices.forEach((slice) => {
        slice.removeAttribute('data-playing');
      });
    });

    const controller = {
      audio,
      // State for cross-page pause & resume
      resumeWordIndex: null,
      resumeTime: null,
      waitingForNextPage: false,

      playSlice: async (sliceElement, startChar, endChar, options = {}) => {
// console.log('[[PLAY]] playSlice called', {
//          karaokeId,
//          startChar,
//          endChar,
//          resumeWordIndex: options.resumeWordIndex,
//          resumeTime: options.resumeTime,
//          audioUnlocked: audioUnlockedRef.current,
//        });
        const source = karaokeSourcesRef.current[karaokeId];
        if (!source) {
// console.log('No source found for karaokeId', karaokeId);
          return;
        }

        // Set playing attribute immediately to stop breathing animation
        sliceElement.setAttribute('data-playing', 'true');
        const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
        allSlices.forEach((slice) => {
          if (slice !== sliceElement) {
            slice.removeAttribute('data-playing');
          }
        });

        // Check if slice is already initialized (has spans)
        const hasSpans = sliceElement.querySelectorAll('.karaoke-word').length > 0;
        if (!hasSpans) {
          // Only initialize if not already initialized
        if (!ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar)) {
            console.warn('[[PLAY]] Failed to initialize slice, cannot start playback');
            sliceElement.removeAttribute('data-playing'); // Remove if failed
            return;
          }
        } else {
// console.log('[[PLAY]] Slice already initialized, skipping initialization');
        }

        // Stop current playback
        audio.pause();
        cancelAnimation();

        // If we're starting from the beginning (not resuming), reset highlighting for all slices
        const isResuming = typeof options.resumeWordIndex === 'number' || typeof options.resumeTime === 'number';
        if (!isResuming) {
// console.log('[[PLAY]] Starting from beginning, resetting highlighting for all slices');
          resetHighlighting(); // Reset all slices, not just this one
          controller.resumeWordIndex = null;
          controller.resumeTime = null;
        }

        // Calculate highlight start time (when highlighting should begin)
        // Audio always starts from 0.0, but highlighting starts at the appropriate time
        const letterTimings = source.letterTimings || [];
        const wordMetadata = source.wordCharRanges || [];
        let highlightStartTime;

        if (typeof options.resumeTime === 'number') {
          // Resuming: start audio at resumeTime, highlighting starts immediately
          highlightStartTime = options.resumeTime;
        } else if (typeof options.resumeWordIndex === 'number') {
          const resumeWord = wordMetadata[options.resumeWordIndex];
          highlightStartTime =
            resumeWord && typeof resumeWord.start === 'number'
              ? resumeWord.start
              : 0;
        } else {
          // Starting fresh: audio always starts from 0.0
          // Highlighting starts when the first word in this slice should be highlighted
          const startTiming = letterTimings[startChar];
          highlightStartTime = startTiming ? startTiming.start : 0;
        }

        currentSlice = {
          sliceElement,
          startChar,
          endChar,
          letterTimings,
          resumeWordIndex: options.resumeWordIndex,
          highlightStartTime, // When highlighting should begin (may be > 0 if audio starts at 0)
          _stepCount: 0,
          _loggedSpans: false,
          _loggedMissingTiming: false,
          _loggedNoSpans: false,
        };

        try {
          // Check if audio has an error
          if (audio.error) {
            console.error('[KARAOKE PLAY] Audio has error in playSlice', {
              code: audio.error.code,
              message: audio.error.message,
              networkState: audio.networkState,
              readyState: audio.readyState
            });
            sliceElement.removeAttribute('data-playing');
            return;
          }
          
          // Wait for audio to be ready if needed
          if (audio.readyState < 4) {
            console.log('[KARAOKE PLAY] Waiting for audio to load in playSlice', {
              readyState: audio.readyState,
              networkState: audio.networkState
            });
            
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Audio load timeout in playSlice'));
              }, 10000);
              
              const onReady = () => {
                clearTimeout(timeout);
                audio.removeEventListener('canplaythrough', onReady);
                audio.removeEventListener('error', onError);
                resolve();
              };
              
              const onError = (e) => {
                clearTimeout(timeout);
                audio.removeEventListener('canplaythrough', onReady);
                audio.removeEventListener('error', onError);
                reject(e);
              };
              
              if (audio.readyState >= 4) {
                clearTimeout(timeout);
                resolve();
              } else {
                audio.addEventListener('canplaythrough', onReady, { once: true });
                audio.addEventListener('error', onError, { once: true });
                if (audio.networkState === 0) {
                  audio.load();
                }
              }
            });
          }
          
          // Audio always starts from 0.0 (or resumeTime if resuming)
          // Highlighting will start at highlightStartTime
          const audioStartTime = typeof options.resumeTime === 'number' ? options.resumeTime : 0;
          audio.currentTime = audioStartTime;
          console.log('[KARAOKE PLAY] Starting audio playback', {
            audioStartTime,
            highlightStartTime,
            currentTime: audio.currentTime
          });
          await audio.play();
          console.log('[KARAOKE PLAY] Audio playing successfully, starting animation loop');
          
          // Clear processing flag now that playback has started
          sliceElement.dataset.processing = 'false';
          
          // Don't clear waitingForNextPage here - keep it until we've actually progressed past resume point
          // The resumeWordIndex/resumeTime will be used for highlighting, and we'll clear waitingForNextPage
          // in the step function once we've passed the resume point
          
          // Start animation loop - it will handle missing spans gracefully
          cancelAnimation();
          rafId = requestAnimationFrame(step);
// console.log('Animation loop started, rafId:', rafId, 'wordSpans:', sliceElement.querySelectorAll('.karaoke-word').length);
        } catch (err) {
          console.error('Karaoke playback failed', err);
          // Remove playing attribute if playback failed so breathing animation resumes
          sliceElement.removeAttribute('data-playing');
          // Clear processing flag
          sliceElement.dataset.processing = 'false';
          // The error might be due to browser restrictions, but we've already had a user gesture
          // so we'll log it but not retry - the user can tap the karaoke to start it
        }
      },
      pause: () => {
        audio.pause();
        cancelAnimation();
      },
      stop: () => {
        audio.pause();
        audio.currentTime = 0;
        cancelAnimation();
        currentSlice = null;
        controller.resumeWordIndex = null;
        controller.resumeTime = null;
        controller.waitingForNextPage = false;
      },
      cleanup: () => {
        audio.pause();
        audio.src = '';
        cancelAnimation();
        currentSlice = null;
        controller.resumeWordIndex = null;
        controller.resumeTime = null;
        controller.waitingForNextPage = false;
      },
    };

    karaokeControllersRef.current.set(karaokeId, controller);
    return controller;
  }, []);

  // Initialize karaoke slices on a page
  const initializeKaraokeSlices = useCallback((pageContentElement) => {
    if (!pageContentElement) return;

    const slices = pageContentElement.querySelectorAll('.karaoke-slice');
// console.log('[[INIT]] initializeKaraokeSlices called', {
//      totalSlices: slices.length,
//      elementConnected: pageContentElement.isConnected,
//    });
    
    slices.forEach((slice) => {
      // Only process slices that are actually connected to the DOM
      if (!slice.isConnected) {
// console.log('[[INIT]] Skipping disconnected slice', {
//          startChar: slice.getAttribute('data-karaoke-start'),
//          endChar: slice.getAttribute('data-karaoke-end'),
//        });
        return;
      }

      const karaokeId = slice.getAttribute('data-karaoke-id');
      const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
      const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);

      if (!karaokeId) return;

      // Initialize slice if not already initialized (has karaoke-word spans)
      const isInitialized = slice.querySelectorAll('.karaoke-word').length > 0;
      if (!isInitialized) {
        const initialized = ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, slice, startChar, endChar);
        if (!initialized) {
          return;
        }
      } else {
// console.log('[[INIT]] Skipping already-initialized slice', {
//          startChar: slice.getAttribute('data-karaoke-start'),
//          endChar: slice.getAttribute('data-karaoke-end'),
//        });
      }

      // Add touch/click handler to start playback on tap (always, even if already initialized)
      if (!slice.dataset.clickHandlerAdded) {
        slice.dataset.clickHandlerAdded = 'true';
        
        // Use touchend for mobile, click for desktop
        const handleInteraction = (e) => {
          console.log('[KARAOKE TAP] Event received', {
            type: e.type,
            target: e.target?.tagName,
            targetClass: e.target?.className,
            slice: slice?.className,
            karaokeId: slice?.getAttribute('data-karaoke-id'),
            hasTouchStart: !!touchStartRef.current,
            hasTouchCurrent: !!touchCurrentRef.current,
            timestamp: Date.now()
          });
          
          // For touchend events, check if it's a tap (not a swipe)
          if (e.type === 'touchend' && touchStartRef.current && touchCurrentRef.current) {
            const deltaX = touchCurrentRef.current.x - touchStartRef.current.x;
            const deltaY = touchCurrentRef.current.y - touchStartRef.current.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            console.log('[KARAOKE TAP] Movement check', { deltaX, deltaY, distance, isTap: distance <= 10 });
            // If movement is too large, it's a swipe, not a tap - ignore it
            if (distance > 10) {
              console.log('[KARAOKE TAP] Ignored - movement too large (swipe)');
              return;
            }
          }
          
          e.stopPropagation(); // Prevent swipe from triggering
          e.preventDefault(); // Prevent any default behavior
          
          console.log('[KARAOKE TAP] Processing tap - passed all checks');

          const karaokeId = slice.getAttribute('data-karaoke-id');
          const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
          
// console.log('Karaoke slice clicked', { karaokeId, startChar, endChar });
          
          // Only allow playback to start if this is the first page of the karaoke object (startChar === 0)
          if (startChar !== 0) {
            console.log('[KARAOKE TAP] Ignored - not on first page of karaoke object', { startChar });
            return; // Do nothing if not on first page
          }
          
          // Prevent multiple simultaneous clicks
          if (slice.dataset.processing === 'true') {
// console.log('Already processing click, ignoring');
            return;
          }
          slice.dataset.processing = 'true';
          
          // Clear processing flag after a short delay
          setTimeout(() => {
            slice.dataset.processing = 'false';
          }, 500);
          
          if (karaokeId) {
            // Ensure slice is initialized BEFORE doing anything else
            if (slice.querySelectorAll('.karaoke-word').length === 0) {
// console.log('Slice not initialized in click handler, initializing now...');
              const initialized = ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, slice, startChar, endChar);
              if (!initialized) {
                console.error('Failed to initialize slice in click handler');
                return;
              }
            }
            
            const controller = getKaraokeController(karaokeId);
            if (controller && controller.audio) {
              const audio = controller.audio;
              
              // Wait for audio to be ready before playing
              const playAudio = async () => {
                // Check if audio has an error
                if (audio.error) {
                  console.error('[KARAOKE PLAY] Audio has error', {
                    code: audio.error.code,
                    message: audio.error.message,
                    networkState: audio.networkState,
                    readyState: audio.readyState
                  });
                  return;
                }
                
                // Wait for audio to be ready (HAVE_ENOUGH_DATA = 4)
                if (audio.readyState < 4) {
                  console.log('[KARAOKE PLAY] Waiting for audio to load', {
                    readyState: audio.readyState,
                    networkState: audio.networkState
                  });
                  
                  // Wait for loadeddata or canplaythrough
                  await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                      reject(new Error('Audio load timeout'));
                    }, 10000); // 10 second timeout
                    
                    const onReady = () => {
                      clearTimeout(timeout);
                      audio.removeEventListener('canplaythrough', onReady);
                      audio.removeEventListener('error', onError);
                      resolve();
                    };
                    
                    const onError = (e) => {
                      clearTimeout(timeout);
                      audio.removeEventListener('canplaythrough', onReady);
                      audio.removeEventListener('error', onError);
                      reject(e);
                    };
                    
                    if (audio.readyState >= 4) {
                      clearTimeout(timeout);
                      resolve();
                    } else {
                      audio.addEventListener('canplaythrough', onReady, { once: true });
                      audio.addEventListener('error', onError, { once: true });
                      // Also try to load if not already loading
                      if (audio.networkState === 0) {
                        audio.load();
                      }
                    }
                  });
                }
                
                // Now try to play
                try {
                  await audio.play();
                  return true;
                } catch (err) {
                  console.error('[KARAOKE PLAY] Play failed', err);
                  throw err;
                }
              };
              
              // Unlock audio by playing the actual karaoke audio (best gesture context)
              if (!audioUnlockedRef.current) {
                console.log('[KARAOKE PLAY] Unlocking audio via karaoke click...');
                playAudio().then(() => {
                  audio.pause();
                  audio.currentTime = 0;
                  audioUnlockedRef.current = true;
                  console.log('[KARAOKE PLAY] Audio unlocked via karaoke click');
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                  // Now start playback from this slice, clearing any pending resume
                  karaokeControllersRef.current.forEach((ctrl, id) => {
                    if (id !== karaokeId) {
                      ctrl.pause();
                    }
                  });
                  controller.resumeWordIndex = null;
                  controller.resumeTime = null;
                  controller.waitingForNextPage = false;
                  controller.playSlice(slice, startChar, endChar);
                  currentKaraokeSliceRef.current = { karaokeId, sliceElement: slice, startChar, endChar };
                }).catch((err) => {
                  console.error('[KARAOKE PLAY] Failed to unlock via karaoke click', err);
                  // Still try to play - might work if audio context is unlocked
                  audioUnlockedRef.current = true;
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                  karaokeControllersRef.current.forEach((ctrl, id) => {
                    if (id !== karaokeId) {
                      ctrl.pause();
                    }
                  });
                  controller.resumeWordIndex = null;
                  controller.resumeTime = null;
                  controller.waitingForNextPage = false;
                  controller.playSlice(slice, startChar, endChar);
                  currentKaraokeSliceRef.current = { karaokeId, sliceElement: slice, startChar, endChar };
                });
              } else {
                // Already unlocked, just play
                console.log('[KARAOKE PLAY] Audio already unlocked, starting playback');
                playAudio().then(() => {
                  karaokeControllersRef.current.forEach((ctrl, id) => {
                    if (id !== karaokeId) {
                      ctrl.pause();
                    }
                  });
                  controller.resumeWordIndex = null;
                  controller.resumeTime = null;
                  controller.waitingForNextPage = false;
                  controller.playSlice(slice, startChar, endChar);
                  currentKaraokeSliceRef.current = { karaokeId, sliceElement: slice, startChar, endChar };
                }).catch((err) => {
                  console.error('[KARAOKE PLAY] Failed to start playback', err);
                });
              }
            } else {
              console.warn('[KARAOKE PLAY] Controller or audio not found', { controller: !!controller, audio: controller?.audio });
            }
          }
        };
        
        // Use touchend for mobile, click for desktop
        // Mobile: touchend fires immediately and reliably, avoiding click delay/cancellation
        // Desktop: click works fine
        const isMobileDevice = window.innerWidth <= 768;
        if (isMobileDevice) {
          slice.addEventListener('touchend', handleInteraction, { passive: false });
        } else {
          slice.addEventListener('click', handleInteraction);
        }
      }
    });
  }, [getKaraokeController, unlockAudioContext]);

  // Start playback for visible karaoke slice
  const startVisibleKaraoke = useCallback(() => {
// console.log('startVisibleKaraoke called', { 
//      isTransitioning: isTransitioningRef.current, 
//      audioUnlocked: audioUnlockedRef.current 
//    });
    // Use ref instead of state to avoid stale closures
    if (isTransitioningRef.current) {
// console.log('Skipping - transitioning');
      return;
    }
    if (!audioUnlockedRef.current) {
// console.log('Skipping - audio not unlocked');
      return; // Don't try if audio isn't unlocked yet
    }
    
    const node = pageContentRef.current;
    if (!node || !node.isConnected) {
// console.log('Skipping - no node or not connected');
      return;
    }

    // FIRST: Check for resume state BEFORE initializing slices
    // We need to check if there's a controller with resume state for any karaoke on this page
    const tempSlices = node.querySelectorAll('.karaoke-slice');
    let hasResumeState = false;
    let resumeController = null;
    
    if (tempSlices.length > 0) {
      const firstSlice = tempSlices[0];
      const firstKaraokeId = firstSlice.getAttribute('data-karaoke-id');
      if (firstKaraokeId) {
        resumeController = getKaraokeController(firstKaraokeId);
        if (resumeController && typeof resumeController.resumeWordIndex === 'number' && resumeController.resumeTime !== null) {
          hasResumeState = true;
// console.log('[[RESUME]] Resume state found BEFORE initialization', {
//            karaokeId: firstKaraokeId,
//            resumeWordIndex: resumeController.resumeWordIndex,
//            resumeTime: resumeController.resumeTime,
//          });
        }
      }
    }

    // Now initialize slices (this is safe - it just wraps chars in spans, doesn't start playback)
    initializeKaraokeSlices(node);

    const slices = node.querySelectorAll('.karaoke-slice');
// console.log('Found karaoke slices', slices.length);
    if (slices.length === 0) return;

// console.log('[[PAGE ENTER]] startVisibleKaraoke invoked');

    // Determine which slice to start from
    let targetSlice = slices[0];
    let targetStartChar = parseInt(targetSlice.getAttribute('data-karaoke-start') || '0', 10);
    let targetEndChar = parseInt(targetSlice.getAttribute('data-karaoke-end') || '0', 10);
    let resumeWordIndex = null;

    // Get controller for the first slice's karaokeId so we can read resume state
    const firstKaraokeId = targetSlice.getAttribute('data-karaoke-id');
    if (!firstKaraokeId) {
      console.warn('[[PAGE ENTER]] No karaokeId on first slice');
      return;
    }
    const controller = resumeController || getKaraokeController(firstKaraokeId);
// console.log('[[PAGE ENTER]] Controller lookup', {
//      karaokeId: firstKaraokeId,
//      found: !!controller,
//      waitingForNextPage: controller?.waitingForNextPage,
//      resumeWordIndex: controller?.resumeWordIndex,
//      resumeTime: controller?.resumeTime,
//      hadResumeStateBeforeInit: hasResumeState,
//    });
    if (!controller) return;

    // Check for resume state - even if waitingForNextPage was cleared, we might still have resume info
    if (typeof controller.resumeWordIndex === 'number' && controller.resumeTime !== null) {
      // Try to find the slice on this page that contains the resume word
      const resumeIndex = controller.resumeWordIndex;
      const sourceForResume = karaokeSourcesRef.current[firstKaraokeId];
      const resumeWordMeta = sourceForResume?.wordCharRanges?.[resumeIndex];
      const resumeCharPosition = resumeWordMeta ? resumeWordMeta.charStart : null;
// console.log('[[RESUME]] Resume state detected', {
//        resumeWordIndex: resumeIndex,
//        resumeCharPosition,
//        resumeTime: controller.resumeTime,
//        waitingForNextPage: controller.waitingForNextPage,
//        note: 'Checking for resume even if waitingForNextPage is false',
//      });

      if (typeof resumeCharPosition === 'number') {
        for (const slice of slices) {
          const sStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const sEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
// console.log('[[RESUME]] Checking slice for resume', {
//            sStart,
//            sEnd,
//            resumeCharPosition,
//          });
          if (resumeCharPosition >= sStart && resumeCharPosition < sEnd) {
            targetSlice = slice;
            targetStartChar = sStart;
            targetEndChar = sEnd;
            resumeWordIndex = resumeIndex;
            break;
          }
        }
      }

      if (resumeWordIndex === null) {
        console.warn('[[RESUME]] No slice on this page contains resumeIndex, falling back to first slice', {
          requestedResumeIndex: resumeIndex,
          controllerResumeWordIndex: controller.resumeWordIndex,
        });
        // Don't clear waitingForNextPage if we didn't find the right slice
      } else {
        // We found the right slice - clear waiting flag after we start playback
        // (We'll clear it in playSlice after successful start)
      }
    }

    const karaokeId = targetSlice.getAttribute('data-karaoke-id');
// console.log('[[PAGE ENTER]] Karaoke slice info', {
//      karaokeId,
//      targetStartChar,
//      targetEndChar,
//      resumeWordIndex,
//      resumeTime: controller.resumeTime,
//    });
    if (!karaokeId) return;

    // Check if slice has been initialized (has karaoke-word spans)
    const hasWords = targetSlice.querySelectorAll('.karaoke-word').length > 0;
// console.log('[[PAGE ENTER]] Slice has words', hasWords);
    if (!hasWords) {
      // Slice not initialized yet, try again after a short delay
// console.log('Retrying - slice not initialized');
      setTimeout(() => {
        startVisibleKaraoke();
      }, 100);
      return;
    }

    // Check if slice is actually visible
    const rect = targetSlice.getBoundingClientRect();
    const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
// console.log('[[PAGE ENTER]] Slice visibility', { isVisible, rect });
    if (!isVisible) return;

    // Pause any other karaoke that might be playing
    karaokeControllersRef.current.forEach((ctrl, id) => {
      if (id !== karaokeId) {
        ctrl.pause();
      }
    });

    // Re-read resume state from controller (in case we retried and lost the local variable)
    const finalResumeWordIndex = typeof controller.resumeWordIndex === 'number' ? controller.resumeWordIndex : resumeWordIndex;
    const finalResumeTime = controller.resumeTime !== null ? controller.resumeTime : null;
    
    // Start playback – if we have a resumeWordIndex, use it to start mid-slice
// console.log('[[PLAY]] Starting karaoke playback', { 
//      resumeWordIndex: finalResumeWordIndex, 
//      resumeTime: finalResumeTime,
//      fromController: typeof controller.resumeWordIndex === 'number',
//      localResumeWordIndex: resumeWordIndex,
//    });
    const playOptions =
      typeof finalResumeWordIndex === 'number' && finalResumeTime !== null
        ? { resumeWordIndex: finalResumeWordIndex, resumeTime: finalResumeTime }
        : {};

    controller.playSlice(targetSlice, targetStartChar, targetEndChar, playOptions);
    currentKaraokeSliceRef.current = {
      karaokeId,
      sliceElement: targetSlice,
      startChar: targetStartChar,
      endChar: targetEndChar,
    };
  }, [isTransitioning, getKaraokeController, initializeKaraokeSlices]);

  // Navigate to next page
  const goToNextPage = useCallback(() => {
    if (isTransitioning || pages.length === 0) return;

    // Find current page - handle special pages (first page, cover) and regular pages
    const currentPage = pages.find(
      (p) => {
        if (currentChapterIndex === -2) {
          // Looking for first page
          return p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        } else if (currentChapterIndex === -1) {
          // Looking for cover page
          return p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        } else {
          // Looking for regular page - exclude special pages
          return !p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        }
      }
    );

    if (!currentPage) {
      // Fallback: try to find first page, then cover, then first regular page
      if (pages.length > 0) {
        const firstPage = pages.find(p => p.isFirstPage);
        if (firstPage) {
          setIsTransitioning(true);
          setCurrentChapterIndex(firstPage.chapterIndex);
          setCurrentPageIndex(firstPage.pageIndex);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setIsTransitioning(false);
            });
          });
          if (onPageChange) {
            onPageChange({
              chapterId: firstPage.chapterId,
              pageIndex: firstPage.pageIndex,
            });
          }
        } else {
          const coverPage = pages.find(p => p.isCover && !p.isFirstPage);
          if (coverPage) {
            setIsTransitioning(true);
            setCurrentChapterIndex(coverPage.chapterIndex);
            setCurrentPageIndex(coverPage.pageIndex);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsTransitioning(false);
              });
            });
            if (onPageChange) {
              onPageChange({
                chapterId: coverPage.chapterId,
                pageIndex: coverPage.pageIndex,
              });
            }
          } else {
            // No special pages, fallback to first regular page
            const firstRegularPage = pages.find(p => !p.isCover && !p.isFirstPage);
            if (firstRegularPage) {
              setIsTransitioning(true);
              setCurrentChapterIndex(firstRegularPage.chapterIndex);
              setCurrentPageIndex(firstRegularPage.pageIndex);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setIsTransitioning(false);
                });
              });
              if (onPageChange) {
                onPageChange({
                  chapterId: firstRegularPage.chapterId,
                  pageIndex: firstRegularPage.pageIndex,
                });
              }
            }
          }
        }
      }
      return;
    }

    // Check if there's a next page in current chapter (exclude special pages from regular navigation)
    const nextPageInChapter = pages.find(
      (p) =>
        !p.isCover && !p.isFirstPage &&
        p.chapterIndex === currentChapterIndex &&
        p.pageIndex === currentPageIndex + 1
    );

    if (nextPageInChapter) {
      // Next page in same chapter
      setIsTransitioning(true);
      // Wait for fade-out to complete (1s), then update content and fade in
      setTimeout(() => {
        // Update both displayPage and indices together
        setDisplayPage(nextPageInChapter);
        setCurrentPageIndex(currentPageIndex + 1);
        // Wait for DOM to update and ink effect to be applied before starting fade-in
        // Use requestAnimationFrame to ensure DOM is ready, then give time for ink effect
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Now start fade-in - ink effect should be applied by now
            setIsTransitioning(false);
          });
        });
      }, 1000); // Wait for full fade-out duration

      if (onPageChange) {
        onPageChange({
          chapterId: currentPage.chapterId,
          pageIndex: currentPageIndex + 1,
          subchapterId: nextPageInChapter.subchapterId,
        });
      }
    } else {
      // Move to next chapter/page
      // Handle special case: if we're on first page, go to cover page
      if (currentChapterIndex === -2) {
        const coverPage = pages.find(p => p.isCover && !p.isFirstPage && p.chapterIndex === -1);
        if (coverPage) {
          setIsTransitioning(true);
          setTimeout(() => {
            setDisplayPage(coverPage);
            setCurrentChapterIndex(coverPage.chapterIndex);
            setCurrentPageIndex(coverPage.pageIndex);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsTransitioning(false);
              });
            });
          }, 1000);
          if (onPageChange) {
            onPageChange({
              chapterId: coverPage.chapterId,
              pageIndex: coverPage.pageIndex,
            });
          }
        }
        return;
      }
      
      // Handle special case: if we're on cover page, go to first regular chapter
      if (currentChapterIndex === -1) {
        // Find first regular chapter (order >= 0, not special pages)
        const sortedChapterIndices = [...new Set(pages.map(p => p.chapterIndex).filter(idx => idx >= 0))].sort((a, b) => a - b);
        if (sortedChapterIndices.length > 0) {
          const firstRegularChapterIndex = sortedChapterIndices[0];
          // Find the first page of the first regular chapter (lowest pageIndex)
          const pagesOfFirstChapter = pages.filter(
            (p) => !p.isCover && !p.isFirstPage && p.chapterIndex === firstRegularChapterIndex
          );
          if (pagesOfFirstChapter.length > 0) {
            // Sort by pageIndex to get the first page
            pagesOfFirstChapter.sort((a, b) => a.pageIndex - b.pageIndex);
            const firstPageOfFirstChapter = pagesOfFirstChapter[0];
            setIsTransitioning(true);
            setTimeout(() => {
              setDisplayPage(firstPageOfFirstChapter);
              setCurrentChapterIndex(firstRegularChapterIndex);
              setCurrentPageIndex(firstPageOfFirstChapter.pageIndex);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setIsTransitioning(false);
                });
              });
            }, 1000);
            if (onPageChange) {
              onPageChange({
                chapterId: firstPageOfFirstChapter.chapterId,
                pageIndex: firstPageOfFirstChapter.pageIndex,
                subchapterId: firstPageOfFirstChapter.subchapterId,
              });
            }
          }
        }
        return;
      }
      
      // Find next chapter by looking for next chapterIndex in sorted order
      const sortedChapterIndices = [...new Set(pages.map(p => p.chapterIndex).filter(idx => idx >= 0))].sort((a, b) => a - b);
      const currentIdxInSorted = sortedChapterIndices.indexOf(currentChapterIndex);
      if (currentIdxInSorted === -1 || currentIdxInSorted + 1 >= sortedChapterIndices.length) {
        return;
      }
      const nextChapterIndex = sortedChapterIndices[currentIdxInSorted + 1];
      const firstPageOfNextChapter = pages.find(
        (p) => !p.isCover && !p.isFirstPage && p.chapterIndex === nextChapterIndex && p.pageIndex === 0
      );
      if (firstPageOfNextChapter) {
        setIsTransitioning(true);
        // Wait for fade-out to complete (1s), then update content and fade in
        setTimeout(() => {
          // Update both displayPage and indices together
          setDisplayPage(firstPageOfNextChapter);
          setCurrentChapterIndex(nextChapterIndex);
          setCurrentPageIndex(0);
          // Wait for DOM to update and ink effect to be applied before starting fade-in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setIsTransitioning(false);
            });
          });
        }, 1000); // Wait for full fade-out duration

        if (onPageChange) {
          onPageChange({
            chapterId: firstPageOfNextChapter.chapterId,
            pageIndex: 0,
            subchapterId: firstPageOfNextChapter.subchapterId,
          });
        }
      }
    }
  }, [
    currentChapterIndex,
    currentPageIndex,
    pages,
    chapters,
    isTransitioning,
    onPageChange,
  ]);

  // Check if touch target is interactive (karaoke, button, etc.)
  const isInteractiveTarget = useCallback((target) => {
    if (!target) return false;
    return (
      target.closest('.karaoke-slice') ||
      target.closest('.karaoke-char') ||
      target.closest('.karaoke-word') ||
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('textarea')
    );
  }, []);

  // Handle touch start (for swipe detection)
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    touchCurrentRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
    swipeInProgressRef.current = false;
    tocDragStartYRef.current = null;
  }, []);

  // Handle touch move
  const handleTouchMove = useCallback((e) => {
    if (!touchStartRef.current) return;
    
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    
    // Prevent pull-to-refresh on all downward swipes
    if (deltaY > 0) {
      e.preventDefault();
    }
    
    // Track vertical swipe down for TOC drag
    if (!isTOCOpen && Math.abs(deltaY) > Math.abs(deltaX) && deltaY > 0) {
      // Swiping down - track the drag progress
      if (tocDragStartYRef.current === null) {
        tocDragStartYRef.current = touchStartRef.current.y;
      }
      
      const dragDistance = e.touches[0].clientY - tocDragStartYRef.current;
      const viewportHeight = window.innerHeight;
      // Calculate progress: 0 when drag starts, 1 when dragged down by viewport height
      const progress = Math.min(Math.max(dragDistance / viewportHeight, 0), 1);
      
      // Store in ref to avoid React re-renders during drag
      tocDragProgressRef.current = progress;
      
      // Update TOC directly via DOM to avoid React re-render of page content
      // This prevents the page from re-rendering and losing ink effects
      const tocElement = document.querySelector('.mobile-toc-overlay');
      if (tocElement) {
        const container = tocElement.querySelector('.mobile-toc-container');
        if (container && progress > 0) {
          const translateY = Math.max(-100, -100 + (progress * 100));
          container.style.transform = `translateY(${translateY}%)`;
          container.style.transition = 'none';
          const textColor = 'white'; // Bright white during drag
          container.style.color = textColor;
          // Keep overlay fully opaque during drag so text is visible (curtain effect)
          tocElement.style.opacity = '1';
          tocElement.style.pointerEvents = 'auto';
        } else if (container && progress === 0) {
          // Reset when drag is cancelled
          container.style.transform = 'translateY(-100%)';
          container.style.transition = '';
          container.style.color = '';
          tocElement.style.opacity = '0';
          tocElement.style.pointerEvents = 'none';
        }
      }
    }
    
    // Prevent default for horizontal swipes as well
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      e.preventDefault();
    }
    
    touchCurrentRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, [isTOCOpen]);

  // Navigate to previous page
  const goToPreviousPage = useCallback(() => {
    // Mark that user has interacted
    hasUserInteractedRef.current = true;
    if (isTransitioning || pages.length === 0) return;

    // Find current page - handle special pages (first page, cover) and regular pages
    const currentPage = pages.find(
      (p) => {
        if (currentChapterIndex === -2) {
          // Looking for first page
          return p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        } else if (currentChapterIndex === -1) {
          // Looking for cover page
          return p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        } else {
          // Looking for regular page - exclude special pages
          return !p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
        }
      }
    );

    if (!currentPage) return;

    // Check if there's a previous page in current chapter
    if (currentPageIndex > 0) {
      // Previous page in same chapter (exclude special pages)
      const prevPage = pages.find(
        (p) =>
          !p.isCover && !p.isFirstPage &&
          p.chapterIndex === currentChapterIndex &&
          p.pageIndex === currentPageIndex - 1
      );
      
      if (prevPage) {
        console.log('[SWIPE BACK] Starting transition', {
          currentPage: { chapterIndex: currentChapterIndex, pageIndex: currentPageIndex, hasContent: !!currentPage?.content, contentLength: currentPage?.content?.length },
          prevPage: { chapterIndex: prevPage.chapterIndex, pageIndex: prevPage.pageIndex, hasContent: !!prevPage.content, contentLength: prevPage.content?.length }
        });
        
        // Safety check: ensure prevPage has content
        if (!prevPage.content) {
          console.error('[SWIPE BACK] prevPage has no content!', {
            prevPage: { chapterIndex: prevPage.chapterIndex, pageIndex: prevPage.pageIndex, id: prevPage.id }
          });
          return; // Don't proceed if no content
        }
        
        setIsTransitioning(true);
        // Wait for fade-out to complete (1s), then update content and fade in
        setTimeout(() => {
          console.log('[SWIPE BACK] Setting displayPage to prevPage', {
            prevPage: { chapterIndex: prevPage.chapterIndex, pageIndex: prevPage.pageIndex, hasContent: !!prevPage.content, contentLength: prevPage.content?.length }
          });
          // Update both displayPage and indices together
          setDisplayPage(prevPage);
          setCurrentPageIndex(currentPageIndex - 1);
          // Wait for DOM to update and ink effect to be applied before starting fade-in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              console.log('[SWIPE BACK] Transition complete, setting isTransitioning to false');
              setIsTransitioning(false);
            });
          });
        }, 1000); // Wait for full fade-out duration

        if (onPageChange) {
          onPageChange({
            chapterId: currentPage.chapterId,
            pageIndex: currentPageIndex - 1,
            subchapterId: prevPage.subchapterId,
          });
        }
      }
    } else {
      // Move to previous chapter, last page (exclude special pages)
      // Handle special case: if we're on cover page, go back to first page
      if (currentChapterIndex === -1) {
        const firstPage = pages.find(p => p.isFirstPage && p.chapterIndex === -2);
        if (firstPage) {
          setIsTransitioning(true);
          setTimeout(() => {
            setDisplayPage(firstPage);
            setCurrentChapterIndex(firstPage.chapterIndex);
            setCurrentPageIndex(firstPage.pageIndex);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsTransitioning(false);
              });
            });
          }, 1000);
          if (onPageChange) {
            onPageChange({
              chapterId: firstPage.chapterId,
              pageIndex: firstPage.pageIndex,
            });
          }
        }
        return;
      }
      
      // Find previous chapter by looking for previous chapterIndex in sorted order
      const sortedChapterIndices = [...new Set(pages.map(p => p.chapterIndex).filter(idx => idx >= 0))].sort((a, b) => a - b);
      const currentIdxInSorted = sortedChapterIndices.indexOf(currentChapterIndex);
      if (currentIdxInSorted === -1 || currentIdxInSorted === 0) {
        // Check if we can go to cover page (if we're on first regular chapter)
        if (currentIdxInSorted === 0) {
          const coverPage = pages.find(p => p.isCover && !p.isFirstPage && p.chapterIndex === -1);
          if (coverPage) {
            setIsTransitioning(true);
            setTimeout(() => {
              setDisplayPage(coverPage);
              setCurrentChapterIndex(coverPage.chapterIndex);
              setCurrentPageIndex(coverPage.pageIndex);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  setIsTransitioning(false);
                });
              });
            }, 1000);
            if (onPageChange) {
              onPageChange({
                chapterId: coverPage.chapterId,
                pageIndex: coverPage.pageIndex,
              });
            }
          }
        }
        return;
      }
      const prevChapterIndex = sortedChapterIndices[currentIdxInSorted - 1];
      const lastPageOfPrevChapter = pages
        .filter((p) => !p.isCover && !p.isFirstPage && p.chapterIndex === prevChapterIndex)
        .sort((a, b) => b.pageIndex - a.pageIndex)[0];

      if (lastPageOfPrevChapter) {
        setIsTransitioning(true);
        // Wait for fade-out to complete (1s), then update content and fade in
        setTimeout(() => {
          // Update both displayPage and indices together
          setDisplayPage(lastPageOfPrevChapter);
          setCurrentChapterIndex(prevChapterIndex);
          setCurrentPageIndex(lastPageOfPrevChapter.pageIndex);
          // Wait for DOM to update and ink effect to be applied before starting fade-in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setIsTransitioning(false);
            });
          });
        }, 1000); // Wait for full fade-out duration

        if (onPageChange) {
          onPageChange({
            chapterId: lastPageOfPrevChapter.chapterId,
            pageIndex: lastPageOfPrevChapter.pageIndex,
            subchapterId: lastPageOfPrevChapter.subchapterId,
          });
        }
      }
    }
  }, [
    currentChapterIndex,
    currentPageIndex,
    pages,
    chapters,
    isTransitioning,
    onPageChange,
  ]);

  // Handle touch end - determine swipe direction
  const handleTouchEnd = useCallback(
    (e) => {
      if (!touchStartRef.current || !touchCurrentRef.current) return;

      // Skip swipe processing if touch target is a karaoke slice (let karaoke handler process the tap)
      const touchTarget = e.target;
      if (touchTarget && (touchTarget.closest('.karaoke-slice') || touchTarget.classList.contains('karaoke-slice'))) {
        // Check if it's a tap (minimal movement) - if so, let karaoke handler process it
        const deltaX = touchCurrentRef.current.x - touchStartRef.current.x;
        const deltaY = touchCurrentRef.current.y - touchStartRef.current.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance < 10) { // Very small movement = tap, not swipe
          return; // Let karaoke touchend handler process this
        }
        // If it's a larger movement, might be a swipe, continue processing
      }

      const deltaX = touchCurrentRef.current.x - touchStartRef.current.x;
      const deltaY = touchCurrentRef.current.y - touchStartRef.current.y;
      const deltaTime = Date.now() - touchStartRef.current.time;
      const minSwipeDistance = 50;
      const maxSwipeTime = 300;

      // Check if it's a vertical swipe down (for TOC)
      if (
        Math.abs(deltaY) > Math.abs(deltaX) &&
        deltaY > 0
      ) {
        if (!isTOCOpen) {
          // Calculate progress from actual drag distance
          const viewportHeight = window.innerHeight;
          const dragDistance = tocDragStartYRef.current !== null 
            ? touchCurrentRef.current.y - tocDragStartYRef.current
            : deltaY;
          const progress = Math.min(Math.max(dragDistance / viewportHeight, 0), 1);
          
          // Determine if we should open or close based on drag progress
          const finalProgress = tocDragProgressRef.current;
          const threshold = 0.25; // 25% threshold (20-30% range)
          
          if (finalProgress > threshold || deltaY > minSwipeDistance * 1.5) {
            // Dragged enough - smoothly animate TOC to fill page, then fade in background
            const tocElement = document.querySelector('.mobile-toc-overlay');
            const container = tocElement?.querySelector('.mobile-toc-container');
            
            if (container) {
              // Phase 1: Smoothly animate container to fill the page (curtain effect)
              container.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
              container.style.transform = 'translateY(0%)';
              
              // Phase 2: After container animation completes, set state to trigger background fade-in
              setTimeout(() => {
                setIsTOCOpen(true);
                setTocDragProgress(1);
                tocDragProgressRef.current = 1;
              }, 400); // Wait for container animation to complete (400ms)
            } else {
              // Fallback if DOM not ready
              setIsTOCOpen(true);
              setTocDragProgress(1);
              tocDragProgressRef.current = 1;
            }
            
            // Stop all karaoke playback
            karaokeControllersRef.current.forEach((controller) => {
              controller.stop();
            });
          } else {
            // Didn't drag enough - smoothly snap back closed
            const tocElement = document.querySelector('.mobile-toc-overlay');
            if (tocElement) {
              const container = tocElement.querySelector('.mobile-toc-container');
              if (container) {
                // Smoothly animate back up
                container.style.transition = 'transform 0.3s cubic-bezier(0.55, 0.055, 0.675, 0.19)';
                container.style.transform = 'translateY(-100%)';
                
                // Fade out overlay after animation
                setTimeout(() => {
                  tocElement.style.opacity = '0';
                  tocElement.style.pointerEvents = 'none';
                  container.style.color = '';
                  setTocDragProgress(0);
                  tocDragProgressRef.current = 0;
                }, 300);
              }
            }
          }
        }
        tocDragStartYRef.current = null;
        touchStartRef.current = null;
        touchCurrentRef.current = null;
        return;
      }
      
      // Reset TOC drag if it was a different gesture
      if (tocDragProgressRef.current > 0 && !isTOCOpen) {
        setTocDragProgress(0);
        tocDragProgressRef.current = 0;
        // Reset TOC element via DOM
        requestAnimationFrame(() => {
          const tocElement = document.querySelector('.mobile-toc-overlay');
          if (tocElement) {
            tocElement.style.opacity = '0';
            tocElement.style.pointerEvents = 'none';
            const container = tocElement.querySelector('.mobile-toc-container');
            if (container) {
              container.style.transform = 'translateY(-100%)';
              container.style.transition = '';
              container.style.color = '';
            }
          }
        });
        tocDragStartYRef.current = null;
      }

      // Check if it's a horizontal swipe
      if (
        Math.abs(deltaX) > Math.abs(deltaY) &&
        Math.abs(deltaX) > minSwipeDistance &&
        deltaTime < maxSwipeTime
      ) {
        // Unlock audio if not already unlocked - use AudioContext for reliable unlock
        if (!audioUnlockedRef.current) {
// console.log('Swipe detected - unlocking audio via AudioContext...');
          try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
              // Create a temporary context to unlock
              const ctx = new AudioContext();
              if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
// console.log('AudioContext resumed - audio unlocked');
                  audioUnlockedRef.current = true;
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                  // Close the temporary context
                  ctx.close();
                }).catch((err) => {
                  console.warn('AudioContext resume failed', err);
                  // Still mark as unlocked
                  audioUnlockedRef.current = true;
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                });
              } else {
                // Already running
                audioUnlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('audioUnlocked'));
                ctx.close();
              }
            } else {
              // Fallback: just mark as unlocked
// console.log('AudioContext not available, marking as unlocked');
              audioUnlockedRef.current = true;
              window.dispatchEvent(new CustomEvent('audioUnlocked'));
            }
          } catch (err) {
            console.error('Error unlocking audio', err);
            audioUnlockedRef.current = true;
            window.dispatchEvent(new CustomEvent('audioUnlocked'));
          }
        }
        
        if (deltaX > 0) {
          // Swipe right - previous page
          goToPreviousPage();
        } else {
          // Swipe left - next page
          goToNextPage();
        }
      }

      touchStartRef.current = null;
      touchCurrentRef.current = null;
    },
    [goToNextPage, goToPreviousPage, isTOCOpen]
  );

  // Get current page data - handle special pages (first page, cover) and regular pages
  const currentPage = pages.find(
    (p) => {
      if (currentChapterIndex === -2) {
        // Looking for first page
        return p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
      } else if (currentChapterIndex === -1) {
        // Looking for cover page
        return p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
      } else {
        // Looking for regular page - exclude special pages
        return !p.isCover && !p.isFirstPage && p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex;
      }
    }
  );

  // Jump to a specific page (for TOC navigation)
  const jumpToPage = useCallback((targetChapterIndex, targetPageIndex) => {
    if (isTransitioning || pages.length === 0) return;
    
    // Find target page - handle special pages (first page, cover) and regular pages
    const targetPage = pages.find(
      (p) => {
        if (targetChapterIndex === -2) {
          // Looking for first page
          return p.isFirstPage && p.chapterIndex === targetChapterIndex && p.pageIndex === targetPageIndex;
        } else if (targetChapterIndex === -1) {
          // Looking for cover page
          return p.isCover && !p.isFirstPage && p.chapterIndex === targetChapterIndex && p.pageIndex === targetPageIndex;
        } else {
          // Looking for regular page - exclude special pages
          return !p.isCover && !p.isFirstPage && p.chapterIndex === targetChapterIndex && p.pageIndex === targetPageIndex;
        }
      }
    );
    
    if (!targetPage) return;
    
    setIsTransitioning(true);
    setTimeout(() => {
      setDisplayPage(targetPage);
      setCurrentChapterIndex(targetChapterIndex);
      setCurrentPageIndex(targetPageIndex);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsTransitioning(false);
        });
      });
    }, 1000);
    
    if (onPageChange) {
      onPageChange({
        chapterId: targetPage.chapterId,
        pageIndex: targetPageIndex,
        subchapterId: targetPage.subchapterId,
      });
    }
  }, [isTransitioning, pages, onPageChange]);

  // Initialize displayPage only on first load - never update it during normal operation
  // This prevents interference with transitions
  useEffect(() => {
    if (pages.length > 0 && !displayPage && currentPage) {
      setDisplayPage(currentPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length]); // Only depend on pages.length to run once when pages are first loaded

  // Ensure valid page state - MUST be before any conditional returns
  useEffect(() => {
    if (pages.length > 0 && !currentPage) {
      // Current page not found, reset to first page (isFirstPage if exists, otherwise first page)
      const firstPage = pages.find(p => p.isFirstPage) || pages[0];
      if (firstPage) {
        setCurrentChapterIndex(firstPage.chapterIndex);
        setCurrentPageIndex(firstPage.pageIndex);
      }
    }
  }, [pages, currentPage]);

  // Use displayPage for rendering, fallback to currentPage
  const pageToDisplay = displayPage || currentPage;
  
  // Log pageToDisplay state for debugging swipe back issue
  if (isTransitioning && (!pageToDisplay || !pageToDisplay.content)) {
    console.warn('[PAGE TO DISPLAY] pageToDisplay is null or has no content during transition', {
      pageToDisplay: pageToDisplay ? { chapterIndex: pageToDisplay.chapterIndex, pageIndex: pageToDisplay.pageIndex, hasContent: !!pageToDisplay.content } : null,
      displayPage: displayPage ? { chapterIndex: displayPage.chapterIndex, pageIndex: displayPage.pageIndex, hasContent: !!displayPage.content } : null,
      currentPage: currentPage ? { chapterIndex: currentPage.chapterIndex, pageIndex: currentPage.pageIndex, hasContent: !!currentPage.content } : null,
      isTransitioning: isTransitioningRef.current
    });
  }
  
  // NOTE: Ink preservation between pages is temporarily disabled to simplify
  // navigation logic and avoid crashes when swiping back on karaoke pages.
  // We keep the refs so future polish can reintroduce this if needed, but we
  // no longer clear/restore preserved HTML across page changes.
  useEffect(() => {
    // no-op for now
  }, [pageToDisplay?.chapterIndex, pageToDisplay?.pageIndex, isTransitioning]);

  // Callback ref to apply ink effect directly when content node is set
  // Must be defined before any conditional returns (Rules of Hooks)
  const pageContentRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const preservedInkHTMLRef = useRef(null); // Store HTML with ink effect before transition
  const preservedPageKeyRef = useRef(null); // Track which page the preserved HTML belongs to
  
  // Calculate chapter progress for progress bar (must be at top level for Rules of Hooks)
  const chapterProgress = useMemo(() => {
    if (!displayPage || displayPage.isFirstPage || displayPage.isCover) {
      return 0;
    }
    const currentChapterPages = pages.filter(p => 
      p.chapterIndex === displayPage.chapterIndex && 
      !p.isFirstPage && 
      !p.isCover
    );
    const currentPageInChapter = currentChapterPages.findIndex(p => 
      p.pageIndex === displayPage.pageIndex && 
      p.chapterIndex === displayPage.chapterIndex
    );
    const totalPagesInChapter = currentChapterPages.length;
    return totalPagesInChapter > 0 
      ? (currentPageInChapter + 1) / totalPagesInChapter 
      : 0;
  }, [displayPage, pages]);
  
  // Pause all karaoke when transitioning
  useEffect(() => {
    if (isTransitioning) {
      karaokeControllersRef.current.forEach((controller) => {
        controller.pause();
      });
      currentKaraokeSliceRef.current = null;
    }
  }, [isTransitioning]);

  // Autoplay videos when page becomes visible, pause when leaving
  useEffect(() => {
    if (!pageToDisplay) return;
    
    // Autoplay videos muted so they're visible and preload them
    if (blankPageVideoRef.current && pageToDisplay?.isVideo) {
      blankPageVideoRef.current.muted = true;
      blankPageVideoRef.current.load(); // Force load the video
      blankPageVideoRef.current.play().catch(err => {
        // console.log('Video autoplay failed:', err);
      });
      setVideoUnmuted(false); // Show unmute button
    }
    
    if (backgroundVideoRef.current && pageToDisplay?.backgroundVideo) {
      backgroundVideoRef.current.muted = true;
      backgroundVideoRef.current.load(); // Force load the video
      backgroundVideoRef.current.play().catch(err => {
        // console.log('Background video autoplay failed:', err);
      });
      setVideoUnmuted(false); // Show unmute button
    }
    
    // Reset when leaving video pages
    if (backgroundVideoRef.current && !pageToDisplay?.backgroundVideo) {
      backgroundVideoRef.current.pause();
      setVideoUnmuted(false);
    }
    if (blankPageVideoRef.current && !pageToDisplay?.isVideo) {
      blankPageVideoRef.current.pause();
      setVideoUnmuted(false);
    }
  }, [pageToDisplay?.chapterIndex, pageToDisplay?.pageIndex, pageToDisplay?.backgroundVideo, pageToDisplay?.isVideo]);

  // Handle link clicks - open external links
  useEffect(() => {
    const pageContent = pageContentRef.current;
    if (!pageContent) return;

    const handleLinkClick = (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // Prevent default navigation
      e.preventDefault();
      e.stopPropagation();

      // Open external link in new tab
      window.open(href, '_blank', 'noopener,noreferrer');
    };

    // Attach click handler to all links
    const links = pageContent.querySelectorAll('a');
    links.forEach(link => {
      link.addEventListener('click', handleLinkClick);
    });

    // Cleanup
    return () => {
      links.forEach(link => {
        link.removeEventListener('click', handleLinkClick);
      });
    };
  }, [pageToDisplay?.chapterIndex, pageToDisplay?.pageIndex]);

  // Track when video is unmuted
  useEffect(() => {
    const blankVideo = blankPageVideoRef.current;
    const bgVideo = backgroundVideoRef.current;
    
    const checkMuted = () => {
      if (blankVideo && pageToDisplay?.isVideo) {
        setVideoUnmuted(!blankVideo.muted);
      }
      if (bgVideo && pageToDisplay?.backgroundVideo) {
        setVideoUnmuted(!bgVideo.muted);
      }
    };
    
    // Check initially
    checkMuted();
    
    // Check on volume change
    if (blankVideo) {
      blankVideo.addEventListener('volumechange', checkMuted);
    }
    if (bgVideo) {
      bgVideo.addEventListener('volumechange', checkMuted);
    }
    
    return () => {
      if (blankVideo) {
        blankVideo.removeEventListener('volumechange', checkMuted);
      }
      if (bgVideo) {
        bgVideo.removeEventListener('volumechange', checkMuted);
      }
    };
  }, [pageToDisplay?.isVideo, pageToDisplay?.backgroundVideo]);

  // Listen for audio unlock and start playback
  useEffect(() => {
    const handleAudioUnlocked = () => {
// console.log('audioUnlocked event received', { isTransitioning });
      // If we're transitioning, the transition-end effect will handle starting karaoke
      // Otherwise, start immediately
      if (!isTransitioning) {
// console.log('Starting karaoke immediately (not transitioning)');
        setTimeout(() => {
          startVisibleKaraoke();
        }, 100);
      } else {
// console.log('Will start karaoke after transition ends');
      }
    };

    window.addEventListener('audioUnlocked', handleAudioUnlocked);
    return () => {
      window.removeEventListener('audioUnlocked', handleAudioUnlocked);
    };
  }, [startVisibleKaraoke, isTransitioning]);

  // Start karaoke when transition ends
  useEffect(() => {
    if (!isTransitioning) {
      // Update ref to match state
      isTransitioningRef.current = false;
      
      // Wait for DOM to settle and slices to be initialized
      const timer = setTimeout(() => {
        const node = pageContentRef.current;
        if (node && node.isConnected) {
          // Ensure slices are initialized before trying to start
          initializeKaraokeSlices(node);
        }
        
        // Check if audio is unlocked, if not wait for it
        if (audioUnlockedRef.current) {
// console.log('Transition ended, audio unlocked, starting karaoke');
          // Give a bit more time for initialization
          setTimeout(() => {
            startVisibleKaraoke();
          }, 200);
        } else {
// console.log('Transition ended, audio not unlocked yet, waiting...');
          // Wait for audio unlock event
          const handleUnlock = () => {
// console.log('Audio unlocked after transition, starting karaoke');
            setTimeout(() => {
              const node = pageContentRef.current;
              if (node && node.isConnected) {
                initializeKaraokeSlices(node);
              }
              setTimeout(() => {
                startVisibleKaraoke();
              }, 200);
            }, 100);
            window.removeEventListener('audioUnlocked', handleUnlock);
          };
          window.addEventListener('audioUnlocked', handleUnlock);
          // Also check periodically in case event was missed
          const checkInterval = setInterval(() => {
            if (audioUnlockedRef.current) {
              clearInterval(checkInterval);
              window.removeEventListener('audioUnlocked', handleUnlock);
              const node = pageContentRef.current;
              if (node && node.isConnected) {
                initializeKaraokeSlices(node);
              }
              setTimeout(() => {
                startVisibleKaraoke();
              }, 200);
            }
          }, 100);
          // Cleanup after 5 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            window.removeEventListener('audioUnlocked', handleUnlock);
          }, 5000);
        }
      }, 1200); // After fade-in completes (1000ms fade + 200ms buffer)
      return () => clearTimeout(timer);
    }
  }, [isTransitioning, startVisibleKaraoke, initializeKaraokeSlices]);

  // Keep ref in sync with state only. Ink restoration during transitions has
  // been disabled to avoid complex innerHTML rewrites that conflicted with
  // karaoke pagination and could cause freezes when swiping back.
  useEffect(() => {
    isTransitioningRef.current = isTransitioning;
  }, [isTransitioning, pageToDisplay]);
  
  // Watch for TOC closing & ink resets – disabled for now to avoid extra
  // MutationObservers and innerHTML rewrites that can interfere with karaoke
  // pagination. Kept here only as placeholders for future polish.
  const prevIsTOCOpenRef = useRef(isTOCOpen);
  const isTOCClosingRef = useRef(false);
  const restoreTimeoutRef = useRef(null);
  
  useEffect(() => {
    prevIsTOCOpenRef.current = isTOCOpen;
    isTOCClosingRef.current = false;
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current);
      restoreTimeoutRef.current = null;
    }
  }, [isTOCOpen]);
  
  useEffect(() => {
    // no-op for now
  }, [isTOCOpen, pageToDisplay, isTransitioning]);
  
  const pageContentRefCallback = useCallback((node) => {
    pageContentRef.current = node;
    if (node && node.isConnected) {
      // Get current page key to track which page this HTML belongs to
      const currentPageKey = pageToDisplay 
        ? `page-${pageToDisplay.chapterIndex}-${pageToDisplay.pageIndex}`
        : null;
      
      console.log('[PAGE CONTENT CALLBACK] Node connected', {
        hasNode: !!node,
        isConnected: node.isConnected,
        pageToDisplay: pageToDisplay ? { chapterIndex: pageToDisplay.chapterIndex, pageIndex: pageToDisplay.pageIndex, hasContent: !!pageToDisplay.content, contentLength: pageToDisplay.content?.length } : null,
        currentPageKey,
        isTransitioning: isTransitioningRef.current,
        nodeInnerHTML: node.innerHTML?.substring(0, 100)
      });

      // Apply ink effect with multiple attempts to ensure it applies
      const applyInk = () => {
        if (node && node.isConnected) {
          // Check if already processed to avoid double-processing
          const hasInkChars = node.querySelectorAll('.ink-char-mobile').length > 0;
          if (!hasInkChars) {
            // If we have preserved HTML for THIS page, restore it
            // Otherwise, apply fresh ink effect
            // BUT don't restore if karaoke slices are already initialized (would overwrite them)
            const hasInitializedKaraoke = node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
            if (preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey && !isTransitioningRef.current && !hasInitializedKaraoke) {
              node.innerHTML = preservedInkHTMLRef.current;
            } else if (!preservedInkHTMLRef.current || preservedPageKeyRef.current !== currentPageKey) {
              applyInkEffectToTextMobile(node, { probability: 0.25 });
              // Immediately preserve the HTML after applying ink effect
              // This ensures we always have the canonical version stored
              preservedInkHTMLRef.current = node.innerHTML;
              preservedPageKeyRef.current = currentPageKey;
            }
          } else if (!preservedInkHTMLRef.current || preservedPageKeyRef.current !== currentPageKey) {
            // Ink chars exist but we haven't preserved HTML yet for this page - preserve it now
            preservedInkHTMLRef.current = node.innerHTML;
            preservedPageKeyRef.current = currentPageKey;
          }
        }
      };
      
      // DON'T apply ink effect immediately - it interferes with initial text layout
      // Only check if we should restore preserved HTML during transitions
      const hasInkChars = node.querySelectorAll('.ink-char-mobile').length > 0;
      if (hasInkChars && (!preservedInkHTMLRef.current || preservedPageKeyRef.current !== currentPageKey)) {
        // Ink chars exist but we haven't preserved HTML yet for this page - preserve it now
        preservedInkHTMLRef.current = node.innerHTML;
        preservedPageKeyRef.current = currentPageKey;
      }
      // During transitions, restore from preserved HTML if available
      // BUT don't restore if karaoke slices are already initialized (would overwrite them)
      const hasInitializedKaraokeCheck = node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
      if (isTransitioningRef.current && preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey && !hasInkChars && !hasInitializedKaraokeCheck) {
        console.log('[PAGE CONTENT] Restoring preserved HTML during transition', {
          currentPageKey,
          preservedPageKey: preservedPageKeyRef.current,
          preservedHTMLLength: preservedInkHTMLRef.current?.length,
          hasInitializedKaraoke: hasInitializedKaraokeCheck
        });
        node.innerHTML = preservedInkHTMLRef.current;
      }
      
      const applyInkWhenReady = async () => {
        // Wait for fonts to be loaded
        if (document.fonts && document.fonts.ready) {
          try {
            await document.fonts.ready;
          } catch (e) {
            console.warn('[PageReader] Font loading check failed:', e);
          }
        }
        
        if (!node || !node.isConnected) return;
        
        // Small delay to ensure layout is stable
        await new Promise(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(resolve, 100);
            });
          });
        });
        
        if (node && node.isConnected) {
          // CRITICAL: During transitions, ensure content exists before processing
          // If content is empty, it means React hasn't set it yet - wait for it
          if (isTransitioningRef.current && (!node.innerHTML || node.innerHTML.trim() === '')) {
            // Content not set yet - wait a bit and check again
            setTimeout(() => {
              if (node && node.isConnected && (!node.innerHTML || node.innerHTML.trim() === '')) {
                // Still empty - this shouldn't happen, but ensure content is set from pageToDisplay
                if (pageToDisplay && pageToDisplay.content) {
                  node.innerHTML = pageToDisplay.content;
                }
              }
            }, 50);
            return; // Don't process yet
          }
          
          const hasInkChars = node.querySelectorAll('.ink-char-mobile').length > 0;
          if (!hasInkChars) {
            // During transitions, restore from preserved HTML only if it's for the current page
            // BUT don't restore if karaoke slices are already initialized (would overwrite them)
            const hasInitializedKaraokeCheck2 = node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
            if (isTransitioningRef.current && preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey && !hasInitializedKaraokeCheck2) {
              console.log('[PAGE CONTENT] Restoring preserved HTML during transition', {
                currentPageKey,
                preservedPageKey: preservedPageKeyRef.current
              });
              node.innerHTML = preservedInkHTMLRef.current;
            } else {
              // CRITICAL: During transitions, ensure content is set from pageToDisplay.content
              // This is especially important when swiping back - the preserved HTML might be for the wrong page
              if (isTransitioningRef.current && (!node.innerHTML || node.innerHTML.trim() === '')) {
                if (pageToDisplay && pageToDisplay.content) {
                  console.log('[PAGE CONTENT] Setting content from pageToDisplay during transition', {
                    currentPageKey,
                    hasContent: !!pageToDisplay.content,
                    contentLength: pageToDisplay.content.length
                  });
                  node.innerHTML = pageToDisplay.content;
                }
              }
              
              // Ensure we have content before processing
              if (!node.innerHTML || node.innerHTML.trim() === '') {
                if (pageToDisplay && pageToDisplay.content) {
                  node.innerHTML = pageToDisplay.content;
                } else {
                  console.error('[PAGE CONTENT] No content available!', {
                    currentPageKey,
                    hasPageToDisplay: !!pageToDisplay,
                    hasContent: !!pageToDisplay?.content
                  });
                  return; // No content to process
                }
              }
              
              // CRITICAL: During transitions, skip karaoke initialization to prevent crashes
              // The callback will run again after transition completes and process normally
              if (isTransitioningRef.current) {
                // Just preserve the raw content - don't process during transition
                if (pageToDisplay && pageToDisplay.content) {
                  preservedInkHTMLRef.current = pageToDisplay.content;
                  preservedPageKeyRef.current = currentPageKey;
                }
                return; // Skip processing during transitions
              }
              
              // Initialize karaoke slices FIRST (creates structure with <br> tags)
              try {
                initializeKaraokeSlices(node);
                // Then apply ink effect to wrap characters in the initialized karaoke structure
                applyInk();
                // Immediately preserve the HTML so we can restore it later without re-applying
                preservedInkHTMLRef.current = node.innerHTML;
                preservedPageKeyRef.current = currentPageKey;
              } catch (error) {
                console.error('[PAGE CONTENT] Error initializing karaoke/ink:', error);
                // If initialization fails, at least preserve the raw content
                if (pageToDisplay && pageToDisplay.content) {
                  preservedInkHTMLRef.current = pageToDisplay.content;
                  preservedPageKeyRef.current = currentPageKey;
                }
              }
            }
          } else {
            // Ink chars exist - check if karaoke needs initialization
            const hasInitializedKaraoke = node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
            if (!hasInitializedKaraoke) {
              // Initialize karaoke slices (this will rebuild, losing ink effect)
              initializeKaraokeSlices(node);
              // Re-apply ink effect after karaoke initialization
              applyInk();
            }
            // Preserve HTML after both are done
            if (!preservedInkHTMLRef.current || preservedPageKeyRef.current !== currentPageKey) {
              preservedInkHTMLRef.current = node.innerHTML;
              preservedPageKeyRef.current = currentPageKey;
            }
          }
          // Preserve HTML AFTER karaoke initialization so it includes initialized karaoke slices
          if (node && node.isConnected) {
            preservedInkHTMLRef.current = node.innerHTML;
            preservedPageKeyRef.current = currentPageKey;
          }
        }
      };
      
      // Only apply ink effect after user interaction
      applyInkWhenReady();
      
      // Backup: Only apply ink effect after user interaction
      if (hasUserInteractedRef.current) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (node && node.isConnected) {
                const hasInkChars = node.querySelectorAll('.ink-char-mobile').length > 0;
                // Check if karaoke slices are already initialized (have .karaoke-word spans)
                const hasInitializedKaraoke = node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
                if (!hasInkChars) {
                  // During transitions, restore from preserved HTML only if it's for the current page
                  // BUT don't restore if karaoke slices are already initialized (would overwrite them)
                  if (isTransitioningRef.current && preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey && !hasInitializedKaraoke) {
                    node.innerHTML = preservedInkHTMLRef.current;
                  } else {
                    applyInk();
                  }
                } else if (!preservedInkHTMLRef.current || preservedPageKeyRef.current !== currentPageKey) {
                  // Ink chars exist but we haven't preserved HTML yet for this page - preserve it now
                  preservedInkHTMLRef.current = node.innerHTML;
                  preservedPageKeyRef.current = currentPageKey;
                }
                
                // Initialize karaoke slices again after second frame
                initializeKaraokeSlices(node);
                // Preserve HTML AFTER karaoke initialization
                if (node && node.isConnected) {
                  preservedInkHTMLRef.current = node.innerHTML;
                  preservedPageKeyRef.current = currentPageKey;
                }
                
                // DON'T call startVisibleKaraoke here - let the transition end effect handle it
                // This ensures resume state is always checked before starting playback
              }
            }, 50);
          });
        });
      }
      
      // During transitions, also check after a short delay to catch any race conditions
      // where React might reset the HTML after the initial application
      if (isTransitioningRef.current) {
        setTimeout(() => {
          if (node && node.isConnected) {
            const hasInkChars = node.querySelectorAll('.ink-char-mobile').length > 0;
            // Only restore if preserved HTML is for the current page
            if (!hasInkChars && preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey) {
              // Always restore from preserved HTML during transitions
              node.innerHTML = preservedInkHTMLRef.current;
            }
          }
        }, 50);
      }
    }
  }, [pageToDisplay, initializeKaraokeSlices, startVisibleKaraoke, isTransitioning]); // Include isTransitioning so callback runs when transition completes

  // Prevent pull-to-refresh on mobile - use document-level listener with passive: false
  // This is necessary because React's onTouchMove may be passive, preventing preventDefault
  useEffect(() => {
    let touchStartY = null;
    
    const handleTouchStart = (e) => {
      // Only track if we're inside the page-reader
      const pageReader = document.querySelector('.page-reader');
      if (!pageReader || !pageReader.contains(e.target)) return;
      
      if (e.touches && e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };
    
    const handleTouchMove = (e) => {
      // Only prevent if we're inside the page-reader
      const pageReader = document.querySelector('.page-reader');
      if (!pageReader || !pageReader.contains(e.target)) {
        touchStartY = null;
        return;
      }
      
      if (touchStartY !== null && e.touches && e.touches.length > 0) {
        const touchY = e.touches[0].clientY;
        const deltaY = touchY - touchStartY;
        
        // Prevent all downward swipes to block pull-to-refresh
        // The page-reader is fixed and shouldn't allow any scrolling
        if (deltaY > 0) {
          e.preventDefault();
        }
      }
    };
    
    // Use passive: false to allow preventDefault
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // Handle footnote clicks - jump to acknowledgements chapter
  useEffect(() => {
    const handleFootnoteClick = (e) => {
      const footnoteRef = e.target.closest('.footnote-ref');
      if (!footnoteRef) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const footnoteNumber = footnoteRef.getAttribute('data-footnote-number');
      if (!footnoteNumber) return;
      
      // Find acknowledgements chapter (should be last chapter)
      const acknowledgementsChapter = chapters.find(ch => 
        ch.title.toLowerCase().includes('acknowledgement') || 
        ch.title.toLowerCase().includes('zahvale')
      );
      
      if (acknowledgementsChapter) {
        // Jump to first page of acknowledgements chapter
        const firstPage = pages.find(p => p.chapterId === acknowledgementsChapter.id && p.pageIndex === 0);
        if (firstPage) {
          jumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
        }
      }
    };
    
    // Set up global click handler for footnotes
    window.footnoteClickHandler = (footnoteNumber) => {
      const acknowledgementsChapter = chapters.find(ch => 
        ch.title.toLowerCase().includes('acknowledgement') || 
        ch.title.toLowerCase().includes('zahvale')
      );
      
      if (acknowledgementsChapter) {
        const firstPage = pages.find(p => p.chapterId === acknowledgementsChapter.id && p.pageIndex === 0);
        if (firstPage) {
          jumpToPage(firstPage.chapterIndex, firstPage.pageIndex);
        }
      }
    };
    
    document.addEventListener('click', handleFootnoteClick);
    
    return () => {
      document.removeEventListener('click', handleFootnoteClick);
      delete window.footnoteClickHandler;
    };
  }, [chapters, pages, jumpToPage]);

  // Cleanup karaoke controllers on unmount
  useEffect(() => {
    return () => {
      karaokeControllersRef.current.forEach((controller) => {
        controller.cleanup();
      });
      karaokeControllersRef.current.clear();
    };
  }, []);

  // Check if we're on desktop
  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;

  // Apply ink effect to desktop PDF pages after render and fix font sizes
  useEffect(() => {
    if (!isDesktop || pages.length === 0) return;
    
    const applyInkAndFixFonts = () => {
      const pageContents = document.querySelectorAll('.pdf-page-wrapper .page-content');
      pageContents.forEach((pageContent) => {
        // Remove inline font-size styles that might override CSS
        const allElements = pageContent.querySelectorAll('*');
        allElements.forEach((el) => {
          if (el.style && el.style.fontSize) {
            // Remove inline font-size to let CSS take over
            el.style.removeProperty('font-size');
          }
        });
        // Also remove from the container itself
        if (pageContent.style && pageContent.style.fontSize) {
          pageContent.style.removeProperty('font-size');
        }
        
        // Apply ink effect
        // Skip if already processed
        if (pageContent.querySelectorAll('.ink-char-mobile').length > 0) return;
        // Skip karaoke players
        if (pageContent.closest('.karaoke-player')) return;
        // Apply ink effect with skipMobileCheck to allow desktop usage
        applyInkEffectToTextMobile(pageContent, { probability: 0.45, skipMobileCheck: true });
      });
    };
    
    // Apply after a short delay to ensure DOM is ready
    const timeoutId = setTimeout(applyInkAndFixFonts, 100);
    
    return () => clearTimeout(timeoutId);
  }, [pages, isDesktop]);

  // Preload adjacent page backgrounds for smoother swiping
  useEffect(() => {
    if (!displayPage || !pages.length) return;

    const currentIndex = pages.findIndex(
      (p) => p.chapterIndex === displayPage.chapterIndex && p.pageIndex === displayPage.pageIndex
    );

    if (currentIndex < 0) return;

    // Preload next page background (if different)
    const nextPage = pages[currentIndex + 1];
    if (nextPage?.backgroundImageUrl && nextPage.backgroundImageUrl !== displayPage.backgroundImageUrl) {
      const img = new Image();
      img.src = nextPage.backgroundImageUrl;
    }

    // Preload previous page background (if different)
    const prevPage = pages[currentIndex - 1];
    if (prevPage?.backgroundImageUrl && prevPage.backgroundImageUrl !== displayPage.backgroundImageUrl) {
      const img = new Image();
      img.src = prevPage.backgroundImageUrl;
    }
  }, [displayPage, pages]);

  // Reset background ready state when page changes - but only wait on first page load
  useEffect(() => {
    if (!hasShownFirstPageWithBackgroundRef.current) {
      // On first page load (refresh/initial load), wait for background
      const hasBackground = !!displayPage?.backgroundImageUrl;
      if (!hasBackground) {
        setBackgroundImageReady(true);
        // Mark as shown even if no background (so swipes don't wait)
        hasShownFirstPageWithBackgroundRef.current = true;
      } else {
        setBackgroundImageReady(false);
      }
    } else {
      // After first page is shown (swiping), backgrounds are preloaded - show immediately
      setBackgroundImageReady(true);
    }
  }, [displayPage?.backgroundImageUrl, displayPage?.chapterIndex, displayPage?.pageIndex]);

  // On desktop, render all pages in a PDF reader style (early return)
  // Show loading if pages aren't calculated yet
  if (isDesktop) {
    if (pages.length === 0) {
      return (
        <div className="page-reader-loading" />
      );
    }
    // Always start at page 1 (cover page)
    // The cover page should always be first in the pages array
    // Verify the first page is the cover page
    console.log('[PDFViewer] Rendering PDF viewer with', pages.length, 'pages');
    const firstPage = pages.find(p => p.isFirstPage) || pages[0];
    if (firstPage && !firstPage.isFirstPage && !firstPage.isCover) {
      console.error('[PageOrder] First page is not first page or cover page!', {
        firstPageType: firstPage.isVideo ? 'video' : firstPage.isEpigraph ? 'epigraph' : 'content',
        firstPageChapterIndex: firstPage.chapterIndex,
        firstPagePageIndex: firstPage.pageIndex,
        totalPages: pages.length,
        firstFewPages: pages.slice(0, 5).map(p => ({
          isCover: p.isCover,
          isVideo: p.isVideo,
          isEpigraph: p.isEpigraph,
          chapterIndex: p.chapterIndex,
          pageIndex: p.pageIndex
        }))
      });
    }
    
    // Check for duplicate pages
    const pageKeys = new Set();
    const duplicates = [];
    pages.forEach((page, index) => {
      const key = `chapter-${page.chapterIndex}-page-${page.pageIndex}`;
      if (pageKeys.has(key)) {
        duplicates.push({ index, key, page });
      }
      pageKeys.add(key);
    });
    if (duplicates.length > 0) {
      console.error('[PDFViewer] Found duplicate pages!', duplicates);
    }
    
    const initialPage = 1;
    
    return (
      <PDFViewer
        currentPage={initialPage}
        totalPages={pages.length}
        onPageChange={(pageNum) => {
          // Scroll to the page
          const pageElement = document.getElementById(`pdf-page-${pageNum - 1}`);
          if (pageElement) {
            pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
        filename="weird-attachments.pdf"
      >
        <div className="pdf-pages-container">
          {pages.map((page, index) => {
            if (!page) return null;
            
            // Debug: Log first few pages to verify order
            if (index < 5) {
              console.log(`[PDFViewer] Rendering page ${index + 1}:`, {
                isCover: page.isCover,
                isVideo: page.isVideo,
                isEpigraph: page.isEpigraph,
                chapterIndex: page.chapterIndex,
                pageIndex: page.pageIndex,
                chapterTitle: page.chapterTitle
              });
            }
            
            // Use index as key to ensure unique keys and prevent React from reusing components incorrectly
            // Also include page properties to help React identify changes
            const pageKey = `pdf-page-${index}-${page.chapterIndex}-${page.pageIndex}`;
            const pageNumber = index + 1;
            // Calculate page number excluding first page and cover (for display)
            // Page numbers start at 1 after the cover page
            const regularPages = pages.filter(p => !p.isFirstPage && !p.isCover);
            const displayPageNumber = (page.isFirstPage || page.isCover) ? 0 : regularPages.findIndex(
              (p) => p.chapterIndex === page.chapterIndex && p.pageIndex === page.pageIndex
            ) + 1;
            const shouldShowTopBar = page && !page.hasHeading && !page.isEpigraph && !page.isCover && !page.isFirstPage && page.pageIndex > 0;
            
            return (
              <div
                key={pageKey}
                id={`pdf-page-${index}`}
                className="pdf-page-wrapper"
                style={{
                  // Ensure each page is in normal document flow
                  position: 'relative',
                  display: 'block',
                  width: '100%'
                }}
              >
                <article className={`page-sheet content-page ${page?.isEpigraph ? 'epigraph-page' : ''} ${page?.isVideo ? 'video-page' : ''} ${page?.isCover ? 'cover-page' : ''} ${page?.isFirstPage ? 'first-page' : ''}`}>
                  {/* Background videos disabled in desktop PDF viewer for now */}
                  <section className="page-body content-body">
                    {page?.isCover ? (
                      <div 
                        className="page-content"
                        dangerouslySetInnerHTML={{ __html: page.content || '' }}
                      />
                    ) : page?.isFirstPage ? (
                      <div 
                        className="page-content"
                        dangerouslySetInnerHTML={{ __html: page.content || '' }}
                      />
                    ) : page?.isEpigraph ? (
                      <div className="page-content epigraph-content">
                        <div className={`epigraph-text epigraph-align-${page?.epigraphAlign || 'center'}`}>
                          <div>{page?.epigraphText || ''}</div>
                          {page?.epigraphAuthor && (
                            <div className="epigraph-author">– {page.epigraphAuthor}</div>
                          )}
                        </div>
                      </div>
                    ) : page?.isVideo ? (
                      <div className="page-content video-content">
                        <video
                          src={page?.videoSrc}
                          loop
                          muted
                          playsInline
                          preload="auto"
                          className="fullscreen-video"
                        />
                      </div>
                    ) : (
                      <div 
                        className="page-content"
                        dangerouslySetInnerHTML={{ __html: page?.content || '' }} 
                      />
                    )}
                  </section>
                  {!page?.isFirstPage && !page?.isCover && (
                    <div className="page-number">
                      {displayPageNumber}
                    </div>
                  )}
                  {shouldShowTopBar && (
                    <ReaderTopBar
                      chapterTitle={page.chapterTitle}
                      subchapterTitle={page.subchapterTitle}
                      pageKey={pageKey}
                    />
                  )}
                </article>
              </div>
            );
          })}
        </div>
      </PDFViewer>
    );
  }

  // Mobile: single page view (existing behavior)
  // Ensure pageToDisplay exists before rendering
  // Wait for background image to load ONLY on first page load, not on swipes
  const hasBackground = !!pageToDisplay?.backgroundImageUrl;
  const shouldShowLoading = !pageToDisplay || (!hasShownFirstPageWithBackgroundRef.current && hasBackground && !backgroundImageReady);
  
  // Render background image first (even if loading) so it can load while loading screen is visible
  const backgroundImage = pageToDisplay?.backgroundImageUrl ? (
    <img
      src={pageToDisplay.backgroundImageUrl}
      alt=""
      className="page-background-image"
      loading="eager"
      decoding="async"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'left center',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      onLoad={(e) => {
        // Background image is loaded, decode and wait for paint before marking as ready
        const img = e.target;
        if (!backgroundImageReady && img) {
          img.decode()
            .then(() => {
              // Wait for browser to paint the image
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  if (!backgroundImageReady) {
                    setBackgroundImageReady(true);
                    // Mark that we've shown the first page with background loaded
                    if (!hasShownFirstPageWithBackgroundRef.current) {
                      hasShownFirstPageWithBackgroundRef.current = true;
                    }
                  }
                });
              });
            })
            .catch(() => {
              // Even on decode error, mark as ready
              if (!backgroundImageReady) {
                setBackgroundImageReady(true);
                if (!hasShownFirstPageWithBackgroundRef.current) {
                  hasShownFirstPageWithBackgroundRef.current = true;
                }
              }
            });
        }
      }}
      onError={() => {
        // Even on error, mark as ready so page can show if we're still waiting
        if (!backgroundImageReady) {
          setBackgroundImageReady(true);
          // Mark that we've shown the first page (even if background failed)
          if (!hasShownFirstPageWithBackgroundRef.current) {
            hasShownFirstPageWithBackgroundRef.current = true;
          }
        }
      }}
      ref={(img) => {
        // Check if image is already loaded (cached images) - decode and wait for paint
        if (img && img.complete && img.naturalWidth > 0 && !backgroundImageReady) {
          img.decode()
            .then(() => {
              // Wait for browser to paint the image
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  if (!backgroundImageReady) {
                    setBackgroundImageReady(true);
                    // Mark that we've shown the first page with background loaded
                    if (!hasShownFirstPageWithBackgroundRef.current) {
                      hasShownFirstPageWithBackgroundRef.current = true;
                    }
                  }
                });
              });
            })
            .catch(() => {
              // Even on decode error, mark as ready
              if (!backgroundImageReady) {
                setBackgroundImageReady(true);
                if (!hasShownFirstPageWithBackgroundRef.current) {
                  hasShownFirstPageWithBackgroundRef.current = true;
                }
              }
            });
        }
      }}
    />
  ) : null;
  
  if (shouldShowLoading) {
    return (
      <>
        {backgroundImage}
        <div className="page-reader-loading" />
      </>
    );
  }
  
  // Calculate current page number (1-indexed, excluding first page and cover page)
  const pageKey = `page-${pageToDisplay.chapterIndex}-${pageToDisplay.pageIndex}`;
  
  // For first page and cover page, don't calculate page number
  let currentPageNumber = 0;
  let totalPages = 0;
  
  if (!pageToDisplay.isFirstPage && !pageToDisplay.isCover) {
    // Find index excluding first page and cover page
    // Page numbers start at 1 after the cover page
    const regularPages = pages.filter(p => !p.isFirstPage && !p.isCover);
    const pageIndex = regularPages.findIndex(
      (p) => p.chapterIndex === pageToDisplay.chapterIndex && p.pageIndex === pageToDisplay.pageIndex
    );
    currentPageNumber = pageIndex >= 0 ? pageIndex + 1 : 0;
    totalPages = regularPages.length;
  }
  const shouldShowTopBar = !pageToDisplay.hasHeading && !pageToDisplay.isEpigraph && !pageToDisplay.isCover && !pageToDisplay.isFirstPage && pageToDisplay.pageIndex > 0;

  const pageContent = (
    <>
      {backgroundImage}
      {pageToDisplay.backgroundVideo && (
        <video
          ref={backgroundVideoRef}
          src={pageToDisplay.backgroundVideo}
          loop
          muted
          playsInline
          preload="auto"
          className="background-video"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            objectFit: 'cover',
            zIndex: 0,
            pointerEvents: 'none',
            margin: 0,
            padding: 0,
          }}
        />
      )}
      <div
        ref={containerRef}
        className="page-reader"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          ref={pageContainerRef}
          className={`page-container ${isTransitioning ? 'transitioning' : ''}`}
        >
        <article className={`page-sheet content-page ${pageToDisplay?.isEpigraph ? 'epigraph-page' : ''} ${pageToDisplay?.isVideo ? 'video-page' : ''} ${pageToDisplay?.backgroundVideo ? 'background-video-page' : ''} ${pageToDisplay?.isCover ? 'cover-page' : ''} ${pageToDisplay?.isFirstPage ? 'first-page' : ''}`}>
          <section className="page-body content-body">
            {pageToDisplay?.isCover ? (
              <div 
                key={pageKey}
                ref={pageContentRefCallback}
                className="page-content"
                dangerouslySetInnerHTML={{ __html: pageToDisplay.content || '' }}
              />
            ) : pageToDisplay?.isFirstPage ? (
              <div 
                key={pageKey}
                ref={pageContentRefCallback}
                className="page-content"
                dangerouslySetInnerHTML={{ __html: pageToDisplay.content || '' }}
              />
            ) : pageToDisplay?.isEpigraph ? (
              <div 
                key={pageKey}
                ref={pageContentRefCallback} 
                className="page-content epigraph-content"
              >
                <div className={`epigraph-text epigraph-align-${pageToDisplay?.epigraphAlign || 'center'}`}>
                  <div>{pageToDisplay?.epigraphText || ''}</div>
                  {pageToDisplay?.epigraphAuthor && (
                    <div className="epigraph-author">– {pageToDisplay.epigraphAuthor}</div>
                  )}
                </div>
              </div>
            ) : pageToDisplay?.isVideo ? (
              <div 
                key={pageKey}
                className="page-content video-content"
              >
                <video
                  ref={blankPageVideoRef}
                  src={pageToDisplay?.videoSrc}
                  loop
                  muted
                  playsInline
                  preload="auto"
                  className="fullscreen-video"
                />
                {!videoUnmuted && (
                  <button
                    onClick={() => {
                      if (blankPageVideoRef.current) {
                        blankPageVideoRef.current.muted = false;
                        setVideoUnmuted(true);
                      }
                    }}
                    className="video-play-button"
                    aria-label="Unmute video"
                  >
                    UNMUTE
                  </button>
                )}
              </div>
             ) : pageToDisplay && !pageToDisplay.isCover && !pageToDisplay.isFirstPage && (
              <div 
                  key={pageKey}
                  ref={pageContentRefCallback} 
                  className={`page-content ${pageToDisplay.backgroundVideo ? 'background-video-text' : ''}`}
                  dangerouslySetInnerHTML={{ __html: pageToDisplay.content || '' }} 
                  style={pageToDisplay.backgroundVideo ? { position: 'relative', zIndex: 1 } : {}}
                />
            )}
          </section>
        </article>
      </div>
       {pageToDisplay && !pageToDisplay.isFirstPage && !pageToDisplay.isCover && (
         <div className="page-number">
           {currentPageNumber}
         </div>
       )}
       {/* Chapter progress bar - Kindle-like thin gray bar */}
       {pageToDisplay && !pageToDisplay.isFirstPage && !pageToDisplay.isCover && chapterProgress > 0 && (
         <div className="chapter-progress-bar">
           <div 
             className="chapter-progress-fill" 
             style={{ width: `${chapterProgress * 100}%` }}
           />
         </div>
       )}
      {shouldShowTopBar && pageToDisplay && (
        <ReaderTopBar
          chapterTitle={pageToDisplay.chapterTitle}
          subchapterTitle={pageToDisplay.subchapterTitle}
          pageKey={pageKey}
        />
      )}
      <MobileTOC
        chapters={chapters}
        pages={pages}
        currentChapterIndex={currentChapterIndex}
        currentPageIndex={currentPageIndex}
        currentSubchapterId={currentPage?.subchapterId || null}
        isOpen={isTOCOpen}
        dragProgress={tocDragProgress}
        onClose={() => {
          // Preserve current HTML with ink effects BEFORE closing
          const pageContent = pageContentRef.current;
          if (pageContent) {
            const currentPageKey = pageToDisplay 
              ? `page-${pageToDisplay.chapterIndex}-${pageToDisplay.pageIndex}`
              : null;
            const hasInkChars = pageContent.querySelectorAll('.ink-char-mobile').length > 0;
            if (hasInkChars && currentPageKey) {
              // Preserve the HTML with ink effects before React resets it
              preservedInkHTMLRef.current = pageContent.innerHTML;
              preservedPageKeyRef.current = currentPageKey;
            }
          }
          
          setIsTOCOpen(false);
          setTocDragProgress(0);
          tocDragProgressRef.current = 0;
          
          // Restore ink effects immediately after React re-renders, during the blur
          // Use multiple requestAnimationFrame to ensure it happens during blur phase
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const pageContentAfter = pageContentRef.current;
                if (pageContentAfter) {
                  const currentPageKey = pageToDisplay 
                    ? `page-${pageToDisplay.chapterIndex}-${pageToDisplay.pageIndex}`
                    : null;
                  if (currentPageKey && preservedInkHTMLRef.current && preservedPageKeyRef.current === currentPageKey) {
                    pageContentAfter.innerHTML = preservedInkHTMLRef.current;
                  }
                }
              });
            });
          });
        }}
        onJumpToPage={jumpToPage}
        onEditChapter={onEditChapter}
        onAddSubchapter={onAddSubchapter}
        onDeleteChapter={onDeleteChapter}
        onEditSubchapter={onEditSubchapter}
        onDeleteSubchapter={onDeleteSubchapter}
        onReorderChapters={onReorderChapters}
        onOpenSettings={onOpenSettings}
        onAddChapter={onAddChapter}
        onToggleEditorReader={onToggleEditorReader}
      />
    </div>
    </>
  );

  // On desktop, wrap with PDFViewer; on mobile, return page content directly
  if (isDesktop) {
    return (
      <PDFViewer
        currentPage={pdfPageNumber}
        totalPages={pdfTotalPages}
        onPageChange={handlePDFPageChange}
        filename="weird-attachments.pdf"
      >
        {pageContent}
      </PDFViewer>
    );
  }

  return pageContent;
};

