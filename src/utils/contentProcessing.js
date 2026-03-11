import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';

const escapeHtml = (text) => {
  const s = String(text || '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Extract blank-page and background videos from HTML content
 * Returns object with:
 * - videoElements: Array of blank-page videos (to be on separate pages)
 * - htmlContent: HTML with videos removed
 */
export const extractVideosFromContent = (htmlContent) => {
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
  let cleanedContent = htmlContent;
  videosToRemove.forEach(videoHtml => {
    cleanedContent = cleanedContent.replace(videoHtml, '');
  });
  
  return { videoElements, htmlContent: cleanedContent };
};

/**
 * Replace long dashes with short hyphens
 */
export const replaceLongDashes = (htmlContent) => {
  // Replace em dash (—) and en dash (–) with regular hyphen (-)
  return htmlContent.replace(/—/g, '-').replace(/–/g, '-');
};

/**
 * Wait for images to load before proceeding with pagination
 */
export const waitForImagesToLoad = (contentDiv) => {
  return new Promise((resolve) => {
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
};

import { applyHyphenationToHTML } from './paginationHelpers';

/**
 * Process HTML content: extract videos, replace dashes, hyphenate, prepare for pagination.
 * Hyphenation is applied here so pagination measures the same text we render (avoids
 * measurement/render mismatch that causes early breaks and empty space).
 */
export const processHTMLContent = async (htmlContent, isDesktop) => {
  // Extract videos first
  const { videoElements, htmlContent: contentWithoutVideos } = extractVideosFromContent(htmlContent);
  
  // Replace long dashes with short hyphens
  const contentWithHyphens = replaceLongDashes(contentWithoutVideos);
  
  // Hyphenate before parsing — ensures measurement matches final render
  const contentHyphenated = applyHyphenationToHTML(contentWithHyphens);
  
  // Create temporary container for image loading
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.visibility = 'hidden';
  tempContainer.style.width = '90vw';
  tempContainer.style.padding = '1rem';
  tempContainer.style.top = '-9999px';
  tempContainer.style.left = '-9999px';
  document.body.appendChild(tempContainer);
  
  const contentDiv = document.createElement('div');
  // Use both chapter-content and page-content classes so measurements
  // see the exact same image/paragraph CSS as the real reader.
  contentDiv.className = 'chapter-content page-content';
  contentDiv.style.fontFamily = "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif";
  contentDiv.style.fontSize = isDesktop ? '1.3rem' : '1.3rem';
  contentDiv.style.lineHeight = isDesktop ? '1.35' : '1.35';
  contentDiv.style.color = '#0a0a0a';
  contentDiv.innerHTML = contentHyphenated;
  tempContainer.appendChild(contentDiv);
  
  // Set loading="eager" on all images to prevent lazy loading
  // This ensures images are always loaded, not lazy-loaded when scrolling
  contentDiv.querySelectorAll('img').forEach((img) => {
    img.setAttribute('loading', 'eager');
    img.setAttribute('decoding', 'async');
  });
  
  // Wait for images to load so height measurements are accurate
  await waitForImagesToLoad(contentDiv);
  
  const elements = Array.from(contentDiv.children);

  // Cache measured heights on each element before detaching from DOM
  elements.forEach((el, index) => {
    try {
      const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : el.offsetHeight;
      if (h && h > 0) {
        el.dataset.measuredHeight = String(h);
      }
    } catch (e) {
      // ignore measurement errors
    }
  });
  
  // Cleanup
  document.body.removeChild(tempContainer);
  
  return { elements, videoElements };
};

/**
 * Build content array: chapter content + all subchapter content.
 * Subchapters inherit fontFamily from their parent chapter.
 */
export const buildChapterContentBlocks = (chapter) => {
  const contentBlocks = [];
  const hasChapterContent = !!(chapter.contentHtml || chapter.content);
  const chapterFont = chapter.fontFamily ?? DEFAULT_CHAPTER_FONT;

  if (hasChapterContent) {
    contentBlocks.push({
      type: 'chapter',
      title: chapter.title,
      content: chapter.contentHtml || chapter.content,
      epigraph: chapter.epigraph ?? null,
      chapterId: chapter.id,
      subchapterId: null,
      pageBorder: !!chapter.pageBorder,
      pageBorderImageUrl: chapter.pageBorderImageUrl || null,
      pageBorderWidth: chapter.pageBorderWidth || null,
      pageBorderSlicePercent: chapter.pageBorderSlicePercent || null,
      hideTitle: !!chapter.hideTitle,
      fontFamily: chapterFont,
    });
  }

  if (chapter.children && chapter.children.length > 0) {
    let isFirstSubchapter = true;
    chapter.children.forEach((subchapter) => {
      if (subchapter.contentHtml || subchapter.content) {
        let content = subchapter.contentHtml || subchapter.content;
        // Ensure subchapter title appears on page: if content has no h4 heading, prepend it
        const hasH4 = /<h4[^>]*>[\s\S]*?<\/h4>/i.test(content);
        if (subchapter.title && !hasH4) {
          content = `<h4>${escapeHtml(subchapter.title)}</h4>${content}`;
        }
        contentBlocks.push({
          type: 'subchapter',
          title: subchapter.title,
          content,
          epigraph: subchapter.epigraph ?? null,
          chapterId: chapter.id,
          subchapterId: subchapter.id,
          pageBorder: !!subchapter.pageBorder,
          pageBorderImageUrl: subchapter.pageBorderImageUrl || null,
          pageBorderWidth: subchapter.pageBorderWidth || null,
          pageBorderSlicePercent: subchapter.pageBorderSlicePercent || null,
          includeChapterTitle: !hasChapterContent && isFirstSubchapter, // Include chapter title if chapter has no content
          hideTitle: !!subchapter.hideTitle,
          fontFamily: chapterFont, // Subchapters inherit parent chapter font
        });
        isFirstSubchapter = false;
      }
    });
  }

  return contentBlocks;
};

