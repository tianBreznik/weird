import { useCallback, useRef } from 'react';
import { getAllFootnotes, isAcknowledgementsChapter, generateAcknowledgementsContent, renderFootnotesSection } from '../utils/footnotes';
import { sortChapters, determineChapterIndex, createEmptyPage, createEpigraphPage, createVideoPage, extractBackgroundVideos } from '../utils/paginationHelpers';
import { initializeNewPage, createPageFromElements } from '../utils/pageCreation';
import {
  processHTMLContent,
  buildChapterContentBlocks,
} from '../utils/contentProcessing';
import { handleKaraokeElement } from '../utils/karaokePagination';
import { handleFieldNotesElement, hasFieldNotesBlocks } from '../utils/fieldNotesPagination';
import { paginateElement, calculateRemainingHeight } from '../utils/elementPagination';
import { finalizePages, applyHyphenationToPages, restoreInitialPosition } from '../utils/postProcessing';
import { extractFootnotesFromContent, measureFootnotesHeight, applyParagraphStylesToContainer, isAtomicElement, splitTextAtSentenceBoundary, splitTextAtWordBoundary } from '../utils/paginationHelpers';
import { beginPackerRun } from '../utils/packPages';
import { MobilePackShell } from '../utils/mobilePackShell';
import { packMobileElement } from '../utils/mobilePackElement';
import { waitForMobilePackGeometry } from '../utils/mobilePackGeometry';

/**
 * Main hook for calculating pages from chapters.
 * Picks desktop (fixed sheet) or mobile (Kindle viewport) packer profile.
 */
