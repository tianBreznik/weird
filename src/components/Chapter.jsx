import { useState, useEffect, useRef } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { renderMarkdownWithParagraphs } from '../utils/markdown';
import './Chapter.css';
import { SortableSubchapters } from './SortableSubchapters';
import { setBookmark } from '../utils/bookmark';
import { IsolatedButton } from './IsolatedButton';

const KARAOKE_DEBUG = true;

const TOKEN_REGEX = /[\p{L}\p{N}'’]+/gu;
const NORMALIZE_REGEX = /[^a-z0-9']+/g;

const isWhitespace = (char) => /\s/.test(char);
const isPunctuation = (char) => /[\p{P}\u2019\u2018]/u.test(char);

// Apply ink effect to text on mobile by wrapping characters in spans
// This is needed because mobile Safari doesn't render subpixel effects like desktop
export const applyInkEffectToTextMobile = (element, options = {}) => {
  if (!element) return;
  
  // Only run on mobile devices
  if (window.innerWidth > 768) return;
  
  // Skip karaoke players - they handle their own ink effect
  if (element.closest('.karaoke-player')) return;
  
  // Determine probability of applying ink based on context
  // Default: 0.15 (titles, book-concept, etc.)
  // Chapter content: lower density for a subtler look
  const isChapterContent =
    element.classList?.contains('chapter-content') ||
    !!element.closest?.('.chapter-content');
  const probability =
    typeof options.probability === 'number'
      ? options.probability
      : (isChapterContent ? 0.25 : 0.15);
  
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip if already processed
        if (parent.classList.contains('ink-processed-mobile')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip karaoke players
        if (parent.closest('.karaoke-player')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip empty text nodes
        if (node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    if (!parent || parent.classList.contains('ink-processed-mobile')) return;
    // Skip if inside karaoke player
    if (parent.closest('.karaoke-player')) return;

    const text = textNode.textContent;
    const fragment = document.createDocumentFragment();

    Array.from(text).forEach((char) => {
      const span = document.createElement('span');
      span.className = 'ink-char-mobile';
      span.textContent = char;

      // Randomly apply ink effect to ~15% of non-whitespace, non-punctuation characters
      if (!isWhitespace(char) && !isPunctuation(char) && Math.random() < probability) {
        span.dataset.ink = '1';
      }

      fragment.appendChild(span);
    });

    parent.replaceChild(fragment, textNode);
    parent.classList.add('ink-processed-mobile');
  });
};

const normalizeWord = (value) => {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/’/g, "'")
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, '');
};

const tokenizeText = (text) => {
  const tokens = [];
  const iterator = text.matchAll(TOKEN_REGEX);

  for (const match of iterator) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const indices = [];
    for (let i = start; i < end; i += 1) {
      indices.push(i);
    }
    tokens.push({
      raw,
      start,
      end,
      indices,
      normalized: normalizeWord(raw),
    });
  }

  return tokens;
};

const assignLetterTimings = (text, wordTimings = []) => {
  const letterTimings = new Array(text.length).fill(null);
  const tokens = tokenizeText(text);
  const debug = {
    text,
    wordTimingsCount: wordTimings.length,
    totalChars: text.length,
    totalAssigned: 0,
    words: [],
    unmatched: [],
  };

  let tokenPointer = 0;

  wordTimings.forEach(({ word, start, end }, wordIdx) => {
    const normalizedWord = normalizeWord(word);
    if (!normalizedWord) {
      if (KARAOKE_DEBUG) debug.unmatched.push({ word, reason: 'empty', wordIdx });
      return;
    }

    let matchedToken = null;
    while (tokenPointer < tokens.length) {
      const candidate = tokens[tokenPointer];
      if (!candidate.normalized) {
        tokenPointer += 1;
        continue;
      }
      if (candidate.normalized === normalizedWord) {
        matchedToken = candidate;
        break;
      }
      tokenPointer += 1;
    }

    if (!matchedToken) {
      if (KARAOKE_DEBUG) debug.unmatched.push({ word, start, end, wordIdx, reason: 'no token match' });
      return;
    }

    const duration = Math.max((end ?? 0) - (start ?? 0), 0.001);
    const indices = matchedToken.indices;
    const spanLength = indices.length || 1;

    indices.forEach((idx, position) => {
      const ratioStart = position / spanLength;
      const ratioEnd = (position + 1) / spanLength;
      letterTimings[idx] = {
        start: (start ?? 0) + duration * ratioStart,
        end: (start ?? 0) + duration * ratioEnd,
      };
    });

    if (KARAOKE_DEBUG) {
      debug.words.push({
        word,
        token: matchedToken.raw,
        normalizedWord,
        indices: indices.slice(),
        start,
        end,
        wordIdx,
        tokenIndex: tokenPointer,
      });
    }

    tokenPointer += 1;
  });

  if (KARAOKE_DEBUG) {
    debug.totalAssigned = letterTimings.filter(Boolean).length;
  }

  return { letterTimings, debug };
};

