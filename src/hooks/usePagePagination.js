import { useCallback } from 'react';
import { getAllFootnotes } from '../utils/footnotes';
import { createMeasureContainer } from '../utils/paginationHelpers';
import { applyHyphenationToHTML } from '../utils/paginationHelpers';
import { sortChapters, determineChapterIndex, createEmptyPage, createEpigraphPage, createVideoPage, extractBackgroundVideos } from '../utils/paginationHelpers';
import { initializeNewPage, createPageFromElements } from '../utils/pageCreation';
import { processHTMLContent, buildChapterContentBlocks } from '../utils/contentProcessing';
import { handleKaraokeElement } from '../utils/karaokePagination';
import { handleFieldNotesElement, hasFieldNotesBlocks } from '../utils/fieldNotesPagination';
import { paginateElement, calculateRemainingHeight } from '../utils/elementPagination';
import { finalizePages, applyHyphenationToPages, restoreInitialPosition } from '../utils/postProcessing';
import { extractFootnotesFromContent, measureFootnotesHeight, applyParagraphStylesToContainer, isAtomicElement, splitTextAtSentenceBoundary, splitTextAtWordBoundary } from '../utils/paginationHelpers';

/**
 * Main hook for calculating pages from chapters
 * Orchestrates all pagination logic using extracted utility functions
 */
