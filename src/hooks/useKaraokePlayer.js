import { useRef, useCallback, useEffect } from 'react';
import { ensureWordSliceInitialized } from '../utils/karaokeHelpers';

/**
 * useKaraokePlayer - Hook for managing karaoke playback and highlighting
 * 
 * Supports both mobile and desktop with isolated state management.
 * 
 * Desktop-specific features:
 * - IntersectionObserver for visibility detection (pause when out of view, resume when in view)
 * - Multi-slice highlighting (highlights words across all visible slices simultaneously)
 * 
 * @param {Object} options
 * @param {boolean} options.isDesktop - Whether this is desktop mode
 * @param {Object} options.karaokeSources - Map of karaoke sources (from usePagePagination)
 * 
 * @returns {Object} - { initializeKaraokeSlices, getKaraokeController, pauseAllKaraoke, stopAllKaraoke, observePage, unobservePage }
 */
export const useKaraokePlayer = ({
  isDesktop,
  karaokeSources
}) => {
  // Keep karaokeSources in a ref for stable access
  const karaokeSourcesRef = useRef({});
  useEffect(() => {
    karaokeSourcesRef.current = karaokeSources || {};
  }, [karaokeSources]);
  // Isolated state for this instance (mobile or desktop)
  const karaokeControllersRef = useRef(new Map()); // karaokeId -> controller
  const audioUnlockedRef = useRef(false);
  const currentKaraokeSliceRef = useRef(null); // { karaokeId, sliceElement, startChar, endChar }
  
  // Desktop-specific: Track visible pages with IntersectionObserver
  // NOTE: Visibility-based pausing/resuming is TEMPORARILY DISABLED because it can
  // interfere with real-time highlighting after recent layout changes.
  // We keep the refs so we can re-enable this later if needed.
  const visiblePagesRef = useRef(new Set()); // Set of page elements that are visible
  const intersectionObserverRef = useRef(null);

  // Helper: Check if a page is currently visible (desktop only)
  // TEMP: Always treat pages as visible so highlighting runs continuously.
  const isPageVisible = useCallback((pageElement) => {
    return true;
  }, [isDesktop]);

  // Helper: Pause karaoke on a specific page (desktop only)
  const pauseKaraokeOnPage = useCallback((pageElement) => {
    // TEMP: visibility-based auto‑pause disabled – do nothing.
    return;
  }, [isDesktop]);

  // Helper: Resume karaoke on a specific page (desktop only)
  const checkAndResumeKaraokeOnPage = useCallback((pageElement) => {
    // TEMP: visibility-based auto‑resume disabled – do nothing.
    return;
  }, [isDesktop, karaokeSources]);

  // Initialize IntersectionObserver for desktop visibility detection
  // TEMP: disabled – we no longer pause/resume based on visibility.
  useEffect(() => {
    // No-op while visibility-based control is disabled.
    return;
  }, [isDesktop, checkAndResumeKaraokeOnPage, pauseKaraokeOnPage]);

  // Get or create karaoke controller for a given karaokeId
  const getKaraokeController = useCallback((karaokeId) => {
    if (karaokeControllersRef.current.has(karaokeId)) {
      return karaokeControllersRef.current.get(karaokeId);
    }

    const source = karaokeSourcesRef.current[karaokeId];
    if (!source) return null;

    const audio = new Audio(source.audioUrl);
    audio.preload = 'none'; // iOS requires explicit load() after user gesture
    
    // Add error handler
    audio.addEventListener('error', (e) => {

    });
    
    audio.addEventListener('loadeddata', () => {

    });

    let rafId = null;
    let currentSlice = null;

    const cancelAnimation = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    // Create controller object first (will be populated below)
    const controller = {
      audio,
      resumeWordIndex: null,
      resumeTime: null,
      waitingForNextPage: false,
      manuallyPaused: false,
    };

    // Update highlighting for words - supports multi-slice on desktop
    // Optimized: Cache slice references and only update visible slices
    const updateHighlightingForSlices = (currentTime, karaokeId, wordMetadata) => {
      if (isDesktop) {
        // Desktop: Update all visible slices simultaneously
        // Cache the slice query to avoid repeated DOM queries
        if (!controller._cachedSlices || controller._cachedSlices.length === 0) {
          controller._cachedSlices = Array.from(document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`));
        }
        
        controller._cachedSlices.forEach((slice) => {
          // Only update slices that are in visible pages (desktop)
          const pageElement = slice.closest('.page-sheet, [data-page-key]');
          if (pageElement && !isPageVisible(pageElement)) {
            return; // Skip slices on non-visible pages
          }

          const wordSpans = slice.querySelectorAll('.karaoke-word');
          
          wordSpans.forEach((span) => {
            const wordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
            if (wordIndex < 0) return;
            
            // If resuming, mark words before resumeWordIndex as complete
            if (currentSlice && typeof currentSlice.resumeWordIndex === 'number' && wordIndex < currentSlice.resumeWordIndex) {
              span.classList.add('karaoke-word-complete');
              span.classList.remove('karaoke-word-active');
              span.style.setProperty('--karaoke-fill', '1');
              return;
            }
            
            const startStr = span.dataset.start;
            const endStr = span.dataset.end;
            if (!startStr || !endStr) return;

            const start = parseFloat(startStr);
            const end = parseFloat(endStr);
            if (Number.isNaN(start) || Number.isNaN(end)) return;

            let fillValue = 0;
            if (currentTime >= end) {
              span.classList.add('karaoke-word-complete');
              span.classList.remove('karaoke-word-active');
              fillValue = 1;
            } else if (currentTime >= start) {
              const duration = Math.max(end - start, 0.001);
              fillValue = Math.min(Math.max((currentTime - start) / duration, 0), 1);
              span.classList.add('karaoke-word-active');
              span.classList.remove('karaoke-word-complete');
            } else {
              span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
              fillValue = 0;
            }
            
            span.style.setProperty('--karaoke-fill', fillValue.toFixed(3));
          });
        });
      } else {
        // Mobile: Update only current slice (original behavior)
        if (!currentSlice) return;
        const { sliceElement } = currentSlice;
        if (!sliceElement || !sliceElement.isConnected) return;

        const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
        wordSpans.forEach((span) => {
          const wordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
          if (wordIndex < 0) return;
          
          if (typeof currentSlice.resumeWordIndex === 'number' && wordIndex < currentSlice.resumeWordIndex) {
            span.classList.add('karaoke-word-complete');
            span.classList.remove('karaoke-word-active');
            span.style.setProperty('--karaoke-fill', '1');
            return;
          }
          
          const startStr = span.dataset.start;
          const endStr = span.dataset.end;
          if (!startStr || !endStr) return;

          const start = parseFloat(startStr);
          const end = parseFloat(endStr);
          if (Number.isNaN(start) || Number.isNaN(end)) return;

          let fillValue = 0;
          if (currentTime >= end) {
            span.classList.add('karaoke-word-complete');
            span.classList.remove('karaoke-word-active');
            fillValue = 1;
          } else if (currentTime >= start) {
            const duration = Math.max(end - start, 0.001);
            fillValue = Math.min(Math.max((currentTime - start) / duration, 0), 1);
            span.classList.add('karaoke-word-active');
            span.classList.remove('karaoke-word-complete');
          } else {
            span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
            fillValue = 0;
          }
          
          span.style.setProperty('--karaoke-fill', fillValue.toFixed(3));
        });
      }
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
      
      // Update highlighting (supports multi-slice on desktop)
      updateHighlightingForSlices(current, karaokeId, wordMetadata);

      // Check if we've passed the resume point
      if (typeof currentSlice.resumeWordIndex === 'number' && controller.waitingForNextPage) {
        const resumeWord = wordMetadata[currentSlice.resumeWordIndex];
        if (resumeWord && typeof resumeWord.start === 'number' && current >= resumeWord.start) {
          controller.waitingForNextPage = false;
          controller.resumeWordIndex = null;
          controller.resumeTime = null;
        }
      }

      // Desktop: Check if next page is visible and continue if so
      if (isDesktop) {
        const fullTextLength = source?.text ? source.text.length : 0;
        const hasMoreTextBeyondSlice = fullTextLength > 0 && endChar < fullTextLength;
        
        if (hasMoreTextBeyondSlice) {
          // Find the next slice
          const allSlices = Array.from(document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`));
          const nextSlice = allSlices.find((s) => {
            const sStart = parseInt(s.getAttribute('data-karaoke-start') || '0', 10);
            return sStart > endChar;
          });
          
          if (nextSlice) {
            const nextPageElement = nextSlice.closest('.page-sheet, [data-page-key]');
            if (nextPageElement && isPageVisible(nextPageElement)) {
              // Next page is visible - continue playback without pausing
              // Ensure all slices still have data-playing to stop breathing
              const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
              allSlices.forEach((slice) => {
                slice.setAttribute('data-playing', 'true');
              });
              
              // Update currentSlice to the next slice
              const nextStart = parseInt(nextSlice.getAttribute('data-karaoke-start') || '0', 10);
              const nextEnd = parseInt(nextSlice.getAttribute('data-karaoke-end') || '0', 10);
              currentSlice = {
                ...currentSlice,
                sliceElement: nextSlice,
                startChar: nextStart,
                endChar: nextEnd
              };
              // Continue animation loop
              rafId = requestAnimationFrame(step);
              return;
            }
          }
        }
      }

      // Mobile: Original behavior - pause at page boundary
      if (!isDesktop) {
        const fullTextLength = source?.text ? source.text.length : 0;
        const hasMoreTextBeyondSlice = fullTextLength > 0 && endChar < fullTextLength;

        if (hasMoreTextBeyondSlice) {
          const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
          if (wordSpans.length > 0) {
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
                controller.resumeTime = nextWord ? nextWord.start : lastWord.end + 0.01;
                controller.waitingForNextPage = true;
                audio.pause();
                cancelAnimation();
                return;
              }
            }
          }
        }
      }

      rafId = requestAnimationFrame(step);
    };

    // Reset highlighting for all slices of this karaoke block
    const resetHighlighting = (sliceElement = null) => {
      if (sliceElement) {
        const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
        wordSpans.forEach((span) => {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', '0');
        });
        return;
      }

      const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
      allSlices.forEach((slice) => {
        const wordSpans = slice.querySelectorAll('.karaoke-word');
        wordSpans.forEach((span) => {
          span.classList.remove('karaoke-word-active', 'karaoke-word-complete');
          span.style.setProperty('--karaoke-fill', '0');
        });
      });
    };

    // Handle audio ended event
    audio.addEventListener('ended', () => {
      resetHighlighting();
      cancelAnimation();
      currentSlice = null;
      controller.resumeWordIndex = null;
      controller.resumeTime = null;
      controller.waitingForNextPage = false;
      const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
      allSlices.forEach((slice) => {
        slice.removeAttribute('data-playing');
      });
    });

    // Add methods to controller
    controller.playSlice = async (sliceElement, startChar, endChar, options = {}) => {
        const source = karaokeSourcesRef.current[karaokeId];
        if (!source) return;

        const hasSpans = sliceElement.querySelectorAll('.karaoke-word').length > 0;
        if (!hasSpans) {
          const initialized = await ensureWordSliceInitialized(karaokeSourcesRef.current, karaokeId, sliceElement, startChar, endChar);
          if (!initialized) {

            return;
          }
        }

        // Set data-playing on ALL slices of this karaoke block to stop breathing animation
        // Do this AFTER initialization to avoid visual glitches during DOM manipulation
        const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
        allSlices.forEach((slice) => {
          slice.setAttribute('data-playing', 'true');
        });

        audio.pause();
        cancelAnimation();
        
        // Clear cached slices when starting new playback to force refresh
        controller._cachedSlices = null;

        const isResuming = typeof options.resumeWordIndex === 'number' || typeof options.resumeTime === 'number';
        if (!isResuming) {
          resetHighlighting();
          controller.resumeWordIndex = null;
          controller.resumeTime = null;
          controller.manuallyPaused = false;
        } else {
          controller.manuallyPaused = false;
        }

        const letterTimings = source.letterTimings || [];
        const wordMetadata = source.wordCharRanges || [];
        let highlightStartTime;

        if (typeof options.resumeTime === 'number') {
          highlightStartTime = options.resumeTime;
        } else if (typeof options.resumeWordIndex === 'number') {
          const resumeWord = wordMetadata[options.resumeWordIndex];
          highlightStartTime = resumeWord && typeof resumeWord.start === 'number' ? resumeWord.start : 0;
        } else {
          const startTiming = letterTimings[startChar];
          highlightStartTime = startTiming ? startTiming.start : 0;
        }

        currentSlice = {
          sliceElement,
          startChar,
          endChar,
          letterTimings,
          resumeWordIndex: options.resumeWordIndex,
          highlightStartTime,
          _stepCount: 0,
          _loggedNoSpans: false,
        };

        try {
          if (audio.error) {

            // Remove data-playing from all slices if there's an error
            const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
            allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
            return;
          }
          
          if (audio.readyState < 4) {
            if (audio.networkState === 0 || audio.networkState === 3) {
              audio.load();
            }
            
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Audio load timeout'));
              }, 20000);
              
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
                audio.addEventListener('canplaythrough', onReady, { once: true });
                audio.addEventListener('loadeddata', onReady, { once: true });
                audio.addEventListener('error', onError, { once: true });
              }
            });
          }
          
          const audioStartTime = typeof options.resumeTime === 'number' ? options.resumeTime : 0;
          audio.currentTime = audioStartTime;
          await audio.play();
          
          sliceElement.dataset.processing = 'false';
          cancelAnimation();
          rafId = requestAnimationFrame(step);
        } catch (err) {

          // Remove data-playing from all slices if playback fails
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
          sliceElement.dataset.processing = 'false';
        }
      };

    controller.pause = () => {
        audio.pause();
        cancelAnimation();
      };

    controller.pauseWithResume = () => {
        if (!currentSlice || !audio) {
          audio?.pause();
          cancelAnimation();
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
          return;
        }

        const current = audio.currentTime;
        const wordMetadata = source?.wordCharRanges || [];
        
        if (!wordMetadata || wordMetadata.length === 0) {
          audio.pause();
          cancelAnimation();
          const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
          allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
          return;
        }

        let currentWordIndex = null;
        let currentWord = null;

        for (let i = 0; i < wordMetadata.length; i++) {
          const word = wordMetadata[i];
          if (!word || typeof word.start !== 'number' || typeof word.end !== 'number') continue;
          
          if (current >= word.start && current < word.end) {
            currentWordIndex = word.wordIndex;
            currentWord = word;
            break;
          }
        }

        if (!currentWordIndex) {
          for (let i = wordMetadata.length - 1; i >= 0; i--) {
            const word = wordMetadata[i];
            if (!word || typeof word.start !== 'number' || typeof word.end !== 'number') continue;
            
            if (current >= word.end) {
              currentWordIndex = word.wordIndex;
              currentWord = word;
              break;
            }
          }
        }

        if (!currentWordIndex && wordMetadata.length > 0) {
          const firstWord = wordMetadata.find(w => w && typeof w.start === 'number');
          if (firstWord) {
            currentWordIndex = firstWord.wordIndex;
            currentWord = firstWord;
          }
        }

        if (currentWord && typeof currentWord.start === 'number') {
          controller.resumeWordIndex = currentWordIndex;
          controller.resumeTime = current;
          controller.manuallyPaused = true;
          controller.waitingForNextPage = false;
          
          // Preserve highlighting state
          const { sliceElement } = currentSlice;
          if (sliceElement && sliceElement.isConnected) {
            const wordSpans = sliceElement.querySelectorAll('.karaoke-word');
            wordSpans.forEach((span) => {
              const spanWordIndex = parseInt(span.dataset.wordIndex ?? '-1', 10);
              if (spanWordIndex < 0) return;
              
              if (spanWordIndex < currentWordIndex) {
                span.classList.add('karaoke-word-complete');
                span.classList.remove('karaoke-word-active');
                span.style.setProperty('--karaoke-fill', '1');
              } else if (spanWordIndex === currentWordIndex) {
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
                if (!span.classList.contains('karaoke-word-active') && !span.classList.contains('karaoke-word-complete')) {
                  span.style.setProperty('--karaoke-fill', '0');
                }
              }
            });
          }
          
          // Also preserve highlighting on other slices (desktop multi-slice)
          if (isDesktop) {
            const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
            allSlices.forEach((slice) => {
              if (slice === sliceElement) return;
              
              const sliceStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
              const sliceEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
              const currentCharStart = currentWord.charStart;
              
              if (sliceEnd <= currentCharStart) {
                const sliceWordSpans = slice.querySelectorAll('.karaoke-word');
                sliceWordSpans.forEach((span) => {
                  span.classList.add('karaoke-word-complete');
                  span.classList.remove('karaoke-word-active');
                  span.style.setProperty('--karaoke-fill', '1');
                });
              }
            });
          }
        }

        audio.pause();
        cancelAnimation();
        
        const allSlices = document.querySelectorAll(`[data-karaoke-id="${karaokeId}"].karaoke-slice`);
        allSlices.forEach((slice) => slice.removeAttribute('data-playing'));
      };

    controller.stop = () => {
        audio.pause();
        audio.currentTime = 0;
        cancelAnimation();
        currentSlice = null;
        controller.resumeWordIndex = null;
        controller.resumeTime = null;
        controller.waitingForNextPage = false;
      };

    controller.cleanup = () => {
        audio.pause();
        audio.src = '';
        cancelAnimation();
        currentSlice = null;
        controller.resumeWordIndex = null;
        controller.resumeTime = null;
        controller.waitingForNextPage = false;
      };

    karaokeControllersRef.current.set(karaokeId, controller);
    return controller;
  }, [isDesktop, isPageVisible]);

  // Initialize karaoke slices on a page
  const initializeKaraokeSlices = useCallback(async (pageContentElement) => {
    if (!pageContentElement) return;

    const slices = pageContentElement.querySelectorAll('.karaoke-slice');
    
    for (const slice of slices) {
      if (!slice.isConnected) continue;

      const karaokeId = slice.getAttribute('data-karaoke-id');
      const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
      const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);

      if (!karaokeId) continue;

      const isInitialized = slice.querySelectorAll('.karaoke-word').length > 0;
      if (!isInitialized) {
        const initialized = await ensureWordSliceInitialized(karaokeSourcesRef.current, karaokeId, slice, startChar, endChar);
        if (!initialized) {
          continue;
        }
      }

      // Add click handler (desktop) or touchend handler (mobile)
      if (!slice.dataset.clickHandlerAdded) {
        slice.dataset.clickHandlerAdded = 'true';
        
        const handleInteraction = async (e) => {

          // Desktop: use click, Mobile: use touchend with swipe detection
          if (!isDesktop && e.type === 'touchend') {
            // Mobile swipe detection logic would go here (from PageReader.jsx)
            // For now, simplified - just check if it's a tap
          }
          
          e.stopPropagation();
          e.preventDefault();
          
          const karaokeId = slice.getAttribute('data-karaoke-id');
          const startChar = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
          const endChar = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
          
          if (!karaokeId) return;
          
          if (slice.dataset.processing === 'true') {
            return;
          }
          slice.dataset.processing = 'true';
          
          setTimeout(() => {
            slice.dataset.processing = 'false';
          }, 500);
          
          const controller = getKaraokeController(karaokeId);
          if (!controller || !controller.audio) {
            slice.dataset.processing = 'false';
            return;
          }
          
          const audio = controller.audio;
          const audioIsPlaying = !audio.paused && audio.currentTime > 0;
          const hasPlayingAttribute = document.querySelector(`[data-karaoke-id="${karaokeId}"][data-playing="true"]`) !== null;
          const isPlaying = audioIsPlaying || hasPlayingAttribute;
          const hasResumeState = typeof controller.resumeWordIndex === 'number' && controller.resumeTime !== null;
          
          // If playing, pause it
          if (isPlaying) {
            controller.pauseWithResume();
            slice.dataset.processing = 'false';
            return;
          }
          
          // If paused with resume state, resume it
          if (hasResumeState) {
            if (slice.querySelectorAll('.karaoke-word').length === 0) {
              const initialized = await ensureWordSliceInitialized(karaokeSourcesRef.current, karaokeId, slice, startChar, endChar);
              if (!initialized) {
                slice.dataset.processing = 'false';
                return;
              }
            }
            
            const sourceForResume = karaokeSourcesRef.current[karaokeId];
            const resumeWordMeta = sourceForResume?.wordCharRanges?.[controller.resumeWordIndex];
            const resumeCharPosition = resumeWordMeta ? resumeWordMeta.charStart : null;
            
            let targetSlice = slice;
            let targetStartChar = startChar;
            let targetEndChar = endChar;
            
            if (typeof resumeCharPosition === 'number') {
              const sStart = parseInt(slice.getAttribute('data-karaoke-start') || '0', 10);
              const sEnd = parseInt(slice.getAttribute('data-karaoke-end') || '0', 10);
              const resumeWordEnd = resumeWordMeta ? resumeWordMeta.charEnd : null;
              const wordStartsInSlice = resumeCharPosition >= sStart && resumeCharPosition < sEnd;
              const wordEndsInSlice = resumeWordEnd && resumeWordEnd > sStart && resumeWordEnd <= sEnd;
              const wordSpansSlice = resumeCharPosition < sStart && resumeWordEnd && resumeWordEnd > sEnd;
              
              if (!wordStartsInSlice && !wordEndsInSlice && !wordSpansSlice) {
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
            
            const playOptions = {
              resumeWordIndex: controller.resumeWordIndex,
              resumeTime: controller.resumeTime
            };
            
            karaokeControllersRef.current.forEach((ctrl, id) => {
              if (id !== karaokeId) {
                ctrl.pause();
              }
            });
            
            if (!audioUnlockedRef.current) {
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

                audioUnlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('audioUnlocked'));
              }
            }
            
            (async () => {
              try {
                controller.playSlice(targetSlice, targetStartChar, targetEndChar, playOptions);
                currentKaraokeSliceRef.current = { karaokeId, sliceElement: targetSlice, startChar: targetStartChar, endChar: targetEndChar };
              } catch (playErr) {

              }
            })();
            
            slice.dataset.processing = 'false';
            return;
          }
          
          // Only allow starting on first page
          if (startChar !== 0) {
            slice.dataset.processing = 'false';
            return;
          }
          
          // Start new playback
          if (slice.querySelectorAll('.karaoke-word').length === 0) {
            const initialized = await ensureWordSliceInitialized(karaokeSourcesRef.current, karaokeId, slice, startChar, endChar);
            if (!initialized) {
              slice.dataset.processing = 'false';
              return;
            }
          }
          
          if (controller && controller.audio) {
            if (!audioUnlockedRef.current) {
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

                audioUnlockedRef.current = true;
                window.dispatchEvent(new CustomEvent('audioUnlocked'));
              }
            }
            
            (async () => {
              if (audio.error) {
                return;
              }
              
              if (audio.readyState < 4) {
                if (audio.networkState === 0 || audio.networkState === 3) {
                  audio.load();
                }
                
                try {
                  await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                      reject(new Error('Audio load timeout'));
                    }, 20000);
                    
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
                      audio.addEventListener('canplaythrough', onReady, { once: true });
                      audio.addEventListener('loadeddata', onReady, { once: true });
                      audio.addEventListener('error', onError, { once: true });
                    }
                  });
                } catch (loadErr) {

                }
              }
              
              try {
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

              }
            })();
          }
        };
        
        const isMobileDevice = !isDesktop && window.innerWidth <= 768;
        if (isMobileDevice) {
          // Mobile: add touchstart and touchend handlers
          slice.addEventListener('touchstart', (e) => {
            // Touch handling logic would go here
          }, { passive: true });
          slice.addEventListener('touchend', handleInteraction, { passive: false });
        } else {
          // Desktop: use click
          slice.addEventListener('click', handleInteraction);
        }
      }
    }
  }, [getKaraokeController, isDesktop]);

  // Pause all playing karaoke
  const pauseAllKaraoke = useCallback(() => {
    karaokeControllersRef.current.forEach((ctrl) => {
      if (ctrl.pauseWithResume) {
        ctrl.pauseWithResume();
      } else {
        ctrl.pause();
      }
    });
  }, []);

  // Stop all karaoke
  const stopAllKaraoke = useCallback(() => {
    karaokeControllersRef.current.forEach((ctrl) => {
      ctrl.stop();
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      karaokeControllersRef.current.forEach((controller) => {
        controller.cleanup();
      });
      karaokeControllersRef.current.clear();
    };
  }, []);

  return {
    initializeKaraokeSlices,
    getKaraokeController,
    pauseAllKaraoke,
    stopAllKaraoke,
    // Desktop-specific: observe page for visibility
    observePage: (pageElement) => {
      if (isDesktop && intersectionObserverRef.current && pageElement) {
        intersectionObserverRef.current.observe(pageElement);
      }
    },
    // Desktop-specific: unobserve page
    unobservePage: (pageElement) => {
      if (isDesktop && intersectionObserverRef.current && pageElement) {
        intersectionObserverRef.current.unobserve(pageElement);
      }
    }
  };
};

