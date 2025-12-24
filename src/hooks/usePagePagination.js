import { useCallback } from 'react';
import { getAllFootnotes } from '../utils/footnotes';
import { createMeasureContainer } from '../utils/paginationHelpers';
import { applyHyphenationToHTML } from '../utils/paginationHelpers';
import { sortChapters, determineChapterIndex, createEmptyPage, createEpigraphPage, createVideoPage, extractBackgroundVideos } from '../utils/paginationHelpers';
import { initializeNewPage, createPageFromElements } from '../utils/pageCreation';
import { processHTMLContent, buildChapterContentBlocks } from '../utils/contentProcessing';
import { handleKaraokeElement } from '../utils/karaokePagination';
import { paginateElement } from '../utils/elementPagination';
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
    console.log('[PagePagination] Starting page calculation', { chaptersCount: chapters?.length });
    if (!chapters || chapters.length === 0) {
      console.warn('[PagePagination] No chapters provided');
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
    
    // Desktop PDF page dimensions: 800px width, 1000px min-height
    // Mobile uses viewport dimensions
    const pageWidth = isDesktop ? 800 : undefined; // undefined = use CSS min(680px, 96vw)
    const pageHeight = isDesktop ? 1000 : viewportHeight;
    
    // Create measurement container that exactly matches rendered page structure
    const measure = createMeasureContainer(isDesktop, pageWidth, pageHeight);

    // Desktop font size and line height (used in applyParagraphStylesToContainer)
    const desktopFontSize = isDesktop ? '1.3rem' : '1.3rem';
    const desktopLineHeight = isDesktop ? '1.35' : '1.35';
    const contentWidth = isDesktop ? pageWidth : undefined;

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
      const chapterIndex = determineChapterIndex(chapter, chapterIdx);
      
      console.log('[PageOrder] Processing chapter:', {
        chapterId: chapter.id,
        title: chapter.title,
        isFirstPage: chapter.isFirstPage,
        isCover: chapter.isCover,
        chapterIndex: chapterIndex,
        hasContent: !!(chapter.contentHtml || chapter.content)
      });
      
      // Build content array: chapter content + all subchapter content
      const contentBlocks = buildChapterContentBlocks(chapter);

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
          const emptyPage = createEmptyPage(chapter, chapterIndex, 0);
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
      const backgroundVideosByPage = extractBackgroundVideos(contentBlocks);

      let chapterPageIndex = 0;
      let currentPageElements = [];
      let pageHasHeading = false;
      let currentPageFootnotes = new Set(); // Track footnote numbers on current page

      const startNewPage = (initialHeading = false) => {
        currentPageElements = [];
        pageHasHeading = initialHeading;
        currentPageFootnotes = new Set();
        measure.pageContent.innerHTML = '';
        measure.setHeading(initialHeading);
      };

      const pushPage = (blockMeta) => {
        if (!currentPageElements.length) return;
        
        const newPage = createPageFromElements({
          elements: currentPageElements,
          blockMeta,
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
          pageWidth
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
        
        console.log('[PageOrder] Processing block content:', {
          blockType: block.type,
          chapterId: block.chapterId,
          subchapterId: block.subchapterId,
          elementsCount: elements.length,
          elementTags: elements.map(el => el.tagName),
          isCover: chapter.isCover,
          isFirstPage: chapter.isFirstPage
        });

        // Main pagination loop: process each element
        for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
          const element = elements[elementIndex];
          const isHeadingElement = /^H[1-6]$/i.test(element.tagName || '');
          const isSubchapterTitle = /^H[4-6]$/i.test(element.tagName || '');
          
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
              pushPage,
              startNewPage
            });
            
            if (handled) {
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
        if (currentPageElements.length > 0) {
          pushPage(block);
        }
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
