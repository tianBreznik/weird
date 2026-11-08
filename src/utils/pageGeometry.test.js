import { describe, it, expect } from 'vitest';
import {
  BOTTOM_MARGIN_MOBILE,
  BOTTOM_MARGIN_PAGE_PADDING_MOBILE,
  DESKTOP_PAGE_WIDTH,
  DESKTOP_PAGE_HEIGHT,
  DESKTOP_CONTENT_WIDTH,
  FOOTNOTE_BAND_MAX,
  MOBILE_PAGE_NUMBER_BAND_PX,
  countWordsFromHtml,
  fitFootnotesToBand,
  getDesktopBodyContentHeight,
  getOverflowTolerance,
  getPageBox,
  getReservedBottomSpace,
  isOrphanSplit,
  isWidowSplit,
} from './pageGeometry.js';

describe('pageGeometry', () => {
  it('exposes desktop sheet and content width consistently', () => {
    expect(DESKTOP_CONTENT_WIDTH).toBe(DESKTOP_PAGE_WIDTH - 40 - 40);
    expect(getDesktopBodyContentHeight(DESKTOP_PAGE_HEIGHT)).toBe(DESKTOP_PAGE_HEIGHT - 48 - 20);
    expect(getPageBox(true).pageWidth).toBe(DESKTOP_PAGE_WIDTH);
  });

  it('caps desktop footnote reservation instead of using raw measured height', () => {
    const reserved = getReservedBottomSpace({
      isDesktop: true,
      footnotesHeight: 200,
    });
    expect(reserved).toBe(FOOTNOTE_BAND_MAX);
  });

  it('never reserves a footnote band on mobile (footnotes are display:none)', () => {
    expect(
      getReservedBottomSpace({
        isDesktop: false,
        footnotesHeight: 200,
      })
    ).toBe(BOTTOM_MARGIN_MOBILE);
    expect(
      getReservedBottomSpace({
        isDesktop: false,
        footnotesHeight: 200,
        hasKaraoke: true,
      })
    ).toBe(32);
  });

  it('keeps mobile packer reserve and rendered content padding on the same page-number band', () => {
    expect(BOTTOM_MARGIN_MOBILE).toBe(MOBILE_PAGE_NUMBER_BAND_PX);
    expect(BOTTOM_MARGIN_PAGE_PADDING_MOBILE).toBe(BOTTOM_MARGIN_MOBILE);
    expect(getReservedBottomSpace({ isDesktop: false })).toBe(MOBILE_PAGE_NUMBER_BAND_PX);
    expect(MOBILE_PAGE_NUMBER_BAND_PX).toBeGreaterThan(0);
  });

  it('uses karaoke / first-page / mobile margins when no footnotes', () => {
    expect(getReservedBottomSpace({ isDesktop: false, hasKaraoke: true })).toBe(32);
    expect(getReservedBottomSpace({ isDesktop: false, isFirstPage: true })).toBe(4);
    expect(getReservedBottomSpace({ isDesktop: true })).toBe(0);
    expect(getReservedBottomSpace({ isDesktop: false })).toBe(MOBILE_PAGE_NUMBER_BAND_PX);
  });

  it('fits footnotes into a band and spills the rest', () => {
    // Each note "costs" 30px; band max 72 => first two fit (60), third spills.
    const measure = (set) => set.size * 30;
    const { fitted, spill, bandHeight } = fitFootnotesToBand(new Set([1, 2, 3]), measure, 72);
    expect(Array.from(fitted).sort()).toEqual([1, 2]);
    expect(Array.from(spill)).toEqual([3]);
    expect(bandHeight).toBeLessThanOrEqual(72);
  });

  it('detects orphan and widow splits by word count', () => {
    expect(isOrphanSplit(2)).toBe(true);
    expect(isOrphanSplit(3)).toBe(false);
    expect(isWidowSplit(3)).toBe(true);
    expect(isWidowSplit(4)).toBe(false);
    expect(countWordsFromHtml('<p>one two three</p>')).toBe(3);
  });

  it('returns platform overflow tolerances', () => {
    expect(getOverflowTolerance(true)).toBe(15);
    expect(getOverflowTolerance(false)).toBe(4);
  });
});
