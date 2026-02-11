import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { PDFViewer } from './PDFViewer';
import { PDFTopBar } from './PDFTopBar';
import { ReaderTopBar } from './ReaderTopBar';
import { DesktopTOC } from './DesktopTOC';
import { useKaraokePlayer } from '../hooks/useKaraokePlayer';
import paperTexture from '../assets/paper-7-origami-TEX.png';
import borderFrame from '../assets/smallerborder.png';

/**
 * DesktopPageReader - Desktop-specific page reader component
 * Renders all pages in a scrollable two-page spread PDF-style viewer
 */
export const DesktopPageReader = ({ 
  pages, 
  karaokeSources = {},
  chapters = [],
  currentChapterIndex,
  currentPageIndex,
  currentSubchapterId,
  onJumpToPage,
  onEditChapter,
  onAddSubchapter,
  onDeleteChapter,
  onEditSubchapter,
  onDeleteSubchapter,
  onReorderChapters,
}) => {
  // IMPORTANT: All hooks must be called before any conditional returns
  // This ensures the hook order remains consistent across renders
  const { initializeKaraokeSlices, observePage, unobservePage } = useKaraokePlayer({
    isDesktop: true,
    karaokeSources
  });
  
  const initializedPagesRef = useRef(new Set());
  const [mostVisiblePage, setMostVisiblePage] = useState(null);
  const [mostVisiblePageIndex, setMostVisiblePageIndex] = useState(null);
  // Track ALL pages (including first/cover/TOC) for PDFTopBar navigation
  const [topBarPageIndex, setTopBarPageIndex] = useState(0);
  // Use refs to track previous values to prevent unnecessary state updates
  const prevTopBarPageIndexRef = useRef(0);
  const prevMostVisiblePageRef = useRef(null);
  const prevMostVisiblePageIndexRef = useRef(null);

  // Zoom level for desktop PDF pages (1 = 100%)
  const [zoom, setZoom] = useState(1);
  const MIN_ZOOM = 0.7;
  const MAX_ZOOM = 1.6;
  const ZOOM_STEP = 0.1;
  
  // Create pagesWithTOC array early (before hooks that depend on it)
  const pagesWithTOC = useMemo(() => {
    const firstPageIndex = pages.findIndex(p => p.isFirstPage);
    const coverPageIndex = pages.findIndex(p => p.isCover && !p.isFirstPage);
    
    const result = [];
    pages.forEach((page, index) => {
      result.push(page);
      
      // Insert TOC after cover page (if exists) or after first page (if no cover)
      if (coverPageIndex >= 0 && index === coverPageIndex) {
        result.push({
          isTOC: true,
          chapterIndex: -3,
          pageIndex: -1,
        });
      } else if (coverPageIndex < 0 && firstPageIndex >= 0 && index === firstPageIndex) {
        result.push({
          isTOC: true,
          chapterIndex: -3,
          pageIndex: -1,
        });
      }
    });
    
    // If no first or cover pages exist, insert TOC at the beginning
    if (firstPageIndex < 0 && coverPageIndex < 0) {
      result.unshift({
        isTOC: true,
        chapterIndex: -3,
        pageIndex: -1,
      });
    }
    
    return result;
  }, [pages]);
  
  // Cache page element references to reduce DOM queries
  const pageElementCacheRef = useRef(new Map());
  
  // Track most centered/visible page for progress bar
  useEffect(() => {
    if (pagesWithTOC.length === 0) return;
    
    // Find most centered page based on scroll position
    let rafId = null;
    const handleScroll = () => {
      // Throttle with requestAnimationFrame for better performance
      if (rafId !== null) return;
      
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pagesWithTOC.length === 0) return;
        
        // Calculate which page is most centered in viewport
        const viewportCenter = window.innerHeight / 2;
        let minDistance = Infinity;
        let mostCenteredPage = null;
        
        let mostCenteredIndex = null;
        // Track ALL pages for top bar (including first/cover/TOC)
        let mostCenteredIndexForTopBar = null;
        let minDistanceForTopBar = Infinity;
        
        pagesWithTOC.forEach((page, index) => {
          // Use cached element reference if available; avoid using detached nodes for rect
          let pageElement = pageElementCacheRef.current.get(index);
          if (pageElement && !document.contains(pageElement)) {
            pageElementCacheRef.current.delete(index);
            pageElement = null;
          }
          if (!pageElement) {
            pageElement = document.getElementById(`pdf-page-${index}`);
            if (pageElement) {
              pageElementCacheRef.current.set(index, pageElement);
            }
          }
          if (!pageElement) return;
          
          const pageSheet = pageElement.querySelector('.page-sheet');
          if (!pageSheet || !document.contains(pageSheet)) return;
          
          const rect = pageSheet.getBoundingClientRect();
          
          // Check if page is visible in viewport (at least partially)
          if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
            const pageCenter = rect.top + rect.height / 2;
            const distanceFromCenter = Math.abs(pageCenter - viewportCenter);
            
            // Calculate how much of the page is visible
            const visibleTop = Math.max(0, rect.top);
            const visibleBottom = Math.min(window.innerHeight, rect.bottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            const visibilityRatio = visibleHeight / Math.min(rect.height, window.innerHeight);
            
            // Track ALL pages for top bar (including first/cover/TOC)
            if (visibilityRatio >= 0.3 && distanceFromCenter < minDistanceForTopBar) {
              minDistanceForTopBar = distanceFromCenter;
              mostCenteredIndexForTopBar = index;
            }
            
            // Only consider regular pages (not first, cover, or TOC) for progress bar
            if (!page.isFirstPage && !page.isCover && !page.isTOC) {
              if (visibilityRatio >= 0.3 && distanceFromCenter < minDistance) {
                minDistance = distanceFromCenter;
                mostCenteredPage = page;
                mostCenteredIndex = index;
              }
            }
          }
        });
      
      // Update top bar page index (ALL pages) - only if it changed to prevent unnecessary re-renders
      if (mostCenteredIndexForTopBar !== null && mostCenteredIndexForTopBar !== prevTopBarPageIndexRef.current) {
        prevTopBarPageIndexRef.current = mostCenteredIndexForTopBar;
        setTopBarPageIndex(mostCenteredIndexForTopBar);
      }
      
      // Only update progress bar tracking if it's a regular page (not first, cover, or TOC)
      // Only update if the value actually changed to prevent unnecessary re-renders
      if (mostCenteredPage && !mostCenteredPage.isFirstPage && !mostCenteredPage.isCover && !mostCenteredPage.isTOC) {
        if (mostCenteredPage !== prevMostVisiblePageRef.current || mostCenteredIndex !== prevMostVisiblePageIndexRef.current) {
          prevMostVisiblePageRef.current = mostCenteredPage;
          prevMostVisiblePageIndexRef.current = mostCenteredIndex;
          setMostVisiblePage(mostCenteredPage);
          setMostVisiblePageIndex(mostCenteredIndex);
        }
      } else {
        if (prevMostVisiblePageRef.current !== null || prevMostVisiblePageIndexRef.current !== null) {
          prevMostVisiblePageRef.current = null;
          prevMostVisiblePageIndexRef.current = null;
          setMostVisiblePage(null);
          setMostVisiblePageIndex(null);
        }
      }
      });
    };
    
    const scrollContainer = document.querySelector('.pdf-viewer');
    if (scrollContainer) {
      handleScroll();

      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

      // One delayed check after scroll settles (no continuous interval — was causing lag over time)
      let scrollEndTimerId = null;
      const scheduleScrollEndCheck = () => {
        if (scrollEndTimerId) clearTimeout(scrollEndTimerId);
        scrollEndTimerId = setTimeout(() => {
          scrollEndTimerId = null;
          handleScroll();
        }, 150);
      };
      scrollContainer.addEventListener('scroll', scheduleScrollEndCheck, { passive: true });

      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (scrollEndTimerId) clearTimeout(scrollEndTimerId);
        if (scrollContainer) {
          scrollContainer.removeEventListener('scroll', handleScroll);
          scrollContainer.removeEventListener('scroll', scheduleScrollEndCheck);
        }
        pageElementCacheRef.current.clear();
      };
    }
  }, [pagesWithTOC]);
  
  // Calculate current page number (1-based) from topBarPageIndex (tracks ALL pages)
  const currentPageNumber = useMemo(() => {
    return topBarPageIndex + 1; // Convert 0-based index to 1-based page number
  }, [topBarPageIndex]);
  
  // Calculate chapter progress based on most visible page
  const chapterProgress = useMemo(() => {
    if (!mostVisiblePage || mostVisiblePage.isFirstPage || mostVisiblePage.isCover || mostVisiblePage.isTOC) {
      return 0;
    }
    
    const currentChapterPages = pagesWithTOC.filter(p => 
      p.chapterIndex === mostVisiblePage.chapterIndex && 
      !p.isFirstPage && 
      !p.isCover &&
      !p.isTOC
    );
    
    const currentPageInChapter = currentChapterPages.findIndex(p => 
      p.pageIndex === mostVisiblePage.pageIndex && 
      p.chapterIndex === mostVisiblePage.chapterIndex
    );
    
    const totalPagesInChapter = currentChapterPages.length;
    return totalPagesInChapter > 0 
      ? (currentPageInChapter + 1) / totalPagesInChapter 
      : 0;
  }, [mostVisiblePage, pagesWithTOC]);
  
  // Handler to scroll to a specific page number
  const handlePageChange = (pageNum) => {
    const pageIndex = pageNum - 1;
    if (pageIndex >= 0 && pageIndex < pagesWithTOC.length) {
      const pageElement = document.getElementById(`pdf-page-${pageIndex}`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };
  
  // Handler for previous page
  const handlePreviousPage = () => {
    if (topBarPageIndex > 0) {
      const prevPageIndex = topBarPageIndex - 1;
      const pageElement = document.getElementById(`pdf-page-${prevPageIndex}`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };
  
  // Handler for next page
  const handleNextPage = () => {
    if (topBarPageIndex < pagesWithTOC.length - 1) {
      const nextPageIndex = topBarPageIndex + 1;
      const pageElement = document.getElementById(`pdf-page-${nextPageIndex}`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };
  
  const handleZoomIn = () => {
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, current + ZOOM_STEP);
      return Number(next.toFixed(2));
    });
  };
  
  const handleZoomOut = () => {
    setZoom((current) => {
      const next = Math.max(MIN_ZOOM, current - ZOOM_STEP);
      return Number(next.toFixed(2));
    });
  };

  const handleZoomChange = (nextZoom) => {
    if (typeof nextZoom !== 'number' || Number.isNaN(nextZoom)) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setZoom(Number(clamped.toFixed(2)));
  };
  
  // Handler for download (placeholder for now)
  const handleDownload = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    const viewer = document.querySelector('.pdf-viewer-container');
    if (!viewer) return;

    // Find all page-sheet elements in order
    const pageSheets = Array.from(
      viewer.querySelectorAll('.pdf-page-wrapper .page-sheet')
    );
    if (pageSheets.length === 0) return;

    // Use the first page to establish PDF dimensions (in pixels)
    const firstRect = pageSheets[0].getBoundingClientRect();
    const pdf = new jsPDF({
      orientation: firstRect.width >= firstRect.height ? 'l' : 'p',
      unit: 'px',
      format: [firstRect.width, firstRect.height],
    });

    // Helper to capture one page and add to PDF
    const capturePage = async (pageEl, isFirst) => {
      const canvas = await html2canvas(pageEl, {
        scale: 2, // higher resolution for sharper text
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      if (!isFirst) {
        pdf.addPage();
      }
      pdf.addImage(imgData, 'PNG', 0, 0, firstRect.width, firstRect.height);
    };

    (async () => {
      // Show footnote blocks on desktop so they appear in the PDF (they're normally hidden, hover-only)
      document.body.setAttribute('data-pdf-export', 'true');
      await new Promise((r) => requestAnimationFrame(r));

      try {
        for (let i = 0; i < pageSheets.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await capturePage(pageSheets[i], i === 0);
        }
        pdf.save('weird-attachments.pdf');
      } finally {
        document.body.removeAttribute('data-pdf-export');
      }
    })();
  };
  
  // Initialize karaoke for all pages after render
  // This hook must be called even when pages.length === 0 to maintain hook order
  // Use useEffect with minimal delay to ensure dangerouslySetInnerHTML content is ready
  useEffect(() => {
    // Early return inside the effect is fine - it doesn't change hook order
    if (pages.length === 0) return;
    
    // Use requestAnimationFrame to ensure DOM is ready, but initialize all pages immediately
    // This ensures dangerouslySetInnerHTML content is inserted before we query for slices
    const rafId = requestAnimationFrame(() => {
      // Initialize all pages immediately - don't wait for scroll/visibility
      
      const initPromises = [];
      
      pages.forEach((page, index) => {
        const pageElement = document.getElementById(`pdf-page-${index}`);
        if (!pageElement) {
          return;
        }
        
        // The page-sheet is the direct child of pdf-page-wrapper
        const pageSheet = pageElement.querySelector('.page-sheet');
        if (!pageSheet) {
          return;
        }
        
        const pageContent = pageSheet.querySelector('.page-content');
        if (!pageContent) {
          return;
        }
        
        const pageKey = `pdf-page-${index}-${page.chapterIndex}-${page.pageIndex}`;
        
        // Only initialize once per page
        if (initializedPagesRef.current.has(pageKey)) {
          return;
        }
        
        // Set data-page-key on page-sheet for IntersectionObserver
        pageSheet.setAttribute('data-page-key', pageKey);
        
        // Check for karaoke slices
        const slices = pageContent.querySelectorAll('.karaoke-slice');
        
        if (slices.length === 0) {
          // No slices on this page, but still mark as initialized and observe
          initializedPagesRef.current.add(pageKey);
          observePage(pageSheet);
          return;
        }
        
        // Check if already initialized (might have been initialized from ref callback)
        if (initializedPagesRef.current.has(pageKey)) {
          return;
        }
        
        // Initialize karaoke slices immediately (don't wait for scroll)
        const initPromise = initializeKaraokeSlices(pageContent).then(() => {
          initializedPagesRef.current.add(pageKey);
          
          // Observe page for visibility (desktop) - for pause/resume on scroll
          observePage(pageSheet);
        }).catch((err) => {
        });
        
        initPromises.push(initPromise);
      });
      
      // Wait for all initializations to complete
      Promise.all(initPromises).then(() => {
      });
    });
    
    return () => {
      cancelAnimationFrame(rafId);
      // Unobserve all pages on cleanup
      pages.forEach((page, index) => {
        const pageElement = document.getElementById(`pdf-page-${index}`);
        if (pageElement) {
          const pageSheet = pageElement.querySelector('.page-sheet');
          if (pageSheet) {
            unobservePage(pageSheet);
          }
        }
      });
    };
  // Also re-run when zoom changes so karaoke stays in sync with scaled layout
  }, [pages, zoom, initializeKaraokeSlices, observePage, unobservePage]);

  // Cache for processed HTML (without images) and extracted image data
  const processedContentCache = useRef(new Map());
  
  // Extract images from HTML and return both the HTML without images and image data
  const extractImagesFromHtml = useMemo(() => {
    return (html) => {
      if (!html || typeof window === 'undefined') {
        return { htmlWithoutImages: html, images: [] };
      }
      
      // Check cache first
      if (processedContentCache.current.has(html)) {
        return processedContentCache.current.get(html);
      }
      
      const container = document.createElement('div');
      container.innerHTML = html;
      
      const images = [];
      const imgElements = container.querySelectorAll('img');
      
      imgElements.forEach((img, index) => {
        // Extract all attributes
        // Use a stable ID based on src and position to ensure consistency across renders
        const imgSrc = img.getAttribute('src') || '';
        const imageData = {
          id: `img-${imgSrc}-${index}`.replace(/[^a-zA-Z0-9-]/g, '-'), // Sanitize for use as ID
          src: imgSrc,
          alt: img.getAttribute('alt') || '',
          dataAlign: img.getAttribute('data-align') || '',
          dataInline: img.getAttribute('data-inline') || '',
          className: img.getAttribute('class') || '',
          style: img.getAttribute('style') || '',
          width: img.getAttribute('width') || '',
          height: img.getAttribute('height') || '',
        };
        
        images.push(imageData);
        
        // Replace img with a placeholder that has a data attribute
        const placeholder = document.createElement('span');
        placeholder.setAttribute('data-image-placeholder', imageData.id);
        placeholder.style.display = 'none'; // Hidden placeholder
        img.parentNode?.replaceChild(placeholder, img);
      });
      
      const htmlWithoutImages = container.innerHTML;
      const result = { htmlWithoutImages, images };
      
      // Cache the result
      processedContentCache.current.set(html, result);
      
      return result;
    };
  }, []);
  
  // Track which pages have had their content set
  const pageContentSetRef = useRef(new Map());
  
  // Store image refs to prevent garbage collection
  const imageRefsRef = useRef(new Map());
  
  // Create a ref callback factory that sets content and images
  // Use a stable ref to store the callback functions to prevent recreation
  const createPageContentRefCallbacks = useRef(new Map());
  
  const createPageContentRef = useCallback((pageKey, content) => {
    // Return a stable callback - reuse if it already exists for this pageKey
    if (!createPageContentRefCallbacks.current.has(pageKey)) {
      const callback = (node) => {
        if (!node) return;
        
        // Check if content has already been set for this page - early return with NO DOM queries
        if (pageContentSetRef.current.has(pageKey)) {
          return;
        }
        
        // Extract images from HTML (cache this so we don't re-process)
        const { htmlWithoutImages, images } = extractImagesFromHtml(content || '');
        
        // Set HTML content (without images)
        node.innerHTML = htmlWithoutImages;
        
        // Batch DOM updates: collect all image elements first, then insert them
        const imageReplacements = [];
        images.forEach((imgData) => {
          const imgId = `${pageKey}-${imgData.id}`;
          const placeholder = node.querySelector(`[data-image-placeholder="${imgData.id}"]`);
          if (placeholder) {
            const img = document.createElement('img');
            img.setAttribute('data-react-img-id', imgId);
            img.src = imgData.src;
            img.alt = imgData.alt;
            if (imgData.dataAlign) img.setAttribute('data-align', imgData.dataAlign);
            if (imgData.dataInline) img.setAttribute('data-inline', imgData.dataInline);
            if (imgData.className) img.className = imgData.className;
            if (imgData.style) img.setAttribute('style', imgData.style);
            // Preserve dimensions to prevent layout shifts
            if (imgData.width) img.setAttribute('width', imgData.width);
            if (imgData.height) img.setAttribute('height', imgData.height);
            img.setAttribute('loading', 'eager');
            img.setAttribute('decoding', 'async');
            img.setAttribute('fetchpriority', 'high');
            // Force image to stay rendered - use CSS classes instead of inline styles to prevent repaints
            img.classList.add('pdf-image-stable');
            
            imageReplacements.push({ placeholder, img, imgId });
          }
        });
        
        // Perform all DOM replacements in one batch using DocumentFragment for better performance
        if (imageReplacements.length > 0) {
          // Use requestAnimationFrame to batch DOM updates for smoother rendering
          requestAnimationFrame(() => {
            imageReplacements.forEach(({ placeholder, img, imgId }) => {
              placeholder.parentNode?.replaceChild(img, placeholder);
              // Store reference (no redundant preload needed - eager loading already handles it)
              imageRefsRef.current.set(imgId, { domImg: img });
            });
          });
        }
        
        // Mark content as set IMMEDIATELY to prevent re-execution
        pageContentSetRef.current.set(pageKey, true);
        
        // Initialize karaoke slices after content is set
        // Use requestAnimationFrame to ensure DOM is fully updated
        requestAnimationFrame(() => {
          const slices = node.querySelectorAll('.karaoke-slice');
          if (slices.length > 0) {
            // Find the page element by traversing up from the node
            let current = node;
            let pageElement = null;
            while (current && current !== document.body) {
              if (current.id && current.id.startsWith('pdf-page-')) {
                pageElement = current;
                break;
              }
              current = current.parentElement;
            }
            
            if (pageElement) {
              const pageSheet = pageElement.querySelector('.page-sheet');
              if (pageSheet) {
                // Extract a simpler pageKey for data-page-key (without content hash)
                const pageKeyParts = pageKey.split('-');
                const simplePageKey = `pdf-page-${pageKeyParts[2] || '0'}-${pageKeyParts[3] || '0'}-${pageKeyParts[4] || '0'}`;
                
                // Set data-page-key if not already set
                if (!pageSheet.getAttribute('data-page-key')) {
                  pageSheet.setAttribute('data-page-key', simplePageKey);
                }
                
                // Initialize karaoke slices
                initializeKaraokeSlices(node).then(() => {
                  // Mark as initialized to prevent duplicate initialization
                  initializedPagesRef.current.add(simplePageKey);
                  // Observe page for visibility (desktop) - for pause/resume on scroll
                  observePage(pageSheet);
                }).catch((err) => {
                });
              }
            }
          }
        });
      };
      
      createPageContentRefCallbacks.current.set(pageKey, callback);
    }
    
    return createPageContentRefCallbacks.current.get(pageKey);
  }, [extractImagesFromHtml, initializeKaraokeSlices, observePage]);

  // Helper function to render a single page
  // MUST be defined before hooks that use it (like renderedPages useMemo)
  const renderPage = useCallback((page, index, allPages) => {
    if (!page) return null;
    
    // Create stable pageKey that includes content hash to detect content changes
    const contentHash = page.content ? 
      page.content.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20) : 
      'empty';
    const pageKey = `pdf-page-${index}-${page.chapterIndex}-${page.pageIndex}-${contentHash}`;
    const contentKey = pageKey; // Use same key for content
    
    // Calculate page number excluding first page, cover, and TOC (for display)
    const regularPages = allPages.filter(p => !p.isFirstPage && !p.isCover && !p.isTOC);
    const displayPageNumber = (page.isFirstPage || page.isCover || page.isTOC) ? 0 : regularPages.findIndex(
      (p) => p.chapterIndex === page.chapterIndex && p.pageIndex === page.pageIndex
    ) + 1;
    
    const shouldShowTopBar = page && !page.hasHeading && !page.isEpigraph && !page.isCover && !page.isFirstPage && !page.isTOC && !page.hasFieldNotes && page.pageIndex > 0;

    // Apply background image style if available
    // For TOC page, use paper texture; otherwise use page's backgroundImageUrl
    const pageStyle = page?.isTOC ? {
      backgroundImage: `url(${paperTexture})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center center',
      backgroundRepeat: 'no-repeat'
    } : page?.backgroundImageUrl ? {
      backgroundImage: `url(${page.backgroundImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'left center',
      backgroundRepeat: 'no-repeat'
    } : {};

    // Add class when background image is present for CSS targeting
    const hasBackgroundImage = !!page?.backgroundImageUrl || page?.isTOC;
    
    // Extract field notes image URL from content if it's a field notes page
    let fieldNotesImageUrl = null;
    if (page?.hasFieldNotes && page?.content) {
      // Field notes content is: <div class="field-notes-page" ... style="background-image: url('...');"></div>
      const match = page.content.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);
      if (match && match[1]) {
        fieldNotesImageUrl = match[1];
      }
    }

    // Per-chapter/subchapter border frame (desktop-only)
    // Match original hard-coded styling, but swap in per-chapter image + width
    // Original CSS:
    // border: 8px solid transparent;
    // border-image: url('/smallerborder.png') 32 26 fill stretch;
    // border-image-outset: 16px;
    const hasBorder = !!page?.borderImageUrl;
    const borderWidth = page?.borderWidth || 8; // default 8px like original
    const borderImageUrl = page?.borderImageUrl;

    // Standardized border-image implementation:
    // - slicePercent: user-configurable (default 4% for 1024x1024px images = ~41px corners)
    // - borderOutset: equals borderWidth (1:1 ratio) for proper frame spacing
    // - Use 'round' repeat to maintain aspect ratio on rectangular pages (prevents distortion)
    const borderOutset = borderWidth; // 1:1 ratio (8px → 8px, 16px → 16px, etc.)
    const slicePercent = page?.borderSlicePercent || 4; // Default 4% for 1024x1024px images

    // Inline border-image styles so each chapter/subchapter can have its own frame
    const borderStyle = hasBorder && borderImageUrl ? {
      border: `${borderWidth}px solid transparent`,
      borderImage: `url(${borderImageUrl}) ${slicePercent}% fill round`,
      borderImageOutset: `${borderOutset}px`,
      borderRadius: 0,
    } : {};

    return (
      <article 
        className={`page-sheet content-page ${page?.isEpigraph ? 'epigraph-page' : ''} ${page?.isVideo ? 'video-page' : ''} ${page?.isCover ? 'cover-page' : ''} ${page?.isFirstPage ? 'first-page' : ''} ${page?.isTOC ? 'toc-page' : ''} ${page?.hasFieldNotes ? 'field-notes-page' : ''} ${hasBorder ? 'page-border' : ''} ${hasBackgroundImage ? 'has-background-image' : ''}`}
        style={{ ...pageStyle, ...borderStyle }}
        data-chapter-index={page.chapterIndex}
        data-page-index={page.pageIndex}
      >
        {/* Background image as absolutely positioned element behind content */}
        {(hasBackgroundImage || fieldNotesImageUrl) && (
          <img
            src={fieldNotesImageUrl || (page.isTOC ? paperTexture : page.backgroundImageUrl)}
            alt=""
            className="pdf-page-background-image"
            loading="eager"
            decoding="async"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: fieldNotesImageUrl ? 'center center' : (page.isTOC ? 'center center' : 'left center'),
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />
        )}
        <section className="page-body content-body" style={{ position: 'relative', zIndex: 1 }}>
          {page?.isTOC ? (
            <DesktopTOC
              chapters={chapters}
              pages={pages}
              currentChapterIndex={currentChapterIndex}
              currentPageIndex={currentPageIndex}
              currentSubchapterId={currentSubchapterId}
              onJumpToPage={(chapterIndex, pageIndex) => {
                // Scroll to the target page using data attributes
                requestAnimationFrame(() => {
                  const allPageSheets = document.querySelectorAll('.page-sheet');
                  allPageSheets.forEach((sheet) => {
                    const sheetChapterIndex = parseInt(sheet.getAttribute('data-chapter-index'));
                    const sheetPageIndex = parseInt(sheet.getAttribute('data-page-index'));
                    if (sheetChapterIndex === chapterIndex && sheetPageIndex === pageIndex) {
                      sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  });
                });
                
                // Call original callback for bookmark saving
                if (onJumpToPage) {
                  onJumpToPage({ chapterIndex, pageIndex });
                }
              }}
              onEditChapter={onEditChapter}
              onAddSubchapter={onAddSubchapter}
              onDeleteChapter={onDeleteChapter}
              onEditSubchapter={onEditSubchapter}
              onDeleteSubchapter={onDeleteSubchapter}
              onReorderChapters={onReorderChapters}
            />
          ) : page?.isCover ? (
            <div 
              className={`page-content ${page?.fontFamily ? 'page-content-custom-font' : ''}`}
              ref={createPageContentRef(`${contentKey}-cover`, page.content || '')}
              style={page?.fontFamily ? { fontFamily: page.fontFamily, '--page-font': page.fontFamily } : undefined}
            />
          ) : page?.isFirstPage ? (
            <div 
              className={`page-content ${page?.fontFamily ? 'page-content-custom-font' : ''}`}
              ref={createPageContentRef(`${contentKey}-first`, page.content || '')}
              style={page?.fontFamily ? { fontFamily: page.fontFamily, '--page-font': page.fontFamily } : undefined}
            />
          ) : page?.isEpigraph ? (
            <div 
              className={`page-content epigraph-content ${page?.fontFamily ? 'page-content-custom-font' : ''}`}
              style={page?.fontFamily ? { fontFamily: page.fontFamily, '--page-font': page.fontFamily } : undefined}
            >
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
          ) : page?.hasFieldNotes ? (
            <div 
              className={`page-content field-notes-content ${page?.fontFamily ? 'page-content-custom-font' : ''}`}
              style={{ position: 'relative', ...(page?.fontFamily ? { fontFamily: page.fontFamily, '--page-font': page.fontFamily } : {}) }}
            >
              {/* Field notes content without the background-image div (background is now rendered as img above) */}
              {/* Remove the field-notes-page div with background-image from content */}
              {(() => {
                if (!page?.content) return null;
                const temp = document.createElement('div');
                temp.innerHTML = page.content;
                // Remove the field-notes-page div that has the background-image
                const fieldNotesDiv = temp.querySelector('.field-notes-page[style*="background-image"]');
                if (fieldNotesDiv) {
                  // Keep any content inside but remove the div itself
                  const innerContent = fieldNotesDiv.innerHTML;
                  return <div ref={createPageContentRef(`${contentKey}-fieldnotes-inner`, innerContent || '')} />;
                }
                return <div ref={createPageContentRef(`${contentKey}-fieldnotes`, page.content)} />;
              })()}
            </div>
          ) : (
            <div 
              className={`page-content ${page?.fontFamily ? 'page-content-custom-font' : ''}`}
              ref={createPageContentRef(`${contentKey}-regular`, page?.content || '')}
              style={page?.fontFamily ? { fontFamily: page.fontFamily, '--page-font': page.fontFamily } : undefined}
            />
          )}
        </section>
        {!page?.isFirstPage && !page?.isCover && !page?.isTOC && (
          <div className="page-number">
            {displayPageNumber}
          </div>
        )}
        {shouldShowTopBar && !page.hasFieldNotes && (
          <ReaderTopBar
            chapterTitle={page.chapterTitle}
            subchapterTitle={page.subchapterTitle}
            pageKey={pageKey}
          />
        )}
      </article>
    );
  }, [chapters, pages, currentChapterIndex, currentPageIndex, currentSubchapterId, onJumpToPage, onEditChapter, onAddSubchapter, onDeleteChapter, onEditSubchapter, onDeleteSubchapter, onReorderChapters, createPageContentRef, paperTexture]);

  // Clean up refs when pages change to prevent memory leaks and handle content updates
  useEffect(() => {
    // Get current page keys based on actual page content
    const currentPageKeys = new Set();
    pagesWithTOC.forEach((page, index) => {
      const contentHash = page.content ? 
        page.content.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20) : 
        'empty';
      const pageKey = page.isTOC 
        ? `toc-${index}` 
        : `pdf-page-${index}-${page.chapterIndex}-${page.pageIndex}-${contentHash}`;
      currentPageKeys.add(pageKey);
    });
    
    // Clean up refs for pages that no longer exist or have changed content
    const keysToRemove = [];
    pageContentSetRef.current.forEach((_, key) => {
      if (!currentPageKeys.has(key)) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(key => {
      pageContentSetRef.current.delete(key);
      createPageContentRefCallbacks.current.delete(key);
      // Clean up image refs for this page
      imageRefsRef.current.forEach((_, imgId) => {
        if (imgId.startsWith(key)) {
          imageRefsRef.current.delete(imgId);
    }
      });
    });
  }, [pagesWithTOC]);

  // Memoize pages rendering to prevent re-renders when only page number state changes
  // Use stable keys based on page identity and content hash to detect content changes
  // MUST be before early return to maintain hook order
  const renderedPages = useMemo(() => {
    if (pagesWithTOC.length === 0) return [];
    return pagesWithTOC.map((page, index) => {
      // Use a stable key based on page identity + content hash to detect content changes
      const contentHash = page.content ? 
        page.content.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20) : 
        'empty';
      const pageKey = page.isTOC 
        ? `toc-${index}` 
        : `page-${page.chapterIndex}-${page.pageIndex}-${contentHash}`;
      
      return (
        <div
          key={pageKey}
          id={`pdf-page-${index}`}
          className="pdf-page-wrapper"
        >
          {renderPage(page, index, pagesWithTOC)}
        </div>
      );
    });
  }, [pagesWithTOC, renderPage]);

  // Ensure the first visible reading page starts at a stable scroll position,
  // even though we've temporarily hidden the original cover / first pages.
  const hasInitialScrollRef = useRef(false);
  useEffect(() => {
    if (hasInitialScrollRef.current) return;
    if (pagesWithTOC.length === 0) return;

    // Find the first non-cover, non-first, non-TOC page
    const firstReadingIndex = pagesWithTOC.findIndex(
      (p) => !p.isFirstPage && !p.isCover && !p.isTOC
    );
    if (firstReadingIndex < 0) return;

    const pageElement = document.getElementById(`pdf-page-${firstReadingIndex}`);
    const scrollContainer = document.querySelector('.pdf-viewer');
    if (pageElement && scrollContainer) {
      hasInitialScrollRef.current = true;
      // Scroll so that this first reading page is nicely positioned under the top bar
      pageElement.scrollIntoView({ behavior: 'instant', block: 'start' });
      // Leave space below the top bar so the first page sits a bit lower (like when cover was visible)
      scrollContainer.scrollTop -= 88;
    }
  }, [pagesWithTOC]);
  
  
  // Early return AFTER all hooks
  if (pages.length === 0) {
    return (
      <div className="page-reader-loading" />
    );
  }

  // Render pages vertically (stacked one after another)
  
  return (
    <>
      <PDFTopBar
        currentPage={currentPageNumber}
        totalPages={pagesWithTOC.length}
        onPageChange={handlePageChange}
        onPreviousPage={handlePreviousPage}
        onNextPage={handleNextPage}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        onDownload={handleDownload}
        filename="weird-attachments.pdf"
      />
      <PDFViewer
        currentPage={1}
        totalPages={pagesWithTOC.length}
        onPageChange={(pageNum) => {
          // Scroll to the page
          const pageIndex = pageNum - 1;
          const page = pagesWithTOC[pageIndex];
          if (page) {
            const pageElement = document.getElementById(`pdf-page-${pageIndex}`);
            if (pageElement) {
              pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }}
        filename="weird-attachments.pdf"
        zoom={zoom}
      >
        <div className="pdf-pages-container">
          {renderedPages}
        </div>
      </PDFViewer>
      {/* Desktop Progress Bar - only show for regular pages */}
      {mostVisiblePage && !mostVisiblePage.isFirstPage && !mostVisiblePage.isCover && !mostVisiblePage.isTOC && chapterProgress > 0 && typeof document !== 'undefined' && createPortal(
        <div className="chapter-progress-bar desktop-progress-bar">
          <div 
            className="chapter-progress-fill" 
            style={{ width: `${chapterProgress * 100}%` }}
          />
        </div>,
        document.body
      )}
    </>
  );
};

