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

/** Inline style props that change line box height / leading when pasted from Word/Docs/etc. */
const TYPOGRAPHY_METRIC_PROPS = new Set(['font-size', 'line-height']);

/**
 * Strip paste-imported font-size / line-height from HTML.
 * Keeps color, weight, decoration, etc. Unwraps spans left with no attributes.
 * Used on paste (editor) and on mobile pagination so reader leading stays uniform.
 */
export const stripInlineTypographyMetrics = (htmlContent) => {
  if (!htmlContent) return htmlContent;
  if (typeof document === 'undefined') return htmlContent;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlContent;

  wrapper.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    const kept = [];
    style.split(';').forEach((rule) => {
      const trimmed = rule.trim();
      if (!trimmed) return;
      const [prop, ...rest] = trimmed.split(':');
      if (!prop || rest.length === 0) return;
      const name = prop.trim().toLowerCase();
      if (TYPOGRAPHY_METRIC_PROPS.has(name)) return;
      kept.push(`${name}: ${rest.join(':').trim()}`);
    });
    if (kept.length > 0) {
      el.setAttribute('style', kept.join('; '));
    } else {
      el.removeAttribute('style');
    }
  });

  // Unwrap spans that only existed to carry the stripped metrics
  wrapper.querySelectorAll('span').forEach((span) => {
    if (span.attributes.length > 0) return;
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  });

  return wrapper.innerHTML;
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
 *
 * @param {string} htmlContent
 * @param {boolean} isDesktop
 * @param {{ standardizeTypography?: boolean }} [options]
 *   standardizeTypography — strip paste font-size/line-height (default: mobile only).
 *   Pass false for cover / first page so their designed sizes stay intact.
 */
export const processHTMLContent = async (htmlContent, isDesktop, options = {}) => {
  const standardizeTypography =
    options.standardizeTypography !== undefined
      ? options.standardizeTypography
      : !isDesktop;

  // Extract videos first
  const { videoElements, htmlContent: contentWithoutVideos } = extractVideosFromContent(htmlContent);
  
  // Replace long dashes with short hyphens
  let contentPrepared = replaceLongDashes(contentWithoutVideos);

  // Mobile body pages: one font-size + line-height. Cover/first page opt out.
  if (standardizeTypography) {
    contentPrepared = stripInlineTypographyMetrics(contentPrepared);
  }
  
  // Hyphenate before parsing — ensures measurement matches final render
  const contentHyphenated = applyHyphenationToHTML(contentPrepared);
  
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
  // Match pageGeometry getFontSize / getLineHeight (and live CSS for body pages).
  contentDiv.style.fontSize = isDesktop ? '1.35rem' : '1.3rem';
  contentDiv.style.lineHeight = isDesktop ? '1.50' : '1.35';
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
      pageBorderImageNaturalWidth: chapter.pageBorderImageNaturalWidth || null,
      pageBorderImageNaturalHeight: chapter.pageBorderImageNaturalHeight || null,
      pageBorderAssetKind: chapter.pageBorderAssetKind || null,
      pageBorderSliceVerticalPercent: chapter.pageBorderSliceVerticalPercent || null,
      pageBorderSliceHorizontalPercent: chapter.pageBorderSliceHorizontalPercent || null,
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
          pageBorderImageNaturalWidth: subchapter.pageBorderImageNaturalWidth || null,
          pageBorderImageNaturalHeight: subchapter.pageBorderImageNaturalHeight || null,
          pageBorderAssetKind: subchapter.pageBorderAssetKind || null,
          pageBorderSliceVerticalPercent: subchapter.pageBorderSliceVerticalPercent || null,
          pageBorderSliceHorizontalPercent: subchapter.pageBorderSliceHorizontalPercent || null,
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

/** True if HTML contains karaoke markers (mobile reflow falls back to packer). */
export const htmlHasKaraoke = (html) => {
  if (!html) return false;
  return (
    html.includes('data-karaoke-block') ||
    html.includes('data-karaoke') ||
    html.includes('karaoke-object')
  );
};

/**
 * Prepare continuous chapter HTML for mobile CSS-column reflow.
 * Strips blank/background videos (returned separately), dashes, optional
 * typography metrics, and hyphenates — no element packing.
 *
 * @returns {{
 *   html: string,
 *   videoElements: Array,
 *   hasKaraoke: boolean,
 *   hasFieldNotes: boolean,
 * }}
 */
export const buildMobileReflowDocument = (chapter, options = {}) => {
  const { standardizeTypography = true } = options;
  const blocks = buildChapterContentBlocks(chapter);
  const combinedRaw = blocks.map((b) => b.content || '').join('');
  const hasKaraoke = htmlHasKaraoke(combinedRaw);
  const hasFieldNotes = combinedRaw.includes('data-field-notes-block');

  if (hasKaraoke || hasFieldNotes || blocks.length === 0) {
    return {
      html: '',
      videoElements: [],
      hasKaraoke,
      hasFieldNotes,
      blocks,
    };
  }

  const videoElements = [];
  const htmlParts = [];

  blocks.forEach((block) => {
    let html = block.content || '';
    const extracted = extractVideosFromContent(html);
    extracted.videoElements.forEach((v) => videoElements.push({ ...v, block }));
    html = extracted.htmlContent;
    html = replaceLongDashes(html);
    if (standardizeTypography) {
      html = stripInlineTypographyMetrics(html);
    }
    html = applyHyphenationToHTML(html);
    if (html.trim()) {
      htmlParts.push(html);
    }
  });

  return {
    html: htmlParts.join(''),
    videoElements,
    hasKaraoke: false,
    hasFieldNotes: false,
    blocks,
  };
};

