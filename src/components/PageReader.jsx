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

const ensureWordSliceInitialized = async (karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar) => {
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
    // IMPORTANT: This text NOW contains soft hyphens (\u00AD) from programmatic hyphenation.
    // The wordCharRanges have been adjusted to account for these soft hyphens.
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
    // Fixing this "properly" would require either:
    //   (1) returning to per-character spans and driving highlight at
    //       character level (sacrificing native hyphenation behaviour), or
    //   (2) a layout-aware JS solution that inspects getClientRects() and
    //       injects fragment-level overlays with accurate positioning and
    //       character range detection (using Range API to determine which
    //       characters are in each fragment).
    //
    // Previous attempt: Tried implementing option (2) but encountered issues
    // with fragment positioning accuracy and character range detection
    // (highlight fragment was breaking one character too soon, positioning was
    // incorrect). This needs more investigation to get the positioning and
    // character mapping correct.
    //
    // For now we accept this limitation as a known polish issue so that we
    // can keep the browser's native, book-like hyphenation for karaoke text.
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
      // Store the literal word text for the ::after overlay. This text may contain
      // soft hyphens (\u00AD) from programmatic hyphenation, which is fine - they're
      // invisible unless the word breaks, and the ::after overlay will render correctly.
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

    // CRITICAL: Wait for browser to fully render and apply hyphenation before rebuilding
    // On the first page, the browser needs time to:
    // 1. Apply CSS hyphenation (hyphens: none, but soft hyphens from hyphenateSync)
    // 2. Calculate line breaks based on container width
    // 3. Render the text with proper wrapping
    // Only after all this is complete should we clear and rebuild with word spans.
    // Otherwise, the rebuild will recalculate line breaks and may wrap differently.
    
    // Measure the current rendered layout to detect when it's stable
    const container = sliceElement.closest('.page-content') || sliceElement.parentElement;
    let previousHeight = 0;
    let stableCount = 0;
    const requiredStableFrames = 3; // Require 3 consecutive stable measurements
    
    // Wait for layout to stabilize by checking if height/position stops changing
    await new Promise(resolve => {
      const checkStability = () => {
        if (!sliceElement || !sliceElement.isConnected) {
          resolve();
          return;
        }
        
        // Measure current layout
        const currentHeight = sliceElement.getBoundingClientRect().height;
        const currentTop = sliceElement.getBoundingClientRect().top;
        
        // Check if layout is stable (height and position haven't changed)
        if (Math.abs(currentHeight - previousHeight) < 0.5 && 
            Math.abs(currentTop - (previousHeight > 0 ? sliceElement.getBoundingClientRect().top : currentTop)) < 0.5) {
          stableCount++;
          if (stableCount >= requiredStableFrames) {
            // Layout is stable, proceed
            resolve();
            return;
          }
        } else {
          // Layout changed, reset counter
          stableCount = 0;
        }
        
        previousHeight = currentHeight;
        
        // Continue checking
        requestAnimationFrame(() => {
          requestAnimationFrame(checkStability);
        });
      };
      
      // Start checking after initial render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Give browser time to apply hyphenation
          setTimeout(() => {
            checkStability();
          }, 100);
        });
      });
    });

    sliceElement.innerHTML = '';
    sliceElement.appendChild(fragment);
    
    // Force a reflow to ensure <br> tags are rendered correctly
    // This fixes the issue where <br> tags aren't visible until a layout recalculation
    void sliceElement.offsetHeight;
    
