import { extractFootnotesFromContent, isAtomicElement } from './paginationHelpers';
import {
  MOBILE_MAX_TAIL_IN_RESERVE_PX,
  MOBILE_MAX_TAIL_IN_RESERVE_WORDS,
} from './pageGeometry';

function tailTextStats(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html || '';
  const text = (wrap.textContent || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  return { words: words.length, text };
}

function canUseReserveBandForTail(shell, pageBlocksSoFar, tailHtml) {
  if (!tailHtml?.trim()) return false;
  const { words } = tailTextStats(tailHtml);
  if (words > MOBILE_MAX_TAIL_IN_RESERVE_WORDS) return false;
  const tailH = shell.lastBlockHeightPx([...pageBlocksSoFar, tailHtml]);
  if (tailH > MOBILE_MAX_TAIL_IN_RESERVE_PX) return false;
  return shell.blocksFit([...pageBlocksSoFar, tailHtml], { borrowReserve: true });
}

function splitElementInShell(shell, element, pageBlocksSoFar) {
  const fullText = element.textContent || '';
  if (!fullText.trim()) {
    return { first: element.outerHTML, second: null };
  }

  const textNodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.trim()) textNodes.push(node);
  }

  const resolveWordEnd = (globalCharIndex) => {
    const range = document.createRange();
    range.setStart(element, 0);
    let charCount = 0;
    for (const textNode of textNodes) {
      const nodeLength = textNode.textContent.length;
      if (charCount + nodeLength >= globalCharIndex) {
        const offset = Math.min(Math.max(0, globalCharIndex - charCount), nodeLength);
        let wordBoundary = offset;
        const text = textNode.textContent;
        while (wordBoundary < text.length && !/\s/.test(text[wordBoundary])) {
          wordBoundary++;
        }
        range.setEnd(textNode, wordBoundary);
        return { range, absoluteEnd: charCount + wordBoundary };
      }
      charCount += nodeLength;
    }
    range.setEnd(element, element.childNodes.length);
    return { range, absoluteEnd: fullText.length };
  };

  let low = 0;
  let high = fullText.length;
  let best = 0;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const { range, absoluteEnd } = resolveWordEnd(mid);
    const clone = element.cloneNode(true);
    clone.innerHTML = '';
    clone.appendChild(range.cloneContents());
    const trial = [...pageBlocksSoFar, clone.outerHTML];
    if (shell.blocksFit(trial)) {
      best = absoluteEnd;
      low = Math.max(mid + 1, absoluteEnd + 1);
    } else {
      high = mid;
    }
  }

  // Top up: binary search can stop early vs live layout — walk forward by word while still fits.
  let extended = best;
  let cursor = extended;
  while (cursor < fullText.length) {
    while (cursor < fullText.length && /\s/.test(fullText[cursor])) {
      cursor += 1;
    }
    if (cursor >= fullText.length) break;

    const { range, absoluteEnd: wordEnd } = resolveWordEnd(
      Math.min(cursor, fullText.length - 1)
    );
    if (wordEnd <= extended) break;

    const clone = element.cloneNode(true);
    clone.innerHTML = '';
    clone.appendChild(range.cloneContents());
    if (shell.blocksFit([...pageBlocksSoFar, clone.outerHTML])) {
      extended = wordEnd;
      cursor = wordEnd;
    } else {
      break;
    }
  }
  best = extended;

  if (best <= 0) {
    return { first: null, second: element.outerHTML };
  }
  if (best >= fullText.length) {
    return { first: element.outerHTML, second: null };
  }

  const { range } = resolveWordEnd(best);
  const firstPart = element.cloneNode(true);
  firstPart.innerHTML = '';
  firstPart.appendChild(range.cloneContents());

  const secondPart = element.cloneNode(true);
  secondPart.innerHTML = '';
  const secondRange = document.createRange();
  secondRange.setStart(range.endContainer, range.endOffset);
  secondRange.setEnd(element, element.childNodes.length);
  secondPart.appendChild(secondRange.cloneContents());

  return { first: firstPart.outerHTML, second: secondPart.outerHTML };
}

/**
 * Mobile: one element → current page using the reader shell (scrollHeight only).
 */
export function packMobileElement({
  shell,
  element,
  currentPageElements,
  currentPageFootnotes,
  elementFootnotes,
  footnoteContentToNumber,
  block,
  pushPage,
  startNewPage,
}) {
  const footnoteNums = elementFootnotes || [];

  const tryPushPage = () => {
    if (currentPageElements.length > 0) pushPage(block);
    startNewPage(false);
  };

  const appendHtml = (html, nums) => {
    nums.forEach((n) => currentPageFootnotes.add(n));
    currentPageElements.push(html);
  };

  const html = element.outerHTML;
  const withHtml = [...currentPageElements, html];
  if (shell.blocksFit(withHtml)) {
    appendHtml(html, footnoteNums);
    return { pageHasHeading: false };
  }
  if (canUseReserveBandForTail(shell, currentPageElements, html)) {
    appendHtml(html, footnoteNums);
    return { pageHasHeading: false };
  }

  if (isAtomicElement(element)) {
    if (currentPageElements.length) tryPushPage();
    appendHtml(html, footnoteNums);
    return { pageHasHeading: false };
  }

  let split = splitElementInShell(shell, element, currentPageElements);

  if (split.first && shell.blocksFit([...currentPageElements, split.first])) {
    const fFoot = extractFootnotesFromContent(split.first, footnoteContentToNumber);
    appendHtml(split.first, fFoot);

    if (split.second) {
      const withSecond = [...currentPageElements, split.second];
      if (shell.blocksFit(withSecond)) {
        const sFoot = extractFootnotesFromContent(split.second, footnoteContentToNumber);
        appendHtml(split.second, sFoot);
      } else if (canUseReserveBandForTail(shell, currentPageElements, split.second)) {
        const sFoot = extractFootnotesFromContent(split.second, footnoteContentToNumber);
        appendHtml(split.second, sFoot);
      } else {
        tryPushPage();
        const sFoot = extractFootnotesFromContent(split.second, footnoteContentToNumber);
        appendHtml(split.second, sFoot);
      }
    }
    return { pageHasHeading: false };
  }

  if (currentPageElements.length === 0 && split.second) {
    split = splitElementInShell(shell, element, []);
    if (split.first && shell.blocksFit([split.first])) {
      const fFoot = extractFootnotesFromContent(split.first, footnoteContentToNumber);
      appendHtml(split.first, fFoot);
      if (split.second) {
        if (canUseReserveBandForTail(shell, currentPageElements, split.second)) {
          const sFoot = extractFootnotesFromContent(split.second, footnoteContentToNumber);
          appendHtml(split.second, sFoot);
        } else {
          tryPushPage();
          const sFoot = extractFootnotesFromContent(split.second, footnoteContentToNumber);
          appendHtml(split.second, sFoot);
        }
      }
      return { pageHasHeading: false };
    }
  }

  if (currentPageElements.length) tryPushPage();
  appendHtml(html, footnoteNums);
  return { pageHasHeading: false };
}
