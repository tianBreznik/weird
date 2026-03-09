/**
 * Footnote parsing and rendering utilities
 * 
 * Syntax: ^[footnote content here]
 * This will be replaced with a superscript number and the content
 * will be displayed at the bottom of the page-frame.
 */

/**
 * Parse footnotes from content and return structured data
 * @param {string} content - The chapter content with ^[footnote] syntax
 * @returns {Object} - { content: cleaned content, footnotes: array of {id, content, index} }
 */
export const parseFootnotes = (content) => {
  if (!content) return { content: '', footnotes: [] };
  
  const footnotes = [];
  let match;
  let footnoteIndex = 0;

  // 1) Legacy markdown-style syntax: ^[content]
  const legacyRegex = /\^\[([^\]]+)\]/g;
  while ((match = legacyRegex.exec(content)) !== null) {
    const fullMatch = match[0]; // ^[content]
    const footnoteContent = match[1]; // content
    const startIndex = match.index;
    
    footnotes.push({
      id: `fn-${startIndex}`, // Unique ID based on position
      content: footnoteContent.trim(),
      index: startIndex,
      fullMatch,
    });
    
    footnoteIndex++;
  }

  // 2) TipTap-generated HTML: <sup class="footnote-ref" data-id="" data-number="" data-content="...">n</sup>
  const supRegex = /<sup([^>]*)>([\s\S]*?)<\/sup>/gi;
  while ((match = supRegex.exec(content)) !== null) {
    const attrs = match[1] || '';
    const innerText = match[2] || '';

    // Must have class containing "footnote-ref"
    const classMatch = attrs.match(/class=["']([^"']*)["']/i);
    if (!classMatch || !classMatch[1].split(/\s+/).includes('footnote-ref')) {
      continue;
    }

    const idMatch = attrs.match(/data-(?:id|footnote-id)=["']([^"']+)["']/i);
    const contentAttrMatch = attrs.match(/data-content=["']([^"']*)["']/i);
    const numberAttrMatch = attrs.match(/data-(?:number|footnote-number)=["']([^"']+)["']/i);

    const id = idMatch ? idMatch[1] : `fn-html-${footnoteIndex}`;
    const textContent = contentAttrMatch ? contentAttrMatch[1] : '';
    const number = numberAttrMatch ? parseInt(numberAttrMatch[1], 10) : null;

    if (!textContent) continue;

    footnotes.push({
      id,
      content: textContent.trim(),
      index: match.index,
      fullMatch: match[0],
      number,
    });

    footnoteIndex++;
  }
  
  return {
    content,
    footnotes,
  };
};

/**
 * Check if a chapter is the auto-generated acknowledgements chapter (by title).
 * Used so we can generate its content from all footnotes and so we don't create duplicates.
 */
export const isAcknowledgementsChapter = (chapter) => {
  if (!chapter) return false;
  const raw = chapter.title != null ? String(chapter.title).trim() : '';
  if (!raw) return false;
  const t = raw.toLowerCase();
  return t === 'acknowledgements' || t.includes('acknowledgement') || t.includes('zahvale');
};

export const ACKNOWLEDGEMENTS_CHAPTER_TITLE = 'Acknowledgements';

/**
 * Get all footnotes from all chapters for global numbering
 * @param {Array} chapters - Array of chapter objects with content
 * @returns {Array} - Array of footnotes with global numbering
 */
export const getAllFootnotes = (chapters) => {
  if (!chapters || chapters.length === 0) return [];
  
  const allFootnotes = [];
  let globalNumber = 1;
  
  chapters.forEach((chapter) => {
    // Parse chapter content
    const chapterSource = chapter.contentHtml || chapter.content;
    if (chapterSource) {
      const parsed = parseFootnotes(chapterSource);
      parsed.footnotes.forEach((fn) => {
        allFootnotes.push({
          ...fn,
          globalNumber: globalNumber++,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
        });
      });
    }
    
    // Parse subchapter content
    if (chapter.children) {
      chapter.children.forEach((subchapter) => {
        const subSource = subchapter.contentHtml || subchapter.content;
        if (subSource) {
          const parsed = parseFootnotes(subSource);
          parsed.footnotes.forEach((fn) => {
            allFootnotes.push({
              ...fn,
              globalNumber: globalNumber++,
              chapterId: chapter.id,
              subchapterId: subchapter.id,
              chapterTitle: chapter.title,
              subchapterTitle: subchapter.title,
            });
          });
        }
      });
    }
  });
  
  return allFootnotes;
};