// console.log('[[INIT]] Slice initialized successfully with words');
    return true;
  };
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { applyInkEffectToTextMobile } from './Chapter';
import { ReaderTopBar } from './ReaderTopBar';
import { MobileTOC } from './MobileTOC';
import { usePagePagination } from '../hooks/usePagePagination';
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
  const calculatePages = usePagePagination({
    chapters,
    initialPosition,
    setPages,
    setKaraokeSources,
    setCurrentChapterIndex,
    setCurrentPageIndex,
    setIsInitializing
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!chapters || chapters.length === 0) {
      setPages([]);
      return;
    }

    // Don't recalculate if pages already exist (unless chapters changed)
    if (pages.length > 0) return;

    // Start calculation immediately but use requestAnimationFrame to ensure DOM is ready
    // This allows the loading GIF to appear right away while calculation happens
    // Use double RAF to ensure React has rendered the loading state first
    const rafId1 = requestAnimationFrame(() => {
      const rafId2 = requestAnimationFrame(() => {
        // Start calculation - loading state should already be visible
        calculatePages().catch((error) => {
          console.error('[PageReader] Error calculating pages:', error);
        });
      });
      return () => cancelAnimationFrame(rafId2);
    });

    return () => {
      cancelAnimationFrame(rafId1);
    };
  }, [chapters, initialPosition, pages.length, calculatePages]);

  // OLD calculatePages implementation removed - now using usePagePagination hook
  // The old implementation was ~2500 lines and has been extracted into:
  // - src/utils/paginationHelpers.js
  // - src/utils/pageCreation.js
  // - src/utils/contentProcessing.js
  // - src/utils/karaokePagination.js
  // - src/utils/elementPagination.js
  // - src/utils/postProcessing.js
  // - src/hooks/usePagePagination.js
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
    // iOS Safari doesn't respect 'auto' preload - we'll load explicitly on user gesture
    audio.preload = 'none'; // Changed from 'auto' - iOS requires explicit load() after user gesture
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
    
    // Log network state changes for debugging
    audio.addEventListener('loadstart', () => {
      console.log('[KARAOKE AUDIO] Load started', {
        networkState: audio.networkState,
        readyState: audio.readyState
      });
    });
    
    audio.addEventListener('progress', () => {
      console.log('[KARAOKE AUDIO] Loading progress', {
        networkState: audio.networkState,
        readyState: audio.readyState,
        buffered: audio.buffered.length > 0 ? audio.buffered.end(0) : 0
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
          // Try to initialize the slice one more time (fire and forget - async)
          ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar).then((wasInitialized) => {
          if (wasInitialized) {
// console.log('[[STEP]] Re-initialized slice on frame', currentSlice._stepCount);
            // Re-query spans after initialization
            const newSpans = sliceElement.querySelectorAll('.karaoke-word');
            if (newSpans.length > 0) {
                // Continue with the new spans (will be picked up on next frame)
              currentSlice._loggedNoSpans = false; // Reset so we can log again if needed
            }
          }
          });
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

        let fillValue = 0;
        if (current >= end) {
          span.classList.add('karaoke-word-complete');
          span.classList.remove('karaoke-word-active');
          fillValue = 1;
        } else if (current >= start) {
          const duration = Math.max(end - start, 0.001);
          fillValue = Math.min(Math.max((current - start) / duration, 0), 1);
          span.classList.add('karaoke-word-active');
          span.classList.remove('karaoke-word-complete');
        } else {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          fillValue = 0;
        }
        
        span.style.setProperty('--karaoke-fill', fillValue.toFixed(3));
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
      manuallyPaused: false, // Track if paused due to manual navigation

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
          const initialized = await ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, sliceElement, startChar, endChar);
          if (!initialized) {
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
          controller.manuallyPaused = false;
        } else {
          // Clear manuallyPaused flag when resuming
          controller.manuallyPaused = false;
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
          // iOS Safari requires explicit load() after user gesture
          if (audio.readyState < 4) {
            console.log('[KARAOKE PLAY] Waiting for audio to load in playSlice', {
              readyState: audio.readyState,
              networkState: audio.networkState
            });
            
            // Explicitly load audio - required on iOS Safari
            if (audio.networkState === 0 || audio.networkState === 3) {
              console.log('[KARAOKE PLAY] Explicitly loading audio (iOS compatibility)');
              audio.load();
            }
            
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Audio load timeout in playSlice'));
              }, 20000); // Increased timeout for slower connections (was 10s)
              
              const onReady = () => {
                clearTimeout(timeout);
                audio.removeEventListener('canplaythrough', onReady);
                audio.removeEventListener('loadeddata', onReady);
                audio.removeEventListener('error', onError);
                resolve();
              };
              
              const onError = (e) => {
                clearTimeout(timeout);
                audio.removeEventListener('canplaythrough', onReady);
                audio.removeEventListener('loadeddata', onReady);
                audio.removeEventListener('error', onError);
                reject(e);
              };
              
              if (audio.readyState >= 4) {
                clearTimeout(timeout);
                resolve();
              } else {
                // Listen to both canplaythrough and loadeddata for better iOS compatibility
                audio.addEventListener('canplaythrough', onReady, { once: true });
                audio.addEventListener('loadeddata', onReady, { once: true });
                audio.addEventListener('error', onError, { once: true });
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
      pauseWithResume: () => {
        // Pause and save resume state for manual navigation
        if (!currentSlice || !audio) {
          audio?.pause();
          cancelAnimation();
          // Remove data-playing attribute so breathing animation can resume
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
          return;
        }

        const current = audio.currentTime;
        const wordMetadata = source?.wordCharRanges || [];
        
        if (!wordMetadata || wordMetadata.length === 0) {
          audio.pause();
          cancelAnimation();
          // Remove data-playing attribute so breathing animation can resume
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
          return;
        }

        // Find the current word based on audio time (more reliable than CSS classes)
        // Find the word that contains the current time, or the last word that has ended
        let currentWordIndex = null;
        let currentWord = null;

        // First, try to find a word that is currently active (start <= current < end)
        for (let i = 0; i < wordMetadata.length; i++) {
          const word = wordMetadata[i];
          if (!word || typeof word.start !== 'number' || typeof word.end !== 'number') continue;
          
          if (current >= word.start && current < word.end) {
            // This word is currently being highlighted
            currentWordIndex = word.wordIndex;
            currentWord = word;
            break;
          }
        }

        // If no active word found, find the last word that has ended (current >= end)
        if (!currentWordIndex) {
          for (let i = wordMetadata.length - 1; i >= 0; i--) {
            const word = wordMetadata[i];
            if (!word || typeof word.start !== 'number' || typeof word.end !== 'number') continue;
            
            if (current >= word.end) {
              // This word has completed
              currentWordIndex = word.wordIndex;
              currentWord = word;
              break;
            }
          }
        }

        // If still no word found (audio hasn't started yet), use the first word
        if (!currentWordIndex && wordMetadata.length > 0) {
          const firstWord = wordMetadata.find(w => w && typeof w.start === 'number');
          if (firstWord) {
            currentWordIndex = firstWord.wordIndex;
            currentWord = firstWord;
          }
        }

        // Save resume state and preserve highlighting
        if (currentWord && typeof currentWord.start === 'number') {
          controller.resumeWordIndex = currentWordIndex;
          controller.resumeTime = current; // Use current audio time for more accuracy
          controller.manuallyPaused = true;
          controller.waitingForNextPage = false; // Not waiting for next page, waiting for user to return
          
          // Preserve highlighting state: mark all words before current as complete,
          // and set current word's fill value
          const { sliceElement } = currentSlice;
          if (sliceElement && sliceElement.isConnected) {
            const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
            wordSpans.forEach((span) => {
              const spanWordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
              if (spanWordIndex < 0) return;
              
              if (spanWordIndex < currentWordIndex) {
                // Word is before current - mark as complete
                span.classList.add('karaoke-word-complete');
                span.classList.remove('karaoke-word-active');
                span.style.setProperty('--karaoke-fill', '1');
              } else if (spanWordIndex === currentWordIndex) {
                // Current word - set fill based on progress
                const wordStart = currentWord.start;
                const wordEnd = currentWord.end;
                const duration = Math.max(wordEnd - wordStart, 0.001);
                const fillValue = Math.min(Math.max((current - wordStart) / duration, 0), 1);
                span.style.setProperty('--karaoke-fill', fillValue.toFixed(3));
                if (fillValue > 0) {
                  span.classList.add('karaoke-word-active');
                  span.classList.remove('karaoke-word-complete');
                }
              } else {
                // Word is after current - leave as is (not highlighted)
                // Don't remove classes in case they were set, just ensure fill is 0
                if (!span.classList.contains('karaoke-word-active') && !span.classList.contains('karaoke-word-complete')) {
                  span.style.setProperty('--karaoke-fill', '0');
                }
              }
            });
          }
          
          // Also preserve highlighting on other slices of the same karaoke block
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => {
            if (slice === sliceElement) return; // Already processed
            
            const sliceStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
            const sliceEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
            const currentCharStart = currentWord.charStart;
            
            // If this slice is before the current word, mark all words as complete
            if (sliceEnd <= currentCharStart) {
              const sliceWordSpans = slice.querySelectorAll('.karaoke-word');
              sliceWordSpans.forEach((span) => {
                span.classList.add('karaoke-word-complete');
                span.classList.remove('karaoke-word-active');
                span.style.setProperty('--karaoke-fill', '1');
              });
            }
          });
          
          console.log('[KARAOKE PAUSE] Saved resume state and preserved highlighting', {
            karaokeId,
            resumeWordIndex: currentWordIndex,
            resumeTime: current,
            wordStart: currentWord.start,
            wordEnd: currentWord.end,
            wordCharStart: currentWord.charStart,
            wordCharEnd: currentWord.charEnd,
            controllerExists: !!controller,
            controllerInMap: karaokeControllersRef.current.has(karaokeId)
          });
        } else {
          console.warn('[KARAOKE PAUSE] Could not find word for resume state', {
            currentTime: current,
            wordMetadataLength: wordMetadata.length
          });
        }

        audio.pause();
        cancelAnimation();
        
        // Remove data-playing attribute so breathing animation can resume
        const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
        allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
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
  const initializeKaraokeSlices = useCallback(async (pageContentElement) => {
    if (!pageContentElement) return;

    const slices = pageContentElement.querySelectorAll('.karaoke-slice');
// console.log('[[INIT]] initializeKaraokeSlices called', {
//      totalSlices: slices.length,
//      elementConnected: pageContentElement.isConnected,
//    });
    
    for (const slice of slices) {
      // Only process slices that are actually connected to the DOM
      if (!slice.isConnected) {
// console.log('[[INIT]] Skipping disconnected slice', {
//          startChar: slice.getAttribute('data-karaoke-start'),
//          endChar: slice.getAttribute('data-karaoke-end'),
//        });
        continue;
      }

      const karaokeId = slice.getAttribute('data-karaoke-id');
      const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
      const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);

      if (!karaokeId) continue;

      // Initialize slice if not already initialized (has karaoke-word spans)
      const isInitialized = slice.querySelectorAll('.karaoke-word').length > 0;
      if (!isInitialized) {
        const initialized = await ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, slice, startChar, endChar);
        if (!initialized) {
          continue;
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
        const handleInteraction = async (e) => {
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
          // If touch refs are set (user swiped first), check for movement
          // If touch refs are null (direct tap), allow it to proceed
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
          } else if (e.type === 'touchend' && !touchStartRef.current) {
            // Direct tap on karaoke slice - this is valid, allow it
            console.log('[KARAOKE TAP] Direct tap detected (no touch refs)');
          }
          
          e.stopPropagation(); // Prevent swipe from triggering
          e.preventDefault(); // Prevent any default behavior
          
          // Q11: Ignore taps during page transitions
          if (isTransitioningRef.current) {
            console.log('[KARAOKE TAP] Ignored - page is transitioning');
            return;
          }
          
          console.log('[KARAOKE TAP] Processing tap - passed all checks');

          const karaokeId = slice.getAttribute('data-karaoke-id');
          const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
          
          if (!karaokeId) {
            console.warn('[KARAOKE TAP] No karaokeId found');
            return;
          }
          
          // Prevent multiple simultaneous clicks
          if (slice.dataset.processing === 'true') {
            console.log('[KARAOKE TAP] Already processing, ignoring');
            return;
          }
          slice.dataset.processing = 'true';
          
          // Clear processing flag after a short delay
          setTimeout(() => {
            slice.dataset.processing = 'false';
          }, 500);
          
          const controller = getKaraokeController(karaokeId);
          if (!controller || !controller.audio) {
            console.warn('[KARAOKE TAP] Controller or audio not found', { controller: !!controller, audio: controller?.audio });
            slice.dataset.processing = 'false';
            return;
          }
          
          const audio = controller.audio;
          
          // Check if karaoke is currently playing using multiple indicators:
          // 1. Audio is not paused AND has currentTime > 0 (actually playing, not just loaded)
          // 2. OR any slice of this karaoke has data-playing attribute (set when playback starts, even if audio is temporarily paused during setup)
          // The data-playing attribute is set immediately when playSlice is called, so if it exists, playback has been initiated
          const audioIsPlaying = !audio.paused && audio.currentTime > 0;
          const hasPlayingAttribute = document.querySelector(`[data-karaoke-id="${karaokeId}"][data-playing="true"]`) !== null;
          const isPlaying = audioIsPlaying || hasPlayingAttribute;
          
          // Check if karaoke is paused with resume state
          const hasResumeState = typeof controller.resumeWordIndex === 'number' && controller.resumeTime !== null;
          
          console.log('[KARAOKE TAP] State check', {
            isPlaying,
            audioIsPlaying,
            hasPlayingAttribute,
            hasResumeState,
            resumeWordIndex: controller.resumeWordIndex,
            resumeTime: controller.resumeTime,
            startChar,
            audioPaused: audio.paused,
            audioCurrentTime: audio.currentTime
          });
          
          // If playing, pause it
          if (isPlaying) {
            console.log('[KARAOKE TAP] Pausing playback');
            controller.pauseWithResume();
            slice.dataset.processing = 'false';
            return;
          }
          
          // If paused with resume state, resume it (can resume from any page)
          if (hasResumeState) {
            console.log('[KARAOKE TAP] Resuming playback');
            
            // Ensure slice is initialized
            if (slice.querySelectorAll('.karaoke-word').length === 0) {
              const initialized = await ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, slice, startChar, endChar);
              if (!initialized) {
                console.error('[KARAOKE TAP] Failed to initialize slice for resume');
                slice.dataset.processing = 'false';
                return;
              }
            }
            
            // Find the slice that contains the resume word
            const sourceForResume = karaokeSourcesRef.current[karaokeId];
            const resumeWordMeta = sourceForResume?.wordCharRanges?.[controller.resumeWordIndex];
            const resumeCharPosition = resumeWordMeta ? resumeWordMeta.charStart : null;
            
            let targetSlice = slice;
            let targetStartChar = startChar;
            let targetEndChar = endChar;
            
            // If resume word is not in this slice, find the correct slice
            if (typeof resumeCharPosition === 'number') {
              const sStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
              const sEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
              const resumeWordEnd = resumeWordMeta ? resumeWordMeta.charEnd : null;
              const wordStartsInSlice = resumeCharPosition >= sStart && resumeCharPosition < sEnd;
              const wordEndsInSlice = resumeWordEnd && resumeWordEnd > sStart && resumeWordEnd <= sEnd;
              const wordSpansSlice = resumeCharPosition < sStart && resumeWordEnd && resumeWordEnd > sEnd;
              
              if (!wordStartsInSlice && !wordEndsInSlice && !wordSpansSlice) {
                // Resume word is not in this slice, find the correct slice
                const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
                for (const otherSlice of allSlices) {
                  const otherStart = parseInt(otherSlice.getAttribute('data-karaoke-start') || '0', 10);
                  const otherEnd = parseInt(otherSlice.getAttribute('data-karaoke-end') || '0', 10);
                  const otherWordStartsInSlice = resumeCharPosition >= otherStart && resumeCharPosition < otherEnd;
                  const otherWordEndsInSlice = resumeWordEnd && resumeWordEnd > otherStart && resumeWordEnd <= otherEnd;
                  const otherWordSpansSlice = resumeCharPosition < otherStart && resumeWordEnd && resumeWordEnd > otherEnd;
                  
                  if (otherWordStartsInSlice || otherWordEndsInSlice || otherWordSpansSlice) {
                    targetSlice = otherSlice;
                    targetStartChar = otherStart;
                    targetEndChar = otherEnd;
                    break;
                  }
                }
              }
            }
            
            // Resume playback
            const playOptions = {
              resumeWordIndex: controller.resumeWordIndex,
              resumeTime: controller.resumeTime
            };
            
            // Stop other karaoke instances
            karaokeControllersRef.current.forEach((ctrl, id) => {
              if (id !== karaokeId) {
                ctrl.pause();
              }
            });
            
            // CRITICAL FOR iOS: audio.play() must be called synchronously within the user gesture handler
            if (!audioUnlockedRef.current) {
              console.log('[KARAOKE PLAY] Unlocking audio via karaoke click (iOS-compatible)...');
              try {
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                  playPromise.then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                  }).catch(() => {});
                }
                audioUnlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('audioUnlocked'));
              } catch (unlockErr) {
                console.warn('[KARAOKE PLAY] Unlock attempt had error, but continuing', unlockErr);
                audioUnlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('audioUnlocked'));
              }
            }
            
            // Resume playback
            (async () => {
              try {
                controller.playSlice(targetSlice, targetStartChar, targetEndChar, playOptions);
                currentKaraokeSliceRef.current = { karaokeId, sliceElement: targetSlice, startChar: targetStartChar, endChar: targetEndChar };
              } catch (playErr) {
                console.error('[KARAOKE PLAY] Failed to resume playback', playErr);
              }
            })();
            
            slice.dataset.processing = 'false';
            return;
          }
          
          // If not started yet, only allow starting on first page
          if (startChar !== 0) {
            console.log('[KARAOKE TAP] Ignored - not on first page of karaoke object', { startChar });
            slice.dataset.processing = 'false';
            return;
          }
          
          // Start new playback
          console.log('[KARAOKE TAP] Starting new playback');
          
          // Ensure slice is initialized BEFORE doing anything else
          if (slice.querySelectorAll('.karaoke-word').length === 0) {
            const initialized = await ensureWordSliceInitialized(karaokeSourcesRef, karaokeId, slice, startChar, endChar);
            if (!initialized) {
              console.error('[KARAOKE TAP] Failed to initialize slice in click handler');
              slice.dataset.processing = 'false';
              return;
            }
          }
          
          if (controller && controller.audio) {
              
              // CRITICAL FOR iOS: audio.play() must be called synchronously within the user gesture handler
              // On iOS, attempting audio.play() (even if it fails) unlocks the audio context
              // So we try to play immediately to capture the gesture context
              if (!audioUnlockedRef.current) {
                console.log('[KARAOKE PLAY] Unlocking audio via karaoke click (iOS-compatible)...');
                // Try to unlock immediately with a synchronous play attempt
                // This must happen synchronously in the gesture handler
                try {
                  const playPromise = audio.play();
                  if (playPromise !== undefined) {
                    // Handle the promise, but don't wait for it - we've already unlocked
                    playPromise.then(() => {
                      // If it actually played, pause it immediately
                      audio.pause();
                      audio.currentTime = 0;
                    }).catch(() => {
                      // Ignore errors - the unlock still happened
                    });
                  }
                  // Mark as unlocked immediately (the attempt unlocked it)
                  audioUnlockedRef.current = true;
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                  console.log('[KARAOKE PLAY] Audio context unlocked');
                } catch (unlockErr) {
                  // Even if play() throws, attempting it may have unlocked the context
                  console.warn('[KARAOKE PLAY] Unlock attempt had error, but continuing', unlockErr);
                  audioUnlockedRef.current = true;
                  window.dispatchEvent(new CustomEvent('audioUnlocked'));
                }
              }
              
              // Now proceed with actual playback (async is fine now that context is unlocked)
              (async () => {
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
                // iOS Safari requires explicit load() after user gesture
                if (audio.readyState < 4) {
                  console.log('[KARAOKE PLAY] Waiting for audio to load', {
                    readyState: audio.readyState,
                    networkState: audio.networkState
                  });
                  
                  // Explicitly load audio - required on iOS Safari
                  if (audio.networkState === 0 || audio.networkState === 3) {
                    console.log('[KARAOKE PLAY] Explicitly loading audio (iOS compatibility)');
                    audio.load();
                  }
                  
                  // Wait for loadeddata or canplaythrough
                  try {
                    await new Promise((resolve, reject) => {
                      const timeout = setTimeout(() => {
                        reject(new Error('Audio load timeout'));
                      }, 20000); // Increased timeout for slower connections (was 10s)
                      
                      const onReady = () => {
                        clearTimeout(timeout);
                        audio.removeEventListener('canplaythrough', onReady);
                        audio.removeEventListener('loadeddata', onReady);
                        audio.removeEventListener('error', onError);
                        resolve();
                      };
                      
                      const onError = (e) => {
                        clearTimeout(timeout);
                        audio.removeEventListener('canplaythrough', onReady);
                        audio.removeEventListener('loadeddata', onReady);
                        audio.removeEventListener('error', onError);
                        reject(e);
                      };
                      
                      if (audio.readyState >= 4) {
                        clearTimeout(timeout);
                        resolve();
              } else {
                        // Listen to both canplaythrough and loadeddata for better iOS compatibility
                        audio.addEventListener('canplaythrough', onReady, { once: true });
                        audio.addEventListener('loadeddata', onReady, { once: true });
                        audio.addEventListener('error', onError, { once: true });
                      }
                    });
                  } catch (loadErr) {
                    console.error('[KARAOKE PLAY] Audio load failed', loadErr);
                    // Continue anyway - might still work
                  }
                }
                
                // Now start actual playback
                try {
                  // Stop other karaoke instances
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
                } catch (playErr) {
                  console.error('[KARAOKE PLAY] Failed to start playback', playErr);
                }
              })();
            } else {
              console.warn('[KARAOKE PLAY] Controller or audio not found', { controller: !!controller, audio: controller?.audio });
            }
        };
        
        // Use touchend for mobile, click for desktop
        // Mobile: touchend fires immediately and reliably, avoiding click delay/cancellation
        // Desktop: click works fine
        const isMobileDevice = window.innerWidth <= 768;
        if (isMobileDevice) {
          // Also listen to touchstart to set touch refs for direct taps on karaoke
          slice.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            if (touch) {
              touchStartRef.current = {
                x: touch.clientX,
                y: touch.clientY,
                time: Date.now(),
              };
              touchCurrentRef.current = {
                x: touch.clientX,
                y: touch.clientY,
              };
            }
          }, { passive: true });
          slice.addEventListener('touchend', handleInteraction, { passive: false });
        } else {
          slice.addEventListener('click', handleInteraction);
        }
      }
    }
  }, [getKaraokeController]);

  // Helper function to pause all playing karaoke and save resume state
  const pauseAllKaraoke = useCallback(() => {
    karaokeControllersRef.current.forEach((ctrl) => {
      if (ctrl.pauseWithResume) {
        ctrl.pauseWithResume();
      } else {
        ctrl.pause(); // Fallback if method doesn't exist
      }
    });
  }, []);

  // Helper function to stop all playing karaoke (cleanup)
  const stopAllKaraoke = useCallback(() => {
    karaokeControllersRef.current.forEach((ctrl) => {
      ctrl.stop();
    });
  }, []);

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
          console.log('[KARAOKE RESUME] Resume state found BEFORE initialization', {
            karaokeId: firstKaraokeId,
            resumeWordIndex: resumeController.resumeWordIndex,
            resumeTime: resumeController.resumeTime,
            manuallyPaused: resumeController.manuallyPaused
          });
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
      
      console.log('[KARAOKE RESUME] Checking for resume state', {
        resumeWordIndex: resumeIndex,
        resumeTime: controller.resumeTime,
        manuallyPaused: controller.manuallyPaused,
        hasSource: !!sourceForResume,
        wordCharRangesLength: sourceForResume?.wordCharRanges?.length,
        firstKaraokeId
      });
      
      const resumeWordMeta = sourceForResume?.wordCharRanges?.[resumeIndex];
      const resumeCharPosition = resumeWordMeta ? resumeWordMeta.charStart : null;
      
      console.log('[KARAOKE RESUME] Resume word lookup', {
        resumeIndex,
        foundWord: !!resumeWordMeta,
        resumeCharPosition,
        wordCharStart: resumeWordMeta?.charStart,
        wordCharEnd: resumeWordMeta?.charEnd
      });

      if (typeof resumeCharPosition === 'number') {
        for (const slice of slices) {
          const sStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const sEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
// console.log('[[RESUME]] Checking slice for resume', {
//            sStart,
//            sEnd,
//            resumeCharPosition,
//          });
          // Check if resume word is in this slice (inclusive of end boundary)
          // A word at charStart is in the slice if: sStart <= charStart < sEnd
          // But we also need to check if the word ENDS in this slice, so check charEnd too
          const resumeWordEnd = resumeWordMeta ? resumeWordMeta.charEnd : null;
          const wordStartsInSlice = resumeCharPosition >= sStart && resumeCharPosition < sEnd;
          const wordEndsInSlice = resumeWordEnd && resumeWordEnd > sStart && resumeWordEnd <= sEnd;
          const wordSpansSlice = resumeCharPosition < sStart && resumeWordEnd && resumeWordEnd > sEnd;
          
          if (wordStartsInSlice || wordEndsInSlice || wordSpansSlice) {
            targetSlice = slice;
            targetStartChar = sStart;
            targetEndChar = sEnd;
            resumeWordIndex = resumeIndex;
            console.log('[KARAOKE RESUME] Found resume word on this page', {
              sliceStart: sStart,
              sliceEnd: sEnd,
              resumeCharStart: resumeCharPosition,
              resumeCharEnd: resumeWordEnd,
              resumeWordIndex: resumeIndex
            });
            break;
          }
        }
      }

      if (resumeWordIndex === null) {
        // Resume word is not on this page - don't start karaoke here
        // But we should still restore highlighting for words that are before the resume word
        const sourceForHighlighting = karaokeSourcesRef.current[firstKaraokeId];
        const resumeWordMetaForHighlighting = sourceForHighlighting?.wordCharRanges?.[resumeIndex];
        
        if (resumeWordMetaForHighlighting) {
          // Restore highlighting for all slices on this page that are before the resume word
          slices.forEach((slice) => {
            const sliceStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
            const sliceEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
            const resumeCharStart = resumeWordMetaForHighlighting.charStart;
            
            // If this slice is entirely before the resume word, mark all words as complete
            if (sliceEnd <= resumeCharStart) {
              const wordSpans = slice.querySelectorAll('.karaoke-word');
              wordSpans.forEach((span) => {
                span.classList.add('karaoke-word-complete');
                span.classList.remove('karaoke-word-active');
                span.style.setProperty('--karaoke-fill', '1');
              });
            } else {
              // Slice might contain words before and after resume - mark only words before as complete
              const wordSpans = slice.querySelectorAll('.karaoke-word');
              wordSpans.forEach((span) => {
                const spanWordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
                if (spanWordIndex >= 0 && spanWordIndex < resumeIndex) {
                  span.classList.add('karaoke-word-complete');
                  span.classList.remove('karaoke-word-active');
                  span.style.setProperty('--karaoke-fill', '1');
                }
              });
            }
          });
          
          console.log('[KARAOKE RESUME] Restored highlighting on page without resume word', {
            resumeWordIndex: resumeIndex,
            slicesProcessed: slices.length
          });
        }
        
        console.log('[[RESUME]] Resume word not on this page, skipping auto-start', {
          requestedResumeIndex: resumeIndex,
          controllerResumeWordIndex: controller.resumeWordIndex,
          currentPageSlices: slices.length,
          note: 'Will resume when user navigates to the correct page'
        });
        return; // Don't start karaoke on this page
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
    
    // If we have resume state, restore highlighting for all slices before resuming
    if (typeof finalResumeWordIndex === 'number' && finalResumeTime !== null) {
      const sourceForHighlighting = karaokeSourcesRef.current[firstKaraokeId];
      const resumeWordMeta = sourceForHighlighting?.wordCharRanges?.[finalResumeWordIndex];
      
      if (resumeWordMeta) {
        // Restore highlighting for all slices of this karaoke block
        const allSlices = document.querySelectorAll(`[data-karaoke-id="${firstKaraokeId}"].karaoke-slice`);
        allSlices.forEach((slice) => {
          const sliceStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const sliceEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
          const resumeCharStart = resumeWordMeta.charStart;
          const resumeCharEnd = resumeWordMeta.charEnd;
          
          const wordSpans = slice.querySelectorAll('.karaoke-word');
          wordSpans.forEach((span) => {
            const spanWordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
            if (spanWordIndex < 0) return;
            
            if (spanWordIndex < finalResumeWordIndex) {
              // Word is before resume point - mark as complete
              span.classList.add('karaoke-word-complete');
              span.classList.remove('karaoke-word-active');
              span.style.setProperty('--karaoke-fill', '1');
            } else if (spanWordIndex === finalResumeWordIndex) {
              // Resume word - set fill based on resume time
              const wordStart = resumeWordMeta.start;
              const wordEnd = resumeWordMeta.end;
              if (typeof wordStart === 'number' && typeof wordEnd === 'number') {
                const duration = Math.max(wordEnd - wordStart, 0.001);
                const fillValue = Math.min(Math.max((finalResumeTime - wordStart) / duration, 0), 1);
                span.style.setProperty('--karaoke-fill', fillValue.toFixed(3));
                if (fillValue > 0) {
                  span.classList.add('karaoke-word-active');
                  span.classList.remove('karaoke-word-complete');
                }
              }
            }
            // Words after resume point are left unhighlighted (will be highlighted during playback)
          });
        });
        
        console.log('[KARAOKE RESUME] Restored highlighting state', {
          resumeWordIndex: finalResumeWordIndex,
          resumeTime: finalResumeTime,
          slicesProcessed: allSlices.length
        });
      }
    }
    
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

    console.log('[KARAOKE RESUME] About to start playback', {
      hasResumeState: typeof finalResumeWordIndex === 'number' && finalResumeTime !== null,
      resumeWordIndex: finalResumeWordIndex,
      resumeTime: finalResumeTime,
      targetStartChar,
      targetEndChar,
      playOptions
    });

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
            // Q2: Pause karaoke when navigating from cover to first chapter (skipping pages)
            pauseAllKaraoke();
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
          // Q2: Pause karaoke when skipping to a different chapter (user skipped pages)
          pauseAllKaraoke();
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
        
        // Q1: Pause karaoke when swiping backward (user can resume when swiping forward again)
        pauseAllKaraoke();
        
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
          // Q1: Pause karaoke when navigating from cover to first page (backward navigation)
          pauseAllKaraoke();
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
        // Q1: Pause karaoke when navigating to previous chapter (backward navigation)
        pauseAllKaraoke();
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
      const timer = setTimeout(async () => {
        const node = pageContentRef.current;
        if (node && node.isConnected) {
          // Ensure slices are initialized before trying to start
          await initializeKaraokeSlices(node);
        }
        
        // POLISH NOTE: Ink effect application to karaoke text is disabled (see note above)
        // Karaoke text uses thicker general text shadow instead
        
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
          const handleUnlock = async () => {
// console.log('Audio unlocked after transition, starting karaoke');
            setTimeout(async () => {
              const node = pageContentRef.current;
              if (node && node.isConnected) {
                await initializeKaraokeSlices(node);
              }
              setTimeout(() => {
                startVisibleKaraoke();
              }, 200);
            }, 100);
            window.removeEventListener('audioUnlocked', handleUnlock);
          };
          window.addEventListener('audioUnlocked', handleUnlock);
          // Also check periodically in case event was missed
          const checkInterval = setInterval(async () => {
            if (audioUnlockedRef.current) {
              clearInterval(checkInterval);
              window.removeEventListener('audioUnlocked', handleUnlock);
              const node = pageContentRef.current;
              if (node && node.isConnected) {
                await initializeKaraokeSlices(node);
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
  }, [isTransitioning, startVisibleKaraoke, initializeKaraokeSlices, pageToDisplay]);

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
  
  // ============================================================================
  // REFACTORED: Separated content processing functions
  // ============================================================================
  
  /**
   * Check if karaoke slices are initialized (have .karaoke-word spans)
   */
  const hasInitializedKaraoke = useCallback((node) => {
    return node && node.querySelectorAll('.karaoke-slice .karaoke-word').length > 0;
  }, []);
  
  /**
   * Check if normal text has ink effect applied (has .ink-char-mobile spans)
   */
  const hasInkEffect = useCallback((node) => {
    return node && node.querySelectorAll('.ink-char-mobile').length > 0;
  }, []);
  
  /**
   * Preserve page content HTML for later restoration
   */
  const preservePageContent = useCallback((node, pageKey) => {
    if (!node || !node.isConnected || !pageKey) return;
    preservedInkHTMLRef.current = node.innerHTML;
    preservedPageKeyRef.current = pageKey;
  }, []);
  
  /**
   * Restore preserved page content HTML if available for the current page
   */
  const restorePageContent = useCallback((node, pageKey) => {
    if (!node || !node.isConnected || !pageKey) return false;
    
    if (preservedInkHTMLRef.current && preservedPageKeyRef.current === pageKey) {
      node.innerHTML = preservedInkHTMLRef.current;
      return true;
    }
    return false;
  }, []);
  
  /**
   * Process karaoke content: initialize karaoke slices
   * This only handles karaoke-specific processing
   */
  const processKaraokeContent = useCallback(async (node) => {
    if (!node || !node.isConnected) return false;
    
    // Check if karaoke slices need initialization
    if (hasInitializedKaraoke(node)) {
      return true; // Already initialized
    }
    
    try {
      await initializeKaraokeSlices(node);
      return true;
    } catch (error) {
      console.error('[PAGE CONTENT] Error initializing karaoke:', error);
      return false;
    }
  }, [initializeKaraokeSlices, hasInitializedKaraoke]);
  
  /**
   * Process normal text content: apply ink effect
   * This only handles normal text processing (excludes karaoke)
   */
  const processNormalTextContent = useCallback((node) => {
    if (!node || !node.isConnected) return false;
    
    // Don't apply ink effect if already applied
    if (hasInkEffect(node)) {
      return true; // Already processed
    }
    
    // Don't apply ink effect to karaoke text (see polish note in code)
    if (hasInitializedKaraoke(node)) {
      return false; // Skip - karaoke text doesn't use ink effect
    }
    
    try {
      applyInkEffectToTextMobile(node, { probability: 0.25 });
      return true;
    } catch (error) {
      console.error('[PAGE CONTENT] Error applying ink effect:', error);
      return false;
    }
  }, [hasInkEffect, hasInitializedKaraoke]);
  
  /**
   * Ensure content is set from pageToDisplay if node is empty
   */
  const ensureContentSet = useCallback((node, pageToDisplay) => {
    if (!node || !node.isConnected) return false;
    
    if (!node.innerHTML || node.innerHTML.trim() === '') {
      if (pageToDisplay && pageToDisplay.content) {
        node.innerHTML = pageToDisplay.content;
        return true;
      }
      return false;
    }
    return true;
  }, []);
  
  const pageContentRefCallback = useCallback((node) => {
    pageContentRef.current = node;
    if (!node || !node.isConnected) return;
    
      // Get current page key to track which page this HTML belongs to
      const currentPageKey = pageToDisplay 
        ? `page-${pageToDisplay.chapterIndex}-${pageToDisplay.pageIndex}`
        : null;
      
    if (!currentPageKey) return;
    
    console.log('[PAGE CONTENT CALLBACK] Node connected', {
      hasNode: !!node,
      isConnected: node.isConnected,
      pageToDisplay: pageToDisplay ? { chapterIndex: pageToDisplay.chapterIndex, pageIndex: pageToDisplay.pageIndex, hasContent: !!pageToDisplay.content, contentLength: pageToDisplay.content?.length } : null,
      currentPageKey,
      isTransitioning: isTransitioningRef.current,
      nodeInnerHTML: node.innerHTML?.substring(0, 100)
    });

    // ========================================================================
    // HANDLE TRANSITIONS: Restore preserved content or preserve raw content
    // ========================================================================
    if (isTransitioningRef.current) {
      // During transitions, try to restore preserved HTML if available
      const restored = restorePageContent(node, currentPageKey);
      if (restored) {
        console.log('[PAGE CONTENT] Restored preserved HTML during transition', {
          currentPageKey,
          preservedPageKey: preservedPageKeyRef.current
        });
        return; // Content restored, wait for transition to complete
      }
      
      // No preserved HTML available - ensure content is set and preserve raw content
      if (ensureContentSet(node, pageToDisplay)) {
        preservePageContent(node, currentPageKey);
      }
      return; // Skip processing during transitions
    }
      
    // ========================================================================
    // PROCESS CONTENT: After transition or on initial load
    // ========================================================================
    const processContentWhenReady = async () => {
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
      
      if (!node || !node.isConnected) return;
      
      // Ensure content is set
      if (!ensureContentSet(node, pageToDisplay)) {
        console.error('[PAGE CONTENT] No content available!', {
          currentPageKey,
          hasPageToDisplay: !!pageToDisplay,
          hasContent: !!pageToDisplay?.content
        });
        return;
      }
      
      // Skip if still transitioning
      if (isTransitioningRef.current) {
        return;
      }
      
      // Process in order: Karaoke first, then normal text
      // This ensures karaoke structure is ready before normal text processing
      await processKaraokeContent(node);
      processNormalTextContent(node);
      
      // Preserve the final processed HTML
      preservePageContent(node, currentPageKey);
    };
    
    // Process content when ready (after fonts and layout are stable)
    processContentWhenReady();
    
    // POLISH NOTE:
    // -------------------------------
    // Ink effect (character-level shadows) is currently disabled for karaoke text
    // because wrapping characters in spans interferes with browser hyphenation.
    // The ink effect causes hyphenation to break on initial load, requiring a swipe
    // to fix. For now, karaoke text uses a thicker general text shadow instead.
    // Future polish: Find a way to apply ink effect to karaoke text without
    // breaking hyphenation, or wait for browser to complete hyphenation before
    // applying ink effect.
    // -------------------------------
    
  }, [pageToDisplay, isTransitioningRef, hasInitializedKaraoke, hasInkEffect, preservePageContent, restorePageContent, processKaraokeContent, processNormalTextContent, ensureContentSet, initializeKaraokeSlices]);

  // Q5: Pause karaoke when tab goes to background
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab went to background - pause all karaoke
        pauseAllKaraoke();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pauseAllKaraoke]);

  // Q6: Stop karaoke when device goes to sleep
  useEffect(() => {
    const handlePageHide = () => {
      // Device going to sleep or page unloading - stop all karaoke
      stopAllKaraoke();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [stopAllKaraoke]);

  // Q9: Stop karaoke on browser navigation (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      // Browser navigation occurred - stop all karaoke
      stopAllKaraoke();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [stopAllKaraoke]);

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
       {pageToDisplay && !pageToDisplay.isFirstPage && !pageToDisplay.isCover && typeof document !== 'undefined' && createPortal(
      <div className="page-number">
           {currentPageNumber || '?'}
         </div>,
         document.body
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

