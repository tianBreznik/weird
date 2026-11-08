import { applyParagraphStylesToContainer } from './paginationHelpers';
import { queryMobilePackGeometry } from './mobilePackGeometry';
import {
  BOTTOM_MARGIN_FIRST_PAGE,
  BOTTOM_MARGIN_MOBILE,
  MOBILE_PAGE_NUMBER_MIN_CLEARANCE_PX,
  getOverflowTolerance,
} from './pageGeometry';
import { DEFAULT_CHAPTER_FONT } from '../constants/chapterFonts';

/**
 * Mobile packer uses ONE DOM tree that mirrors the live reader — same CSS,
 * same box, scrollHeight as the source of truth (no parallel measure container).
 */
export class MobilePackShell {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'page-reader mobile-pack-shell';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.style.cssText =
      'position:fixed;left:0;top:0;width:100vw;height:100dvh;visibility:hidden;pointer-events:none;z-index:-1;overflow:hidden;';

    this.container = document.createElement('div');
    this.container.className = 'page-container';
    this.container.style.padding = '2rem 1rem 0';
    this.container.style.boxSizing = 'border-box';
    this.container.style.height = '100dvh';
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.justifyContent = 'center';

    this.sheet = document.createElement('article');
    this.sheet.className = 'page-sheet content-page';

    this.body = document.createElement('section');
    this.body.className = 'page-body content-body';
    this.body.style.flex = '1';
    this.body.style.width = '100%';
    this.body.style.overflow = 'hidden';
    this.body.style.display = 'flex';
    this.body.style.flexDirection = 'column';

    this.pageContent = document.createElement('div');
    this.pageContent.className = 'page-content page-content--canonical';

    this.main = document.createElement('div');
    this.main.className = 'page-content-main';

    this.pageContent.appendChild(this.main);
    this.body.appendChild(this.pageContent);
    this.sheet.appendChild(this.body);
    this.container.appendChild(this.sheet);
    this.root.appendChild(this.container);
    document.body.appendChild(this.root);