const initializeKaraokePlayer = (rootElement, karaokeData) => {
  if (!rootElement || !karaokeData) return () => {};

  const { text = rootElement.textContent || '', audioUrl, wordTimings = [] } = karaokeData;
  if (!audioUrl || wordTimings.length === 0 || !text) return () => {};

  const { letterTimings, debug } = assignLetterTimings(text, wordTimings);

  if (KARAOKE_DEBUG) {
    const summary = {
      sample: text.slice(0, 60),
      words: wordTimings.length,
      assignedCharacters: debug.totalAssigned,
      totalCharacters: debug.totalChars,
      unmatchedWords: debug.unmatched.length,
    };
    // eslint-disable-next-line no-console
    console.groupCollapsed('Karaoke debug', summary);
    // eslint-disable-next-line no-console
    console.log('Detailed debug info:', debug);
    if (!window.__KARAOKE_DEBUG__) window.__KARAOKE_DEBUG__ = [];
    window.__KARAOKE_DEBUG__.push({ debug, karaokeData });
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  // Prepare DOM
  rootElement.innerHTML = '';
  rootElement.classList.add('karaoke-player');
  rootElement.style.whiteSpace = 'pre-wrap';

  const timings = letterTimings;
  const charSpans = [];
  const fragment = document.createDocumentFragment();

  Array.from(text).forEach((char, index) => {
    const span = document.createElement('span');
    span.className = 'karaoke-char';
    span.textContent = char;
    span.dataset.char = char === ' ' ? '\u00A0' : char;

    if (!isWhitespace(char) && !isPunctuation(char) && Math.random() < 0.35) {
      span.dataset.ink = '1';
    }

    const timing = timings[index];
    if (timing) {
      span.dataset.start = String(timing.start);
      span.dataset.end = String(timing.end);
    }
    fragment.appendChild(span);
    charSpans.push(span);
  });

  rootElement.appendChild(fragment);

  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';

  let rafId = null;
  let hasUserGesture = false;

  const resetChars = () => {
    charSpans.forEach((span) => {
      span.classList.remove('karaoke-char-active', 'karaoke-char-complete');
      span.style.setProperty('--karaoke-fill', '0');
    });
  };

  const cancelAnimation = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const step = () => {
    const current = audio.currentTime;
    charSpans.forEach((span) => {
      const start = parseFloat(span.dataset.start);
      const end = parseFloat(span.dataset.end);
      if (Number.isNaN(start) || Number.isNaN(end)) return;

      if (current >= end) {
        span.classList.add('karaoke-char-complete');
        span.classList.remove('karaoke-char-active');
        span.style.setProperty('--karaoke-fill', '1');
      } else if (current >= start) {
        const duration = Math.max(end - start, 0.001);
        const progress = Math.min(Math.max((current - start) / duration, 0), 1);
        span.classList.add('karaoke-char-active');
        span.classList.remove('karaoke-char-complete');
        span.style.setProperty('--karaoke-fill', progress.toFixed(3));
      } else {
        span.classList.remove('karaoke-char-active', 'karaoke-char-complete');
        span.style.setProperty('--karaoke-fill', '0');
      }
    });

    rafId = requestAnimationFrame(step);
  };

  const stopPlayback = () => {
    rootElement.classList.remove('karaoke-playing');
    cancelAnimation();
    audio.pause();
    audio.currentTime = 0;
    resetChars();
  };

  const startPlayback = async () => {
    if (!hasUserGesture) {
      // Attempt resume in case autoplay is blocked
      try {
        await audio.play();
      } catch (err) {
        console.warn('Karaoke playback blocked until user interaction', err);
        return;
      }
      audio.pause();
      audio.currentTime = 0;
      hasUserGesture = true;
    }

    resetChars();
    rootElement.classList.add('karaoke-playing');
    try {
      await audio.play();
      cancelAnimation();
      rafId = requestAnimationFrame(step);
    } catch (err) {
      console.warn('Karaoke playback failed', err);
    }
  };

  audio.addEventListener('ended', () => {
    stopPlayback();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          startPlayback();
        } else {
          stopPlayback();
        }
      });
    },
    { threshold: [0, 0.5, 0.75, 1] }
  );

  observer.observe(rootElement);

  // Allow manual click to play when autoplay is blocked
  const handleClick = () => {
    hasUserGesture = true;
    startPlayback();
  };

  rootElement.addEventListener('click', handleClick);

  return () => {
    rootElement.removeEventListener('click', handleClick);
    observer.disconnect();
    stopPlayback();
    audio.src = '';
  };
};

