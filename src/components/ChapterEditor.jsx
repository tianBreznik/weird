import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import SimpleBar from 'simplebar-react';
import 'simplebar-react/dist/simplebar.min.css';
import { uploadImageToStorage, uploadVideoToStorage } from '../services/storage';
import { generateWordTimingsWithDeepgram } from '../services/autoTiming';
import { KaraokeBlock, Dinkus, Highlight, TextColor, Underline, FootnoteRef, Indent, CustomParagraph, Video, CustomImage, InlineImage, Poetry } from '../extensions/tiptapExtensions.js';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { FootnotePlugin } from '../extensions/footnotePlugin.js';
import './ChapterEditor.css';

export const ChapterEditor = ({ chapter, parentChapter, onSave, onCancel, onDelete }) => {
  const [title, setTitle] = useState(chapter?.title || '');
  const [epigraph, setEpigraph] = useState(chapter?.epigraph || null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState('Ready');
  const [highlightColor, setHighlightColor] = useState('#ffeb3b');
  const [textColor, setTextColor] = useState('#000000');
  const [fontSize, setFontSize] = useState('16');
  const [entityVersion, setEntityVersion] = useState(chapter?.version ?? 0);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    highlight: false,
    textColor: false,
    blockquote: false,
    subscript: false,
    superscript: false,
    dropCap: false,
    introParagraph: false,
    whisperParagraph: false,
    epigraphParagraph: false,
    alignLeft: false,
    alignCenter: false,
    alignRight: false,
    alignJustify: false,
  });
  const titleInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const inlineImageInputRef = useRef(null);
  const videoFileInputRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const colorInputRef = useRef(null);
  const highlightInputRef = useRef(null);
  const userChangedColorRef = useRef(false); // Track when user manually changes text color
  const userChangedHighlightRef = useRef(false); // Track when user manually changes highlight color
  const dialogOpenRef = useRef(false); // Track if dialog is open to prevent editor interference
  const lastSelectionRef = useRef({ from: null, to: null }); // Track last selection for polling
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [showKaraokeDialog, setShowKaraokeDialog] = useState(false);
  const [karaokeText, setKaraokeText] = useState('');
  const [karaokeAudioFile, setKaraokeAudioFile] = useState(null);
  const [karaokeAudioUrl, setKaraokeAudioUrl] = useState('');
  const [karaokeTimingFile, setKaraokeTimingFile] = useState(null);
  const [karaokeTimingMethod, setKaraokeTimingMethod] = useState('upload'); // 'upload' or 'auto'
  const [generatingTimings, setGeneratingTimings] = useState(false);
  const [showEpigraphDialog, setShowEpigraphDialog] = useState(false);
  const [epigraphDraft, setEpigraphDraft] = useState({
    text: '',
    author: '',
    align: 'center',
  });

  
  // Ref to track if we're programmatically setting content (to avoid update loops)
  const isSettingContentRef = useRef(false);
  const lastSetContentRef = useRef('');
  
  // TipTap editor instance - Adding extensions back systematically to find the issue
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable some default extensions we'll customize
        heading: {
          levels: [1, 2, 3],
        },
        // Disable default paragraph - we'll use CustomParagraph instead
        paragraph: false,
      }),
      CustomParagraph,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Subscript,
      Superscript,
      Indent,
      // Adding back basic formatting extensions first
      Highlight,
      TextColor,
      Underline,
      // Adding back media extensions
      InlineImage, // Must come BEFORE CustomImage so inline images are parsed correctly
      CustomImage,
      Video,
      // Adding back content extensions
      Dinkus,
      Poetry,
      // Footnote extensions - InputRule disabled as it interferes with typing
      FootnoteRef,
      // FootnotePlugin, // DISABLED: InputRule interferes with typing - using manual conversion instead
      // Adding back KaraokeBlock
      KaraokeBlock,
    ],
    content: '',
    editable: true, // Explicitly enable editing
    autofocus: false, // Don't auto-focus on mount
    onUpdate: ({ editor }) => {
      // Only update content state if we're not programmatically setting content
      if (!isSettingContentRef.current) {
        const html = editor.getHTML();
        // Only update if content actually changed
        if (html !== lastSetContentRef.current) {
          setContent(html);
          lastSetContentRef.current = html;
        }
      }
    },
    onCreate: () => {},
    parseOptions: {
      preserveWhitespace: 'full',
    },
    editorProps: {
      attributes: {
        class: 'page-area',
      },
      // Ensure scrolling works properly
      handleScrollToSelection: () => {
        // Let TipTap handle scrolling naturally
        return true;
      },
    },
  });

  const applyKaraokeEditorMarkers = () => {
    // TipTap handles karaoke blocks via custom node, so this may not be needed
    // But keeping for compatibility with existing content
    if (!editor) return;
    const editorEl = editor.view?.dom;
    if (!editorEl) return;
    const nodes = editorEl.querySelectorAll('.karaoke-object');
    nodes.forEach((node) => {
      node.classList.add('karaoke-editor-marker');
      node.setAttribute('contenteditable', 'false');
      node.setAttribute('data-karaoke-block', 'true');
    });
  };

  // Normalize a CSS color string (rgb(...), #rgb, #rrggbb, etc.) to a 6-char hex (#rrggbb).
  const normalizeCssColorToHex = (color, fallback = '#ffffff') => {
    if (!color) return fallback;
    const trimmed = color.trim().toLowerCase();

    const normalizeHex = (hex) => {
      if (!hex || !hex.startsWith('#')) return null;
      let clean = hex.slice(1).toLowerCase();
      if (clean.length === 3) {
        clean = clean.split('').map((c) => c + c).join('');
      }
      if (clean.length >= 6) {
        clean = clean.slice(0, 6);
      }
      if (clean.length < 6) {
        clean = clean.padEnd(6, '0');
      }
      return `#${clean}`;
    };

    // Already hex
    if (trimmed.startsWith('#')) {
      const norm = normalizeHex(trimmed);
      return norm || fallback;
    }

    // rgb(...) or rgba(...)
    const rgbMatch = trimmed.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      const [r, g, b] = rgbMatch.slice(1, 4).map((v) => {
        const n = parseInt(v, 10);
        const hex = n.toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
      });
      const hex = `#${r}${g}${b}`;
      const norm = normalizeHex(hex);
      return norm || fallback;
    }

    // Fallback: give up and return previous/fallback
    return fallback;
  };

  // Get current text color from selection/computed style
  const getCurrentTextColor = () => {
    try {
      if (!editor) return '#000000';
      const editorEl = editor.view?.dom;
      if (!editorEl) return '#000000';
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        // If no selection, try to get color from TipTap editor
        const attrs = editor.getAttributes('textColor');
        if (attrs?.color) return attrs.color;
        return '#000000';
      }
      
      const range = selection.getRangeAt(0);
      let element = range.commonAncestorContainer;
      
      // If it's a text node, get its parent element
      if (element.nodeType === Node.TEXT_NODE) {
        element = element.parentElement;
      } else if (element.nodeType === Node.ELEMENT_NODE) {
        element = element;
      } else {
        return '#000000';
      }
      
      if (!element) return '#000000';
      
      return getColorFromElement(element);
    } catch {
      return '#000000';
    }
  };

  // Helper to extract color from an element
  const getColorFromElement = (element) => {
    if (!element) return '#000000';
    if (!editor) return '#000000';
    const editorEl = editor.view?.dom;
    if (!editorEl) return '#000000';
    
    // Walk up the DOM to find the first element with explicit color
    let current = element;
    while (current && current !== editorEl) {
      // Check if this element has inline color style first (most specific)
      if (current.style && current.style.color && current.style.color !== '') {
        const color = current.style.color;
        // Convert rgb/rgba to hex if needed
        if (color.startsWith('rgb')) {
          const rgb = color.match(/\d+/g);
          if (rgb && rgb.length >= 3) {
            const hex = '#' + rgb.slice(0, 3).map(x => {
              const val = parseInt(x);
              return (val < 16 ? '0' : '') + val.toString(16);
            }).join('');
            return hex;
          }
        }
        // If it's already hex or named color, return as-is
        if (color.startsWith('#')) {
          return color;
        }
      }
      
      // Check computed style
      const computedStyle = window.getComputedStyle(current);
      const color = computedStyle.color;
      
      // If color is not black/default, return it
      if (color && color !== 'rgb(0, 0, 0)' && color !== '#000000' && color !== '#000') {
        // Convert rgb/rgba to hex
        if (color.startsWith('rgb')) {
          const rgb = color.match(/\d+/g);
          if (rgb && rgb.length >= 3) {
            const hex = '#' + rgb.slice(0, 3).map(x => {
              const val = parseInt(x);
              return (val < 16 ? '0' : '') + val.toString(16);
            }).join('');
            return hex;
          }
        }
        return color;
      }
      
      current = current.parentElement;
    }
    
    return '#000000';
  };

  // Get current font size for toolbar sync.
  // For now, just reflect the current fontSize state; we can make this smarter later.
  const getCurrentFontSize = () => fontSize || '16';

  // Get current highlight color from ProseMirror marks around the caret.
  //
  // Behaviour for a collapsed caret:
  // - ONLY look at the position AT the caret.
  //   This matches your expectation: if the caret is at the start of a
  //   non‑highlighted word (even if there is a highlighted word before it),
  //   we report "no highlight" instead of inheriting the previous color.
  const getCurrentHighlightFromState = () => {
    if (!editor) return '#ffffff';
    try {
      const { state } = editor;
      const sel = state.selection;
      if (!sel) return '#ffffff';

      if (sel.from === sel.to) {
        // Collapsed caret: inspect marks AT the caret only.
        const posAtCaret = sel.from;
        if (posAtCaret >= 0 && posAtCaret <= state.doc.content.size) {
          const $at = state.doc.resolve(posAtCaret);
          const marksAt = $at.marks();
          const highlightAt = marksAt.find((m) => m.type.name === 'highlight');
          if (highlightAt && highlightAt.attrs?.color) {
            return normalizeCssColorToHex(highlightAt.attrs.color, '#ffffff');
          }
        }
        return '#ffffff';
      }

      // Range selection: just check the start position.
      const pos = sel.from;
      if (pos < 0 || pos > state.doc.content.size) {
        return '#ffffff';
      }
      const $pos = state.doc.resolve(pos);
      const marks = $pos.marks();
      const highlightMark = marks.find((m) => m.type.name === 'highlight');
      if (highlightMark && highlightMark.attrs?.color) {
        return normalizeCssColorToHex(highlightMark.attrs.color, '#ffffff');
      }
      return '#ffffff';
    } catch {
      return '#ffffff';
    }
  };

  const refreshToolbarState = () => {
    if (!editor) return;
    try {
      const state = {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        strikethrough: editor.isActive('strike'),
        underline: editor.isActive('underline'),
        highlight: editor.isActive('highlight'),
        blockquote: editor.isActive('blockquote'),
        subscript: editor.isActive('subscript'),
        superscript: editor.isActive('superscript'),
        // Check if current paragraph has drop-cap class
        dropCap: (() => {
          try {
            const { $from } = editor.state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'paragraph') {
                const classAttr = node.attrs.class || '';
                return classAttr.includes('drop-cap');
              }
            }
            return false;
          } catch {
            return false;
          }
        })(),
        // Check if current paragraph has intro paragraph class
        introParagraph: (() => {
          try {
            const { $from } = editor.state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'paragraph') {
                const classAttr = node.attrs.class || '';
                return classAttr.includes('para-intro');
              }
            }
            return false;
          } catch {
            return false;
          }
        })(),
        // Check if current paragraph has whisper paragraph class
        whisperParagraph: (() => {
          try {
            const { $from } = editor.state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'paragraph') {
                const classAttr = node.attrs.class || '';
                return classAttr.includes('para-whisper');
              }
            }
            return false;
          } catch {
            return false;
          }
        })(),
        // Check if current paragraph has epigraph paragraph class
        epigraphParagraph: (() => {
          try {
            const { $from } = editor.state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'paragraph') {
                const classAttr = node.attrs.class || '';
                return classAttr.includes('para-epigraph');
              }
            }
            return false;
          } catch {
            return false;
          }
        })(),
        // alignment states (only one likely true)
        alignLeft: editor.isActive({ textAlign: 'left' }),
        alignCenter: editor.isActive({ textAlign: 'center' }),
        alignRight: editor.isActive({ textAlign: 'right' }),
        alignJustify: editor.isActive({ textAlign: 'justify' }),
        // Check if image is selected and its alignment
        // For atom nodes like images, check nodeBefore, nodeAfter, and nodeAt positions
        // Check if video is selected and its mode
        videoSelected: (() => {
          try {
            const { selection } = editor.state;
            const { $from } = selection;
            // Check multiple positions for atom nodes
            let videoNode = $from.nodeBefore || $from.nodeAfter;
            if (!videoNode || videoNode.type.name !== 'video') {
              // Also check the node at the current position
              const nodeAt = $from.parent.child($from.index());
              if (nodeAt && nodeAt.type.name === 'video') {
                videoNode = nodeAt;
              }
            }
            return videoNode && videoNode.type.name === 'video' ? videoNode : null;
          } catch {
            return null;
          }
        })(),
        imageAlignLeft: (() => {
          try {
            const { selection } = editor.state;
            const { $from } = selection;
            // Check multiple positions for atom nodes
            let imageNode = $from.nodeBefore || $from.nodeAfter;
            if (!imageNode || imageNode.type.name !== 'image') {
              // Also check the node at the current position
              const nodeAt = $from.parent.child($from.index());
              if (nodeAt && nodeAt.type.name === 'image') {
                imageNode = nodeAt;
              }
            }
            if (imageNode && imageNode.type.name === 'image') {
              return imageNode.attrs.align === 'left';
            }
            return false;
          } catch {
            return false;
          }
        })(),
        imageAlignCenter: (() => {
          try {
            const { selection } = editor.state;
            const { $from } = selection;
            let imageNode = $from.nodeBefore || $from.nodeAfter;
            if (!imageNode || imageNode.type.name !== 'image') {
              const nodeAt = $from.parent.child($from.index());
              if (nodeAt && nodeAt.type.name === 'image') {
                imageNode = nodeAt;
              }
            }
            if (imageNode && imageNode.type.name === 'image') {
              return !imageNode.attrs.align || imageNode.attrs.align === 'center';
            }
            return false;
          } catch {
            return false;
          }
        })(),
        imageAlignRight: (() => {
          try {
            const { selection } = editor.state;
            const { $from } = selection;
            let imageNode = $from.nodeBefore || $from.nodeAfter;
            if (!imageNode || imageNode.type.name !== 'image') {
              const nodeAt = $from.parent.child($from.index());
              if (nodeAt && nodeAt.type.name === 'image') {
                imageNode = nodeAt;
              }
            }
            if (imageNode && imageNode.type.name === 'image') {
              return imageNode.attrs.align === 'right';
            }
            return false;
          } catch {
            return false;
          }
        })(),
      };
      setActiveFormats(prev => ({ ...prev, ...state }));

      // Only sync text color picker with current text color if user didn't just manually change it
      if (!userChangedColorRef.current) {
        const currentColor = getCurrentTextColor();
        setTextColor(currentColor);

        if (colorInputRef.current) {
          colorInputRef.current.value = currentColor;
        }
      }
      
      // Always update highlight color - it should reflect the current selection's highlight
      // regardless of whether user changed text color

      // Keep dropdown in sync with our simple fontSize state for now.
      // (Font-size is a future polish feature; currently we don't modify the document.)
      const currentFontSize = getCurrentFontSize();
      if (currentFontSize !== fontSize) {
        setFontSize(currentFontSize);
      }

      // Update highlight color based on current selection/caret position
      // But don't override if user just manually changed it
      if (!userChangedHighlightRef.current) {
        let currentHighlight = '#ffffff';
        try {
          currentHighlight = getCurrentHighlightFromState();
        } catch (e) {
          currentHighlight = '#ffffff';
        }

        setHighlightColor(currentHighlight);
        if (highlightInputRef.current) {
          highlightInputRef.current.value = currentHighlight;
        }
      }
    } catch {}
  };

  // Content loading effect - RE-ENABLED for testing
  useEffect(() => {
    if (!editor) return;
    
    if (chapter && editor) {
      const chapterContent = chapter.contentHtml || chapter.content || '';
      const rawEpigraph = chapter.epigraph;
      if (rawEpigraph && typeof rawEpigraph === 'object') {
        setEpigraph({
          text: rawEpigraph.text || '',
          author: rawEpigraph.author || '',
          align: rawEpigraph.align || 'center',
        });
      } else if (typeof rawEpigraph === 'string' && rawEpigraph.trim()) {
        setEpigraph({
          text: rawEpigraph,
          author: '',
          align: 'center',
        });
      } else {
        setEpigraph(null);
      }
      
      // Only set content if it's different from what's currently in the editor
      const currentContent = editor.getHTML();
      let processedContent = chapterContent; // Use let so we can reassign if needed
      
      if (currentContent !== processedContent) {
        setTitle(chapter.title);
        setEntityVersion(chapter.version ?? 0);
        
        // Mark that we're programmatically setting content
        isSettingContentRef.current = true;
        lastSetContentRef.current = processedContent;
        
        // Preprocess HTML: Split spans with both background-color and color into nested structure
        // This ensures both Highlight and TextColor marks can be applied
        // Only process spans that are NOT already inside a <mark> tag (to avoid double-processing)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = processedContent;
        const spansWithBoth = tempDiv.querySelectorAll('span[style*="background-color"][style*="color"]');
        
        if (spansWithBoth.length > 0) {
          spansWithBoth.forEach((span) => {
            // Skip if this span is already inside a <mark> tag (already processed)
            if (span.closest('mark')) {
              return;
            }
            
            const style = span.getAttribute('style') || '';
            const bgColorMatch = style.match(/background-color\s*:\s*([^;]+)/i);
            const colorMatch = style.match(/(?<!background-)color\s*:\s*([^;]+)/i);
            
            if (bgColorMatch && colorMatch) {
              const bgColor = bgColorMatch[1].trim();
              const textColor = colorMatch[1].trim();
              
              // Create nested structure: <mark style="background-color: ..."><span style="color: ...">text</span></mark>
              const mark = document.createElement('mark');
              mark.setAttribute('style', `background-color: ${bgColor}`);
              
              const innerSpan = document.createElement('span');
              innerSpan.setAttribute('style', `color: ${textColor}`);
              
              // Move all children to inner span
              while (span.firstChild) {
                innerSpan.appendChild(span.firstChild);
              }
              
              mark.appendChild(innerSpan);
              span.parentNode.replaceChild(mark, span);
            }
          });
          
          processedContent = tempDiv.innerHTML;
        }
        
        editor.commands.setContent(processedContent);
        setContent(processedContent);
        
        // Ensure editor scroll container works after content is loaded
        // This is especially important when karaoke blocks are present
        setTimeout(() => {
          if (editor && editor.view?.dom) {
            const editorEl = editor.view.dom;
            // Ensure the editor element maintains scroll capability
            if (editorEl.parentElement) {
              const scrollContainer = editorEl.parentElement;
              // Force scroll container to maintain overflow
              if (scrollContainer.style.overflow === 'hidden') {
                scrollContainer.style.overflow = 'auto';
              }
            }
            // Reset scroll position to top to ensure toolbar is visible
            editorEl.scrollTop = 0;
          }
        }, 100);
        
        // Reset flag after editor has updated
        setTimeout(() => {
          isSettingContentRef.current = false;
          
          // After content is set, detect color and sync toolbar
          requestAnimationFrame(() => {
            if (editor) {
              // Get the color from TipTap
              const attrs = editor.getAttributes('textColor');
              const detectedColor = attrs?.color || '#000000';
              
              // Update state
              setTextColor(detectedColor);
              
              // Update color input if needed
              if (colorInputRef.current) {
                colorInputRef.current.value = detectedColor;
              }
              
              // Refresh toolbar to sync all states
              refreshToolbarState();
            }
          });
        }, 100);
      } else {
        // Content is the same, just update title and version if needed
        setTitle(chapter.title);
        setEpigraph(chapter.epigraph || '');
        setEntityVersion(chapter.version ?? 0);
      }
    } else if (parentChapter && editor) {
      const currentContent = editor.getHTML();
      if (currentContent !== '') {
        setTitle('');
        setEpigraph('');
        setEntityVersion(0);
        
        // Mark that we're programmatically setting content
        isSettingContentRef.current = true;
        lastSetContentRef.current = '';
        editor.commands.setContent('');
        // Reset to black for new chapter
        setTextColor('#000000');
        setContent('');
        
        // Reset flag after a brief delay
        setTimeout(() => {
          isSettingContentRef.current = false;
        }, 100);
      }
    }
  }, [chapter?.id, chapter?.contentHtml, chapter?.content, parentChapter?.id, editor]);

  // Sanitize editor HTML before saving:
  // - Strip foreign container tags (e.g. <section> from pasted content)
  // - Keep our semantic structure (p, br, lists, headings, images, videos, karaoke blocks)
  // - Whitelist only a small set of inline style properties we intentionally use
  const sanitizeEditorHtml = (html) => {
    if (!html) return '';
    if (typeof document === 'undefined') return html;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    const ALLOWED_STYLE_PROPS = new Set([
      'color',
      'background-color',
      'font-weight',
      'font-style',
      'text-decoration',
      'font-size',
      // allow line-height so our own spans with explicit size still look right
      'line-height',
    ]);

    const UNWRAP_TAGS = new Set([
      'SECTION',
      'ARTICLE',
      'ASIDE',
      'MAIN',
      'HEADER',
      'FOOTER',
    ]);

    const traverse = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;

        // Special case: sections pasted from external editors that include
        // `data-markdown-raw` with the original plain text (including newlines).
        // For these, we prefer to rebuild clean <p> paragraphs from that raw text
        // instead of keeping their nested spans and layout styles.
        if (
          el.tagName === 'SECTION' &&
          el.classList.contains('markdown-section') &&
          el.hasAttribute('data-markdown-raw')
        ) {
          const parent = el.parentNode;
          if (parent) {
            const raw = el.getAttribute('data-markdown-raw') || '';
            const paragraphs = raw.split(/\n\s*\n/); // double newline => new paragraph

            paragraphs.forEach((para) => {
              const trimmed = para.trim();
              if (!trimmed) return;
              const p = document.createElement('p');
              // Collapse internal newlines within a paragraph to single spaces
              p.textContent = trimmed.replace(/\s*\n\s*/g, ' ');
              parent.insertBefore(p, el);
            });

            parent.removeChild(el);
            return;
          }
        }

        // Unwrap container tags we don't want to persist
        if (UNWRAP_TAGS.has(el.tagName)) {
          const parent = el.parentNode;
          if (parent) {
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            // After unwrapping, nothing more to do on this node
            return;
          }
        }

        // Sanitize inline styles: keep only whitelisted properties
        if (el.hasAttribute('style')) {
          const style = el.getAttribute('style') || '';
          const kept = [];
          style.split(';').forEach((rule) => {
            const trimmed = rule.trim();
            if (!trimmed) return;
            const [prop, ...rest] = trimmed.split(':');
            if (!prop || rest.length === 0) return;
            const name = prop.trim().toLowerCase();
            if (ALLOWED_STYLE_PROPS.has(name)) {
              kept.push(`${name}: ${rest.join(':').trim()}`);
            }
          });
          if (kept.length > 0) {
            el.setAttribute('style', kept.join('; '));
          } else {
            el.removeAttribute('style');
          }
        }

        // We keep data-* attributes, src/href/etc., and classes.
        // Visual inconsistency mostly comes from inline styles and container tags.
      }

      let child = node.firstChild;
      while (child) {
        const next = child.nextSibling;
        traverse(child);
        child = next;
      }
    };

    traverse(wrapper);
    return wrapper.innerHTML;
  };

  useEffect(() => {
    if (!editor) return;
    const originalBodyOverflow = document.body.style.overflow;
    const originalDocOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // TipTap handles its own events - we don't need to add custom touch handlers
    // that might interfere with typing. The editor's DOM is already set up correctly.

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalDocOverflow;
    };
  }, [editor]);

  useEffect(() => {
    if (showKaraokeDialog || !editor) return;
    // TipTap handles content automatically, so we don't need to restore here
    // Karaoke insertion will be handled via TipTap commands
  }, [showKaraokeDialog, editor]);

  // Handle content changes - TipTap handles this via onUpdate callback
  // This function is kept for compatibility but may not be needed
  const handleEditorInput = () => {
    // TipTap's onUpdate callback already handles this
  };

  // Debounced local autosave
  useEffect(() => {
    // Skip initial mount when no title and no content
    if (!title && !content) return;
    setAutosaveStatus('Saving draft...');
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      try {
        const key = `draft:${chapter?.id || parentChapter?.id || 'new'}`;
        const data = { title, content, ts: Date.now() };
        localStorage.setItem(key, JSON.stringify(data));
        setAutosaveStatus('Draft saved');
      } catch (e) {
        setAutosaveStatus('Draft save failed');
      }
    }, 800);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [title, content, chapter?.id, parentChapter?.id]);

  // Sync toolbar with selection changes
  useEffect(() => {
    if (!editor) return;

    let rafId;
    const pollSelection = () => {
      try {
        const { state } = editor;
        const { from, to } = state.selection || {};
        const last = lastSelectionRef.current;

        if (from !== last.from || to !== last.to) {
          lastSelectionRef.current = { from, to };
          // Always refresh toolbar state when selection changes
          // userChangedColorRef only prevents text color updates, not highlight color
          refreshToolbarState();
        }
      } catch (e) {}
      rafId = window.requestAnimationFrame(pollSelection);
    };

    rafId = window.requestAnimationFrame(pollSelection);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [editor]);

  // Update dialog ref when dialog state changes
  useEffect(() => {
    dialogOpenRef.current = showKaraokeDialog;
    // Add/remove body class for CSS targeting
    if (showKaraokeDialog) {
      document.body.classList.add('dialog-open');
    } else {
      document.body.classList.remove('dialog-open');
    }
    return () => {
      document.body.classList.remove('dialog-open');
    };
  }, [showKaraokeDialog]);

  useEffect(() => {
  }, [showKaraokeDialog]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!editor) return; // Don't set up shortcuts if editor isn't ready
    
    const onKeyDown = (e) => {
      // Check if the event target is within a dialog - if so, let it through completely
      const target = e.target;
      if (target && target.closest('.karaoke-dialog')) {
        return; // Let the dialog handle it
      }
      
      // Don't capture keyboard events when dialogs are open
      if (dialogOpenRef.current) {
        return; // Dialog is open but event not from dialog - ignore completely
      }
      
      // Check if editor is focused - CRITICAL: only handle shortcuts when editor is focused
      if (!editor || !editor.isFocused) return;
      
      // Check for footnote conversion: typing ] after ^[content]
      if (e.key === ']' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        // Check if we just typed ] after a ^[...] pattern
        const { state } = editor;
        const { $from } = state.selection;
        const textBefore = state.doc.textBetween(Math.max(0, $from.pos - 100), $from.pos);
        const footnotePattern = /\^\[([^\]]+)$/;
        const match = textBefore.match(footnotePattern);
        
        if (match) {
          // We're closing a footnote pattern - convert it
          e.preventDefault();
          setTimeout(() => {
            convertTextToFootnote();
          }, 0);
          return;
        }
      }
      
      // CRITICAL: Only handle meta/ctrl shortcuts, let all other keys through to editor
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return; // Let normal typing pass through
      
      switch (e.key.toLowerCase()) {
        case 'b': 
          e.preventDefault(); 
          editor.chain().focus().toggleBold().run(); 
          refreshToolbarState(); 
          break;
        case 'i': 
          e.preventDefault(); 
          editor.chain().focus().toggleItalic().run(); 
          refreshToolbarState(); 
          break;
        case 'u': 
          e.preventDefault(); 
          // TODO: implement underline
          refreshToolbarState(); 
          break;
        case 'l': 
          e.preventDefault(); 
          editor.chain().focus().setTextAlign('left').run(); 
          refreshToolbarState(); 
          break;
        case 'e': 
          e.preventDefault(); 
          editor.chain().focus().setTextAlign('center').run(); 
          refreshToolbarState(); 
          break;
        case 'r': 
          e.preventDefault(); 
          editor.chain().focus().setTextAlign('right').run(); 
          refreshToolbarState(); 
          break;
        case 'enter':
          // Cmd+Enter: Convert ^[...] pattern to footnote
          e.preventDefault();
          convertTextToFootnote();
          break;
        default: break;
      }
    };
    document.addEventListener('keydown', onKeyDown, false); // Use bubbling phase, not capture
    return () => document.removeEventListener('keydown', onKeyDown, false);
  }, [editor, refreshToolbarState]); // FIXED: Add dependencies to prevent stale closures

  const handleSave = async () => {
    setSaving(true);
    const currentContent = editor ? editor.getHTML() : '';
    // Debug: always log HTML to see what's being saved
    console.log('[Save] Full HTML content:', currentContent);
    console.log('[Save] Contains drop-cap?', currentContent.includes('drop-cap'));
    if (currentContent.includes('drop-cap')) {
      const matches = currentContent.match(/<p[^>]*drop-cap[^>]*>.*?<\/p>/gi);
      console.log('[Save] Drop cap paragraphs found:', matches);
    }
    try {
      await onSave({ title, epigraph, contentHtml: currentContent, version: entityVersion });
    } catch (err) {
      if (err?.code === 'version-conflict') {
        setAutosaveStatus('Chapter updated elsewhere. Reloaded latest content.');
        alert('This chapter was updated in another session. The latest version has been loaded—please review and reapply your changes.');
      } else {
        console.error('Save failed', err);
        setAutosaveStatus('Save failed.');
        alert(err?.message || 'Failed to save changes. Please try again.');
      }
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this chapter?')) {
      await onDelete(chapter?.id);
      onCancel();
    }
  };


  const applyBold = () => {
    if (!editor) return;
    editor.chain().focus().toggleBold().run();
    refreshToolbarState();
  };
  const applyItalic = () => {
    if (!editor) return;
    editor.chain().focus().toggleItalic().run();
    refreshToolbarState();
  };
  const applyStrikethrough = () => {
    if (!editor) return;
    editor.chain().focus().toggleStrike().run();
    refreshToolbarState();
  };
  const applyUnderline = () => {
    if (!editor) return;
    editor.chain().focus().toggleUnderline().run();
    refreshToolbarState();
  };
  const applyHighlight = () => {
    if (!editor) return;
    // Use TipTap highlight mark instead of execCommand
    editor
      .chain()
      .focus()
      .toggleMark('highlight', { color: highlightColor })
      .run();
    refreshToolbarState();
  };
  const applyTextColor = () => {
    if (!editor) return;
    // Use TipTap TextColor mark command
    editor.chain().focus().setTextColor(textColor).run();
    refreshToolbarState();
  };
  const applyFontSize = (size) => {
    // Font-size is currently a planned polish feature.
    // For now we simply track the dropdown state without changing the document,
    // to avoid impacting pagination or layout.
    setFontSize(size);
  };

  const applyWhisperParagraph = () => {
    if (!editor) return;
    const { state } = editor;
    const { $from } = state.selection;
    
    // Find the paragraph node and its position (same approach as Indent/DropCap)
    let paragraphNode = null;
    let paragraphPos = null;
    
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'paragraph') {
        paragraphNode = $from.node(depth);
        paragraphPos = $from.before(depth);
        break;
      }
    }
    
    if (paragraphNode === null || paragraphPos === null) {
      console.log('[WhisperParagraph] No paragraph found');
      return;
    }
    
    const currentClass = paragraphNode.attrs.class || 'para-body';
    const hasWhisper = currentClass.includes('para-whisper');
    
    // Remove existing paragraph-variant classes we control (intro/whisper/epigraph)
    const cleaned = currentClass
      .split(/\s+/)
      .filter((cls) => cls && !['para-intro', 'para-whisper', 'para-epigraph'].includes(cls))
      .join(' ')
      .trim();
    
    let newClass;
    if (hasWhisper) {
      // Turn whisper back into regular body paragraph, preserving other classes (e.g. drop-cap)
      newClass = cleaned || 'para-body';
    } else {
      // Add whisper variant on top of existing classes
      newClass = (cleaned + ' para-whisper').trim();
      // Ensure we still have a base body class
      if (!newClass.includes('para-body')) {
        newClass = `para-body ${newClass}`.trim();
      }
    }
    
    const tr = state.tr.setNodeMarkup(paragraphPos, null, {
      ...paragraphNode.attrs,
      class: newClass,
    });
    editor.view.dispatch(tr);
    refreshToolbarState();
  };

  const setAlignment = (value) => {
    if (!editor) return;
    editor.chain().focus().setTextAlign(value).run();
    refreshToolbarState();
  };

  const alignLeft = () => setAlignment('left');
  const alignCenter = () => setAlignment('center');
  const alignRight = () => setAlignment('right');
  const alignJustify = () => setAlignment('justify');
  
  const applyBlockquote = () => {
    if (!editor) return;
    editor.chain().focus().toggleBlockquote().run();
    refreshToolbarState();
  };
  
  const applySubscript = () => {
    if (!editor) return;
    editor.chain().focus().toggleSubscript().run();
    refreshToolbarState();
  };
  
  const applySuperscript = () => {
    if (!editor) return;
    editor.chain().focus().toggleSuperscript().run();
    refreshToolbarState();
  };
  
  const applyIndent = () => {
    if (!editor) return;
    editor.chain().focus().indent().run();
    refreshToolbarState();
  };
  
  const applyOutdent = () => {
    if (!editor) return;
    editor.chain().focus().outdent().run();
    refreshToolbarState();
  };
  
  // Image alignment functions
  const setImageAlign = (align) => {
    if (!editor) return;
    editor.chain().focus().setImageAlign(align).run();
    // Small delay to ensure state updates before refreshing toolbar
    setTimeout(() => {
      refreshToolbarState();
    }, 50);
  };

  const applyImageAlignLeft = () => setImageAlign('left');
  const applyImageAlignCenter = () => setImageAlign('center');
  const applyImageAlignRight = () => setImageAlign('right');
  
  // Insert inline image (flows with text, like emoji/icon)
  const handleInlineImageSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !editor) return;
    
    setUploadingImage(true);
    try {
      const downloadURL = await uploadImageToStorage(file);
      // Insert as inline image node
      editor.chain().focus().insertContent({
        type: 'inlineImage',
        attrs: { src: downloadURL, alt: '' },
      }).run();
    } catch (error) {
      console.error('Error uploading inline image:', error);
    } finally {
      setUploadingImage(false);
      // Reset input
      if (inlineImageInputRef.current) {
        inlineImageInputRef.current.value = '';
      }
    }
  };

  const applyDropCap = () => {
    if (!editor) return;
    const { state } = editor;
    const { $from } = state.selection;
    
    // Find the paragraph node and its position (same approach as Indent extension)
    let paragraphNode = null;
    let paragraphPos = null;
    
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'paragraph') {
        paragraphNode = node;
        paragraphPos = $from.before(depth);
        break;
      }
    }
    
    if (!paragraphNode || paragraphPos === null) {
      console.log('[DropCap] No paragraph found');
      return;
    }
    
    const currentClass = paragraphNode.attrs.class || 'para-body';
    const hasDropCap = currentClass.includes('drop-cap');
    
    let newClass;
    if (hasDropCap) {
      // Remove drop cap
      newClass = currentClass.replace(/\s*drop-cap\s*/g, ' ').trim() || 'para-body';
    } else {
      // Add drop cap
      newClass = (currentClass + ' drop-cap').trim();
    }
    
    console.log('[DropCap] Current class:', currentClass, 'New class:', newClass);
    
    // Use the same approach as Indent extension - custom command with setNodeMarkup
    editor.chain().focus().command(({ tr, state, dispatch }) => {
      if (!dispatch) return false;
      
      const nodeAtPos = state.doc.nodeAt(paragraphPos);
      if (!nodeAtPos || nodeAtPos.type.name !== 'paragraph') {
        return false;
      }
      
      // Update the class attribute using setNodeMarkup (same as Indent does)
      tr.setNodeMarkup(paragraphPos, null, { ...nodeAtPos.attrs, class: newClass });
      dispatch(tr);
      return true;
    }).run();
    
    // Debug: verify the class was actually applied
    setTimeout(() => {
      if (editor) {
        const html = editor.getHTML();
        console.log('[DropCap] HTML after applying:', html);
        console.log('[DropCap] Contains drop-cap in HTML?', html.includes('drop-cap'));
        if (html.includes('drop-cap')) {
          const matches = html.match(/<p[^>]*drop-cap[^>]*>.*?<\/p>/gi);
          console.log('[DropCap] Drop cap paragraphs in editor HTML:', matches);
        } else {
          // Check what the actual paragraph HTML looks like
          const paraMatches = html.match(/<p[^>]*>.*?<\/p>/gi);
          console.log('[DropCap] All paragraphs in HTML (first 3):', paraMatches?.slice(0, 3));
        }
      }
    }, 200);
    
    refreshToolbarState();
  };

  const applyPoetry = () => {
    if (!editor) return;
    editor.chain().focus().togglePoetry().run();
    refreshToolbarState();
  };

  const applyEpigraphParagraph = () => {
    if (!editor) return;
    const { state } = editor;
    const { $from } = state.selection;
    
    // Find the paragraph node and its position
    let paragraphNode = null;
    let paragraphPos = null;
    
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'paragraph') {
        paragraphNode = node;
        paragraphPos = $from.before(depth);
        break;
      }
    }
    
    if (!paragraphNode || paragraphPos === null) {
      console.log('[EpigraphParagraph] No paragraph found');
      return;
    }
    
    const currentClass = paragraphNode.attrs.class || 'para-body';
    const hasEpigraph = currentClass.includes('para-epigraph');
    
    // Remove existing paragraph-variant classes we control (intro/whisper/epigraph)
    const cleaned = currentClass
      .split(/\s+/)
      .filter((cls) => cls && !['para-intro', 'para-whisper', 'para-epigraph'].includes(cls))
      .join(' ')
      .trim();
    
    let newClass;
    if (hasEpigraph) {
      // Turn epigraph back into regular body paragraph
      newClass = cleaned || 'para-body';
    } else {
      // Add epigraph variant
      newClass = (cleaned + ' para-epigraph').trim();
      if (!newClass.includes('para-body')) {
        newClass = ('para-body ' + newClass).trim();
      }
    }
    
    editor.chain().focus().command(({ tr, dispatch }) => {
      if (paragraphPos !== null) {
        tr.setNodeMarkup(paragraphPos, null, { ...paragraphNode.attrs, class: newClass });
        if (dispatch) dispatch(tr);
        return true;
      }
      return false;
    }).run();
    
    refreshToolbarState();
  };


  const applyIntroParagraph = () => {
    if (!editor) return;
    const { state } = editor;
    const { $from } = state.selection;
    
    // Find the paragraph node and its position (same approach as Indent/DropCap)
    let paragraphNode = null;
    let paragraphPos = null;
    
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'paragraph') {
        paragraphNode = node;
        paragraphPos = $from.before(depth);
        break;
      }
    }
    
    if (!paragraphNode || paragraphPos === null) {
      console.log('[IntroParagraph] No paragraph found');
      return;
    }
    
    const currentClass = paragraphNode.attrs.class || 'para-body';
    const hasIntro = currentClass.includes('para-intro');
    
    // Remove any existing paragraph-variant classes we control (intro/whisper/epigraph)
    const cleaned = currentClass
      .split(/\s+/)
      .filter((cls) => cls && !['para-intro', 'para-whisper', 'para-epigraph'].includes(cls))
      .join(' ')
      .trim();
    
    let newClass;
    if (hasIntro) {
      // Turn intro back into regular body paragraph, preserving other classes (e.g. drop-cap)
      newClass = cleaned || 'para-body';
    } else {
      // Add intro variant on top of any existing classes (e.g. drop-cap)
      newClass = (cleaned + ' para-intro').trim();
      // Ensure we still have a base body class if nothing else remains
      if (!/para-body/.test(newClass)) {
        newClass = ('para-body ' + newClass).trim();
      }
    }
    
    const { tr } = state;
    tr.setNodeMarkup(paragraphPos, null, {
      ...paragraphNode.attrs,
      class: newClass,
    });
    editor.view.dispatch(tr);
    refreshToolbarState();
  };

  const handleTextColorChange = (e) => {
    const value = e.target.value;
    
    // Mark that user is manually changing the color - prevent refreshToolbarState from overriding
    // Set this BEFORE any operations that might trigger selection changes
    userChangedColorRef.current = true;
    
    // Update state immediately - useLayoutEffect will handle visual update
    setTextColor(value);
    
    // Force immediate visual update of the color picker swatch
    if (colorInputRef.current) {
      colorInputRef.current.value = value;
    }
    
    if (editor) {
      // Apply color to current selection/caret position via TipTap
      editor.chain().focus().setTextColor(value).run();

      // Keep the flag true for longer to prevent any selection changes from overriding
      // Only reset after user starts typing or a significant delay
      setTimeout(() => {
        userChangedColorRef.current = false;
      }, 500);

      // Let toolbar sync naturally on next refreshToolbarState
    }
  };

  const handleHighlightColorChange = (e) => {
    const value = e.target.value;
    
    // Mark that user is manually changing the highlight color
    userChangedHighlightRef.current = true;
    
    // Update state immediately so tooltip reflects the change
    setHighlightColor(value);
    
    // Force immediate visual update of the color picker
    if (highlightInputRef.current) {
      highlightInputRef.current.value = value;
    }
    
    // Immediately apply new highlight color to selection/caret via TipTap
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setMark('highlight', { color: value })
      .run();
    
    // Reset flag after a delay to allow toolbar to sync naturally
    setTimeout(() => {
      userChangedHighlightRef.current = false;
    }, 500);
    
    // Don't call refreshToolbarState here - it would override our manual change
  };

  const handleApplyHighlightClick = (e) => {
    if (!editor) return;
    e.preventDefault();
    const chain = editor.chain().focus();
    if (e.altKey) {
      // Alt-click clears highlight
      chain.unsetMark('highlight');
    } else {
      chain.toggleMark('highlight', { color: highlightColor });
    }
    chain.run();
    refreshToolbarState();
  };

  const handleImageButtonClick = () => {
    if (imageInputRef.current) imageInputRef.current.click();
  };

  const handleVideoButtonClick = () => {
    if (videoFileInputRef.current) videoFileInputRef.current.click();
  };

  const handleInsertFootnote = () => {
    if (!editor) {
      console.warn('Editor not available');
      return;
    }
    
    try {
      // Ensure editor is focused first
      if (!editor.isFocused) {
        editor.commands.focus();
      }
      
      // Get current cursor position before insertion
      const { state: beforeState } = editor;
      const beforePos = beforeState.selection.$from.pos;
      
      // Insert inline placeholder: ^[ ]
      editor.chain()
        .focus()
        .insertContent('^[ ]')
        .run();
      
      // Move cursor between the brackets after insertion
      requestAnimationFrame(() => {
        if (editor) {
          const { state } = editor;
          // The cursor should now be after the inserted text
          // We inserted '^[ ]' which is 4 characters, so cursor is at beforePos + 4
          // We want cursor at beforePos + 2 (right after '^[')
          const targetPos = beforePos + 2;
          
          // Set cursor position and delete the space
          editor.chain()
            .setTextSelection(targetPos)
            .deleteSelection() // Delete the space between brackets
            .focus()
            .run();
        }
      });
      
      refreshToolbarState();
    } catch (error) {
      console.error('Error inserting footnote:', error);
    }
  };

  // Convert ^[content] text pattern to footnote node
  const convertTextToFootnote = () => {
    if (!editor) return;
    
    try {
      const { state } = editor;
      const { selection } = state;
      const { from, to } = selection;
      
      // Get text around cursor/selection
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from);
      const textAfter = state.doc.textBetween(to, Math.min(state.doc.content.size, to + 10));
      
      // Look for ^[...] pattern before cursor
      const pattern = /\^\[([^\]]+)\]$/;
      const match = (textBefore + textAfter).match(pattern);
      
      if (match) {
        const content = match[1].trim();
        if (!content) return;
        
        // Find the position of the pattern
        const patternStart = textBefore.lastIndexOf('^[');
        if (patternStart === -1) return;
        
        const actualStart = from - (textBefore.length - patternStart);
        const actualEnd = actualStart + match[0].length;
        
        // Find highest footnote number
        let maxNumber = 0;
        state.doc.descendants((node) => {
          if (node.type.name === 'footnoteRef' && node.attrs.number) {
            maxNumber = Math.max(maxNumber, node.attrs.number);
          }
        });
        
        const number = maxNumber + 1;
        const id = `fn-${number}`;
        
        // Replace text with footnote node
        editor.chain()
          .setTextSelection({ from: actualStart, to: actualEnd })
          .insertContent({
            type: 'footnoteRef',
            attrs: {
              id,
              number,
              content: content,
            },
          })
          .run();
        
        refreshToolbarState();
      }
    } catch (error) {
      console.error('Error converting text to footnote:', error);
    }
  };

  const handleVideoFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadingVideo(true);
    setVideoUploadProgress(0);
    
    try {
      const downloadURL = await uploadVideoToStorage(file, {
        onProgress: (progress) => {
          setVideoUploadProgress(progress);
        }
      });
    
      if (!editor) return;
      
      // Use TipTap's insertContent to insert Video node
      editor.chain().focus().insertContent({
        type: 'video',
        attrs: {
          src: downloadURL,
          controls: true,
          style: 'max-width:100%;height:auto;display:block;margin:8px 0;',
          mode: 'blank-page', // Default to blank page mode
        },
      }).run();
      
      // Select the video node so the mode toggle button appears
      // Use setTimeout to allow the editor state to settle after insertion
      setTimeout(() => {
        if (!editor) return;
        
        // Get fresh state inside setTimeout to avoid stale position issues
        const { state } = editor;
        const { doc } = state;
        
        // Search for the video node we just inserted by its src attribute
        let videoPos = null;
        doc.descendants((node, pos) => {
          if (node.type.name === 'video' && node.attrs.src === downloadURL) {
            videoPos = pos;
            return false; // Stop searching
          }
        });
        
        // If we found the video node, select it
        if (videoPos !== null) {
          // Resolve the position against the current state
          const resolvedPos = doc.resolve(videoPos);
          editor.commands.setTextSelection(resolvedPos);
        }
        
        refreshToolbarState();
      }, 100);
    } catch (err) {
      console.error('Video upload failed', err);
      alert(err.message || 'Video upload failed. Please try again.');
    } finally {
      setUploadingVideo(false);
      setVideoUploadProgress(0);
      if (videoFileInputRef.current) videoFileInputRef.current.value = '';
    }
  };

  const handleToggleVideoMode = () => {
    if (!editor) return;
    
    try {
      const { selection } = editor.state;
      const { $from } = selection;
      
      // Find the video node
      let videoNode = $from.nodeBefore || $from.nodeAfter;
      if (!videoNode || videoNode.type.name !== 'video') {
        const nodeAt = $from.parent.child($from.index());
        if (nodeAt && nodeAt.type.name === 'video') {
          videoNode = nodeAt;
        }
      }
      
      if (videoNode && videoNode.type.name === 'video') {
        const currentMode = videoNode.attrs.mode || 'blank-page';
        const newMode = currentMode === 'blank-page' ? 'background' : 'blank-page';
        
        // Update the video node's mode attribute
        editor.chain().focus().updateAttributes('video', {
          mode: newMode,
        }).run();
        
        refreshToolbarState();
      }
    } catch (error) {
      console.error('Error toggling video mode:', error);
    }
  };

  // Parse SRT/VTT file to extract word timings
  const parseTimingFile = async (file) => {
    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    // Try SRT format first
    if (lines.some(l => l.includes('-->'))) {
      return parseSRT(text);
    }
    
    // Try VTT format
    if (text.includes('WEBVTT')) {
      return parseVTT(text);
    }
    
    throw new Error('Unsupported timing file format. Please use SRT or VTT.');
  };

  const parseSRT = (text) => {
    const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
    const wordTimings = [];
    
    for (const block of blocks) {
      const lines = block.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;
      
      // Find time line (e.g., "00:00:00,000 --> 00:00:03,000")
      const timeLine = lines.find(l => l.includes('-->'));
      if (!timeLine) continue;
      
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
      if (!timeMatch) continue;
      
      const startTime = parseFloat(
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000
      );
      const endTime = parseFloat(
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000
      );
      
      // Get text (all lines after the time line)
      const textLines = lines.slice(lines.indexOf(timeLine) + 1);
      const text = textLines.join(' ').replace(/<[^>]+>/g, ''); // Remove HTML tags
      
      // Split text into words and distribute timing evenly
      const words = text.split(/\s+/).filter(w => w);
      if (words.length === 0) continue;
      
      const duration = endTime - startTime;
      const timePerWord = duration / words.length;
      
      words.forEach((word, i) => {
        wordTimings.push({
          word: word.replace(/[.,!?;:]/g, ''), // Remove punctuation for matching
          start: startTime + (i * timePerWord),
          end: startTime + ((i + 1) * timePerWord)
        });
      });
    }
    
    return wordTimings;
  };

  const parseVTT = (text) => {
    const lines = text.split('\n');
    const wordTimings = [];
    let currentStart = 0;
    let currentEnd = 0;
    let currentText = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Time cue line (e.g., "00:00:00.000 --> 00:00:03.000")
      if (line.includes('-->')) {
        const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (timeMatch) {
          currentStart = parseFloat(
            parseInt(timeMatch[1]) * 3600 +
            parseInt(timeMatch[2]) * 60 +
            parseInt(timeMatch[3]) +
            parseInt(timeMatch[4]) / 1000
          );
          currentEnd = parseFloat(
            parseInt(timeMatch[5]) * 3600 +
            parseInt(timeMatch[6]) * 60 +
            parseInt(timeMatch[7]) +
            parseInt(timeMatch[8]) / 1000
          );
        }
      } else if (line && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && !line.match(/^\d+$/)) {
        // Text line
        currentText = line.replace(/<[^>]+>/g, ''); // Remove HTML tags
        const words = currentText.split(/\s+/).filter(w => w);
        if (words.length > 0 && currentEnd > currentStart) {
          const duration = currentEnd - currentStart;
          const timePerWord = duration / words.length;
          
          words.forEach((word, idx) => {
            wordTimings.push({
              word: word.replace(/[.,!?;:]/g, ''),
              start: currentStart + (idx * timePerWord),
              end: currentStart + ((idx + 1) * timePerWord)
            });
          });
        }
      }
    }
    
    return wordTimings;
  };

  const handleKaraokeAudioFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setKaraokeAudioFile(file);
      setKaraokeAudioUrl(''); // Clear URL if file selected
    }
  };

  const handleKaraokeTimingFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setKaraokeTimingFile(file);
    }
  };


  const handleInsertKaraoke = async () => {
    if (!karaokeText.trim()) {
      alert('Please enter the karaoke text.');
      return;
    }
    
    if (!karaokeAudioFile && !karaokeAudioUrl.trim()) {
      alert('Please upload an audio file or provide an audio URL.');
      return;
    }
    
    let audioUrl = '';
    let wordTimings = [];
    
    // Handle audio: convert file to base64 or use URL
    if (karaokeAudioFile) {
      try {
        // Convert audio to base64 (similar to images)
        const reader = new FileReader();
        audioUrl = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(karaokeAudioFile);
        });
      } catch (err) {
        alert('Failed to process audio file: ' + err.message);
        return;
      }
    } else {
      audioUrl = karaokeAudioUrl.trim();
    }
    
    // Handle timings: parse file or auto-generate
    if (karaokeTimingMethod === 'upload' && karaokeTimingFile) {
      try {
        wordTimings = await parseTimingFile(karaokeTimingFile);
      } catch (err) {
        alert('Failed to parse timing file: ' + err.message);
        return;
      }
    } else if (karaokeTimingMethod === 'auto') {
      try {
        setGeneratingTimings(true);
        const audioSource = karaokeAudioFile || audioUrl;
        if (!audioSource) {
          alert('Please provide an audio file or URL for auto-generation.');
          setGeneratingTimings(false);
          return;
        }
        
        // Generate word timings using Deepgram API
        wordTimings = await generateWordTimingsWithDeepgram(audioSource, karaokeText.trim());
        
        if (wordTimings.length === 0) {
          alert('Failed to generate word timings. Please try uploading a timing file instead.');
          setGeneratingTimings(false);
          return;
        }
        setGeneratingTimings(false);
      } catch (err) {
        setGeneratingTimings(false);
        alert('Failed to auto-generate timings: ' + err.message);
        return;
      }
    } else {
      alert('Please either upload a timing file or select auto-generation.');
      return;
    }
    
    if (wordTimings.length === 0) {
      alert('No word timings found. Please check your timing file.');
      return;
    }
    
    if (!editor) return;
    
    // Create karaoke object
    const karaokeId = `karaoke-${Date.now()}`;
    
    // Use TipTap's insertContent to insert KaraokeBlock node
    editor.chain().focus().insertContent({
      type: 'karaokeBlock',
      attrs: {
        id: karaokeId,
        audioUrl: audioUrl,
        timingsJson: JSON.stringify(wordTimings),
        text: karaokeText.trim(),
      },
    }).run();
    
    // Close dialog and reset form
    setShowKaraokeDialog(false);
    setKaraokeText('');
    setKaraokeAudioFile(null);
    setKaraokeAudioUrl('');
    setKaraokeTimingFile(null);
    setGeneratingTimings(false);
    setPendingInsertTick((tick) => tick + 1);
  };

  const handleImageSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setImageUploadProgress(0);
    try {
      const downloadURL = await uploadImageToStorage(file, {
        onProgress: (progress) => {
          setImageUploadProgress(progress);
        },
        compress: true
      });
      
      if (!editor) return;
      
      // Use TipTap's CustomImage node with default center alignment
      // This works for both regular images and GIFs
      editor.chain().focus().setImage({
        src: downloadURL,
        alt: '',
        align: 'center', // Default to center, user can change alignment after insertion
      }).run();
      
      refreshToolbarState();
    } catch (err) {
      console.error('Image upload failed', err);
      alert(err.message || 'Image upload failed. Please try again.');
    } finally {
      setUploadingImage(false);
      setImageUploadProgress(0);
      // reset input so selecting the same file again still triggers change
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  useEffect(() => {
    // Only auto-focus content editor on initial mount, and only if title input is not being focused
    if (!editor) return;
    const timer = setTimeout(() => {
      const activeElement = document.activeElement;
      const editorEl = editor.view?.dom;
      // Don't auto-focus if title input is focused or if content editor is already focused
      if (editorEl && 
          activeElement !== titleInputRef.current && 
          activeElement !== editorEl &&
          !titleInputRef.current?.matches(':focus')) {
        editor.commands.focus();
      }
    }, 300); // Longer delay to allow user to click title first
    return () => clearTimeout(timer);
  }, [editor]);

  return (
    <div className="editor-overlay side-panel">
      <div className="editor-modal side-panel-modal">
        <button className="close-btn close-top" onClick={onCancel}>✕</button>
        
        <div className="editor-content">
          <div className="title-row">
            <input
              ref={titleInputRef}
              id="chapter-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="naslov poglavja"
              className="title-input"
            />
          </div>

          <div className="page-frame">
            <div className="editor-toolbar attached">
              <div className="toolbar-buttons">
                <button 
                  onClick={applyBold}
                  className={`toolbar-btn ${activeFormats.bold ? 'active' : ''}`}
                  title="Bold"
                >
                  <strong>B</strong>
                </button>
                <button 
                  onClick={applyItalic}
                  className={`toolbar-btn ${activeFormats.italic ? 'active' : ''}`}
                  title="Italic"
                >
                  <em>I</em>
                </button>
                <button 
                  onClick={applyStrikethrough}
                  className={`toolbar-btn ${activeFormats.strikethrough ? 'active' : ''}`}
                  title="Strikethrough"
                >
                  <span style={{textDecoration: 'line-through'}}>S</span>
                </button>
                <button 
                  onClick={applyUnderline}
                  className={`toolbar-btn ${activeFormats.underline ? 'active' : ''}`}
                  title="Underline"
                >
                  <span style={{textDecoration: 'underline'}}>U</span>
                </button>
                {/* Font size selector */}
                <select
                  value={fontSize}
                  onChange={(e) => {
                    const size = e.target.value;
                    setFontSize(size);
                    applyFontSize(size);
                  }}
                  className="toolbar-font-size"
                  title="Font Size"
                >
                  <option value="10">10</option>
                  <option value="12">12</option>
                  <option value="14">14</option>
                  <option value="16">16</option>
                  <option value="18">18</option>
                  <option value="20">20</option>
                  <option value="24">24</option>
                  <option value="28">28</option>
                  <option value="32">32</option>
                  <option value="36">36</option>
                  <option value="48">48</option>
                </select>
                <button
                  onClick={handleImageButtonClick}
                  className={`toolbar-btn ${uploadingImage ? 'uploading' : ''}`}
                  title={uploadingImage ? "Uploading image..." : "Insert Image"}
                  disabled={uploadingImage}
                  style={uploadingImage ? {
                    '--upload-progress': `${imageUploadProgress}%`
                  } : {}}
                >
                  <span className="toolbar-btn-icon">🖼</span>
                  {uploadingImage && <div className="toolbar-btn-progress" />}
                </button>
                <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageSelected} style={{ display: 'none' }} disabled={uploadingImage} />
                <button
                  onClick={() => inlineImageInputRef.current?.click()}
                  className={`toolbar-btn ${uploadingImage ? 'uploading' : ''}`}
                  title={uploadingImage ? "Uploading..." : "Insert Inline Image (Flows with Text)"}
                  disabled={uploadingImage}
                >
                  <span className="toolbar-btn-icon">📎</span>
                  {uploadingImage && <div className="toolbar-btn-progress" />}
                </button>
                <input ref={inlineImageInputRef} type="file" accept="image/*" onChange={handleInlineImageSelected} style={{ display: 'none' }} disabled={uploadingImage} />
                <button
                  onClick={handleVideoButtonClick}
                  className={`toolbar-btn ${uploadingVideo ? 'uploading' : ''}`}
                  title={uploadingVideo ? "Uploading video..." : "Insert Video"}
                  disabled={uploadingVideo}
                  style={uploadingVideo ? {
                    '--upload-progress': `${videoUploadProgress}%`
                  } : {}}
                >
                  <span className="toolbar-btn-icon">🎥</span>
                  {uploadingVideo && <div className="toolbar-btn-progress" />}
                </button>
                <input ref={videoFileInputRef} type="file" accept="video/*" onChange={handleVideoFileSelected} style={{ display: 'none' }} disabled={uploadingVideo} />
                {/* Video mode toggle disabled for now - focusing on blank-page mode only */}
                {/* {activeFormats.videoSelected && (
                  <button
                    onClick={handleToggleVideoMode}
                    className="toolbar-btn"
                    title={activeFormats.videoSelected.attrs.mode === 'background' 
                      ? "Video Mode: Background (Click to switch to Blank Page)" 
                      : "Video Mode: Blank Page (Click to switch to Background)"}
                    style={{
                      backgroundColor: activeFormats.videoSelected.attrs.mode === 'background' 
                        ? 'rgba(59, 130, 246, 0.15)' 
                        : 'rgba(107, 114, 128, 0.15)',
                      border: `1px solid ${activeFormats.videoSelected.attrs.mode === 'background' 
                        ? 'rgba(59, 130, 246, 0.3)' 
                        : 'rgba(107, 114, 128, 0.3)'}`
                    }}
                  >
                    <span className="toolbar-btn-icon">
                      {activeFormats.videoSelected.attrs.mode === 'background' ? '🎬' : '📄'}
                    </span>
                    <span style={{ fontSize: '0.7rem', marginLeft: '4px', fontWeight: 500 }}>
                      {activeFormats.videoSelected.attrs.mode === 'background' ? 'BG' : 'Page'}
                    </span>
                  </button>
                )} */}
                <button
                  onClick={() => {
                    // Disable editor and blur it before opening dialog
                    if (editor) {
                      editor.commands.blur();
                    }
                    setShowKaraokeDialog(true);
                    setKaraokeText('');
                    setKaraokeAudioFile(null);
                    setKaraokeAudioUrl('');
                    setKaraokeTimingFile(null);
                    setKaraokeTimingMethod('upload');
                  }}
                  className="toolbar-btn karaoke-btn"
                  title="Insert Karaoke"
                >
                  🎤
                </button>
                <button
                  onClick={handleInsertFootnote}
                  className="toolbar-btn"
                  title="Insert Footnote"
                >
                  <sup>¹</sup>
                </button>
                {/* Text color picker (no button) */}
                <div className="color-group">
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={textColor}
                    onChange={handleTextColorChange}
                    className="color-input"
                    title="Text Color"
                  />
                </div>
                {/* Highlight H-swatch next to text color */}
                <div className="highlight-picker-container" title="Highlight (click to apply, Alt-click to clear)">
                  <input
                    ref={highlightInputRef}
                    type="color"
                    value={highlightColor}
                    onChange={handleHighlightColorChange}
                    className="highlight-picker"
                  />
                  <button className="highlight-overlay" style={{ color: textColor }} onMouseDown={(e)=>e.preventDefault()} onClick={handleApplyHighlightClick}>H</button>
                </div>
                <span className="toolbar-sep" />
                <button 
                  onClick={alignLeft}
                  className={`toolbar-btn ${activeFormats.alignLeft ? 'active' : ''}`}
                  title="Align Left"
                >
                  ⬑
                </button>
                <button 
                  onClick={alignCenter}
                  className={`toolbar-btn ${activeFormats.alignCenter ? 'active' : ''}`}
                  title="Align Center"
                >
                  ≡
                </button>
                <button 
                  onClick={alignRight}
                  className={`toolbar-btn ${activeFormats.alignRight ? 'active' : ''}`}
                  title="Align Right"
                >
                  ⬏
                </button>
                <button 
                  onClick={alignJustify}
                  className={`toolbar-btn ${activeFormats.alignJustify ? 'active' : ''}`}
                  title="Align Justify"
                >
                  ☰
                </button>
                {/* Image alignment buttons - only show when image is selected */}
                {(activeFormats.imageAlignLeft || activeFormats.imageAlignCenter || activeFormats.imageAlignRight) && (
                  <>
                    <div className="toolbar-separator" />
                    <button
                      onClick={applyImageAlignLeft}
                      className={`toolbar-btn ${activeFormats.imageAlignLeft ? 'active' : ''}`}
                      title="Image: Align Left (Text Wraps Right)"
                    >
                      ⬅️
                    </button>
                    <button
                      onClick={applyImageAlignCenter}
                      className={`toolbar-btn ${activeFormats.imageAlignCenter ? 'active' : ''}`}
                      title="Image: Center (No Wrap)"
                    >
                      ⬆️
                    </button>
                    <button
                      onClick={applyImageAlignRight}
                      className={`toolbar-btn ${activeFormats.imageAlignRight ? 'active' : ''}`}
                      title="Image: Align Right (Text Wraps Left)"
                    >
                      ➡️
                    </button>
                  </>
                )}
                <span className="toolbar-sep" />
                <button 
                  onClick={applyBlockquote}
                  className={`toolbar-btn ${activeFormats.blockquote ? 'active' : ''}`}
                  title="Blockquote"
                >
                  "
                </button>
                <button 
                  onClick={applySubscript}
                  className={`toolbar-btn ${activeFormats.subscript ? 'active' : ''}`}
                  title="Subscript"
                >
                  <span style={{ fontSize: '0.9em' }}>x₂</span>
                </button>
                <button 
                  onClick={applySuperscript}
                  className={`toolbar-btn ${activeFormats.superscript ? 'active' : ''}`}
                  title="Superscript"
                >
                  <span style={{ fontSize: '0.9em' }}>x²</span>
                </button>
                <button 
                  onClick={applyIndent}
                  className="toolbar-btn"
                  title="Indent"
                >
                  →
                </button>
                <button 
                  onClick={applyOutdent}
                  className="toolbar-btn"
                  title="Outdent"
                >
                  ←
                </button>
                <button
                  onClick={applyIntroParagraph}
                  className={`toolbar-btn ${activeFormats.introParagraph ? 'active' : ''}`}
                  title="Intro paragraph style"
                >
                  <span style={{ fontStyle: 'italic', fontSize: '1.1em' }}>¶</span>
                </button>
                <button
                  onClick={applyWhisperParagraph}
                  className={`toolbar-btn ${activeFormats.whisperParagraph ? 'active' : ''}`}
                  title="Whisper / aside paragraph style"
                >
                  <span style={{ fontSize: '0.95em', color: '#777' }}>¶</span>
                </button>
                <button
                  onClick={applyEpigraphParagraph}
                  className={`toolbar-btn ${activeFormats.epigraphParagraph ? 'active' : ''}`}
                  title="Epigraph (quote before chapter)"
                >
                  <span style={{ fontStyle: 'italic', fontSize: '0.9em' }}>"</span>
                </button>
                <button
                  onClick={applyPoetry}
                  className={`toolbar-btn ${editor?.isActive('poetry') ? 'active' : ''}`}
                  title="Poetry formatting"
                >
                  📜
                </button>
                <button 
                  onClick={applyDropCap}
                  className={`toolbar-btn ${activeFormats.dropCap ? 'active' : ''}`}
                  title="Drop Cap"
                >
                  <span style={{ fontSize: '1.5em', lineHeight: '0.8' }}>A</span>
                </button>
                
              </div>
              <div className="toolbar-actions">
                <button
                  className="toolbar-btn epigraph-btn"
                  type="button"
                  onClick={() => {
                    console.log('[Epigraph] Opening epigraph dialog');
                    const current = epigraph && typeof epigraph === 'object'
                      ? epigraph
                      : { text: '', author: '', align: 'center' };
                    setEpigraphDraft({
                      text: current.text || '',
                      author: current.author || '',
                      align: current.align || 'center',
                    });
                    setShowEpigraphDialog(true);
                  }}
                  title="Epigraf poglavja"
                >
                  <span className="icon">✶</span>
                </button>
                <button 
                  className="toolbar-save-btn"
                  onClick={handleSave}
                  disabled={!title.trim() || saving}
                >
                  {saving ? 'Objavljam' : 'Objavi'}
                </button>
              </div>
            </div>
            <div className="ruler">
              <div className="ruler-track">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} className="ruler-num">{i + 1}</span>
                ))}
              </div>
            </div>
            {!showKaraokeDialog && editor && (
              <SimpleBar className="content-editor-wrapper" style={{ flex: 1, minHeight: 0 }}>
                <EditorContent 
                  editor={editor}
                  onFocus={() => {
                    // Ensure editor is focused when clicked
                    if (editor && !editor.isFocused) {
                      editor.commands.focus();
                    }
                  }}
                />
              </SimpleBar>
            )}
          </div>

          {/* shortcuts removed per design */}
        </div>

        {/* bottom actions removed in favor of floating save */}
      </div>

      {/* Karaoke dialog - modal overlay, but editor is hidden from DOM */}
      {showKaraokeDialog && createPortal(
        <div 
          className="karaoke-dialog-overlay" 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowKaraokeDialog(false);
              setKaraokeText('');
              setKaraokeAudioFile(null);
              setKaraokeAudioUrl('');
              setKaraokeTimingFile(null);
              setGeneratingTimings(false);
            }
          }}
        >
          <div 
            className="karaoke-dialog" 
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close-btn close-top" onClick={() => {
              setShowKaraokeDialog(false);
              setKaraokeText('');
              setKaraokeAudioFile(null);
              setKaraokeAudioUrl('');
              setKaraokeTimingFile(null);
              setGeneratingTimings(false);
            }}>✕</button>
            <div className="karaoke-dialog-content">
              <h3>Insert Karaoke</h3>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                Enter the text, upload audio, and provide word timings
              </p>
              
              <div>
                <label>Karaoke Text:</label>
                <textarea
                  value={karaokeText}
                  onChange={(e) => setKaraokeText(e.target.value)}
                  placeholder="Enter the text that will be highlighted..."
                  rows={3}
                />
              </div>

              <div>
                <label>Audio:</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleKaraokeAudioFileSelected}
                />
                <div className="karaoke-form-divider">or</div>
            <input
              type="text"
                  value={karaokeAudioUrl}
                  onChange={(e) => {
                    setKaraokeAudioUrl(e.target.value);
                    setKaraokeAudioFile(null);
                  }}
                  placeholder="Paste audio URL..."
                />
              </div>

              <div>
                <label>Word Timings:</label>
                <div className="karaoke-form-radio-group">
                  <label>
                    <input
                      type="radio"
                      checked={karaokeTimingMethod === 'upload'}
                      onChange={() => setKaraokeTimingMethod('upload')}
                    />
                    Upload SRT/VTT file
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={karaokeTimingMethod === 'auto'}
                      onChange={() => setKaraokeTimingMethod('auto')}
                    />
                    Auto-generate
                  </label>
                </div>
                {karaokeTimingMethod === 'upload' && (
                  <input
                    type="file"
                    accept=".srt,.vtt,text/vtt"
                    onChange={handleKaraokeTimingFileSelected}
                  />
                )}
                {karaokeTimingMethod === 'auto' && (
                  <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic' }}>
                    {generatingTimings ? 'Generating word timings...' : 'Word timings will be automatically generated from the audio using Deepgram API.'}
                  </div>
                )}
              </div>

              <div className="karaoke-dialog-actions">
                <button 
                  onClick={() => {
                    setShowKaraokeDialog(false);
                    setKaraokeText('');
                    setKaraokeAudioFile(null);
                    setKaraokeAudioUrl('');
                    setKaraokeTimingFile(null);
                    setGeneratingTimings(false);
                  }} 
                  className="btn-cancel"
                >
                Cancel
              </button>
                <button 
                  onClick={handleInsertKaraoke} 
                  className="btn-save"
                  disabled={!karaokeText.trim() || (!karaokeAudioFile && !karaokeAudioUrl.trim()) || generatingTimings}
                >
                  {generatingTimings ? 'Generating...' : 'Insert'}
              </button>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}

      {/* Epigraph mini editor dialog */}
      {showEpigraphDialog && createPortal(
        <div 
          className="karaoke-dialog-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowEpigraphDialog(false);
            }
          }}
        >
          <div 
            className="karaoke-dialog epigraph-dialog-wrapper"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-btn close-top"
              onClick={() => setShowEpigraphDialog(false)}
            >
              ✕
            </button>
            <div className="karaoke-dialog-content epigraph-dialog">
              <h2 className="epigraph-dialog-title">Epigraf poglavja</h2>
              <div className="form-group">
                <label htmlFor="epigraph-text">Besedilo epigrafa</label>
                <textarea
                  id="epigraph-text"
                  value={epigraphDraft.text}
                  onChange={(e) =>
                    setEpigraphDraft((prev) => ({ ...prev, text: e.target.value }))
                  }
                  rows={4}
                />
              </div>
              <div className="form-group">
                <label htmlFor="epigraph-author">Avtor (opcijsko)</label>
                <input
                  id="epigraph-author"
                  type="text"
                  value={epigraphDraft.author}
                  onChange={(e) =>
                    setEpigraphDraft((prev) => ({ ...prev, author: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label>Poravnava</label>
                <div className="epigraph-align-buttons">
                  <button
                    type="button"
                    className={`toolbar-btn ${epigraphDraft.align === 'left' ? 'active' : ''}`}
                    onClick={() =>
                      setEpigraphDraft((prev) => ({ ...prev, align: 'left' }))
                    }
                    title="Align Left"
                  >
                    ⬑
                  </button>
                  <button
                    type="button"
                    className={`toolbar-btn ${epigraphDraft.align === 'center' ? 'active' : ''}`}
                    onClick={() =>
                      setEpigraphDraft((prev) => ({ ...prev, align: 'center' }))
                    }
                    title="Align Center"
                  >
                    ≡
                  </button>
                  <button
                    type="button"
                    className={`toolbar-btn ${epigraphDraft.align === 'right' ? 'active' : ''}`}
                    onClick={() =>
                      setEpigraphDraft((prev) => ({ ...prev, align: 'right' }))
                    }
                    title="Align Right"
                  >
                    ⬏
                  </button>
                </div>
              </div>
              <div className="epigraph-actions">
                <button
                  type="button"
                  className="epigraph-delete-btn"
                  onClick={() => {
                    setEpigraph(null);
                    setShowEpigraphDialog(false);
                  }}
                >
                  Odstrani epigraf
                </button>
                <button
                  type="button"
                  className="epigraph-save-btn"
                  onClick={() => {
                    const text = epigraphDraft.text.trim();
                    const author = epigraphDraft.author.trim();
                    const align = epigraphDraft.align || 'center';
                    if (!text) {
                      setEpigraph(null);
                    } else {
                      setEpigraph({ text, author, align });
                    }
                    setShowEpigraphDialog(false);
                  }}
                >
                  Shrani epigraf
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