export const usePagePagination = ({
  chapters,
  initialPosition,
  setPages,
  setKaraokeSources,
  setCurrentChapterIndex,
  setCurrentPageIndex,
  setIsInitializing,
  setSubchapterPageMap,
  /** Optional: force 'desktop' | 'mobile' (tests / tooling) */
  packerMode = null,
}) => {
  /** Stale async packs must not overwrite a newer run (mobile refresh race). */
  const packRunIdRef = useRef(0);

  const calculatePages = useCallback(async () => {
    if (!chapters || chapters.length === 0) {
      return;
    }

    const runId = packRunIdRef.current + 1;
    packRunIdRef.current = runId;

    const newPages = [];
    const sharedSubchapterStarts = [];
    const newKaraokeSources = {};

    // Sort chapters: isFirstPage first, then isCover, then regular chapters by order
    const sortedChapters = sortChapters(chapters);
    // First regular chapter = book page "1" intro (e.g. Welcome…) — keep its typography.
    const firstRegularChapterId = sortedChapters.find(
      (c) => !c.isFirstPage && !c.isCover
    )?.id;

    // Get all footnotes globally for numbering
    const allFootnotes = getAllFootnotes(chapters);
    // Create a map of footnote content to global number for quick lookup
    const footnoteContentToNumber = new Map();
    allFootnotes.forEach((fn) => {
      footnoteContentToNumber.set(fn.content.trim(), fn.globalNumber);
    });

    // Dual packer: fixed-sheet desktop vs full-viewport mobile policies + geometry
    const {
      policy,
      isDesktop,
      pageWidth,
      pageHeight,
      contentWidth,
      measure,
    } = beginPackerRun(packerMode);

    let mobileGeometry = null;
    if (!isDesktop && typeof document !== 'undefined') {
      mobileGeometry = await waitForMobilePackGeometry();
      if (!mobileGeometry) {
        return;
      }
    }

    if (runId !== packRunIdRef.current) return;

    const mobileShell = !isDesktop ? new MobilePackShell() : null;

    // Process chapters sequentially (now sorted: first page, cover, then regular)
    
    for (let chapterIdx = 0; chapterIdx < sortedChapters.length; chapterIdx++) {
      const chapter = sortedChapters[chapterIdx];
      
      // Determine chapterIndex: use order field, or special indices for first page/cover
      const chapterIndex = determineChapterIndex(chapter, chapterIdx);
      
      // Acknowledgements chapter: content is generated from all footnotes, not stored HTML
      const effectiveChapter = isAcknowledgementsChapter(chapter)
        ? { ...chapter, contentHtml: generateAcknowledgementsContent(allFootnotes), content: generateAcknowledgementsContent(allFootnotes) }
        : chapter;
      
      // Build content array: chapter content + all subchapter content
      const contentBlocks = buildChapterContentBlocks(effectiveChapter);
      
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
      const footnoteSpill = new Set(); // Footnote defs that did not fit the previous page band

      const startNewPage = (initialHeading = false) => {
        // Clear array in place instead of reassigning to preserve reference
        currentPageElements.length = 0;
        pageHasHeading = initialHeading;
        currentPageFootnotes.clear();
        measure.pageContent.innerHTML = '';
        measure.setHeading(initialHeading);
      };

      // When true, the next push is the "shared" page (chapter end + subchapter start).
      let nextPushIsSharedPage = false;

      const pushPage = (blockMeta) => {
        if (!currentPageElements.length) return;
        
        // Don't push pages that only have empty/whitespace/br-only content (renders as blank)
        const hasRealContent = currentPageElements.some(el => {
          const trimmed = el.trim();
          if (trimmed.length === 0) return false;
          const temp = document.createElement('div');
          temp.innerHTML = trimmed;
          const text = (temp.textContent || '').trim();
          return text.length > 0;
        });
        if (!hasRealContent) return;

        // Shared page: chapter end + subchapter start on one physical page.
        // We keep chapter framing, but also mark the page as a subchapter start
        // so TOCs can jump directly to it. That means the page will belong to
        // both the chapter (via chapterId) and the subchapter (via subchapterId).
        const isSharedSubchapterStart = nextPushIsSharedPage && blockMeta.type === 'subchapter';
        const metaToUse = isSharedSubchapterStart
          ? {
              // Inherit chapter-level visual settings from the first block
              ...contentBlocks[0],
              // But treat this page as the start of the subchapter as well
              subchapterId: blockMeta.subchapterId,
              type: 'subchapter',
              title: blockMeta.title,
            }
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
          hasFieldNotes: chapterHasFieldNotes,
          footnoteSpill,
          preserveTypography:
            !!chapter.isFirstPage ||
            !!chapter.isCover ||
            chapter.id === firstRegularChapterId,
        });
        
        if (newPage) {
          newPages.push(newPage);

          // If this was a shared page where subchapter content begins, record it
          // as the subchapter's first page without changing the page metadata.
          if (isSharedSubchapterStart && blockMeta.subchapterId) {
            sharedSubchapterStarts.push({
              subchapterId: blockMeta.subchapterId,
              chapterIndex: newPage.chapterIndex,
              pageIndex: newPage.pageIndex,
            });
          }

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
        
        // Process HTML content: extract videos, replace dashes, prepare for pagination.
        // Cover, special first page, and the first regular (intro) chapter keep designed type.
        const preserveTypography =
          !!chapter.isFirstPage ||
          !!chapter.isCover ||
          chapter.id === firstRegularChapterId;
        const { elements, videoElements } = await processHTMLContent(block.content, isDesktop, {
          standardizeTypography: !isDesktop && !preserveTypography,
        });

        if (mobileShell) {
          mobileShell.syncSizeFromLiveReader();
          const tightReserve =
            (chapter.isFirstPage && chapterPageIndex === 0) ||
            (preserveTypography &&
              !chapter.isCover &&
              !chapter.isFirstPage &&
              chapterPageIndex === 0);
          mobileShell.setPageStyle({
            preserveTypography,
            tightReserve,
            fontFamily: block.fontFamily,
          });
        }
        
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
          
          // Update heading state for page metadata (hasHeading). Do NOT call measure.setHeading(true)
          // here — it can reduce available height in the measurement container (esp. mobile) and cause
          // content to break early when a subchapter is on the page. Keep measurement consistent.
          if (isSubchapterTitle && !pageHasHeading) {
            pageHasHeading = true;
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

          const elementFootnotes = extractFootnotesFromContent(
            element.outerHTML,
            footnoteContentToNumber
          );

          const result = !isDesktop
            ? packMobileElement({
                shell: mobileShell,
                element,
                currentPageElements,
                currentPageFootnotes,
                elementFootnotes,
                footnoteContentToNumber,
                block,
                pushPage,
                startNewPage,
              })
            : paginateElement({
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
                startNewPage,
                policy,
                preserveTypography,
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
            let remainingContentHeight = 0;
            let contentAvailableHeight = 1;
            if (mobileShell) {
              const { content, slack } = mobileShell.measureBlocksHeight(
                currentPageElements
              );
              contentAvailableHeight = mobileShell.contentLimitPx || 1;
              remainingContentHeight = Math.max(0, slack);
            } else {
              const isStandaloneFirstPage =
                chapter.isFirstPage && chapterPageIndex === 0;
              const footnotesHeight =
                currentPageFootnotes.size > 0
                  ? measureFootnotesHeight(
                      currentPageFootnotes,
                      measure.body,
                      allFootnotes,
                      isDesktop,
                      pageWidth
                    )
                  : 0;
              contentAvailableHeight = measure.getAvailableHeight(
                footnotesHeight,
                isStandaloneFirstPage
              );
              ({ remainingContentHeight } = calculateRemainingHeight({
                currentPageElements,
                contentAvailableHeight,
                contentWidth,
                isDesktop,
                measure,
                applyParagraphStylesToContainer,
              }));
            }
            const freePercent =
              contentAvailableHeight > 0
                ? remainingContentHeight / contentAvailableHeight
                : 0;
            skipPushForFlow = freePercent >= policy.subchapterFlowFreeRatio;
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

      // Flush any remaining spilled footnote defs onto the chapter's last page (PDF footer).
      if (footnoteSpill.size > 0) {
        for (let i = newPages.length - 1; i >= 0; i -= 1) {
          if (newPages[i].chapterId !== chapter.id) continue;
          const spilledFns = Array.from(footnoteSpill)
            .sort((a, b) => a - b)
            .map((num) => allFootnotes.find((fn) => fn.globalNumber === num))
            .filter(Boolean);
          if (spilledFns.length) {
            const existing = newPages[i].footnotes || [];
            const merged = [...existing];
            spilledFns.forEach((fn) => {
              if (!merged.some((e) => e.globalNumber === fn.globalNumber)) merged.push(fn);
            });
            newPages[i] = {
              ...newPages[i],
              footnotes: merged,
              content: `${newPages[i].content}${renderFootnotesSection(spilledFns)}`,
            };
          }
          footnoteSpill.clear();
          break;
        }
      }
    }

    mobileShell?.destroy();

    // Cleanup measurement container
    measure.destroy();

    // Finalize pages: calculate totalPages and verify order
    const finalizedPages = finalizePages(newPages);

    // Build a lookup from subchapterId -> first page { chapterIndex, pageIndex }.
    // This is used by both desktop and mobile TOCs for precise subchapter jumps.
    if (typeof setSubchapterPageMap === 'function') {
      const map = {};

      // 1) Shared pages where subchapter content starts on a page that was
      //    labeled as a chapter page (recorded during pagination).
      sharedSubchapterStarts.forEach(({ subchapterId, chapterIndex, pageIndex }) => {
        if (!map[subchapterId]) {
          map[subchapterId] = { chapterIndex, pageIndex };
        }
      });

      // 2) Pages that are already tagged with a subchapterId.
      for (const page of finalizedPages) {
        if (page.subchapterId && map[page.subchapterId] == null) {
          map[page.subchapterId] = {
            chapterIndex: page.chapterIndex,
            pageIndex: page.pageIndex,
          };
        }
      }

      // 3) For any subchapter still missing in the map, derive its first page
      //    from the finalized pages. This never mutates pages, only metadata.
      chapters.forEach((chapter) => {
        if (!chapter.children || chapter.children.length === 0) return;

        chapter.children.forEach((sub) => {
          if (map[sub.id]) return;

          // Look for any page that clearly belongs to this subchapter.
          const candidate = finalizedPages
            .filter(
              (p) =>
                p.chapterId === chapter.id &&
                p.subchapterId === sub.id
            )
            .sort((a, b) => a.pageIndex - b.pageIndex)[0];

          if (candidate) {
            map[sub.id] = {
              chapterIndex: candidate.chapterIndex,
              pageIndex: candidate.pageIndex,
            };
          }
        });
      });

      setSubchapterPageMap(map);
    }

    if (runId !== packRunIdRef.current) return;

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
  }, [chapters, initialPosition, setPages, setKaraokeSources, setCurrentChapterIndex, setCurrentPageIndex, setIsInitializing, setSubchapterPageMap, packerMode]);

  return calculatePages;
};
