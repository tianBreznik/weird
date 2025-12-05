import { Node, Mark, Extension } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';

// Custom block node for karaoke
export const KaraokeBlock = Node.create({
  name: 'karaokeBlock',
  group: 'block',
  atom: true, // Cannot be split
  draggable: true,
  
  addAttributes() {
    return {
      id: {
        default: null,
      },
      audioUrl: {
        default: null,
      },
      timingsJson: {
        default: null,
      },
      text: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-karaoke-block="true"]',
        getAttrs: (node) => {
          // Parse existing karaoke elements from database
          const karaokeData = node.getAttribute('data-karaoke');
          const karaokeId = node.getAttribute('data-karaoke-id');
          const text = node.textContent || '';
          
          if (karaokeData) {
            try {
              const decoded = JSON.parse(decodeURIComponent(karaokeData));
              return {
                id: karaokeId || `karaoke-${Date.now()}`,
                audioUrl: decoded.audioUrl || '',
                timingsJson: JSON.stringify(decoded.wordTimings || []),
                text: decoded.text || text,
              };
            } catch (e) {
              console.warn('Failed to parse karaoke data:', e);
            }
          }
          
          // Fallback: extract from attributes or text content
          return {
            id: karaokeId || `karaoke-${Date.now()}`,
            audioUrl: node.getAttribute('data-audio-url') || '',
            timingsJson: node.getAttribute('data-timings') || '[]',
            text: text,
          };
        },
      },
      {
        tag: 'div.karaoke-object',
        getAttrs: (node) => {
          // Also match karaoke-object class for backward compatibility
          const karaokeData = node.getAttribute('data-karaoke');
          const text = node.textContent || '';
          
          if (karaokeData) {
            try {
              const decoded = JSON.parse(decodeURIComponent(karaokeData));
              return {
                id: node.getAttribute('data-karaoke-id') || `karaoke-${Date.now()}`,
                audioUrl: decoded.audioUrl || '',
                timingsJson: JSON.stringify(decoded.wordTimings || []),
                text: decoded.text || text,
              };
            } catch (e) {
              console.warn('Failed to parse karaoke data:', e);
            }
          }
          
          return {
            id: node.getAttribute('data-karaoke-id') || `karaoke-${Date.now()}`,
            audioUrl: node.getAttribute('data-audio-url') || '',
            timingsJson: node.getAttribute('data-timings') || '[]',
            text: text,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Reconstruct the original karaoke data structure for compatibility
    const karaokeData = {
      type: 'karaoke',
      text: HTMLAttributes.text || '',
      audioUrl: HTMLAttributes.audioUrl || '',
      wordTimings: HTMLAttributes.timingsJson ? JSON.parse(HTMLAttributes.timingsJson) : [],
    };
    
    const karaokePayload = encodeURIComponent(JSON.stringify(karaokeData));
    
    return [
      'div',
      {
        class: 'karaoke-object karaoke-editor-marker',
        'data-karaoke-block': 'true',
        'data-karaoke': karaokePayload,
        'data-karaoke-id': HTMLAttributes.id || `karaoke-${Date.now()}`,
        contenteditable: 'false',
      },
      HTMLAttributes.text || '',
    ];
  },
});

// Custom block node for dinkus (section separator)
export const Dinkus = Node.create({
  name: 'dinkus',
  group: 'block',
  atom: true,
  
  parseHTML() {
    return [
      {
        tag: 'p.dinkus',
      },
      {
        tag: 'div.dinkus',
      },
    ];
  },

  renderHTML() {
    return ['p', { class: 'dinkus' }, '* * *'];
  },

  addNodeView() {
    return () => {
      const p = document.createElement('p');
      p.className = 'dinkus';
      p.textContent = '* * *';
      p.style.textAlign = 'center';
      p.style.margin = '1rem 0';
      p.style.opacity = '0.5';
      return {
        dom: p,
      };
    };
  },
});

// Custom mark for highlight with color
export const Highlight = Mark.create({
  name: 'highlight',
  
  // Allow this mark to stack with other marks like TextColor
  excludes: '', // Empty string means this mark can coexist with any other mark
  
  addAttributes() {
    return {
      color: {
        default: '#ffeb3b',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'mark',
        getAttrs: (node) => {
          // Get background-color from style attribute or inline style
          // Only extract background-color, not text color (that's handled by TextColor mark)
          const styleAttr = node.getAttribute('style') || '';
          const bgColorMatch = styleAttr.match(/background-color\s*:\s*([^;]+)/i);
          const color = bgColorMatch 
            ? bgColorMatch[1].trim() 
            : (node.style?.backgroundColor || node.getAttribute('data-color') || '#ffeb3b');
          return { color };
        },
      },
      {
        tag: 'span',
        getAttrs: (node) => {
          // Also match spans with highlight background color
          // This should work even if the span also has color (for TextColor mark)
          const styleAttr = node.getAttribute('style') || '';
          if (styleAttr.includes('background-color')) {
            const bgColorMatch = styleAttr.match(/background-color\s*:\s*([^;]+)/i);
            if (bgColorMatch) {
              console.log('[Highlight] Found background-color in span:', bgColorMatch[1].trim(), 'full style:', styleAttr);
              return { color: bgColorMatch[1].trim() };
            }
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      {
        style: `background-color: ${HTMLAttributes.color || '#ffeb3b'}`,
      },
      0,
    ];
  },
});

// Custom mark for text color
export const TextColor = Mark.create({
  name: 'textColor',
  
  // Allow this mark to stack with other marks like Highlight
  excludes: '',
  
  addAttributes() {
    return {
      color: {
        default: '#000000',
      },
    };
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ chain }) =>
          chain()
            .setMark(this.name, { color })
            .run(),
      unsetTextColor:
        () =>
        ({ chain }) =>
          chain()
            .unsetMark(this.name)
            .run(),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'mark',
        priority: 100, // Higher priority to check mark tags first
        getAttrs: (node) => {
          // Check mark tags for color (when mark has both background-color and color)
          // This allows TextColor to stack with Highlight mark
          // Highlight renders as <mark>, so we need to parse color from mark tags
          const styleAttr = node.getAttribute('style') || '';
          
          // Parse style string more carefully to avoid matching "background-color"
          let color = null;
          if (styleAttr) {
            // Split by semicolon and find the "color:" property (not "background-color:")
            const styleParts = styleAttr.split(';').map(s => s.trim()).filter(s => s);
            const colorPart = styleParts.find(part => {
              const normalized = part.trim().toLowerCase();
              return normalized.startsWith('color:') && !normalized.startsWith('background-color:');
            });
            
            if (colorPart) {
              const colonIndex = colorPart.indexOf(':');
              if (colonIndex !== -1) {
                color = colorPart.substring(colonIndex + 1).trim();
              }
            }
          }
          
          // Fallback to computed style or data attribute
          if (!color) {
            color = node.style?.color || node.getAttribute('data-color');
          }
          
          // Accept ANY color value as-is (white, black, rgb, hex, named colors, etc.)
          if (color && color.trim() !== '') {
            console.log('[TextColor] Found text color in mark:', color, 'from style:', styleAttr);
            return { color: color.trim() };
          }
          return false;
        },
      },
      {
        tag: 'span',
        getAttrs: (node) => {
          // Get color from style attribute or inline style
          // This MUST work even if the span also has background-color (for Highlight mark)
          const styleAttr = node.getAttribute('style') || '';
          console.log('[TextColor] Checking span with style:', styleAttr);
          
          // Parse style string more carefully to avoid matching "background-color"
          let color = null;
          if (styleAttr) {
            // Split by semicolon and find the "color:" property (not "background-color:")
            const styleParts = styleAttr.split(';').map(s => s.trim()).filter(s => s);
            console.log('[TextColor] Style parts:', styleParts);
            const colorPart = styleParts.find(part => {
              const normalized = part.trim().toLowerCase();
              return normalized.startsWith('color:') && !normalized.startsWith('background-color:');
            });
            
            if (colorPart) {
              const colonIndex = colorPart.indexOf(':');
              if (colonIndex !== -1) {
                color = colorPart.substring(colonIndex + 1).trim();
                console.log('[TextColor] Found color in span:', color);
              }
            }
          }
          
          // Fallback to computed style or data attribute
          if (!color) {
            color = node.style?.color || node.getAttribute('data-color');
            if (color) {
              console.log('[TextColor] Found color from computed style or data attribute:', color);
            }
          }
          
          // Only return color if we found one (don't match spans without color)
          // Accept ANY color value as-is (white, black, rgb, hex, named colors, etc.)
          // This MUST work even if the span also has background-color
          if (color && color.trim() !== '') {
            console.log('[TextColor] Returning color for span:', color.trim());
            return { color: color.trim() };
          }
          console.log('[TextColor] No color found in span, returning false');
          return false;
        },
      },
      {
        tag: 'font',
        getAttrs: (node) => {
          // Also match old <font color=""> tags
          const color = node.getAttribute('color');
          return color ? { color } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        style: `color: ${HTMLAttributes.color || '#000000'}`,
      },
      0,
    ];
  },
});

// Custom Mark for Underline
export const Underline = Mark.create({
  name: 'underline',
  
  parseHTML() {
    return [
      {
        tag: 'u',
      },
      {
        tag: 'span',
        getAttrs: (node) => {
          const style = node.getAttribute('style') || '';
          if (style.includes('text-decoration') && style.includes('underline')) {
            return {};
          }
          return false;
        },
      },
    ];
  },

  renderHTML() {
    return ['u', 0];
  },
});

// Custom inline node for footnote reference
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  
  addAttributes() {
    return {
      id: {
        default: null,
      },
      number: {
        default: null,
      },
      content: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'sup.footnote-ref',
        getAttrs: (node) => ({
          id: node.getAttribute('data-id'),
          number: parseInt(node.getAttribute('data-number') || node.textContent, 10),
          content: node.getAttribute('data-content') || null,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      {
        class: 'footnote-ref',
        'data-id': HTMLAttributes.id,
        'data-number': HTMLAttributes.number,
        'data-content': HTMLAttributes.content,
      },
      String(HTMLAttributes.number || ''),
    ];
  },
});

// Drop cap is handled via paragraph class, no separate extension needed
// The applyDropCap function in ChapterEditor.jsx toggles the 'drop-cap' class on paragraphs

// Custom extension for Indent (increases left margin/padding)
export const Indent = Extension.create({
  name: 'indent',
  
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: element => parseInt(element.getAttribute('data-indent') || '0', 10),
            renderHTML: attributes => {
              if (!attributes.indent || attributes.indent === 0) {
                return {};
              }
              return {
                'data-indent': attributes.indent,
                style: `padding-left: ${attributes.indent * 1.5}rem;`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }) => {
        const { selection } = state;
        const { from, to } = selection;
        
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const currentIndent = node.attrs.indent || 0;
            const newIndent = Math.min(currentIndent + 1, 6); // Max 6 levels
            if (dispatch) {
              tr.setNodeMarkup(pos, null, { ...node.attrs, indent: newIndent });
            }
          }
        });
        
        if (dispatch) dispatch(tr);
        return true;
      },
      
      outdent: () => ({ tr, state, dispatch }) => {
        const { selection } = state;
        const { from, to } = selection;
        
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const currentIndent = node.attrs.indent || 0;
            const newIndent = Math.max(currentIndent - 1, 0);
            if (dispatch) {
              tr.setNodeMarkup(pos, null, { ...node.attrs, indent: newIndent });
            }
          }
        });
        
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

