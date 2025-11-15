import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { uploadImageToStorage, uploadVideoToStorage } from '../services/storage';
import { generateWordTimingsWithDeepgram } from '../services/autoTiming';
import './ChapterEditor.css';

export const ChapterEditor = ({ chapter, parentChapter, onSave, onCancel, onDelete }) => {
  const [title, setTitle] = useState(chapter?.title || '');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState('Ready');
  const [highlightColor, setHighlightColor] = useState('#ffeb3b');
  const [textColor, setTextColor] = useState('#000000');
  const [entityVersion, setEntityVersion] = useState(chapter?.version ?? 0);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    highlight: false,
    textColor: false
  });
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const videoFileInputRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const colorInputRef = useRef(null);
  const userChangedColorRef = useRef(false); // Track when user manually changes color
  const dialogOpenRef = useRef(false); // Track if dialog is open to prevent editor interference
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
  const [pendingInsertTick, setPendingInsertTick] = useState(0);

  const pendingKaraokeHtmlRef = useRef(null);

  const applyKaraokeEditorMarkers = () => {
    if (!textareaRef.current) return;
    const nodes = textareaRef.current.querySelectorAll('.karaoke-object');
    nodes.forEach((node) => {
      node.classList.add('karaoke-editor-marker');
      node.setAttribute('contenteditable', 'false');
      node.setAttribute('data-karaoke-block', 'true');
    });
  };

  // Extract color from HTML string (for initial load)
  // Finds colors in <p> and <span> elements and returns the LAST one found
  const extractColorFromHTML = (html) => {
    if (!html) return '#000000';
    try {
      let lastColor = '#000000';
      
      // Helper to convert color to hex and normalize to 6-digit format
      const colorToHex = (color) => {
        const trimmed = color.trim();
        if (trimmed.startsWith('rgb')) {
          const rgb = trimmed.match(/\d+/g);
          if (rgb && rgb.length >= 3) {
            const hex = '#' + rgb.slice(0, 3).map(x => {
              const val = parseInt(x);
              return (val < 16 ? '0' : '') + val.toString(16);
            }).join('');
            return normalizeHex(hex);
          }
        }
        if (trimmed.startsWith('#')) {
          return normalizeHex(trimmed);
        }
        return null;
      };
      
      // Normalize hex color to 6-digit format (e.g., #f00 -> #ff0000, #ff0000ff -> #ff0000)
      const normalizeHex = (hex) => {
        if (!hex || !hex.startsWith('#')) return null;
        // Remove # and convert to uppercase
        let clean = hex.slice(1).toLowerCase();
        // Handle 3-digit hex (e.g., #f00 -> #ff0000)
        if (clean.length === 3) {
          clean = clean.split('').map(c => c + c).join('');
        }
        // Take only first 6 characters (ignore alpha channel if present)
        if (clean.length >= 6) {
          clean = clean.slice(0, 6);
        }
        // Ensure it's exactly 6 characters
        if (clean.length < 6) {
          clean = clean.padEnd(6, '0');
        }
        return '#' + clean;
      };
      
      // Find all <p> and <span> tags (including self-closing and with attributes)
      const allTags = html.matchAll(/<(p|span)([^>]*)>/gi);
      
      for (const match of allTags) {
        const attributes = match[2] || '';
        
        // Extract color from style attribute - improved regex
        // Match: style="color: #ff0000" or style='color: rgb(255,0,0)' or style="...color: red..."
        const styleAttrMatch = attributes.match(/style\s*=\s*["']([^"']*)["']/i);
        if (styleAttrMatch && styleAttrMatch[1]) {
          const styleContent = styleAttrMatch[1];
          // Look for color property in style
          const colorMatch = styleContent.match(/color\s*:\s*([^;]+)/i);
          if (colorMatch && colorMatch[1]) {
            const colorValue = colorMatch[1].trim();
            const hex = colorToHex(colorValue);
            if (hex && hex !== '#000000') {
              lastColor = hex;
            }
          }
        }
        
        // Also check for <font color="..."> format
        const fontColorMatch = attributes.match(/color\s*=\s*["']([^"']+)["']/i);
        if (fontColorMatch && fontColorMatch[1]) {
          const colorValue = fontColorMatch[1].trim();
          const hex = colorToHex(colorValue);
          if (hex && hex !== '#000000') {
            lastColor = hex;
          }
        }
      }
      
      // Normalize the final color to ensure it's in correct format
      const finalColor = lastColor !== '#000000' ? normalizeHex(lastColor) || '#000000' : '#000000';
      return finalColor;
    } catch (error) {
      console.error('extractColorFromHTML error:', error);
      return '#000000';
    }
  };

  // Get current text color from selection/computed style
  const getCurrentTextColor = () => {
    try {
      const editor = textareaRef.current;
      if (!editor) return '#000000';
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        // If no selection, try to get color from the last element or cursor position
        // Place cursor at end and check
        try {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          const tempSel = window.getSelection();
          tempSel.removeAllRanges();
          tempSel.addRange(range);
          
          // Now check the color at cursor position
          const range2 = tempSel.getRangeAt(0);
          let element = range2.commonAncestorContainer;
          
          if (element.nodeType === Node.TEXT_NODE) {
            element = element.parentElement;
          }
          
          if (element) {
            return getColorFromElement(element);
          }
        } catch {}
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
    
    // Walk up the DOM to find the first element with explicit color
    let current = element;
    while (current && current !== textareaRef.current) {
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

  const refreshToolbarState = () => {
    try {
      const state = {
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        strikethrough: document.queryCommandState('strikeThrough'),
        underline: document.queryCommandState('underline'),
        // alignment states (only one likely true)
        alignLeft: document.queryCommandState('justifyLeft'),
        alignCenter: document.queryCommandState('justifyCenter'),
        alignRight: document.queryCommandState('justifyRight'),
      };
      setActiveFormats(prev => ({ ...prev, ...state }));
      
      // Only sync color picker with current text color if user didn't just manually change it
      // This prevents the color picker from being overridden when user picks a new color
      if (!userChangedColorRef.current) {
        const currentColor = getCurrentTextColor();
        setTextColor(currentColor);
      }
    } catch {}
  };

  useEffect(() => {
    if (chapter) {
      setTitle(chapter.title);
      setEntityVersion(chapter.version ?? 0);
      if (textareaRef.current) {
        // Get the HTML content from the chapter being edited
        // Check both contentHtml (from database) and content (mapped property)
        const chapterContent = chapter.contentHtml || chapter.content || '';
        textareaRef.current.innerHTML = chapterContent;
        applyKaraokeEditorMarkers();
        setContent(chapterContent);
        
        // After DOM is ready, detect color from the actual DOM (same way refreshToolbarState does)
        // This is more reliable than HTML parsing because it uses the same logic as when cursor moves
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (textareaRef.current) {
                // Place cursor at end (this creates a selection)
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(textareaRef.current);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
                
                // Small delay to ensure selection is applied
                setTimeout(() => {
                  // Now get the color from the DOM at the cursor position (same as refreshToolbarState)
                  const detectedColor = getCurrentTextColor();
                  
                  // Update state first
                  setTextColor(detectedColor);
                  
                  // Then update DOM directly after React has a chance to update
                  setTimeout(() => {
                    if (colorInputRef.current) {
                      colorInputRef.current.value = detectedColor;
                      // Force update with both input and change events
                      colorInputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
                      colorInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    
                    // Refresh toolbar to sync all states (this will also call getCurrentTextColor again)
                    refreshToolbarState();
                  }, 0);
                }, 10);
              }
            }, 10);
          });
        });
      }
    } else if (parentChapter) {
      setTitle('');
      setEntityVersion(0);
      if (textareaRef.current) {
        textareaRef.current.innerHTML = '';
      }
      // Reset to black for new chapter
      setTextColor('#000000');
      setContent('');
    }
  }, [chapter, parentChapter]);

  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalDocOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const el = textareaRef.current;
    if (!el) return;

    let touchStartY = 0;

    const handleWheel = (event) => {
      const target = textareaRef.current;
      if (!target) return;

      const delta = event.deltaY;
      const { scrollTop, scrollHeight, clientHeight } = target;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight;

      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      target.scrollTop = Math.min(
        Math.max(scrollTop + delta, 0),
        scrollHeight - clientHeight
      );
    };

    const handleTouchStart = (event) => {
      if (event.touches.length !== 1) return;
      touchStartY = event.touches[0].clientY;
    };

    const handleTouchMove = (event) => {
      const target = textareaRef.current;
      if (!target || event.touches.length !== 1) return;
      const currentY = event.touches[0].clientY;
      const delta = touchStartY - currentY;

      const { scrollTop, scrollHeight, clientHeight } = target;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight;

      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      target.scrollTop = Math.min(
        Math.max(scrollTop + delta, 0),
        scrollHeight - clientHeight
      );
      touchStartY = currentY;
    };

    const handleTouchEnd = () => {
      touchStartY = 0;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalDocOverflow;
    };
  }, []);

  useEffect(() => {
    if (showKaraokeDialog) return;
    const editor = textareaRef.current;
    if (!editor) return;

    const currentHtml = editor.innerHTML;
    const domIsEmpty = !currentHtml || currentHtml === '<br>' || currentHtml.trim() === '';
    if (!domIsEmpty) return;

    if (content !== undefined && content !== null) {
      editor.innerHTML = content || '';
      applyKaraokeEditorMarkers();

      // Attempt to restore caret at end
      try {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (err) {
        console.warn('Failed to restore caret after dialog close:', err);
      }
    }
  }, [showKaraokeDialog, content]);

  // Handle content changes from contentEditable for autosave
  const handleEditorInput = () => {
    if (!textareaRef.current) return;

    const placeholders = textareaRef.current.querySelectorAll('[data-karaoke-placeholder]');
    placeholders.forEach((node) => {
      const text = node.textContent.replace(/\u00A0/g, '').trim();
      if (text.length > 0) {
        node.removeAttribute('data-karaoke-placeholder');
        node.removeAttribute('data-placeholder-id');
      } else if (!node.querySelector('br')) {
        node.innerHTML = '<br />';
      }
    });

    const html = textareaRef.current.innerHTML;
    setContent(html);
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
    const handleSelection = () => {
      // Don't sync if user just manually changed the color picker
      if (!userChangedColorRef.current) {
        refreshToolbarState();
      }
    };
    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

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
    if (!showKaraokeDialog && pendingKaraokeHtmlRef.current) {
      scheduleEditorInsertion(pendingKaraokeHtmlRef.current);
    }
  }, [showKaraokeDialog, pendingInsertTick]);

  // Keyboard shortcuts
  useEffect(() => {
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
      
      if (!textareaRef.current) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); document.execCommand('bold'); refreshToolbarState(); break;
        case 'i': e.preventDefault(); document.execCommand('italic'); refreshToolbarState(); break;
        case 'u': e.preventDefault(); document.execCommand('underline'); refreshToolbarState(); break;
        case 'l': e.preventDefault(); document.execCommand('justifyLeft'); refreshToolbarState(); break;
        case 'e': e.preventDefault(); document.execCommand('justifyCenter'); refreshToolbarState(); break;
        case 'r': e.preventDefault(); document.execCommand('justifyRight'); refreshToolbarState(); break;
        default: break;
      }
    };
    document.addEventListener('keydown', onKeyDown, false); // Use bubbling phase, not capture
    return () => document.removeEventListener('keydown', onKeyDown, false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const currentContent = textareaRef.current ? textareaRef.current.innerHTML : '';
    try {
      await onSave({ title, contentHtml: currentContent, version: entityVersion });
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


  const toggleFormatting = (formatType, command, value = null) => {
    const editor = textareaRef.current;
    if (!editor) return;
    
    editor.focus();
    
    document.execCommand(command, false, value);
    
    editor.focus();
    refreshToolbarState();
  };

  const applyBold = () => toggleFormatting('bold', 'bold');
  const applyItalic = () => toggleFormatting('italic', 'italic');
  const applyStrikethrough = () => toggleFormatting('strikethrough', 'strikeThrough');
  const applyUnderline = () => toggleFormatting('underline', 'underline');
  const applyHighlight = () => {
    const editor = textareaRef.current;
    if (!editor) return;
    editor.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch {}
    document.execCommand('hiliteColor', false, highlightColor);
    refreshToolbarState();
  };
  const applyTextColor = () => toggleFormatting('textColor', 'foreColor', textColor);
  const alignLeft = () => toggleFormatting('alignLeft', 'justifyLeft');
  const alignCenter = () => toggleFormatting('alignCenter', 'justifyCenter');
  const alignRight = () => toggleFormatting('alignRight', 'justifyRight');

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
    
    const editor = textareaRef.current;
    if (editor) {
      // Apply color to current selection/caret position BEFORE focusing
      // This way the color is applied to the caret position
      document.execCommand('foreColor', false, value);
      
      editor.focus();
      
      // Keep the flag true for longer to prevent any selection changes from overriding
      // Only reset after user starts typing or a significant delay
      setTimeout(() => {
        userChangedColorRef.current = false;
      }, 500); // Longer delay to prevent immediate override
      
      // Don't call refreshToolbarState here - it will override the color
      // Let it sync naturally when user types or moves cursor
    }
  };

  const handleHighlightColorChange = (e) => {
    const value = e.target.value;
    setHighlightColor(value);
    // Immediately apply new highlight color to selection/caret
    const editor = textareaRef.current;
    if (editor) {
      editor.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch {}
      document.execCommand('hiliteColor', false, value);
      refreshToolbarState();
    }
  };

  const handleApplyHighlightClick = (e) => {
    const editor = textareaRef.current;
    if (!editor) return;
    e.preventDefault();
    editor.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch {}
    if (e.altKey) {
      document.execCommand('hiliteColor', false, 'transparent');
    } else {
      document.execCommand('hiliteColor', false, highlightColor);
    }
    refreshToolbarState();
  };

  const handleImageButtonClick = () => {
    if (imageInputRef.current) imageInputRef.current.click();
  };

  const handleVideoButtonClick = () => {
    if (videoFileInputRef.current) videoFileInputRef.current.click();
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
      
      const editor = textareaRef.current;
      if (!editor) return;
      editor.focus();
      const videoHtml = `<video src="${downloadURL}" controls style="max-width:100%;height:auto;display:block;margin:8px 0;"></video>`;
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const temp = document.createElement('div');
          temp.innerHTML = videoHtml;
          const frag = document.createDocumentFragment();
          let node, lastNode;
          while ((node = temp.firstChild)) {
            lastNode = frag.appendChild(node);
          }
          range.insertNode(frag);
          if (lastNode) {
            const after = document.createTextNode('\u00A0');
            lastNode.parentNode.insertBefore(after, lastNode.nextSibling);
            const newRange = document.createRange();
            newRange.setStartAfter(after);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } else {
          editor.insertAdjacentHTML('beforeend', videoHtml);
        }
      } catch {
        document.execCommand('insertHTML', false, videoHtml);
      }
      refreshToolbarState();
    } catch (err) {
      console.error('Video upload failed', err);
      alert(err.message || 'Video upload failed. Please try again.');
    } finally {
      setUploadingVideo(false);
      setVideoUploadProgress(0);
      if (videoFileInputRef.current) videoFileInputRef.current.value = '';
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

  const insertHtmlIntoEditor = (payload) => {
    const editor = textareaRef.current;
    if (!editor) {
      return false;
    }

    const normalizedPayload = typeof payload === 'string'
      ? { html: payload, focusSelector: null }
      : (payload || {});

    const { html, focusSelector } = normalizedPayload;
    if (!html) return false;

    // instrumentation removed after debugging

    editor.focus();

    let anchorNode = null;
    let caretNode = null;
    let inserted = false;
    let emptyBlock = null;

    const ensureSelectionWithinEditor = (selection) => {
      if (
        selection.rangeCount === 0 ||
        !editor.contains(selection.anchorNode) ||
        !editor.contains(selection.focusNode)
      ) {
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(editor);
        fallbackRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
      }
    };

    const resolveClosestBlock = (node) => {
      if (!node) return null;
      let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      while (current && current !== editor) {
        if (current.nodeType === Node.ELEMENT_NODE) {
          if (current.tagName === 'BR') return current;
          const display = window.getComputedStyle(current).display;
          if (display === 'block' || display === 'list-item' || current.tagName === 'P' || current.tagName === 'DIV') {
            return current;
          }
        }
        current = current.parentElement;
      }
      return null;
    };

    const isEmptyBlock = (node) => {
      if (!node || node === editor) return false;
      if (node.tagName === 'BR') return true;
      const text = node.textContent.replace(/\u00A0/g, '').trim();
      if (text.length > 0) return false;
      if (node.querySelector && node.querySelector('.karaoke-object')) return false;
      return true;
    };

    const ensureTrailingCaretNode = (referenceNode, replacedBlock) => {
      if (!referenceNode || !referenceNode.parentNode) return null;
      const parent = referenceNode.parentNode;

      let next = referenceNode.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim() === '') {
        const removeTarget = next;
        next = next.nextSibling;
        parent.removeChild(removeTarget);
      }

      if (
        next &&
        next.nodeType === Node.ELEMENT_NODE &&
        next.getAttribute('data-karaoke-block') !== 'true'
      ) {
        const text = next.textContent.replace(/\u00A0/g, '').trim();
        if (text.length === 0) {
          if (!next.querySelector('br')) {
            next.innerHTML = '<br />';
          }
          return next;
        }
      }

      const tagName = (replacedBlock && replacedBlock.tagName && replacedBlock.tagName !== 'BR')
        ? replacedBlock.tagName.toLowerCase()
        : 'div';

      const caretBlock = document.createElement(tagName === 'br' ? 'div' : tagName);
      caretBlock.innerHTML = '<br />';
      parent.insertBefore(caretBlock, referenceNode.nextSibling);
      return caretBlock;
    };

    try {
      let selection = window.getSelection();
      if (!selection) {
        return false;
      }

      ensureSelectionWithinEditor(selection);

      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);

        if (!editor.contains(range.commonAncestorContainer)) {
          ensureSelectionWithinEditor(selection);
        }

        const activeRange = selection.getRangeAt(0);
        if (!activeRange.collapsed) {
          activeRange.deleteContents();
        }

        emptyBlock = resolveClosestBlock(activeRange.startContainer);
        if (!isEmptyBlock(emptyBlock)) {
          emptyBlock = null;
        }

        const temp = document.createElement('div');
        temp.innerHTML = html;
        const frag = document.createDocumentFragment();
        let node;
        let lastNode = null;
        while ((node = temp.firstChild)) {
          lastNode = frag.appendChild(node);
        }

        if (emptyBlock && emptyBlock !== editor) {
          emptyBlock.replaceWith(frag);
          anchorNode = lastNode;
        } else {
          activeRange.insertNode(frag);
          anchorNode = lastNode;
        }

        inserted = true;
      } else {
        editor.insertAdjacentHTML('beforeend', html);
        anchorNode = editor.lastElementChild;
        inserted = true;
      }
    } catch (err) {
      console.error('Falling back to execCommand insertion due to error:', err);
      document.execCommand('insertHTML', false, html);
      anchorNode = focusSelector ? editor.querySelector(focusSelector) : editor.lastElementChild;
      inserted = true;
    }

    if (!inserted) {
      return false;
    }

    applyKaraokeEditorMarkers();

    if (anchorNode) {
      const removeEmptyBefore = (node) => {
        if (!node || !node.parentNode) return;
        let prev = node.previousSibling;

        const isNodeEmpty = (candidate) => {
          if (!candidate) return false;
          if (candidate.nodeType === Node.TEXT_NODE) {
            return candidate.textContent.replace(/\u00A0/g, '').trim().length === 0;
          }
          if (candidate.nodeType === Node.ELEMENT_NODE) {
            if (candidate.getAttribute && candidate.getAttribute('data-karaoke-block') === 'true') {
              return false;
            }
            const text = candidate.textContent.replace(/\u00A0/g, '').trim();
            if (text.length > 0) return false;
            if (candidate.querySelector && candidate.querySelector('.karaoke-object')) return false;
            return true;
          }
          return false;
        };

        while (prev && isNodeEmpty(prev)) {
          const toRemove = prev;
          prev = prev.previousSibling;
          toRemove.parentNode.removeChild(toRemove);
        }
      };

      removeEmptyBefore(anchorNode);
    }

    if (!anchorNode && focusSelector) {
      anchorNode = editor.querySelector(focusSelector);
    }

    if (anchorNode) {
      caretNode = ensureTrailingCaretNode(anchorNode, emptyBlock);
    }

    const restoreCaret = () => {
      const selection = window.getSelection();
      if (!selection) return;

      if (caretNode && editor.contains(caretNode)) {
        const range = document.createRange();
        range.selectNodeContents(caretNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }

      if (anchorNode && editor.contains(anchorNode)) {
        const range = document.createRange();
        range.setStartAfter(anchorNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };

    restoreCaret();
    handleEditorInput();
    refreshToolbarState();

    // instrumentation removed after debugging

    return true;
  };

  const scheduleEditorInsertion = (html, attempt = 0) => {
    const MAX_ATTEMPTS = 10;
    if (insertHtmlIntoEditor(html)) {
      pendingKaraokeHtmlRef.current = null;
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      requestAnimationFrame(() => scheduleEditorInsertion(html, attempt + 1));
    } else {
      console.error('Failed to insert karaoke object: editor not available.');
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
    
    // Create karaoke object
    const karaokeData = {
      type: 'karaoke',
      text: karaokeText.trim(),
      audioUrl: audioUrl,
      wordTimings: wordTimings
    };
    
    // Insert as a data attribute in a special element
    const karaokeId = `karaoke-${Date.now()}`;
    const karaokePayload = encodeURIComponent(JSON.stringify(karaokeData));
    const container = document.createElement('div');
    container.className = 'karaoke-object karaoke-editor-marker';
    container.dataset.karaoke = karaokePayload;
    container.dataset.karaokeId = karaokeId;
    container.setAttribute('contenteditable', 'false');
    container.setAttribute('data-karaoke-block', 'true');
    container.textContent = karaokeText.trim();
    const karaokeHtml = container.outerHTML;
    
    // Close dialog and reset form; insertion happens after editor re-mounts
    pendingKaraokeHtmlRef.current = {
      html: karaokeHtml,
      focusSelector: `[data-karaoke-id="${karaokeId}"]`,
    };
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
      const editor = textareaRef.current;
      if (!editor) return;
      editor.focus();
      const imgHtml = `<img src="${downloadURL}" alt="" style="max-width:100%;height:auto;display:block;margin:8px 0;" />`;
      try {
        // Prefer modern Selection/Range insertion
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const temp = document.createElement('div');
          temp.innerHTML = imgHtml;
          const frag = document.createDocumentFragment();
          let node, lastNode;
          while ((node = temp.firstChild)) {
            lastNode = frag.appendChild(node);
          }
          range.insertNode(frag);
          // Move caret after inserted image
          if (lastNode) {
            const after = document.createTextNode('\u00A0');
            lastNode.parentNode.insertBefore(after, lastNode.nextSibling);
            const newRange = document.createRange();
            newRange.setStartAfter(after);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } else {
          // Fallback: append at end of editor
          editor.insertAdjacentHTML('beforeend', imgHtml);
        }
      } catch {
        // Legacy fallback
        document.execCommand('insertHTML', false, imgHtml);
      }
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
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus({ preventScroll: true });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="editor-overlay side-panel">
      <div className="editor-modal side-panel-modal">
        <button className="close-btn close-top" onClick={onCancel}>✕</button>
        
        <div className="editor-content">
          <div className="title-row">
            <input
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
                <button
                  onClick={() => {
                    // Disable editor and blur it before opening dialog
                    if (textareaRef.current) {
                      textareaRef.current.blur();
                      textareaRef.current.contentEditable = 'false';
                    }
                    setShowKaraokeDialog(true);
                    setKaraokeText('');
                    setKaraokeAudioFile(null);
                    setKaraokeAudioUrl('');
                    setKaraokeTimingFile(null);
                    setKaraokeTimingMethod('upload');
                  }}
                  className="toolbar-btn"
                  title="Insert Karaoke"
                >
                  🎤
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
                  className="toolbar-btn"
                  title="Align Left"
                >
                  ⬑
                </button>
                <button 
                  onClick={alignCenter}
                  className="toolbar-btn"
                  title="Align Center"
                >
                  ≡
                </button>
                <button 
                  onClick={alignRight}
                  className="toolbar-btn"
                  title="Align Right"
                >
                  ⬏
                </button>
                
              </div>
              <div className="toolbar-actions">
                <button 
                  className="toolbar-save-btn"
                  onClick={handleSave}
                  disabled={!title.trim() || saving}
                >
                  {saving ? 'Publishing…' : 'Objavi'}
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
            {!showKaraokeDialog && (
              <div 
                className="content-editor page-area"
                contentEditable="true"
                ref={textareaRef}
                suppressContentEditableWarning={true}
                onInput={handleEditorInput}
                onClick={refreshToolbarState}
                onFocus={refreshToolbarState}
              />
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
    </div>
  );
};