export const usePagePagination = ({
  chapters,
  initialPosition,
  setPages,
  setKaraokeSources,
  setCurrentChapterIndex,
  setCurrentPageIndex,
  setIsInitializing
}) => {
  const calculatePages = useCallback(async () => {
    if (!chapters || chapters.length === 0) {
      return;
    }

    // Get viewport dimensions for mobile
    const viewport = typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport
      : null;
    const viewportHeight = viewport ? viewport.height : (typeof window !== 'undefined' ? window.innerHeight : 0);
    
    const newPages = [];
    const newKaraokeSources = {};

    // Sort chapters: isFirstPage first, then isCover, then regular chapters by order
    const sortedChapters = sortChapters(chapters);

    // Get all footnotes globally for numbering
    const allFootnotes = getAllFootnotes(chapters);
    // Create a map of footnote content to global number for quick lookup
    const footnoteContentToNumber = new Map();
    allFootnotes.forEach((fn) => {
      footnoteContentToNumber.set(fn.content.trim(), fn.globalNumber);
    });

    // Determine if we're calculating for desktop PDF or mobile
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    
    // Desktop PDF page dimensions: 
    // - Width: 450px (max-width for two-page spreads, matches CSS max-width: 450px)
    // - Height: 636px (max-height for two-page spreads, matches CSS max-height: 636px)
    //   Note: Single-page spreads use 848px height, but we use the smaller height (636px) 
    //   for safety to ensure content fits in all pages. Padding (3rem top/bottom = 48px each)
    //   is handled by createMeasureContainer which mirrors the actual page structure.
    // Mobile uses viewport dimensions
    const pageWidth = isDesktop ? 450 : undefined; // undefined = use CSS min(680px, 96vw)
    const pageHeight = isDesktop ? 636 : viewportHeight; // Match CSS max-height: 636px
    
    // Create measurement container that exactly matches rendered page structure
    const measure = createMeasureContainer(isDesktop, pageWidth, pageHeight);

    // Desktop font size and line height (used in applyParagraphStylesToContainer)
    // Desktop PDF uses 1.35rem (matches PDFViewer.css), mobile uses 1.3rem
    const desktopFontSize = isDesktop ? '1.35rem' : '1.3rem';
    // Desktop PDF uses 1.62 line-height (matches PDFViewer.css), mobile uses 1.35
    const desktopLineHeight = isDesktop ? '1.62' : '1.35';
    // Desktop: content width = page width - left padding - right padding
    // .page-body has padding: 3rem 2.5rem, so 2.5rem ≈ 40px per side
    // Content width = 450px - 40px - 40px = 370px
    const contentWidth = isDesktop ? (pageWidth - 40 - 40) : undefined;

    // Process chapters sequentially (now sorted: first page, cover, then regular)
    
    for (let chapterIdx = 0; chapterIdx < sortedChapters.length; chapterIdx++) {
      const chapter = sortedChapters[chapterIdx];
      
      // Determine chapterIndex: use order field, or special indices for first page/cover
      const chapterIndex = determineChapterIndex(chapter, chapterIdx);
      
      // Build content array: chapter content + all subchapter content
      const contentBlocks = buildChapterContentBlocks(chapter);
      
      // Check if chapter has field notes blocks (to hide title)
      const chapterHasFieldNotes = contentBlocks.some(block => 
        hasFieldNotesBlocks(block.content)
      );

      // Special pages (first page, cover) should always create at least one page, even if empty
      // Regular chapters with no content are skipped
      if (contentBlocks.length === 0) {
        if (chapter.isFirstPage || chapter.isCover) {
          // Create an empty page for special pages
          const emptyPage = createEmptyPage(chapter, chapterIndex, 0, chapterHasFieldNotes);
          newPages.push(emptyPage);
        }
        continue;
      }

      // First, collect all background videos with their targetPage from all blocks
      const backgroundVideosByPage = extractBackgroundVideos(contentBlocks);

      let chapterPageIndex = 0;
      let currentPageElements = [];
      let pageHasHeading = false;
      let currentPageFootnotes = new Set(); // Track footnote numbers on current page

      const startNewPage = (initialHeading = false) => {
        // Clear array in place instead of reassigning to preserve reference
        currentPageElements.length = 0;
        pageHasHeading = initialHeading;
        currentPageFootnotes.clear();
        measure.pageContent.innerHTML = '';
        measure.setHeading(initialHeading);
      };

      // When true, the next push is the "shared" page (chapter end + subchapter start);
      // we label it as the chapter's last page for TOC (subchapter starts on the next page).
      let nextPushIsSharedPage = false;

      const pushPage = (blockMeta) => {
        if (!currentPageElements.length) return;
        
        // For field-notes-only chapters, we should NOT be pushing regular content pages
        // This is a safeguard - if chapter has field notes and we're trying to push,
        // it means there's mixed content (which is fine), but we should be careful
        if (chapterHasFieldNotes) {
          // Check if elements are actually non-empty (not just whitespace)
          const hasRealContent = currentPageElements.some(el => {
            const trimmed = el.trim();
            // Check if it's not just empty tags or whitespace
            return trimmed.length > 0 && !/^<[^>]+>\s*<\/[^>]+>$/i.test(trimmed);
          });
          if (!hasRealContent) {
            // No real content, don't push empty page
            return;
          }
        }

        // Shared page: chapter end + subchapter start on one page → label as chapter's last page
        // so TOC shows chapter ending here and subchapter starting on the next page.
        const metaToUse = (nextPushIsSharedPage && blockMeta.type === 'subchapter')
          ? contentBlocks[0]
          : blockMeta;
        if (nextPushIsSharedPage && blockMeta.type === 'subchapter') {
          nextPushIsSharedPage = false;
        }
        
        const newPage = createPageFromElements({
          elements: currentPageElements,
          blockMeta: metaToUse,
          chapter,
          chapterIndex,
          chapterPageIndex,
          pageHasHeading,
          currentPageFootnotes,
          footnoteContentToNumber,
          allFootnotes,
          measure,
          backgroundVideosByPage,
          isDesktop,
          pageWidth,
          hasFieldNotes: chapterHasFieldNotes
        });
        
        if (newPage) {
          newPages.push(newPage);
          chapterPageIndex += 1;
          startNewPage(false);
        }
      };

      startNewPage(false);

      for (let blockIdx = 0; blockIdx < contentBlocks.length; blockIdx++) {
        const block = contentBlocks[blockIdx];
        
        // Create epigraph page if epigraph exists
        const epigraphPage = createEpigraphPage(block, chapter, chapterIndex, chapterPageIndex);
        if (epigraphPage) {
          newPages.push(epigraphPage);
          chapterPageIndex += 1;
        }
        
        // Process HTML content: extract videos, replace dashes, prepare for pagination
        const { elements, videoElements } = await processHTMLContent(block.content, isDesktop);
        
        // Create video pages for blank-page videos
        videoElements.forEach((video) => {
          const videoPage = createVideoPage(video, chapter, chapterIndex, chapterPageIndex, block);
          newPages.push(videoPage);
          chapterPageIndex += 1;
        });

        // Main pagination loop: process each element
        let lastElementWasFieldNotes = false;
        for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
          const element = elements[elementIndex];
          const isHeadingElement = /^H[1-6]$/i.test(element.tagName || '');
          const isSubchapterTitle = /^H[4-6]$/i.test(element.tagName || '');
          const isChapterTitle = /^H[1-3]$/i.test(element.tagName || '');
          
          // Skip heading elements if chapter has field notes (title should be hidden)
          if (chapterHasFieldNotes && isHeadingElement) {
            continue; // Don't reset flag on skipped elements
          }
          
          // Skip heading elements if hideTitle is enabled
          // For chapters, skip h1-h3; for subchapters, skip h4-h6
          if (block.hideTitle) {
            if ((block.type === 'chapter' && isChapterTitle) || 
                (block.type === 'subchapter' && isSubchapterTitle)) {
              continue; // Don't reset flag on skipped elements
            }
          }
          
          // Reset flag only when we actually process a non-field-notes element
          // (We'll set it to true if this element is field notes)
          lastElementWasFieldNotes = false;
          
          // Update heading state if needed (affects available height)
          if (isSubchapterTitle && !pageHasHeading) {
            pageHasHeading = true;
            measure.setHeading(true);
            // Force a reflow to ensure CSS changes take effect before measurement
            measure.body.offsetHeight;
          }

          // Handle background video elements - skip them from content
          if (element.tagName === 'VIDEO') {
            const videoMode = element.getAttribute('data-video-mode') || 'blank-page';
            if (videoMode === 'background') {
              continue;
            }
          }

          // Handle karaoke elements (they manage their own pagination)
          if (
            element.classList?.contains('karaoke-object') ||
            element.hasAttribute?.('data-karaoke') ||
            element.querySelector?.('.karaoke-object')
          ) {
            // Create wrapper functions that always use the current array references
            // This ensures that when startNewPage creates a new array, handleKaraokeElement
            // will use the new array reference on subsequent iterations
            const getCurrentPageElements = () => currentPageElements;
            const getCurrentPageFootnotes = () => currentPageFootnotes;
            const addToCurrentPageElements = (html) => {
              currentPageElements.push(html);
            };
            const addToCurrentPageFootnotes = (num) => {
              currentPageFootnotes.add(num);
            };
            
            const handled = handleKaraokeElement({
              element,
              blockMeta: block,
              chapterIdx,
              newKaraokeSources,
              getCurrentPageFootnotes,
              getCurrentPageElements,
              addToCurrentPageElements,
              addToCurrentPageFootnotes,
              measure,
              footnoteContentToNumber,
              allFootnotes,
              isDesktop,
              pageWidth,
              pageHeight,
              contentWidth,
              pushPage,
              startNewPage
            });
            
            if (handled) {
              continue;
            }
          }

          // Handle field notes elements (one page per block)
          if (element.hasAttribute('data-field-notes-block')) {
            // Save current state before processing field notes
            const hadContentBefore = currentPageElements.length > 0;
            
            const fieldNotesPage = handleFieldNotesElement({
              element,
              blockMeta: block,
              chapter,
              chapterIndex,
              chapterPageIndex,
              pushPage: () => pushPage(block),
              startNewPage: () => startNewPage(false),
              getCurrentPageElements: () => currentPageElements, // Pass function to check current elements
              chapterHasFieldNotes: chapterHasFieldNotes // Pass flag to know if chapter only has field notes
            });
            
            if (fieldNotesPage) {
              newPages.push(fieldNotesPage);
              chapterPageIndex += 1;
              // handleFieldNotesElement already called startNewPage, which cleared currentPageElements
              // CRITICAL: Ensure it stays empty to prevent empty page at end
              // Also ensure pageHasHeading is reset since field notes pages don't have headings
              currentPageElements.length = 0;
              currentPageFootnotes.clear();
              pageHasHeading = false; // Reset heading state
              lastElementWasFieldNotes = true; // Mark that last element was field notes
              continue;
            }
          }

          // Paginate regular elements
          // Note: paginateElement mutates currentPageElements and currentPageFootnotes directly
          const result = paginateElement({
            element,
            elementIndex,
            elementsLength: elements.length,
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
          });
          
          // Update state from result
          if (result && result.pageHasHeading !== undefined) {
            pageHasHeading = result.pageHasHeading;
          }
        }

        // Finalize last page of block
        // For chapters with ONLY field notes, we should ONLY have field notes pages (no regular content pages)
        // CRITICAL: If chapter has field notes and last element was field notes, NEVER push a final page
        if (lastElementWasFieldNotes) {
          // Field notes element already created its page, ensure no leftover content
          currentPageElements.length = 0;
          currentPageFootnotes.clear();
          // Don't push - field notes already created its own page
        } else if (chapterHasFieldNotes) {
          // Chapter has field notes
          // Only push if there's actual content AND it's not empty
          // But be very careful - if we only have field notes, currentPageElements should be empty
          if (currentPageElements.length > 0) {
            // There's regular content mixed with field notes, so push it
            pushPage(block);
          }
          // If empty, don't push - field notes pages were already added individually
        } else if (currentPageElements.length > 0) {
          // Regular chapter without field notes - push if there's content
          // Unless: next block is subchapter AND >= 45% of page is free - flow subchapter onto same page
          const nextBlock = contentBlocks[blockIdx + 1];
          const canFlowSubchapter = block.type === 'chapter' && nextBlock?.type === 'subchapter';
          let skipPushForFlow = false;
          if (canFlowSubchapter) {
            const isStandaloneFirstPage = chapter.isFirstPage && chapterPageIndex === 0;
            const footnotesHeight = currentPageFootnotes.size > 0
              ? measureFootnotesHeight(currentPageFootnotes, measure.body, allFootnotes, isDesktop, pageWidth)
              : 0;
            const contentAvailableHeight = measure.getAvailableHeight(footnotesHeight, isStandaloneFirstPage);
            const { remainingContentHeight } = calculateRemainingHeight({
              currentPageElements,
              contentAvailableHeight,
              contentWidth,
              isDesktop,
              measure,
              applyParagraphStylesToContainer
            });
            const freePercent = contentAvailableHeight > 0 ? remainingContentHeight / contentAvailableHeight : 0;
            skipPushForFlow = freePercent >= 0.45;
          }
          if (!skipPushForFlow) {
            pushPage(block);
          } else {
            // Next push will be the shared page (chapter end + subchapter start); label it as chapter's last page.
            nextPushIsSharedPage = true;
          }
        }
        // If currentPageElements is empty and last wasn't field notes and chapter doesn't have field notes,
        // that's fine - nothing to push (empty chapter)
      }
    }

    // Cleanup measurement container
    measure.destroy();

    // Finalize pages: calculate totalPages and verify order
    const finalizedPages = finalizePages(newPages);
    
    // Set pages immediately for faster initial render
    setPages(finalizedPages);
    setKaraokeSources(newKaraokeSources);
    
    // Apply hyphenation to all pages asynchronously after initial render
    applyHyphenationToPages(finalizedPages, setPages);
    
    // Restore initial position immediately when pages are calculated
    restoreInitialPosition(finalizedPages, initialPosition, {
      setCurrentChapterIndex,
      setCurrentPageIndex,
      setIsInitializing
    });
  }, [chapters, initialPosition, setPages, setKaraokeSources, setCurrentChapterIndex, setCurrentPageIndex, setIsInitializing]);

  return calculatePages;
};
