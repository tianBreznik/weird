import {
  BOTTOM_MARGIN_FIRST_PAGE,
  MOBILE_PAGE_NUMBER_BAND_PX,
} from './pageGeometry';

const OVERLAY_CLASS = 'pagination-debug-layer';

export function countPackedBlocksInPageHtml(pageContentHtml) {
  if (!pageContentHtml) return 0;
  const wrap = document.createElement('div');
  wrap.innerHTML = pageContentHtml;
  const main = wrap.querySelector('.page-content-main');
  if (!main) return 0;
  return [...main.children].filter(
    (el) =>
      !el.classList.contains('footnotes-section') &&
      !el.classList.contains(OVERLAY_CLASS)
  ).length;
}

/**
 * Visualize how packed content fills the mobile page-body:
 * - blue boxes: each top-level block in .page-content-main
 * - purple band: packer bottom reserve (page number / tight first-page pad)
 * - green band: unused slack above that reserve (the "mystery gap")
 * - yellow band: last rejected overflow from packer (?debug=pagination log data)
 */
export function applyPaginationDebugOverlay(pageBodyEl, options = {}) {
  if (!pageBodyEl) return () => {};
  clearPaginationDebugOverlay(pageBodyEl);

  const {
    chapterId = '',
    pageIndex = 0,
    isFirstPage = false,
    preserveTypography = false,
    isTightFirst = false,
    packedBlockCount = null,
    bookPageNumber = null,
  } = options;

  const pageContent = pageBodyEl.querySelector('.page-content');
  const contentMain = pageBodyEl.querySelector('.page-content-main');
  if (!contentMain) return () => {};

  const bodyRect = pageBodyEl.getBoundingClientRect();
  const mainRect = contentMain.getBoundingClientRect();
  const mainStyle = window.getComputedStyle(contentMain);
  let reservePx = parseFloat(mainStyle.paddingBottom) || 0;
  if (reservePx <= 0) {
    reservePx =
      isFirstPage || isTightFirst || preserveTypography
        ? BOTTOM_MARGIN_FIRST_PAGE
        : MOBILE_PAGE_NUMBER_BAND_PX;
  }

  const blocks = [...contentMain.children].filter(
    (el) => !el.classList.contains(OVERLAY_CLASS) && !el.classList.contains('page-footnotes')
  );

  blocks.forEach((el, index) => {
    el.classList.add('pagination-debug-block');
    const h = Math.round(el.getBoundingClientRect().height);
    const tag = (el.tagName || 'el').toLowerCase();
    const words = (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    el.dataset.debugBlockIndex = String(index + 1);
    el.dataset.debugBlockH = String(h);
    el.dataset.debugBlockTag = tag;
    el.dataset.debugBlockWords = String(words);
    el.title = `${tag} #${index + 1} · ${h}px · ~${words} words`;
  });

  const lastBlock = blocks[blocks.length - 1];
  const usedBottom = lastBlock
    ? lastBlock.getBoundingClientRect().bottom
  : mainRect.top;

  const bodyBottom = bodyRect.bottom;
  const reserveTop = bodyBottom - reservePx;
  const slackPx = Math.max(0, Math.round(reserveTop - usedBottom));

  const makeLayer = (className, heightPx, topPx, label) => {
    if (heightPx < 1) return null;
    const layer = document.createElement('div');
    layer.className = `${OVERLAY_CLASS} ${className}`;
    layer.style.height = `${heightPx}px`;
    layer.style.top = `${topPx}px`;
    if (label) layer.dataset.debugLabel = label;
    pageBodyEl.appendChild(layer);
    return layer;
  };

  const bodyTop = bodyRect.top;
  const slackTop = usedBottom - bodyTop;
  makeLayer(
    'page-slack-debug',
    slackPx,
    slackTop,
    `slack ${slackPx}px`
  );
  makeLayer(
    'page-reserve-debug',
    reservePx,
    reserveTop - bodyTop,
    `reserve ${reservePx}px`
  );

  // Packer-recorded overflow for this page (from elementPagination console path)
  try {
    const key = `${chapterId}:${pageIndex}`;
    const info = window.__paginationDebug?.[key];
    if (info?.overflowAmount > 0) {
      const overflowPx = Math.min(Math.round(info.overflowAmount), Math.round(bodyRect.height));
      makeLayer(
        'page-overflow-debug',
        overflowPx,
        bodyRect.height - overflowPx,
        `overflow +${overflowPx}px`
      );
    }
  } catch {
    /* ignore */
  }

  const legend = document.createElement('div');
  legend.className = `${OVERLAY_CLASS} page-pagination-legend`;
  const bodyH = Math.round(bodyRect.height);
  const mainH = Math.round(mainRect.height);
  const blockCount = blocks.length;
  const storedLabel =
    packedBlockCount != null
      ? `stored <span>${packedBlockCount}</span>`
      : '';
  const bookLabel =
    bookPageNumber != null && bookPageNumber > 0
      ? `book <span>${bookPageNumber}</span>`
      : '';
  legend.innerHTML = [
    `<strong>Page fill</strong>`,
    bookLabel,
    `body <span>${bodyH}px</span>`,
    `dom blocks <span>${blockCount}</span>`,
    storedLabel,
    `slack <span class="c-slack">${slackPx}px</span>`,
    `reserve <span class="c-reserve">${reservePx}px</span>`,
    `key <span>${chapterId}:${pageIndex}</span>`,
  ]
    .filter(Boolean)
    .join(' · ');
  pageBodyEl.appendChild(legend);

  return () => clearPaginationDebugOverlay(pageBodyEl);
}

export function clearPaginationDebugOverlay(pageBodyEl) {
  if (!pageBodyEl) return;
  pageBodyEl.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  pageBodyEl.querySelectorAll('.pagination-debug-block').forEach((el) => {
    el.classList.remove('pagination-debug-block');
    delete el.dataset.debugBlockIndex;
    delete el.dataset.debugBlockH;
    delete el.dataset.debugBlockTag;
    delete el.dataset.debugBlockWords;
    el.removeAttribute('title');
  });
}
