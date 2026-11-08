import defaultBorderImage from '../assets/smallerborder.png';
import { defaultImageOutset, effectiveFrameThickness } from '../utils/desktopApertureBorderStyle';

/** Solid default mat around the desktop reading aperture; overridden per page when set. */
export const DEFAULT_DESKTOP_PAGE_FRAME = {
  url: defaultBorderImage,
  width: 12,
  slicePercent: 5,
};

export function resolveDesktopApertureFrame(page) {
  if (page?.borderImageUrl) {
    const width = Math.max(5, page.borderWidth ?? 10);
    const slice = page.borderSlicePercent ?? 5;
    const nw = page.borderImageNaturalWidth ?? null;
    const nh = page.borderImageNaturalHeight ?? null;
    const kind = page.borderAssetKind ?? null;
    const thickness = effectiveFrameThickness(width, slice, nw, nh, kind);
    const imageOutset = defaultImageOutset(thickness, slice, page.borderImageOutset, nw, nh, kind);
    return {
      url: page.borderImageUrl,
      width,
      slicePercent: slice,
      sliceVerticalPercent: page.borderSliceVerticalPercent ?? null,
      sliceHorizontalPercent: page.borderSliceHorizontalPercent ?? null,
      borderAssetKind: kind,
      imageOutset,
      borderImageNaturalWidth: nw,
      borderImageNaturalHeight: nh,
    };
  }
  const { width } = DEFAULT_DESKTOP_PAGE_FRAME;
  return { ...DEFAULT_DESKTOP_PAGE_FRAME, imageOutset: width };
}
