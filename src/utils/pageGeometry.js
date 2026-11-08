/**
 * Canonical page geometry for reader + PDF pagination.
 * Every packing / measure path should import from here instead of local magic numbers.
 */

/** Desktop sheet size (matches PDFViewer.css two-page spread) */
export const DESKTOP_PAGE_WIDTH = 450;
export const DESKTOP_PAGE_HEIGHT = 636;

/** Desktop page-body padding (matches createMeasureContainer / PDFViewer.css) */
export const DESKTOP_BODY_PADDING_TOP = 48; // 3rem
export const DESKTOP_BODY_PADDING_RIGHT = 40; // 2.5rem
export const DESKTOP_BODY_PADDING_LEFT = 40; // 2.5rem
export const DESKTOP_BODY_PADDING_BOTTOM = 20;

/** Horizontal content width inside the desktop sheet */
export const DESKTOP_CONTENT_WIDTH =
  DESKTOP_PAGE_WIDTH - DESKTOP_BODY_PADDING_LEFT - DESKTOP_BODY_PADDING_RIGHT;

/** Typography used when measuring / applying paragraph styles */
export const DESKTOP_FONT_SIZE = '1.35rem';
export const MOBILE_FONT_SIZE = '1.3rem';
/**
 * Live `.page-content` font-size (PageReader.css). Preserve pages (first/cover/intro)
 * inherit this when p { font-size: unset }. Measure MUST use the same value or the
 * packer thinks text is taller than live → one-word spill + bottom gap.
 */
export const MOBILE_PRESERVE_FONT_SIZE = '1.18rem';
export const DESKTOP_LINE_HEIGHT = '1.50';
export const MOBILE_LINE_HEIGHT = '1.35';

/** Bottom safety margins when no footnote band is reserved */
/** Tight bottom pad for special first page / book intro page 1 (page number still clears). */
export const BOTTOM_MARGIN_FIRST_PAGE = 4;
export const BOTTOM_MARGIN_DESKTOP = 0; // desktop relies on body padding
/**
 * Mobile bottom reserve for the fixed page-number chrome (not footnotes).
 * Large enough that the last line clears the page number; small enough that
 * pages still fill. Packer + rendered padding stay in lockstep.
 */
export const MOBILE_PAGE_NUMBER_BAND_PX = 40;
export const BOTTOM_MARGIN_MOBILE = MOBILE_PAGE_NUMBER_BAND_PX;
/** When borrowing the band, keep at least this much clear above the screen edge for the page #. */
export const MOBILE_PAGE_NUMBER_MIN_CLEARANCE_PX = 10;
/** Tails shorter than this may extend into the page-number band instead of a new page. */
export const MOBILE_MAX_TAIL_IN_RESERVE_PX = MOBILE_PAGE_NUMBER_BAND_PX;
/** Optional word cap for reserve-band tails (short sentences only). */
export const MOBILE_MAX_TAIL_IN_RESERVE_WORDS = 14;
export const BOTTOM_MARGIN_KARAOKE = 32;
/** @deprecated Use BOTTOM_MARGIN_MOBILE / MOBILE_PAGE_NUMBER_BAND_PX */
export const BOTTOM_MARGIN_PAGE_PADDING_MOBILE = BOTTOM_MARGIN_MOBILE;

/**
 * Footnote footer band — desktop / PDF only.
 * On-screen footnotes are display:none (tooltip UX); mobile packing must NOT reserve
 * this band or body text leaves a visible empty gap. Desktop PDF export still packs
 * against a capped band so printed footnotes fit.
 */
export const FOOTNOTE_BAND_MAX = 72;
export const FOOTNOTE_BAND_MIN = 28;
/** Extra visual padding inside footnote measure that is not content-critical */
export const FOOTNOTE_EXTRA_PADDING_PX = 16;

/** Fit tolerances (px) — allow tiny visual overflow instead of aggressive splits */
export const DESKTOP_OVERFLOW_TOLERANCE = 15;
/**
 * Mobile slack: rounding / subpixel only. Fill comes from word-splitting at the
 * last cut that fits — not from overflowing into the page-number band.
 */
export const MOBILE_OVERFLOW_TOLERANCE = 4;

/**
 * @deprecated Mobile no longer uses sentence-first + char top-up.
 * Kept so older imports do not break; value unused by the packer.
 */
export const MOBILE_SENTENCE_NEARLY_FULL_CHARS = 0;
/** @deprecated */
export const MOBILE_SENTENCE_WORD_TOPUP_PX = MOBILE_SENTENCE_NEARLY_FULL_CHARS;

/** Approx one mobile body line — below this, mid-paragraph split isn't worth it */
export const MOBILE_MIN_SPLIT_REMAINING_PX = 28;

