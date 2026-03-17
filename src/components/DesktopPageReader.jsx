import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { PDFViewer } from './PDFViewer';
import { PDFTopBar } from './PDFTopBar';
import { DitheredLoader } from './DitheredLoader';
import { ReaderTopBar } from './ReaderTopBar';
import { DesktopTOC } from './DesktopTOC';
import { useKaraokePlayer } from '../hooks/useKaraokePlayer';
import { getStickyNoteStyle } from '../utils/stickyNotePosition';
import { getBookMeta, updateBookMeta, clearBookPdfCache } from '../services/firestore';
import { uploadPdfToStorage } from '../services/storage';
import paperTexture from '../assets/paper-7-origami-TEX.png';
import borderFrame from '../assets/smallerborder.png';

// Per-book bitmap cache so we only re-render (html2canvas) pages whose content changed.
// Survives component unmount (e.g. after editing and returning to reader).
const pageBitmapCacheByBook = new Map();

/**
 * DesktopPageReader - Desktop-specific page reader component
 * Renders all pages in a scrollable two-page spread PDF-style viewer
 */
export const DesktopPageReader = ({ 
  bookId,
  pages, 
  karaokeSources = {},
  chapters = [],
  isEditor,
  onAddStickyClick,
  uploadingSticky,
  currentChapterIndex,
  currentPageIndex,
  isInitializing,
  currentSubchapterId,
  onJumpToPage,
  onEditChapter,
  onAddSubchapter,
  onDeleteChapter,
  onEditSubchapter,
  onDeleteSubchapter,
  onReorderChapters,
  onPageChange,
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
  const [isDownloadingPdf, setDownloadingPdf] = useState(false);
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
  
  // Keep a stable ref to onPageChange so the scroll handler doesn't need it as a dependency.
  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => { onPageChangeRef.current = onPageChange; }, [onPageChange]);

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
          // Save reading position whenever the visible page changes.
          onPageChangeRef.current?.({
            chapterId: mostCenteredPage.chapterId,
            pageIndex: mostCenteredPage.pageIndex,
            subchapterId: mostCenteredPage.subchapterId || null,
          });
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

  // Cache per-page bitmaps so unchanged pages don't re-run html2canvas every time
  // Map: pageKey -> { hash, dataUrl }
  const pageBitmapCacheRef = useRef(new Map());

  const computeHash = useCallback((str) => {
    // Simple djb2-style hash, good enough for change detection
    let hash = 5381;
    for (let i = 0; i < str.length; i += 1) {
      // eslint-disable-next-line no-bitwise
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    // eslint-disable-next-line no-bitwise
    return (hash >>> 0).toString(16);
  }, []);

  // Expose a server-usable generator: returns PDF as base64 data (no download)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    window.__generatePdfFromViewer = async () => {
      const viewer = document.querySelector('.pdf-viewer-container');
      if (!viewer) return null;

      const pageSheets = Array.from(
        viewer.querySelectorAll('.pdf-page-wrapper .page-sheet')
      );
      if (pageSheets.length === 0) return null;

      const getCaptureElement = (sheet) => sheet;

      const compositeFrameWithContent = (contentDataUrl, frameImageUrl, frameWidthPx, sheetWidth, sheetHeight, slicePercent = 5) =>
        new Promise((resolve) => {
          const totalW = sheetWidth + 2 * frameWidthPx;
          const totalH = sheetHeight + 2 * frameWidthPx;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const iw = img.naturalWidth;
              const ih = img.naturalHeight;
              const slicePct = Math.min(49, Math.max(1, Number(slicePercent) || 5)) / 100;
              const sliceX = Math.floor(iw * slicePct);
              const sliceY = Math.floor(ih * slicePct);
              const canvas = document.createElement('canvas');
              canvas.width = totalW;
              canvas.height = totalH;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, totalW, totalH);
              const frameW = frameWidthPx;
              const draw = (sx, sy, sw, sh, dx, dy, dw, dh) => {
                if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
                  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
                }
              };
              const edgeW = Math.max(1, iw - 2 * sliceX);
              const edgeH = Math.max(1, ih - 2 * sliceY);
              const destEdgeW = totalW - 2 * frameW;
              const destEdgeH = totalH - 2 * frameW;
              const cornerScale = Math.min(frameW / Math.max(1, sliceX), frameW / Math.max(1, sliceY));
              const cornerDw = sliceX * cornerScale;
              const cornerDh = sliceY * cornerScale;
              const oxTL = (frameW - cornerDw) / 2;
              const oyTL = (frameW - cornerDh) / 2;
              draw(0, 0, sliceX, sliceY, 0 + oxTL, 0 + oyTL, cornerDw, cornerDh);
              draw(iw - sliceX, 0, sliceX, sliceY, totalW - frameW + (frameW - cornerDw) / 2, 0 + oyTL, cornerDw, cornerDh);
              draw(0, ih - sliceY, sliceX, sliceY, 0 + oxTL, totalH - frameW + (frameW - cornerDh) / 2, cornerDw, cornerDh);
              draw(iw - sliceX, ih - sliceY, sliceX, sliceY, totalW - frameW + (frameW - cornerDw) / 2, totalH - frameW + (frameW - cornerDh) / 2, cornerDw, cornerDh);
              const scaleTop = frameW / sliceY;
              const tileW = edgeW * scaleTop;
              const nTop = Math.max(1, Math.ceil(destEdgeW / tileW));
              const offsetTop = (destEdgeW - nTop * tileW) / 2;
              for (let k = 0; k < nTop; k++) {
                draw(sliceX, 0, edgeW, sliceY, frameW + offsetTop + k * tileW, 0, tileW, frameW);
              }
              const tileWB = edgeW * scaleTop;
              const nBottom = Math.max(1, Math.ceil(destEdgeW / tileWB));
              const offsetBottom = (destEdgeW - nBottom * tileWB) / 2;
              for (let k = 0; k < nBottom; k++) {
                draw(sliceX, ih - sliceY, edgeW, sliceY, frameW + offsetBottom + k * tileWB, totalH - frameW, tileWB, frameW);
              }
              const scaleSide = frameW / sliceX;
              const tileH = edgeH * scaleSide;
              const nLeft = Math.max(1, Math.ceil(destEdgeH / tileH));
              const offsetLeft = (destEdgeH - nLeft * tileH) / 2;
              for (let k = 0; k < nLeft; k++) {
                draw(0, sliceY, sliceX, edgeH, 0, frameW + offsetLeft + k * tileH, frameW, tileH);
              }
              const tileHR = edgeH * scaleSide;
              const nRight = Math.max(1, Math.ceil(destEdgeH / tileHR));
              const offsetRight = (destEdgeH - nRight * tileHR) / 2;
              for (let k = 0; k < nRight; k++) {
                draw(iw - sliceX, sliceY, sliceX, edgeH, totalW - frameW, frameW + offsetRight + k * tileHR, frameW, tileHR);
              }
              const contentImg = new Image();
              contentImg.crossOrigin = 'anonymous';
              contentImg.onload = () => {
                ctx.drawImage(contentImg, frameW, frameW, sheetWidth, sheetHeight);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
              };
              contentImg.onerror = () => {
                if (import.meta.env.DEV) console.warn('[PDF] Content image failed in frame composite');
                resolve(null);
              };
              contentImg.src = contentDataUrl;
            } catch (e) {
              if (import.meta.env.DEV) console.warn('[PDF] Frame composite error:', e);
              resolve(null);
            }
          };
          img.onerror = () => {
            if (import.meta.env.DEV) {
              console.warn('[PDF] Frame image failed to load (CORS or network):', frameImageUrl);
            }
            resolve(null);
          };
          img.src = frameImageUrl;
        });

      const waitForImages = (root) => {
        const imgs = Array.from(root.querySelectorAll('img'));
        if (imgs.length === 0) return Promise.resolve();
        return Promise.all(
          imgs.map(
            (img) =>
              new Promise((resolve) => {
                if (img.complete) {
                  resolve();
                  return;
                }
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              })
          )
        );
      };

      document.body.setAttribute('data-pdf-export', 'true');
      await new Promise((r) => requestAnimationFrame(r));

      const capturePage = async (sheet, index) => {
        const sw = sheet.offsetWidth;
        const sh = sheet.offsetHeight;
        const hasBorder = sheet.getAttribute('data-has-border') === 'true';
        const frameW = hasBorder ? parseInt(sheet.getAttribute('data-frame-width'), 10) || 10 : 0;
        await waitForImages(sheet);
        const contentCanvas = await html2canvas(sheet, {
          scale: Math.min(window.devicePixelRatio || 1, 2),
          useCORS: true,
          backgroundColor: '#ffffff',
        });
        const contentDataUrl = contentCanvas.toDataURL('image/jpeg', 0.85);
        let imgData = contentDataUrl;
        let w = sw;
        let h = sh;
        if (hasBorder) {
          const frameUrl = sheet.getAttribute('data-border-image-url');
          const slicePct = hasBorder ? (parseInt(sheet.getAttribute('data-border-slice-percent'), 10) || 5) : null;
          if (frameUrl) {
            if (import.meta.env.DEV) console.log('[PDF] frame composite', { frameW, slicePct, sw, sh });
            const composite = await compositeFrameWithContent(contentDataUrl, frameUrl, frameW, sw, sh, slicePct);
            if (composite) {
              imgData = composite;
              w = sw + 2 * frameW;
              h = sh + 2 * frameW;
            }
          }
        }
        if (index === 0) {
          pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
        } else {
          pdf.addPage([w, h], 'p');
          pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
        }
      };

      const firstSheet = pageSheets[0];
      const firstHasBorder = firstSheet.getAttribute('data-has-border') === 'true';
      const firstFrameW = firstHasBorder ? parseInt(firstSheet.getAttribute('data-frame-width'), 10) || 10 : 0;
      const firstW = firstSheet.offsetWidth + 2 * firstFrameW;
      const firstH = firstSheet.offsetHeight + 2 * firstFrameW;
      const pdf = new jsPDF({
        orientation: firstW >= firstH ? 'l' : 'p',
        unit: 'px',
        format: [firstW, firstH],
        compression: 'FAST',
      });

      for (let i = 0; i < pageSheets.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await capturePage(pageSheets[i], i);
      }

      document.body.removeAttribute('data-pdf-export');
      // Return base64 (no data: prefix) for server to convert
      return pdf.output('datauristring').split(',')[1];
    };
  }, [pages]);

  const handleDownload = (forceRegenerate = false) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const viewer = document.querySelector('.pdf-viewer-container');
    if (!viewer) return;

    const pageSheets = Array.from(
      viewer.querySelectorAll('.pdf-page-wrapper .page-sheet')
    );
    if (pageSheets.length === 0) return;

    setDownloadingPdf(true);
    (async () => {
      if (import.meta.env.DEV && forceRegenerate && bookId) {
        await clearBookPdfCache(bookId);
        console.log('[PDF] Cleared PDF cache for book %s; generating from scratch', bookId);
      }

      const triggerDownload = (blobOrUrl) => {
        const a = document.createElement('a');
        a.download = 'weird-attachments.pdf';
        if (typeof blobOrUrl === 'string') {
          a.href = blobOrUrl;
        } else {
          const url = URL.createObjectURL(blobOrUrl);
          a.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 200);
        }
        a.click();
      };

      // 1) If we have bookId and a current PDF in Storage, download it
      if (bookId) {
        try {
          const meta = await getBookMeta(bookId);
          if (meta.pdfUrl && meta.pdfVersion != null && meta.pdfVersion === meta.contentVersion) {
            if (import.meta.env.DEV) {
              console.log('[PDF] Using cached PDF from Firestore books/%s (pdfVersion=%s)', bookId, meta.pdfVersion);
            }
            // Always force a download, independent of browser behavior:
            // fetch the PDF, turn it into a blob, then download via an object URL.
            const res = await fetch(meta.pdfUrl);
            const blob = await res.blob();
            triggerDownload(blob);
            setDownloadingPdf(false);
            return;
          }
        } catch {
          // Fall through to generate
        }
      }

      // Always capture the sheet; html2canvas does not support border-image, so we composite the frame in PDF
      const getCaptureElement = (sheet) => sheet;

      const compositeFrameWithContent = (contentDataUrl, frameImageUrl, frameWidthPx, sheetWidth, sheetHeight, slicePercent = 5) =>
        new Promise((resolve) => {
          const totalW = sheetWidth + 2 * frameWidthPx;
          const totalH = sheetHeight + 2 * frameWidthPx;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const iw = img.naturalWidth;
              const ih = img.naturalHeight;
              const slicePct = Math.min(49, Math.max(1, Number(slicePercent) || 5)) / 100;
              const sliceX = Math.floor(iw * slicePct);
              const sliceY = Math.floor(ih * slicePct);
              const canvas = document.createElement('canvas');
              canvas.width = totalW;
              canvas.height = totalH;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, totalW, totalH);
              const frameW = frameWidthPx;
              const draw = (sx, sy, sw, sh, dx, dy, dw, dh) => {
                if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
                  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
                }
              };
              const edgeW = Math.max(1, iw - 2 * sliceX);
              const edgeH = Math.max(1, ih - 2 * sliceY);
              const destEdgeW = totalW - 2 * frameW;
              const destEdgeH = totalH - 2 * frameW;
              const cornerScale = Math.min(frameW / Math.max(1, sliceX), frameW / Math.max(1, sliceY));
              const cornerDw = sliceX * cornerScale;
              const cornerDh = sliceY * cornerScale;
              const oxTL = (frameW - cornerDw) / 2;
              const oyTL = (frameW - cornerDh) / 2;
              draw(0, 0, sliceX, sliceY, 0 + oxTL, 0 + oyTL, cornerDw, cornerDh);
              draw(iw - sliceX, 0, sliceX, sliceY, totalW - frameW + (frameW - cornerDw) / 2, 0 + oyTL, cornerDw, cornerDh);
              draw(0, ih - sliceY, sliceX, sliceY, 0 + oxTL, totalH - frameW + (frameW - cornerDh) / 2, cornerDw, cornerDh);
              draw(iw - sliceX, ih - sliceY, sliceX, sliceY, totalW - frameW + (frameW - cornerDw) / 2, totalH - frameW + (frameW - cornerDh) / 2, cornerDw, cornerDh);
              const scaleTop = frameW / sliceY;
              const tileW = edgeW * scaleTop;
              const nTop = Math.max(1, Math.ceil(destEdgeW / tileW));
              const offsetTop = (destEdgeW - nTop * tileW) / 2;
              for (let k = 0; k < nTop; k++) {
                draw(sliceX, 0, edgeW, sliceY, frameW + offsetTop + k * tileW, 0, tileW, frameW);
              }
              const tileWB = edgeW * scaleTop;
              const nBottom = Math.max(1, Math.ceil(destEdgeW / tileWB));
              const offsetBottom = (destEdgeW - nBottom * tileWB) / 2;
              for (let k = 0; k < nBottom; k++) {
                draw(sliceX, ih - sliceY, edgeW, sliceY, frameW + offsetBottom + k * tileWB, totalH - frameW, tileWB, frameW);
              }
              const scaleSide = frameW / sliceX;
              const tileH = edgeH * scaleSide;
              const nLeft = Math.max(1, Math.ceil(destEdgeH / tileH));
              const offsetLeft = (destEdgeH - nLeft * tileH) / 2;
              for (let k = 0; k < nLeft; k++) {
                draw(0, sliceY, sliceX, edgeH, 0, frameW + offsetLeft + k * tileH, frameW, tileH);
              }
              const tileHR = edgeH * scaleSide;
              const nRight = Math.max(1, Math.ceil(destEdgeH / tileHR));
              const offsetRight = (destEdgeH - nRight * tileHR) / 2;
              for (let k = 0; k < nRight; k++) {
                draw(iw - sliceX, sliceY, sliceX, edgeH, totalW - frameW, frameW + offsetRight + k * tileHR, frameW, tileHR);
              }
              const contentImg = new Image();
              contentImg.crossOrigin = 'anonymous';
              contentImg.onload = () => {
                ctx.drawImage(contentImg, frameW, frameW, sheetWidth, sheetHeight);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
              };
              contentImg.onerror = () => {
                if (import.meta.env.DEV) console.warn('[PDF] Content image failed in frame composite');
                resolve(null);
              };
              contentImg.src = contentDataUrl;
            } catch (e) {
              if (import.meta.env.DEV) console.warn('[PDF] Frame composite error:', e);
              resolve(null);
            }
          };
          img.onerror = () => {
            if (import.meta.env.DEV) {
              console.warn('[PDF] Frame image failed to load (CORS or network):', frameImageUrl);
            }
            resolve(null);
          };
          img.src = frameImageUrl;
        });

      // Content-only hash so re-renders (attribute order, etc.) don't invalidate cache.
      // Normalize image URLs (strip query/token) so Storage token refresh doesn't invalidate hash.
      const getStableContentString = (pageEl) => {
        const content = pageEl.querySelector('.page-content');
        const text = content?.innerText ?? content?.textContent ?? '';
        const imgs = Array.from(pageEl.querySelectorAll('img'))
          .map((img) => {
            const src = img.src || '';
            try {
              const u = new URL(src);
              u.search = '';
              return u.toString();
            } catch {
              return src;
            }
          })
          .sort();

        // Include frame parameters so per-chapter/subchapter border changes
        // invalidate only the affected pages, not the whole book.
        const hasBorder = pageEl.getAttribute('data-has-border') === 'true';
        const frameUrl = hasBorder ? (pageEl.getAttribute('data-border-image-url') || '') : '';
        const frameW = hasBorder ? (pageEl.getAttribute('data-frame-width') || '') : '';
        const slicePct = hasBorder ? (pageEl.getAttribute('data-border-slice-percent') || '') : '';
        const frameSignature = hasBorder ? `\nFRAME:${frameUrl}|${frameW}|${slicePct}` : '';

        return text + '\n' + imgs.join('\n') + frameSignature;
      };

      const getPageKeyAndHash = (pageEl, index) => {
        const ci = pageEl.getAttribute('data-chapter-index');
        const pi = pageEl.getAttribute('data-page-index');
        const pageKey =
          (ci != null && pi != null)
            ? `logical-${ci}-${pi}`
            : (pageEl.getAttribute('data-page-key') || `page-${index}`);
        const hash = computeHash(getStableContentString(pageEl));
        return { pageKey, hash };
      };

      const waitForImages = (root) => {
        const imgs = Array.from(root.querySelectorAll('img'));
        if (imgs.length === 0) return Promise.resolve();
        return Promise.all(
          imgs.map(
            (img) =>
              new Promise((resolve) => {
                if (img.complete) {
                  resolve();
                  return;
                }
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              })
          )
        );
      };

      // Use book-scoped cache when available so cache survives unmount after edits
        const cache = bookId
          ? (pageBitmapCacheByBook.get(bookId) ?? (() => {
              const m = new Map();
              pageBitmapCacheByBook.set(bookId, m);
              return m;
            })())
          : pageBitmapCacheRef.current;

        const stats = { rendered: 0, reused: 0 };
        const getOrRenderPageBitmap = async (sheetEl, index) => {
          const { pageKey, hash } = getPageKeyAndHash(sheetEl, index);

          const cached = cache.get(pageKey);
          if (cached && cached.hash === hash) {
            stats.reused += 1;
            return cached.dataUrl;
          }

          const captureEl = getCaptureElement(sheetEl);
          await waitForImages(captureEl);
          const canvas = await html2canvas(captureEl, {
            scale: Math.min(window.devicePixelRatio || 1, 2),
            useCORS: true,
            backgroundColor: '#ffffff',
          });
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          cache.set(pageKey, { hash, dataUrl });
          stats.rendered += 1;
          return dataUrl;
        };

      const renderPageToDataUrl = async (captureEl) => {
        await waitForImages(captureEl);
        const canvas = await html2canvas(captureEl, {
          scale: Math.min(window.devicePixelRatio || 1, 2),
          useCORS: true,
          backgroundColor: '#ffffff',
        });
        return canvas.toDataURL('image/jpeg', 0.85);
      };

      document.body.setAttribute('data-pdf-export', 'true');
      await new Promise((r) => requestAnimationFrame(r));

      const firstSheet = pageSheets[0];
      const firstHasBorder = firstSheet.getAttribute('data-has-border') === 'true';
      const firstFrameW = firstHasBorder ? parseInt(firstSheet.getAttribute('data-frame-width'), 10) || 10 : 0;
      const firstRect = {
        width: firstSheet.offsetWidth + 2 * firstFrameW,
        height: firstSheet.offsetHeight + 2 * firstFrameW,
      };

      try {
        // 2a) Incremental: reuse pages from stored PDF when content hash matches (works across devices)
        let meta = null;
        try {
          meta = bookId ? await getBookMeta(bookId) : null;
        } catch (metaErr) {
          if (import.meta.env.DEV) console.warn('[PDF] getBookMeta failed (e.g. network), using full generation:', metaErr);
        }
        const canIncremental =
          bookId &&
          meta?.pdfUrl &&
          Array.isArray(meta.pdfPageKeys) &&
          meta.pdfPageKeys.length > 0 &&
          meta.pdfPageHashes &&
          typeof meta.pdfPageHashes === 'object';

        if (import.meta.env.DEV && bookId) {
          if (!canIncremental) {
            const reason = !meta?.pdfUrl
              ? 'no pdfUrl'
              : !Array.isArray(meta?.pdfPageKeys) || meta.pdfPageKeys.length === 0
                ? 'no pdfPageKeys (do one full download to save them)'
                : !meta?.pdfPageHashes
                  ? 'no pdfPageHashes'
                  : 'unknown';
            console.log('[PDF] Skipping incremental:', reason);
          }
        }

        if (canIncremental) {
          try {
            const res = await fetch(meta.pdfUrl);
            if (!res.ok) throw new Error('Fetch failed');
            const oldPdfBytes = new Uint8Array(await res.arrayBuffer());
            const oldDoc = await PDFDocument.load(oldPdfBytes);
            const newDoc = await PDFDocument.create();

            const newPageKeys = [];
            const newPageHashes = {};
            let copiedCount = 0;
            let renderedCount = 0;

            for (let i = 0; i < pageSheets.length; i += 1) {
              const { pageKey, hash } = getPageKeyAndHash(pageSheets[i], i);
              const oldIndex = meta.pdfPageKeys.indexOf(pageKey);
              const canCopy =
                oldIndex >= 0 && meta.pdfPageHashes[pageKey] === hash;

              if (canCopy) {
                const [copiedPage] = await newDoc.copyPages(oldDoc, [oldIndex]);
                newDoc.addPage(copiedPage);
                copiedCount += 1;
              } else {
                const sheet = pageSheets[i];
                const sw = sheet.offsetWidth;
                const sh = sheet.offsetHeight;
                const contentDataUrl = await renderPageToDataUrl(sheet);
                const hasBorder = sheet.getAttribute('data-has-border') === 'true';
                const frameW = hasBorder ? parseInt(sheet.getAttribute('data-frame-width'), 10) || 10 : 0;
                const frameUrl = hasBorder ? sheet.getAttribute('data-border-image-url') : null;
                const slicePct = hasBorder ? sheet.getAttribute('data-border-slice-percent') : null;
                let dataUrl = contentDataUrl;
                let w = sw;
                let h = sh;
                if (hasBorder && frameUrl) {
                  if (import.meta.env.DEV) console.log('[PDF] frame composite (incremental)', { frameW, slicePct, sw, sh });
                  const composite = await compositeFrameWithContent(contentDataUrl, frameUrl, frameW, sw, sh, slicePct);
                  if (composite) {
                    dataUrl = composite;
                    w = sw + 2 * frameW;
                    h = sh + 2 * frameW;
                  }
                }
                const embed = await newDoc.embedJpg(dataUrl);
                const page = newDoc.addPage([w, h]);
                page.drawImage(embed, { x: 0, y: 0, width: w, height: h });
                renderedCount += 1;
              }
              newPageKeys.push(pageKey);
              newPageHashes[pageKey] = hash;
            }

            const pdfBytes = await newDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const pdfUrl = await uploadPdfToStorage(bookId, blob);
            const freshMeta = await getBookMeta(bookId);
            await updateBookMeta(bookId, {
              pdfUrl,
              pdfVersion: freshMeta.contentVersion,
              contentVersion: freshMeta.contentVersion,
              pdfPageKeys: newPageKeys,
              pdfPageHashes: newPageHashes,
            });
            if (import.meta.env.DEV) {
              console.log(
                '[PDF] Incremental: %d pages copied from Storage, %d rendered (html2canvas)',
                copiedCount,
                renderedCount
              );
            }
            triggerDownload(blob);
            setDownloadingPdf(false);
            return;
          } catch (incErr) {
            if (import.meta.env.DEV) {
              console.warn('[PDF] Incremental build failed, falling back to full generation:', incErr);
            }
          }
        }

        // 2b) Full generation: jsPDF + collect page keys/hashes for next time
        const pdf = new jsPDF({
          orientation: firstRect.width >= firstRect.height ? 'l' : 'p',
          unit: 'px',
          format: [firstRect.width, firstRect.height],
          compression: 'FAST',
        });

        const pdfPageKeys = [];
        const pdfPageHashes = {};

        for (let i = 0; i < pageSheets.length; i += 1) {
          const sheet = pageSheets[i];
          const { pageKey, hash } = getPageKeyAndHash(sheet, i);
          pdfPageKeys.push(pageKey);
          pdfPageHashes[pageKey] = hash;
          const sw = sheet.offsetWidth;
          const sh = sheet.offsetHeight;
          // eslint-disable-next-line no-await-in-loop
          const contentDataUrl = await getOrRenderPageBitmap(sheet, i);
          const hasBorder = sheet.getAttribute('data-has-border') === 'true';
          const frameW = hasBorder ? parseInt(sheet.getAttribute('data-frame-width'), 10) || 10 : 0;
          const frameUrl = hasBorder ? sheet.getAttribute('data-border-image-url') : null;
          const slicePct = hasBorder ? (parseInt(sheet.getAttribute('data-border-slice-percent'), 10) || 5) : null;
          let imgData = contentDataUrl;
          let w = sw;
          let h = sh;
          if (hasBorder && frameUrl) {
            if (import.meta.env.DEV) console.log('[PDF] frame composite (full)', { frameW, slicePct, sw, sh });
            const composite = await compositeFrameWithContent(contentDataUrl, frameUrl, frameW, sw, sh, slicePct);
            if (composite) {
              imgData = composite;
              w = sw + 2 * frameW;
              h = sh + 2 * frameW;
            }
          }
          if (i !== 0) {
            pdf.addPage([w, h], 'p');
          }
          pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
        }
        if (import.meta.env.DEV && (stats.rendered > 0 || stats.reused > 0)) {
          console.log('[PDF] Full: %d rendered (html2canvas), %d reused from cache', stats.rendered, stats.reused);
        }
        const blob = pdf.output('blob');
        if (bookId) {
          try {
            const pdfUrl = await uploadPdfToStorage(bookId, blob);
            const freshMeta = await getBookMeta(bookId);
            await updateBookMeta(bookId, {
              pdfUrl,
              pdfVersion: freshMeta.contentVersion,
              contentVersion: freshMeta.contentVersion,
              pdfPageKeys,
              pdfPageHashes,
            });
            if (import.meta.env.DEV) {
              console.log('[PDF] Metadata saved to Firestore (pdfVersion=%s, %d page keys)', bookId, freshMeta.contentVersion, pdfPageKeys.length);
            }
          } catch (err) {
            console.warn('PDF upload/update failed, downloading locally:', err);
          }
          triggerDownload(blob);
        } else {
          pdf.save('weird-attachments.pdf');
        }
      } finally {
        document.body.removeAttribute('data-pdf-export');
        setDownloadingPdf(false);
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
    const borderImageUrl = page?.borderImageUrl;

    // Interpret pageBorderWidth as visible frame thickness, not as inward border.
    // We keep border-width at 0 so the frame does not cut into the page; the
    // `/ frameWidthpx` part of border-image controls thickness, and
    // border-image-outset pushes the frame outward so it sits like a picture frame.
    const frameWidth = Math.max(5, page?.borderWidth || 10);
    const slicePercent = page?.borderSlicePercent ?? 5;

    const borderStyle = hasBorder && borderImageUrl ? {
      border: '0 solid transparent',
      borderImage: `url(${borderImageUrl}) ${slicePercent}% / ${frameWidth}px round`,
      borderImageOutset: `${frameWidth}px`,
      borderRadius: 0,
    } : {};

    return (
      <article 
        className={`page-sheet content-page ${page?.isEpigraph ? 'epigraph-page' : ''} ${page?.isVideo ? 'video-page' : ''} ${page?.isCover ? 'cover-page' : ''} ${page?.isFirstPage ? 'first-page' : ''} ${page?.isTOC ? 'toc-page' : ''} ${page?.hasFieldNotes ? 'field-notes-page' : ''} ${hasBorder ? 'page-border' : ''} ${hasBackgroundImage ? 'has-background-image' : ''}`}
        style={{ ...pageStyle, ...borderStyle }}
        data-chapter-index={page.chapterIndex}
        data-page-index={page.pageIndex}
        data-has-border={hasBorder ? 'true' : undefined}
        data-frame-width={hasBorder ? frameWidth : undefined}
        data-border-image-url={hasBorder ? borderImageUrl : undefined}
        data-border-slice-percent={hasBorder ? slicePercent : undefined}
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
                requestAnimationFrame(() => {
                  const targetIndex = pagesWithTOC.findIndex(
                    (p) => p.chapterIndex === chapterIndex && p.pageIndex === pageIndex
                  );
                  const pageElement = targetIndex >= 0 ? document.getElementById(`pdf-page-${targetIndex}`) : null;
                  const scrollContainer = document.querySelector('.pdf-viewer');
                  const topBar = document.querySelector('.pdf-top-bar');
                  const topBarHeight = topBar ? topBar.offsetHeight : 0;
                  if (scrollContainer && pageElement) {
                    const targetScrollTop = pageElement.offsetTop - topBarHeight - 24;
                    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
                  }
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
          {/* Per-page sticky notes (chapter-level, clear-background scan on edge) */}
          {page?.chapterId && !page?.isCover && !page?.isFirstPage && !page?.isTOC && !page?.isEpigraph && !page?.isVideo && (() => {
            const chapter = chapters.find(c => c.id === page.chapterId);
            const notes = Array.isArray(chapter?.stickyNotes) ? chapter.stickyNotes.filter(n => n.pageIndex === page.pageIndex && n.imageUrl) : [];
            return notes.map((note, idx) => (
              <img
                key={`sticky-${page.chapterId}-${page.pageIndex}-${idx}`}
                src={note.imageUrl}
                alt=""
                className="page-sticky-note"
                style={getStickyNoteStyle(`${page.chapterId}-${page.pageIndex}-${idx}`)}
              />
            ));
          })()}
          {/* Editor mode: add sticky to this page */}
          {isEditor && onAddStickyClick && page?.chapterId && !page?.isCover && !page?.isFirstPage && !page?.isTOC && !page?.isEpigraph && !page?.isVideo && (
            <div className="page-add-sticky-wrap">
              <button
                type="button"
                className="page-add-sticky-btn"
                disabled={uploadingSticky}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddStickyClick(page.chapterId, page.pageIndex);
                }}
                title="Add sticky note to this page"
              >
                {uploadingSticky ? '…' : '📌'}
              </button>
            </div>
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
  }, [chapters, pages, currentChapterIndex, currentPageIndex, currentSubchapterId, onJumpToPage, onEditChapter, onAddSubchapter, onDeleteChapter, onEditSubchapter, onDeleteSubchapter, onReorderChapters, createPageContentRef, paperTexture, isEditor, onAddStickyClick, uploadingSticky]);

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

  // Scroll to bookmark on first stable render (after initialPosition has loaded).
  // isInitializing stays true until restoreInitialPosition runs with a non-null initialPosition,
  // so gating on it ensures currentChapterIndex/currentPageIndex hold the restored values, not 0/0.
  // We use a ref to fire only once per session.
  const hasInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (isInitializing) return;
    if (hasInitialScrollRef.current) return;
    if (pagesWithTOC.length === 0) return;

    hasInitialScrollRef.current = true;

    const restoredIndex = pagesWithTOC.findIndex(
      (p) => p.chapterIndex === currentChapterIndex && p.pageIndex === currentPageIndex
    );
    const targetIndex = restoredIndex >= 0 ? restoredIndex : 0;

    const scrollContainer = document.querySelector('.pdf-viewer');
    const pageElement = document.getElementById(`pdf-page-${targetIndex}`);
    const topBar = document.querySelector('.pdf-top-bar');
    const topBarHeight = topBar ? topBar.offsetHeight : 0;
    if (scrollContainer && pageElement) {
      scrollContainer.scrollTop = pageElement.offsetTop - topBarHeight - 62;
    }
  }, [pagesWithTOC, currentChapterIndex, currentPageIndex, isInitializing]);

  // When showing only the inline loader page (before any real pages are ready),
  // place it at the same scroll position the first real page will use so the
  // transition feels seamless.
  useLayoutEffect(() => {
    if (pages.length !== 0) return;
    const scrollContainer = document.querySelector('.pdf-viewer');
    const pageElement = document.getElementById('pdf-page-0');
    const topBar = document.querySelector('.pdf-top-bar');
    const topBarHeight = topBar ? topBar.offsetHeight : 0;
    if (scrollContainer && pageElement) {
      scrollContainer.scrollTop = pageElement.offsetTop - topBarHeight - 62;
    }
  }, [pages.length]);
  
  
  // Early return: one "page" with the loader in the same slot as the first page; real pages replace it when loaded
  if (pages.length === 0) {
    return (
      <>
        <PDFTopBar
          currentPage={1}
          totalPages={1}
          onPageChange={() => {}}
          onPreviousPage={() => {}}
          onNextPage={() => {}}
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          zoom={1}
          onZoomChange={() => {}}
          onDownload={() => {}}
          isDownloading={false}
          filename="weird-attachments.pdf"
        />
        <PDFViewer
          currentPage={1}
          totalPages={1}
          onPageChange={() => {}}
          filename="weird-attachments.pdf"
          zoom={1}
        >
          <div className="pdf-pages-container">
            <div className="pdf-page-wrapper" id="pdf-page-0">
              <article className="page-sheet">
                <DitheredLoader inline />
              </article>
            </div>
          </div>
        </PDFViewer>
      </>
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
        isDownloading={isDownloadingPdf}
        filename="weird-attachments.pdf"
      />
      <PDFViewer
        currentPage={1}
        totalPages={pagesWithTOC.length}
        onPageChange={(pageNum) => {
          const pageIndex = pageNum - 1;
          const page = pagesWithTOC[pageIndex];
          if (page) {
            const pageElement = document.getElementById(`pdf-page-${pageIndex}`);
            const scrollContainer = document.querySelector('.pdf-viewer');
            const topBar = document.querySelector('.pdf-top-bar');
            const topBarHeight = topBar ? topBar.offsetHeight : 0;
            if (scrollContainer && pageElement) {
              scrollContainer.scrollTo({ top: pageElement.offsetTop - topBarHeight - 24, behavior: 'smooth' });
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

