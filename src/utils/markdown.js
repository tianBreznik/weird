// Simple HTML wrapper for TipTap content
// All content is now HTML from TipTap, so we just ensure proper wrapping
export function renderMarkdownWithParagraphs(text) {
  if (!text) return '';
  
  const trimmed = text.trim();
  if (!trimmed) return '';
  
  // Check if content already starts with a block tag
  const startsWithBlockTag = trimmed.match(/^<(p|h[1-6]|div|ul|ol|blockquote)/i);
  
  if (!startsWithBlockTag) {
    // Wrap content in <p> if it doesn't start with a block tag
    return `<p>${trimmed}</p>`;
  }
  
  return trimmed;
}