/** Orphan / widow approximations (word counts on split parts) */
export const ORPHAN_MIN_WORDS = 3;
export const WIDOW_MIN_WORDS = 4;

/** Image keep-together breathing room */
export const ATOMIC_IMAGE_BUFFER_PX = 8;

/** Subchapter flow: share page when this fraction of the content area is free */
export const SUBCHAPTER_FLOW_FREE_RATIO = 0.45;

export function isDesktopViewport(width = typeof window !== 'undefined' ? window.innerWidth : 1024) {
  return width > 768;
}

export function getFontSize(isDesktop) {
  return isDesktop ? DESKTOP_FONT_SIZE : MOBILE_FONT_SIZE;
}

export function getLineHeight(isDesktop) {
  return isDesktop ? DESKTOP_LINE_HEIGHT : MOBILE_LINE_HEIGHT;
}

/**
 * Desktop / mobile page box used by the packer.
 * Mobile height should come from visualViewport when available.
 */
export function getPageBox(isDesktop, viewportHeight) {
  if (isDesktop) {
    return {
      pageWidth: DESKTOP_PAGE_WIDTH,
      pageHeight: DESKTOP_PAGE_HEIGHT,
      contentWidth: DESKTOP_CONTENT_WIDTH,
    };
  }
  return {
    pageWidth: undefined,
    pageHeight: viewportHeight,
    contentWidth: undefined,
  };
}

/** Raw content-box height inside the desktop page-body (before footnote/margin reserve). */
export function getDesktopBodyContentHeight(pageHeight = DESKTOP_PAGE_HEIGHT) {
  return pageHeight - DESKTOP_BODY_PADDING_TOP - DESKTOP_BODY_PADDING_BOTTOM;
}

/**
 * Bottom reserve for packing.
 * Mobile: page-number band only (footnotes are display:none on screen).
 * Desktop: when footnotes are present, reserve a capped PDF footer band.
 */
export function getReservedBottomSpace({
  isDesktop,
  isFirstPage = false,
  hasKaraoke = false,
  footnotesHeight = 0,
}) {
  if (isDesktop && footnotesHeight > 0) {
    return Math.min(
      FOOTNOTE_BAND_MAX,
      Math.max(FOOTNOTE_BAND_MIN, footnotesHeight)
    );
  }
  if (hasKaraoke) return BOTTOM_MARGIN_KARAOKE;
  if (isFirstPage) return BOTTOM_MARGIN_FIRST_PAGE;
  return isDesktop ? BOTTOM_MARGIN_DESKTOP : BOTTOM_MARGIN_MOBILE;
}

/**
 * Greedy footnote-band fit: keep notes that fit under bandMax, spill the rest.
 * `measureSetHeight` receives a Set of footnote numbers and returns px height.
 */
export function fitFootnotesToBand(footnoteNumbers, measureSetHeight, bandMax = FOOTNOTE_BAND_MAX) {
  const ordered = Array.from(footnoteNumbers).sort((a, b) => a - b);
  const fitted = new Set();
  const spill = new Set();

  if (ordered.length === 0) {
    return { fitted, spill, bandHeight: 0 };
  }

  let bandHeight = 0;
  for (const num of ordered) {
    const trial = new Set(fitted);
    trial.add(num);
    const height = measureSetHeight(trial) || 0;
    if (fitted.size === 0 || height <= bandMax) {
      fitted.add(num);
      bandHeight = Math.min(bandMax, Math.max(FOOTNOTE_BAND_MIN, height));
    } else {
      spill.add(num);
    }
  }

  // Always keep at least the first note on the page that referenced it.
  if (fitted.size === 0 && ordered.length > 0) {
    fitted.add(ordered[0]);
    bandHeight = Math.min(bandMax, Math.max(FOOTNOTE_BAND_MIN, measureSetHeight(fitted) || FOOTNOTE_BAND_MIN));
    for (let i = 1; i < ordered.length; i += 1) spill.add(ordered[i]);
  }

  return { fitted, spill, bandHeight };
}

/** True if a split first-part is too short to leave before a break (orphan). */
export function isOrphanSplit(firstPartWordCount) {
  return firstPartWordCount < ORPHAN_MIN_WORDS;
}

/** True if a split second-part would open the next page with a widow. */
export function isWidowSplit(secondPartWordCount) {
  return secondPartWordCount > 0 && secondPartWordCount < WIDOW_MIN_WORDS;
}

export function countWordsFromHtml(html) {
  if (!html) return 0;
  const text = String(html).replace(/<[^>]*>/g, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function getOverflowTolerance(isDesktop) {
  return isDesktop ? DESKTOP_OVERFLOW_TOLERANCE : MOBILE_OVERFLOW_TOLERANCE;
}