/**
 * Replace footnote syntax with superscript numbers in HTML
 * @param {string} content - Content with ^[footnote] syntax
 * @param {Array} footnotes - Array of footnotes for this page/chapter
 * @param {Function} onFootnoteClick - Callback when footnote is clicked
 * @returns {string} - HTML with footnotes replaced by superscript numbers
 */
export const renderFootnotesInContent = (content, footnotes = [], onFootnoteClick = null) => {
  if (!content) return '';
  
  // Create a map of footnote content to global number
  const footnoteMap = new Map();
  footnotes.forEach((fn, idx) => {
    // Match by content (since we're processing page by page)
    footnoteMap.set(fn.content.trim(), fn.globalNumber || (idx + 1));
  });
  
  const escapeTitle = (s) => String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/&/g, '&amp;');
  const toSuperscript = (n) => String(n).replace(/[0-9]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]);
  
  // Replace ^[content] with superscript
  const footnoteRegex = /\^\[([^\]]+)\]/g;
  let footnoteCounter = 1; // Local counter for this page
  
  const html = content.replace(footnoteRegex, (match, footnoteContent) => {
    const trimmedContent = footnoteContent.trim();
    // Try to find global number, otherwise use local counter
    const globalNumber = footnoteMap.get(trimmedContent) || footnoteCounter++;
    
    const clickHandler = onFootnoteClick 
      ? `onclick="window.footnoteClickHandler && window.footnoteClickHandler(${globalNumber}); return false;"`
      : '';
    
    const titleWithSuperscript = escapeTitle(toSuperscript(globalNumber) + ' ' + trimmedContent);
    return `<sup class="footnote-ref" data-footnote-number="${globalNumber}" title="${titleWithSuperscript}" ${clickHandler}>${globalNumber}</sup>`;
  });
  
  return html;
};

/**
 * Generate HTML for footnotes section at bottom of page
 * @param {Array} footnotes - Array of footnotes for this page
 * @returns {string} - HTML for footnotes section
 */
export const renderFootnotesSection = (footnotes) => {
  if (!footnotes || footnotes.length === 0) return '';
  
  const footnotesHtml = footnotes
    .map((fn, idx) => {
      const number = fn.globalNumber || (idx + 1);
      return `
        <div class="footnote-item" id="footnote-${number}">
          <sup class="footnote-number">${number}.</sup>
          <span class="footnote-content">${fn.content}</span>
        </div>
      `;
    })
    .join('');
  
  return `
    <div class="footnotes-section">
      <div class="footnotes-divider"></div>
      <div class="footnotes-list">
        ${footnotesHtml}
      </div>
    </div>
  `;
};

/**
 * Generate content for acknowledgements chapter
 * @param {Array} allFootnotes - All footnotes from all chapters
 * @returns {string} - HTML content for acknowledgements chapter
 */
export const generateAcknowledgementsContent = (allFootnotes) => {
  if (!allFootnotes || allFootnotes.length === 0) {
    return '<p>No acknowledgements.</p>';
  }
  
  let html = '<div class="acknowledgements-content">';
  html += `<h2 class="acknowledgements-page-title">${ACKNOWLEDGEMENTS_CHAPTER_TITLE}</h2>`;
  
  allFootnotes.forEach((fn) => {
    html += `
      <div class="acknowledgement-item">
        <span class="acknowledgement-number">${fn.globalNumber}.</span>
        <span class="acknowledgement-content">${fn.content}</span>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
};