// Custom Paragraph extension that properly handles class attribute for drop cap
export const CustomParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      class: {
        default: 'para-body',
        parseHTML: element => {
          const classAttr = element.getAttribute('class');
          return classAttr || 'para-body';
        },
        renderHTML: attributes => {
          if (!attributes.class) {
            return { class: 'para-body' };
          }
          return {
            class: attributes.class,
          };
        },
      },
    };
  },
});

// Custom block node for video
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true, // Cannot be split
  draggable: true,
  
  addAttributes() {
    return {
      src: {
        default: null,
      },
      controls: {
        default: true,
      },
      style: {
        default: 'max-width:100%;height:auto;display:block;margin:8px 0;',
      },
      mode: {
        default: 'blank-page', // 'blank-page' or 'background'
        parseHTML: (element) => element.getAttribute('data-video-mode') || 'blank-page',
        renderHTML: (attributes) => {
          if (!attributes.mode || attributes.mode === 'blank-page') {
            return {};
          }
          return {
            'data-video-mode': attributes.mode,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video',
        getAttrs: (node) => ({
          src: node.getAttribute('src'),
          controls: node.hasAttribute('controls'),
          style: node.getAttribute('style') || 'max-width:100%;height:auto;display:block;margin:8px 0;',
          mode: node.getAttribute('data-video-mode') || 'blank-page',
        }),
      },
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const container = document.createElement('div');
      container.className = 'video-container';
      container.style.position = 'relative';
      container.style.display = 'block';
      container.style.margin = '8px 0';
      
      const video = document.createElement('video');
      video.src = HTMLAttributes.src || node.attrs.src;
      video.controls = HTMLAttributes.controls !== false;
      video.style.width = '100%';
      video.style.height = 'auto';
      video.style.display = 'block';
      
      // Add data-video-mode attribute if mode is set and not 'blank-page'
      const mode = HTMLAttributes.mode || node.attrs.mode || 'blank-page';
      if (mode !== 'blank-page') {
        video.setAttribute('data-video-mode', mode);
      }
      
      // Add mode badge
      const badge = document.createElement('div');
      badge.className = 'video-mode-badge';
      badge.textContent = mode === 'background' ? '🎬 BG' : '📄 Page';
      badge.style.position = 'absolute';
      badge.style.top = '8px';
      badge.style.right = '8px';
      badge.style.backgroundColor = mode === 'background' 
        ? 'rgba(59, 130, 246, 0.9)' 
        : 'rgba(107, 114, 128, 0.9)';
      badge.style.color = 'white';
      badge.style.padding = '4px 8px';
      badge.style.borderRadius = '4px';
      badge.style.fontSize = '0.75rem';
      badge.style.fontWeight = '500';
      badge.style.pointerEvents = 'none';
      badge.style.zIndex = '10';
      badge.style.userSelect = 'none';
      
      container.appendChild(video);
      container.appendChild(badge);
      
      // Handle click to select video (desktop only - mobile uses native video controls)
      // REMOVED: All touch event handlers to prevent interference with mobile typing
      const handleSelect = () => {
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos !== null && pos !== undefined) {
            editor.commands.setTextSelection(pos);
            editor.commands.focus();
          }
        }
      };
      
      // Desktop click handler only - no touch handlers to avoid breaking mobile typing
      container.addEventListener('click', (e) => {
        // Only handle clicks on container/badge, not video itself
        if (e.target === container || e.target === badge) {
          e.preventDefault();
          e.stopPropagation();
          handleSelect();
        }
        // If clicking on video, let it through to video controls
      });
      
      return {
        dom: container,
        contentDOM: null, // Video is an atom node, no content
        update: (updatedNode) => {
          // Update badge when mode changes
          const updatedMode = updatedNode.attrs.mode || 'blank-page';
          badge.textContent = updatedMode === 'background' ? '🎬 BG' : '📄 Page';
          badge.style.backgroundColor = updatedMode === 'background' 
            ? 'rgba(59, 130, 246, 0.9)' 
            : 'rgba(107, 114, 128, 0.9)';
          
          // Update video data attribute
          if (updatedMode !== 'blank-page') {
            video.setAttribute('data-video-mode', updatedMode);
          } else {
            video.removeAttribute('data-video-mode');
          }
          
          return true;
        },
      };
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      src: HTMLAttributes.src,
      controls: HTMLAttributes.controls !== false,
      style: HTMLAttributes.style || 'max-width:100%;height:auto;display:block;margin:8px 0;',
    };
    
    // Add data-video-mode attribute if mode is set and not 'blank-page'
    if (HTMLAttributes.mode && HTMLAttributes.mode !== 'blank-page') {
      attrs['data-video-mode'] = HTMLAttributes.mode;
    }
    
    return ['video', attrs];
  },
});

