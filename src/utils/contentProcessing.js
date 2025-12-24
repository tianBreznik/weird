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

/**
 * Process HTML content: extract videos, replace dashes, prepare for pagination
 */
export const processHTMLContent = async (htmlContent, isDesktop) => {
  // Extract videos first
  const { videoElements, htmlContent: contentWithoutVideos } = extractVideosFromContent(htmlContent);
  
  // Replace long dashes with short hyphens
  const contentWithHyphens = replaceLongDashes(contentWithoutVideos);
  
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
  contentDiv.className = 'chapter-content';
  contentDiv.style.fontFamily = "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif";
  contentDiv.style.fontSize = isDesktop ? '1.3rem' : '1.3rem';
  contentDiv.style.lineHeight = isDesktop ? '1.35' : '1.35';
  contentDiv.style.color = '#0a0a0a';
  contentDiv.innerHTML = contentWithHyphens;
  tempContainer.appendChild(contentDiv);
  
  // Wait for images to load
  await waitForImagesToLoad(contentDiv);
  
  const elements = Array.from(contentDiv.children);
  
  // Cleanup
  document.body.removeChild(tempContainer);
  
  return { elements, videoElements };
};

/**
 * Build content array: chapter content + all subchapter content
 */
export const buildChapterContentBlocks = (chapter) => {
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
  
  return contentBlocks;
};