export const Chapter = ({ chapter, level = 0, chapterNumber = 1, subChapterNumber = null, parentChapterId = null, onEdit, onAddSubchapter, onDelete, dragHandleProps, defaultExpandedChapterId }) => {
  const [isExpanded, setIsExpanded] = useState(chapter.id === defaultExpandedChapterId);
  const { isEditor } = useEditorMode();
  const contentRef = useRef(null);
  const headerRef = useRef(null);

  // Generate formal numbering (no "Chapter" label)
  const getFormalNumber = () => {
    if (level === 0) {
      return `${chapterNumber}.`;
    } else {
      return `${chapterNumber}.${subChapterNumber}`;
    }
  };

  // Convert ALL CAPS to Title Case (first letter uppercase, rest lowercase)
  const formatTitle = (title) => {
    if (!title) return title;
    let t = title;
    // If the title is ALL CAPS (and not numeric/punctuation), normalize to lowercase first
    if (t === t.toUpperCase() && t !== t.toLowerCase()) {
      t = t.toLowerCase();
    }
    // Capitalize the first alphabetical character only
    return t.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/, (m) => m.toUpperCase());
  };

  // Apply ink effect to headers on mobile
  useEffect(() => {
    if (headerRef.current) {
      applyInkEffectToTextMobile(headerRef.current);
    }
  }, [chapter.title]);

  // Apply ink effect to content and initialize karaoke players
  useEffect(() => {
    if (!isExpanded || !contentRef.current) return;
    
    // Apply ink effect to regular text content on mobile
    applyInkEffectToTextMobile(contentRef.current);
    
    // Initialize karaoke players
    const karaokeElements = contentRef.current.querySelectorAll('.karaoke-object');
    if (karaokeElements.length === 0) return;

    const cleanups = [];
    karaokeElements.forEach((element) => {
      const dataAttr = element.getAttribute('data-karaoke');
      if (!dataAttr) return;
      try {
        let parsed = dataAttr;
        try {
          parsed = decodeURIComponent(dataAttr);
        } catch (decodeErr) {
          console.warn('Failed to decode karaoke data, attempting raw JSON', decodeErr);
        }
        const karaokeData = JSON.parse(parsed);
        const cleanup = initializeKaraokePlayer(element, karaokeData);
        if (cleanup) {
          cleanups.push(cleanup);
        }
      } catch (err) {
        console.error('Failed to initialize karaoke element', err, { dataAttr });
      }
    });

    return () => {
      cleanups.forEach((cleanup) => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      });
    };
  }, [isExpanded, chapter.content]);

  return (
    <div
      id={`chapter-${chapter.id}`}
      className={`chapter ${level > 0 ? 'subchapter' : ''} ${isExpanded ? 'expanded' : ''}`}
      style={{ marginLeft: `${level * 1.5}rem` }}
    >
      <div
        className="chapter-header"
        onClick={() => {
          const next = !isExpanded;
          setIsExpanded(next);
          if (next) setBookmark(chapter.id);
        }}
      >
        {/** Title element with class per level for precise styling/hover */}
        <h3 ref={headerRef} className={level === 0 ? 'chapter-title' : 'subchapter-title'}>
          <span className="chapter-number">{getFormalNumber()}</span> {formatTitle(chapter.title)}
        </h3>
        {isEditor && (
          <div className="chapter-actions-container" onClick={(e) => e.stopPropagation()}>
            <div className="chapter-actions-inline">
              <IsolatedButton label="Edit" variant="edit" onClick={() => onEdit(chapter)} />
              {level === 0 && (
                <IsolatedButton label="Add" variant="add" onClick={() => onAddSubchapter(chapter)} />
              )}
              <IsolatedButton
                label="Del"
                variant="delete"
                onClick={() => onDelete(chapter.id, level > 0, level > 0 ? parentChapterId : null)}
              />
            </div>
            <span {...(dragHandleProps || {})} style={{ userSelect: 'none' }} aria-label="Drag handle">
              ⋮⋮
            </span>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="chapter-body">
          {/* Show chapter content if it exists (both main and subchapters) */}
          {chapter.content && (
            <div
              ref={contentRef}
              className="chapter-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdownWithParagraphs(chapter.content) }}
            />
          )}

          {/* Render child chapters recursively */}
          {chapter.children && chapter.children.length > 0 && (
            <div className="child-chapters">
              <SortableSubchapters
                items={chapter.children}
                onReorder={async (orderedIds) => {
                  // Persist subchapter order for this chapter
                  try {
                    const { reorderSubchapters } = await import('../services/firestore.js');
                    await reorderSubchapters('primary', chapter.id, orderedIds);
                  } catch {}
                }}
                renderRow={(childChapter, dragHandle, index) => (
                  <Chapter
                    key={childChapter.id}
                    chapter={childChapter}
                    level={level + 1}
                    chapterNumber={chapterNumber}
                    subChapterNumber={index + 1}
                    parentChapterId={chapter.id}
                    dragHandleProps={dragHandle}
                    onEdit={onEdit}
                    onAddSubchapter={onAddSubchapter}
                    onDelete={onDelete}
                  />
                )}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};