// Inline Image node - for small images that flow with text (like emojis/icons)
// This is a separate node type from CustomImage to allow true inline behavior
export const InlineImage = Node.create({
  name: 'inlineImage',
  group: 'inline',
  inline: true,
  atom: true, // Treat as single unit
  draggable: true,
  
  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: '',
      },
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) {
            return {};
          }
          return {
            width: attributes.width,
          };
        },
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          return height ? parseInt(height, 10) : null;
        },
        renderHTML: attributes => {
          if (!attributes.height) {
            return {};
          }
          return {
            height: attributes.height,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-inline="true"]',
        priority: 100, // High priority to ensure it's checked before CustomImage
        getAttrs: (node) => ({
          src: node.getAttribute('src'),
          alt: node.getAttribute('alt') || '',
          // Don't parse width/height - inline images should always use max constraints
          width: null,
          height: null,
        }),
      },
      // Also match img tags that have inline styling constraints (fallback)
      {
        tag: 'img',
        priority: 99,
        getAttrs: (node) => {
          const style = node.getAttribute('style') || '';
          const hasInlineConstraints = style.includes('max-height: 1.5em') || 
                                      style.includes('max-height:1.5em') ||
                                      style.includes('data-inline');
          // Only parse as inline if it has inline constraints
          if (hasInlineConstraints) {
            return {
              src: node.getAttribute('src'),
              alt: node.getAttribute('alt') || '',
              width: null,
              height: null,
            };
          }
          return false; // Don't parse as inline image
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Don't include width/height attributes - they override max constraints
    // Only use CSS max-width and max-height
    const { width, height, ...attrs } = HTMLAttributes;
    
    let styleString = '';
    // Always enforce inline constraints with !important to override any conflicting styles
    // Use 1em so height matches current font-size on that line
    styleString += 'max-height: 1em !important;'; // Match surrounding text height
    styleString += ' max-width: 200px !important;'; // Cap width for inline images
    styleString += ' width: auto !important;'; // Let width be auto, constrained by max-width
    styleString += ' height: auto !important;'; // Let height be auto, constrained by max-height
    styleString += ' vertical-align: middle !important;';
    styleString += ' margin: 0 0.25em !important;';
    styleString += ' margin-top: 0 !important;';
    styleString += ' margin-bottom: 0 !important;';
    styleString += ' display: inline-block !important;';
    styleString += ' float: none !important;';
    
    const htmlAttrs = {
      ...attrs,
      'data-inline': 'true',
      style: styleString,
    };
    
    // Explicitly don't include width/height attributes
    // They would override the max constraints
    
    return [
      'img',
      htmlAttrs,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const container = document.createElement('span');
      container.className = 'inline-image-container';
      container.style.display = 'inline';
      container.style.position = 'relative';
      
      const img = document.createElement('img');
      img.src = HTMLAttributes.src || node.attrs.src;
      img.alt = HTMLAttributes.alt || node.attrs.alt || '';
      img.setAttribute('data-inline', 'true'); // Ensure attribute is set
      
      // CRITICAL: Remove width/height attributes FIRST - they override CSS
      img.removeAttribute('width');
      img.removeAttribute('height');
      
      // Function to enforce constraints (reusable)
      const enforceConstraints = () => {
        img.removeAttribute('width');
        img.removeAttribute('height');
        // Use setProperty with 'important' to override any conflicting styles
        // 1em so inline image height matches current font size on that line
        img.style.setProperty('max-height', '1em', 'important');
        img.style.setProperty('max-width', '200px', 'important');
        img.style.setProperty('width', 'auto', 'important');
        img.style.setProperty('height', 'auto', 'important');
        img.style.setProperty('display', 'inline-block', 'important');
        img.style.setProperty('vertical-align', 'middle', 'important');
        img.style.setProperty('margin', '0 0.25em', 'important');
        img.style.setProperty('margin-top', '0', 'important');
        img.style.setProperty('margin-bottom', '0', 'important');
        img.style.setProperty('float', 'none', 'important');
      };
      
      // Enforce constraints immediately
      enforceConstraints();
      
      // When image loads, enforce constraints again (use setTimeout to ensure it runs after browser applies natural size)
      img.onload = () => {
        setTimeout(() => {
          enforceConstraints();
        }, 0);
      };
      
      // Also enforce constraints if image is already loaded
      if (img.complete && img.naturalWidth > 0) {
        setTimeout(() => {
          enforceConstraints();
        }, 0);
      }
      
      // Use MutationObserver to catch any attempts to set width/height attributes or style changes
      const observer = new MutationObserver((mutations) => {
        let shouldEnforce = false;
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'width' || mutation.attributeName === 'height' || mutation.attributeName === 'style') {
              shouldEnforce = true;
            }
          }
        });
        if (shouldEnforce) {
          setTimeout(() => {
            enforceConstraints();
          }, 0);
        }
      });
      observer.observe(img, { 
        attributes: true, 
        attributeFilter: ['width', 'height', 'style'],
        attributeOldValue: false
      });
      
      // Also periodically check and enforce constraints (as a fallback)
      const intervalId = setInterval(() => {
        const currentMaxHeight = window.getComputedStyle(img).maxHeight;
        const currentMaxWidth = window.getComputedStyle(img).maxWidth;
        if (currentMaxHeight !== '1.5em' || currentMaxWidth !== '200px') {
          enforceConstraints();
        }
      }, 100);
      
      // Store interval ID to clean up later if needed
      container.dataset.intervalId = intervalId;
      
      container.appendChild(img);
      
      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'inlineImage') return false;
          
          if (updatedNode.attrs.src !== img.src) {
            img.src = updatedNode.attrs.src;
          }
          
          // Always maintain inline constraints
          img.setAttribute('data-inline', 'true');
          img.style.maxHeight = '1.5em';
          img.style.maxWidth = '100%';
          img.style.verticalAlign = 'middle';
          img.style.margin = '0 0.25em';
          img.style.marginTop = '0';
          img.style.marginBottom = '0';
          
          // NEVER apply width/height attributes - always use CSS max constraints
          // Remove any width/height attributes that might override constraints
          img.removeAttribute('width');
          img.removeAttribute('height');
          // Use setProperty with important to ensure constraints are enforced
          img.style.setProperty('max-height', '1.5em', 'important');
          img.style.setProperty('max-width', '200px', 'important');
          img.style.setProperty('width', 'auto', 'important');
          img.style.setProperty('height', 'auto', 'important');
          img.style.setProperty('display', 'inline-block', 'important');
          img.style.setProperty('vertical-align', 'middle', 'important');
          
          return true;
        },
      };
    };
  },
});

