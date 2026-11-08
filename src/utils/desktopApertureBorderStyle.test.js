import { describe, expect, it } from 'vitest';
import {
  BORDER_ASSET_KIND,
  borderImageSliceCssForLayer,
  desktopApertureFrameLayerStyle,
  isRectangularBorderSource,
  suggestBorderCalibration,
} from './desktopApertureBorderStyle';

describe('desktopApertureBorderStyle', () => {
  it('square ornate keeps asymmetric slice', () => {
    expect(
      borderImageSliceCssForLayer({
        slicePercent: 30,
        borderImageNaturalWidth: 360,
        borderImageNaturalHeight: 360,
        borderAssetKind: BORDER_ASSET_KIND.SQUARE,
      })
    ).toBe('24% 30% 24% 30%');
  });

  it('rectangular uses separate vertical and horizontal slice', () => {
    const style = desktopApertureFrameLayerStyle({
      url: '/card.jpg',
      frameWidth: 40,
      slicePercent: 10,
      sliceVerticalPercent: 10,
      sliceHorizontalPercent: 12,
      borderAssetKind: BORDER_ASSET_KIND.RECTANGULAR,
      borderImageNaturalWidth: 736,
      borderImageNaturalHeight: 1003,
    });
    expect(borderImageSliceCssForLayer({
      slicePercent: 10,
      sliceVerticalPercent: 10,
      sliceHorizontalPercent: 12,
      borderAssetKind: BORDER_ASSET_KIND.RECTANGULAR,
    })).toBe('10% 12% 10% 12%');
    expect(style.borderImage).toContain('10% 12% 10% 12%');
    expect(style.borderImageOutset).toBe('40px');
    expect(style.borderImage).toContain('/ 40px round');
  });

  it('detects portrait full-frame at upload', () => {
    expect(isRectangularBorderSource(736, 1003)).toBe(true);
    const cal = suggestBorderCalibration(736, 1003);
    expect(cal.assetKind).toBe(BORDER_ASSET_KIND.RECTANGULAR);
    expect(cal.sliceVerticalPercent).toBe(10);
    expect(cal.sliceHorizontalPercent).toBe(12);
  });
});
