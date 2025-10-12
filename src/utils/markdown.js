// Simple markdown renderer for basic formatting
export function renderMarkdown(text) {
  if (!text) return '';
  
  console.log('Original text:', text);
  
  let result = text
    // Headers first (before other processing)
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>');
    
  console.log('After header processing:', result);
    
  result = result
    // Bold: **text** -> <strong>text</strong>
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic: *text* -> <em>text</em> (but not **text**)
    .replace(/(?<!\*)\*([^*\s]+(?:\s+[^*\s]+)*?)\*(?!\*)/g, '<em>$1</em>')
    // Strikethrough: -text- -> <del>text</del> (but not in HTML attributes)
    .replace(/(?<!["\w])-([^-\s]+(?:\s+[^-\s]+)*?)-(?!["\w])/g, '<del>$1</del>')
    // Line breaks: double newline -> paragraph break
    .replace(/\n\n/g, '</p><p>')
    // Single newlines: -> <br>
    .replace(/\n/g, '<br>');
    
  console.log('Final result:', result);
  return result;
}

export function renderMarkdownWithParagraphs(text) {
  if (!text) return '';
  
  console.log('renderMarkdownWithParagraphs - Original text:', text);
  
  // Process custom large text syntax: #text -> <span class="large-text">text</span>
  let result = text
    .replace(/#([^\s#][^#]*?)(?=\s|$)/g, '<span class="large-text">$1</span>');
    
  console.log('After large text processing:', result);
  
  // Now render the rest of the markdown
  result = renderMarkdown(result);
  
  console.log('Final result from renderMarkdownWithParagraphs:', result);
  return result;
}