// Custom Image extension with Word/Docs-like capabilities
// Supports: alignment (left/right/center), text wrapping, resizing
export const CustomImage = Node.create({
  name: 'image',
  group: 'block', // Default to block, but can appear inline when align='inline'
  atom: true, // Treat as single unit
  draggable: true,
  inline: false, // Not inline by default, but styling can make it appear inline
  
  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: '',
      },
      title: {
        default: '',
      },
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) {
            return {};
          }
          return {
            width: attributes.width,
          };
        },
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          return height ? parseInt(height, 10) : null;
        },
        renderHTML: attributes => {
          if (!attributes.height) {
            return {};
          }
          return {
            height: attributes.height,
          };
        },
      },
      align: {
        default: 'center', // center, left, right (inline removed - use InlineImage node instead)
        parseHTML: element => {
          const align = element.getAttribute('data-align') || 
                       element.getAttribute('align') ||
                       (element.style.float === 'left' ? 'left' : 
                        element.style.float === 'right' ? 'right' :
                        element.style.display === 'inline' || element.style.display === 'inline-block' ? 'inline' : 'center');
          return align || 'center';
        },
        renderHTML: attributes => {
          // Always return data-align, even for center, so reader CSS can apply correct styles
          const align = attributes.align || 'center';
          return {
            'data-align': align,
          };
        },
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (!attributes.style) {
            return {};
          }
          return {
            style: attributes.style,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img',
        priority: 50, // Lower priority than InlineImage
        getAttrs: (node) => {
          // CRITICAL: Don't parse images with data-inline="true" as CustomImage
          // They should be parsed by InlineImage instead
          if (node.getAttribute('data-inline') === 'true') {
            return false; // Don't parse as CustomImage
          }
          
          return {
            src: node.getAttribute('src'),
            alt: node.getAttribute('alt') || '',
            title: node.getAttribute('title') || '',
            width: node.getAttribute('width') ? parseInt(node.getAttribute('width'), 10) : null,
            height: node.getAttribute('height') ? parseInt(node.getAttribute('height'), 10) : null,
            align: node.getAttribute('data-align') || 
                   node.getAttribute('align') ||
                   (node.style?.float === 'left' ? 'left' : 
                    node.style?.float === 'right' ? 'right' : 'center'),
            style: node.getAttribute('style'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // CRITICAL: Read align from node.attrs directly, not HTMLAttributes
    // because the attribute's renderHTML returns {} for center, so it won't be in HTMLAttributes
    const align = node?.attrs?.align || HTMLAttributes?.align || 'center';
    const { width, height, style, ...attrs } = HTMLAttributes;
    
    // Build style string - only include width/height and max-width
    // Alignment is handled via data-align attribute and CSS, not inline styles
    let styleString = '';
    
    // Add width/height if specified
    if (width) {
      styleString += `width: ${width}px;`;
    }
    if (height) {
      styleString += (styleString ? ' ' : '') + `height: ${height}px;`;
    }
    
    // Ensure max-width for responsiveness
    if (!styleString.includes('max-width')) {
      styleString += (styleString ? ' ' : '') + 'max-width: 100%;';
    }
    if (!styleString.includes('height') || !height) {
      styleString += (styleString ? ' ' : '') + 'height: auto;';
    }
    
    // Always include data-align attribute so reader can apply correct styles
    const htmlAttrs = {
      ...attrs,
    };
    
    // Add style only if we have width/height or need max-width
    if (styleString) {
      htmlAttrs.style = styleString;
    }
    
    // ALWAYS set data-align attribute, even for center (so reader knows it's center, not default)
    // This is critical for the reader CSS to work correctly
    htmlAttrs['data-align'] = align;
    
    return [
      'img',
      htmlAttrs,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      // Use div for all block images (inline images use separate InlineImage node)
      const container = document.createElement('div');
      container.className = 'image-resize-container';
      container.style.position = 'relative';
      container.style.display = 'inline-block';
      // Don't set maxWidth on container - let it wrap the image naturally
      container.style.width = 'auto';
      container.style.height = 'auto';
      
      const img = document.createElement('img');
      img.src = HTMLAttributes.src || node.attrs.src;
      img.alt = HTMLAttributes.alt || node.attrs.alt || '';
      img.title = HTMLAttributes.title || node.attrs.title || '';
      
      // Wait for image to load to get natural dimensions
      let naturalWidth = 0;
      let naturalHeight = 0;
      let aspectRatio = 1;
      
      // Apply width/height if specified BEFORE setting onload
      if (node.attrs.width) {
        img.width = node.attrs.width;
        img.style.width = `${node.attrs.width}px`;
      }
      if (node.attrs.height) {
        img.height = node.attrs.height;
        img.style.height = `${node.attrs.height}px`;
      }
      
      // If both width and height are set, calculate aspect ratio from them
      if (node.attrs.width && node.attrs.height) {
        aspectRatio = node.attrs.width / node.attrs.height;
      }
      
      img.onload = () => {
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
        
        // Only set aspect ratio from natural dimensions if not already set
        if (!node.attrs.width && !node.attrs.height) {
          aspectRatio = naturalWidth / naturalHeight;
          // Don't set explicit dimensions - let it use natural size with max-width constraint
        } else if (node.attrs.width && !node.attrs.height) {
          // If only width is set, calculate height from natural aspect ratio
          aspectRatio = naturalWidth / naturalHeight;
          const calculatedHeight = node.attrs.width / aspectRatio;
          img.height = calculatedHeight;
          img.style.height = `${calculatedHeight}px`;
        } else if (!node.attrs.width && node.attrs.height) {
          // If only height is set, calculate width from natural aspect ratio
          aspectRatio = naturalWidth / naturalHeight;
          const calculatedWidth = node.attrs.height * aspectRatio;
          img.width = calculatedWidth;
          img.style.width = `${calculatedWidth}px`;
        }
      };
      
      // Apply alignment styles to container
      const imageAlign = node.attrs.align || 'center';
      // Reset all alignment styles first
      container.style.float = '';
      container.style.margin = '';
      container.style.display = '';
      container.style.verticalAlign = '';
      
      if (imageAlign === 'left') {
        container.style.float = 'left';
        container.style.marginRight = '1em';
        container.style.marginBottom = '0.5em';
        container.style.marginTop = '0.5em';
        container.style.display = 'block';
      } else if (imageAlign === 'right') {
        container.style.float = 'right';
        container.style.marginLeft = '1em';
        container.style.marginBottom = '0.5em';
        container.style.marginTop = '0.5em';
        container.style.display = 'block';
      } else if (imageAlign === 'inline') {
        // For inline, use display: inline (not inline-block) to truly flow with text
        container.style.display = 'inline';
        container.style.verticalAlign = 'middle';
        container.style.margin = '0 0.25em';
        container.style.marginTop = '0';
        container.style.marginBottom = '0';
        // Make image itself inline-block so it can be sized
        img.style.display = 'inline-block';
        img.style.verticalAlign = 'middle';
      } else {
        // center (default) - use block with fit-content width so it wraps the image
        container.style.display = 'block';
        container.style.width = 'fit-content';
        container.style.maxWidth = '100%';
        container.style.margin = '0.5em auto';
      }
      
      // Ensure container always wraps image tightly, never stretches
      container.style.height = 'auto';
      
      // Set image styles
      img.style.maxWidth = '100%';
      // Only set height: auto if no explicit dimensions are set
      if (!node.attrs.width && !node.attrs.height) {
        img.style.height = 'auto';
      } else {
        // If dimensions are set, don't use height: auto as it can cause stretching
        img.style.objectFit = 'contain'; // Preserve aspect ratio
      }
      img.style.display = 'block';
      
      container.appendChild(img);
      
      // Add resize handle (bottom-right corner)
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'image-resize-handle';
      resizeHandle.style.position = 'absolute';
      resizeHandle.style.bottom = '0';
      resizeHandle.style.right = '0';
      resizeHandle.style.width = '20px';
      resizeHandle.style.height = '20px';
      resizeHandle.style.background = '#4285f4';
      resizeHandle.style.border = '2px solid white';
      resizeHandle.style.borderRadius = '50%';
      resizeHandle.style.cursor = 'nwse-resize';
      resizeHandle.style.zIndex = '10';
      resizeHandle.style.display = 'none'; // Hidden by default, shown on hover/selection
      resizeHandle.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
      resizeHandle.style.alignItems = 'center';
      resizeHandle.style.justifyContent = 'center';
      
      // Add stretch/resize icon (diagonal arrows)
      const resizeIcon = document.createElement('div');
      resizeIcon.innerHTML = '↗';
      resizeIcon.style.color = 'white';
      resizeIcon.style.fontSize = '12px';
      resizeIcon.style.fontWeight = 'bold';
      resizeIcon.style.lineHeight = '1';
      resizeIcon.style.pointerEvents = 'none';
      resizeIcon.style.userSelect = 'none';
      resizeHandle.appendChild(resizeIcon);
      
      container.appendChild(resizeHandle);
      
      // Show/hide resize handle based on selection
      let isSelected = false;
      const isMobile = window.innerWidth <= 768;
      
      const showHandle = () => {
        resizeHandle.style.display = 'block';
        container.classList.add('selected');
      };
      
      const hideHandle = () => {
        if (!isSelected) {
          resizeHandle.style.display = 'none';
          container.classList.remove('selected');
        }
      };
      
      // On desktop, show on hover; on mobile, always show when selected
      if (!isMobile) {
        container.addEventListener('mouseenter', showHandle);
        container.addEventListener('mouseleave', hideHandle);
      }
      
      // On mobile, also show handle when image is tapped
      if (isMobile) {
        container.addEventListener('click', (e) => {
          // Don't trigger if clicking the resize handle itself
          if (e.target !== resizeHandle && !resizeHandle.contains(e.target)) {
            showHandle();
            // Focus the editor to ensure selection is set
            editor.commands.focus();
          }
        });
      }
      
      // Check if image is selected
      const checkSelection = () => {
        const { selection } = editor.state;
        const pos = typeof getPos === 'function' ? getPos() : null;
        
        if (pos !== null) {
          // Check if selection is at or near this image node
          const { $from } = selection;
          const nodeBefore = $from.nodeBefore;
          const nodeAfter = $from.nodeAfter;
          
          // Check if this image node is selected
          if ((nodeBefore && nodeBefore === node) || 
              (nodeAfter && nodeAfter === node) ||
              (selection.from <= pos && selection.to > pos)) {
            isSelected = true;
            showHandle();
          } else {
            isSelected = false;
            // On mobile, keep handle visible for a bit after selection changes
            if (isMobile) {
              setTimeout(() => {
                if (!isSelected) hideHandle();
              }, 2000); // Hide after 2 seconds if not selected
            } else {
              hideHandle();
            }
          }
        }
      };
      
      // Listen for selection changes
      editor.on('selectionUpdate', checkSelection);
      // Also poll on mobile for better reliability
      if (isMobile) {
        const pollInterval = setInterval(checkSelection, 300);
        // Clean up on destroy
        setTimeout(() => clearInterval(pollInterval), 60000);
      }
      checkSelection();
      
      // Resize functionality
      let isResizing = false;
      let startX = 0;
      let startY = 0;
      let startWidth = 0;
      let startHeight = 0;
      let currentAspectRatio = aspectRatio;
      
      const startResize = (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
        startWidth = img.offsetWidth || img.width || naturalWidth;
        startHeight = img.offsetHeight || img.height || naturalHeight;
        
        // Calculate aspect ratio from current dimensions
        if (startWidth > 0 && startHeight > 0) {
          currentAspectRatio = startWidth / startHeight;
        } else if (naturalWidth > 0 && naturalHeight > 0) {
          currentAspectRatio = naturalWidth / naturalHeight;
        }
        
        // Add blue outline during resize
        container.style.outline = '2px solid #4285f4';
        container.style.outlineOffset = '2px';
        
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        document.addEventListener('touchmove', doResize, { passive: false });
        document.addEventListener('touchend', stopResize);
      };
      
      const doResize = (e) => {
        if (!isResizing) return;
        e.preventDefault();
        
        const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        const currentY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
        
        // Calculate diagonal distance for diagonal resizing
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;
        
        // For bottom-right corner, resize along diagonal
        // Use the larger absolute value to maintain aspect ratio
        const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
        
        // Calculate new dimensions maintaining aspect ratio
        // Allow smaller minimum for inline images (20px), otherwise 50px
        const minSize = (node.attrs.align === 'inline') ? 20 : 50;
        const newWidth = Math.max(minSize, startWidth + delta);
        const newHeight = newWidth / currentAspectRatio;
        
        img.width = newWidth;
        img.height = newHeight;
        img.style.width = `${newWidth}px`;
        img.style.height = `${newHeight}px`;
        
        // Ensure container wraps the image tightly, but preserve alignment styles
        // Don't reset container styles during resize - alignment must be preserved
        const currentAlign = node.attrs.align || 'center';
        if (currentAlign === 'center') {
          // For center, use fit-content
          container.style.width = 'fit-content';
          container.style.maxWidth = '100%';
        } else {
          // For left/right/inline, keep width auto to wrap image
          container.style.width = 'auto';
        }
        container.style.height = 'auto';
      };
      
      const stopResize = (e) => {
        if (!isResizing) return;
        isResizing = false;
        
        // Remove blue outline
        container.style.outline = '';
        container.style.outlineOffset = '';
        
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
        document.removeEventListener('touchmove', doResize);
        document.removeEventListener('touchend', stopResize);
        
        // Update node attributes with new dimensions
        // IMPORTANT: Preserve all existing attributes, especially alignment
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && editor.view) {
          const { tr } = editor.state;
          
          // Get the CURRENT node from the transaction state to ensure we have latest attributes
          const currentNode = tr.doc.nodeAt(pos);
          if (!currentNode) return;
          
          // Preserve alignment from current node (or fallback to original node)
          const preservedAlign = currentNode.attrs.align || node.attrs.align || 'center';
          
          const attrs = {
            ...currentNode.attrs, // Use current node attrs as base (most up-to-date)
            width: img.width,
            height: img.height,
            // Explicitly preserve alignment - this is critical
            align: preservedAlign,
          };
          
          tr.setNodeMarkup(pos, null, attrs);
          editor.view.dispatch(tr);
        }
      };
      
      resizeHandle.addEventListener('mousedown', startResize);
      resizeHandle.addEventListener('touchstart', startResize, { passive: false });
      
      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          
          // Update image src if changed
          if (updatedNode.attrs.src !== img.src) {
            img.src = updatedNode.attrs.src;
          }
          
          // Update dimensions if changed
          if (updatedNode.attrs.width && updatedNode.attrs.width !== img.width) {
            img.width = updatedNode.attrs.width;
            img.style.width = `${updatedNode.attrs.width}px`;
          }
          if (updatedNode.attrs.height && updatedNode.attrs.height !== img.height) {
            img.height = updatedNode.attrs.height;
            img.style.height = `${updatedNode.attrs.height}px`;
          }
          
          // Update alignment - CRITICAL: Always preserve alignment from node attributes
          // Log for debugging
          const newAlign = updatedNode.attrs.align || 'center';
          
          // Reset all alignment styles first
          container.style.float = '';
          container.style.margin = '';
          container.style.display = '';
          container.style.verticalAlign = '';
          container.style.width = '';
          container.style.maxWidth = '';
          container.style.textAlign = '';
          
          // Apply alignment styles based on node attribute
          if (newAlign === 'left') {
            container.style.float = 'left';
            container.style.marginRight = '1em';
            container.style.marginBottom = '0.5em';
            container.style.marginTop = '0.5em';
            container.style.display = 'block';
            container.style.width = 'auto';
          } else if (newAlign === 'right') {
            container.style.float = 'right';
            container.style.marginLeft = '1em';
            container.style.marginBottom = '0.5em';
            container.style.marginTop = '0.5em';
            container.style.display = 'block';
            container.style.width = 'auto';
          } else {
            // center (default) - use block with fit-content width so it wraps the image
            container.style.display = 'block';
            container.style.width = 'fit-content';
            container.style.maxWidth = '100%';
            container.style.margin = '0.5em auto';
          }
          
          // Always ensure container wraps image tightly
          container.style.height = 'auto';
          
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setImage: (options) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
      setImageAlign: (align) => ({ tr, state, dispatch }) => {
        if (!dispatch) return false;
        
        const { selection } = state;
        const { $from } = selection;
        
        // For atom nodes like images, check multiple positions
        let imagePos = null;
        let imageNode = null;
        
        // Check node before cursor
        const nodeBefore = $from.nodeBefore;
        if (nodeBefore && nodeBefore.type.name === 'image') {
          imageNode = nodeBefore;
          imagePos = $from.pos - 1;
        }
        
        // Check node after cursor
        if (!imageNode) {
          const nodeAfter = $from.nodeAfter;
          if (nodeAfter && nodeAfter.type.name === 'image') {
            imageNode = nodeAfter;
            imagePos = $from.pos;
          }
        }
        
        // Check node at current position (for atom nodes)
        if (!imageNode) {
          try {
            const nodeAt = $from.parent.child($from.index());
            if (nodeAt && nodeAt.type.name === 'image') {
              imageNode = nodeAt;
              // Calculate position of this node
              let pos = $from.start($from.depth);
              for (let i = 0; i < $from.index(); i++) {
                pos += $from.parent.child(i).nodeSize;
              }
              imagePos = pos;
            }
          } catch (e) {
            // Ignore errors
          }
        }
        
        // Also check a range around the selection
        if (!imageNode) {
          const start = Math.max(0, $from.pos - 1);
          const end = Math.min(state.doc.content.size, $from.pos + 1);
          state.doc.nodesBetween(start, end, (node, pos) => {
            if (node.type.name === 'image' && !imageNode) {
              imageNode = node;
              imagePos = pos;
            }
          });
        }
        
        if (imageNode && imagePos !== null) {
          const attrs = { ...imageNode.attrs, align };
          tr.setNodeMarkup(imagePos, null, attrs);
          dispatch(tr);
          return true;
        }
        
        return false;
      },
      setImageSize: ({ width, height }) => ({ tr, state, dispatch }) => {
        const { selection } = state;
        const { from } = selection;
        
        state.doc.nodesBetween(from, from, (node, pos) => {
          if (node.type.name === 'image') {
            const attrs = { ...node.attrs };
            if (width !== undefined) attrs.width = width;
            if (height !== undefined) attrs.height = height;
            tr.setNodeMarkup(pos, null, attrs);
          }
        });
        
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

// Custom block node for poetry
// Poetry preserves line breaks and is centered
export const Poetry = Node.create({
  name: 'poetry',
  group: 'block',
  content: 'paragraph+', // Allow multiple paragraphs (one per line)
  
  parseHTML() {
    return [
      {
        tag: 'div.poetry',
      },
      {
        tag: 'pre.poetry',
      },
    ];
  },
  
  renderHTML({ node }) {
    return ['div', { class: 'poetry' }, 0];
  },
  
  addCommands() {
    return {
      setPoetry: () => ({ commands, state }) => {
        // If selection is in a paragraph, wrap it
        if (state.selection.$from.parent.type.name === 'paragraph') {
          return commands.wrapIn('poetry');
        }
        // Otherwise, insert a new poetry block with an empty paragraph
        return commands.insertContent({
          type: 'poetry',
          content: [{ type: 'paragraph' }],
        });
      },
      togglePoetry: () => ({ commands }) => {
        return commands.toggleWrap('poetry');
      },
    };
  },
});