    this.reservePx = BOTTOM_MARGIN_MOBILE;
    this.tolerance = getOverflowTolerance(false);
    this.syncSizeFromLiveReader();
  }

  destroy() {
    this.root.remove();
  }

  syncSizeFromLiveReader() {
    const geom = queryMobilePackGeometry();
    const vh =
      typeof window !== 'undefined'
        ? Math.round(window.visualViewport?.height ?? window.innerHeight)
        : 0;

    const liveContainer = geom?.container;
    if (liveContainer) {
      const w = Math.round(liveContainer.getBoundingClientRect().width);
      if (w > 0) this.container.style.width = `${w}px`;
    } else if (vh > 0) {
      this.container.style.width = '100%';
    }

    this.container.style.height = vh > 0 ? `${vh}px` : '100dvh';

    const liveSheet = geom?.sheet;
    this.sheet.style.removeProperty('width');
    this.sheet.style.removeProperty('max-width');
    if (liveSheet) {
      const sheetRect = liveSheet.getBoundingClientRect();
      const sw = Math.round(sheetRect.width);
      const sh = Math.round(sheetRect.height);
      if (sw > 0) {
        this.sheet.style.width = `${sw}px`;
        this.sheet.style.maxWidth = `${sw}px`;
      }
      if (sh > 0) {
        this.sheet.style.height = `${sh}px`;
        this.sheet.style.maxHeight = `${sh}px`;
      }
    } else {
      this.sheet.style.height = '100%';
      if (typeof window !== 'undefined') {
        const fallback = Math.min(680, Math.round(window.innerWidth * 0.96));
        this.sheet.style.width = `${fallback}px`;
        this.sheet.style.maxWidth = `${fallback}px`;
      }
    }

    const liveBody = geom?.body;
    if (liveBody?.clientHeight > 80) {
      this.body.style.height = `${liveBody.clientHeight}px`;
      this.body.style.maxHeight = `${liveBody.clientHeight}px`;
    } else {
      this.body.style.height = '';
      this.body.style.maxHeight = '';
    }

    const liveContent = geom?.pageContent;
    if (liveContent?.clientHeight > 40) {
      this.pageContent.style.height = `${liveContent.clientHeight}px`;
      this.pageContent.style.maxHeight = `${liveContent.clientHeight}px`;
    } else {
      this.pageContent.style.height = '100%';
      this.pageContent.style.maxHeight = '100%';
    }

    const liveMain = geom?.main;
    if (liveMain?.clientWidth > 0) {
      const mw = Math.round(liveMain.getBoundingClientRect().width);
      if (mw > 0) {
        this.main.style.width = `${mw}px`;
        this.main.style.maxWidth = `${mw}px`;
      }
    } else {
      this.main.style.width = '100%';
      this.main.style.removeProperty('max-width');
    }

    void this.container.offsetHeight;
    void this.sheet.offsetHeight;
    void this.body.offsetHeight;
    void this.pageContent.offsetHeight;
    void this.main.offsetHeight;
  }

  setPageStyle({ preserveTypography = false, tightReserve = false, fontFamily }) {
    this.preserveTypography = preserveTypography;
    this.fontFamily = fontFamily || DEFAULT_CHAPTER_FONT;
    this.reservePx = tightReserve ? BOTTOM_MARGIN_FIRST_PAGE : BOTTOM_MARGIN_MOBILE;
    if (!preserveTypography) {
      this.pageContent.classList.add('page-content--canonical');
      this.pageContent.classList.remove('page-content--preserve');
    } else {
      this.pageContent.classList.remove('page-content--canonical');
      this.pageContent.classList.add('page-content--preserve');
    }
    this.main.style.paddingBottom = `${this.reservePx}px`;
  }

  /** Bottom Y (viewport coords) below which packed blocks must not extend (matches debug overlay). */
  get packLimitBottomPx() {
    void this.main.offsetHeight;
    return this.body.getBoundingClientRect().bottom - this.reservePx;
  }

  blockChildren() {
    return [...this.main.children].filter(
      (el) => !el.classList.contains('page-footnotes') && !el.classList.contains('footnotes-section')
    );
  }

  /** Max content height from main top to pack limit — for slack / subchapter flow math. */
  get contentLimitPx() {
    const mainTop = this.main.getBoundingClientRect().top;
    return Math.max(0, this.packLimitBottomPx - mainTop);
  }

  lastBlockBottomPx() {
    const blocks = this.blockChildren();
    if (!blocks.length) return this.main.getBoundingClientRect().top;
    return blocks[blocks.length - 1].getBoundingClientRect().bottom;
  }

  renderBlocks(blockHtmlList) {
    this.main.innerHTML = '';
    blockHtmlList.forEach((html) => {
      const t = document.createElement('div');
      t.innerHTML = html;
      this.main.appendChild(t.firstElementChild || t);
    });
    applyParagraphStylesToContainer(this.main, false, this.fontFamily, {
      canonicalTypography: !this.preserveTypography,
    });
    void this.main.offsetHeight;
  }

  /** Live layout fill — same axes as paginationDebugOverlay (not scrollHeight). */
  measureBlocksHeight(blockHtmlList) {
    this.renderBlocks(blockHtmlList);
    const mainTop = this.main.getBoundingClientRect().top;
    const usedBottom = this.lastBlockBottomPx();
    const content = usedBottom - mainTop;
    const slack = this.packLimitBottomPx - usedBottom;
    return { total: usedBottom - mainTop + this.reservePx, content, slack };
  }

  fitLimitBottomPx({ borrowReserve = false } = {}) {
    const bodyBottom = this.body.getBoundingClientRect().bottom;
    if (borrowReserve) {
      return bodyBottom - MOBILE_PAGE_NUMBER_MIN_CLEARANCE_PX;
    }
    return this.packLimitBottomPx;
  }

  /** Height of the last top-level block after rendering the list. */
  lastBlockHeightPx(blockHtmlList) {
    this.renderBlocks(blockHtmlList);
    const blocks = this.blockChildren();
    if (!blocks.length) return 0;
    return Math.round(blocks[blocks.length - 1].getBoundingClientRect().height);
  }

  blocksFit(blockHtmlList, options = {}) {
    this.renderBlocks(blockHtmlList);
    const limit = this.fitLimitBottomPx(options);
    return this.lastBlockBottomPx() <= limit + this.tolerance;
  }
}
