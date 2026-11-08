/**
 * Desktop aperture border-image tuning.
 * Square 9-slice tiles vs rectangular full-frame assets use different editor + CSS paths.
 */

export const ORNATE_SLICE_THRESHOLD = 12;
export const RECTANGULAR_BORDER_ASPECT = 1.12;

export const BORDER_ASSET_KIND = {
  SQUARE: 'square',
  RECTANGULAR: 'rectangular',
};

export function isOrnateDesktopFrame(slicePercent) {
  return (slicePercent ?? 0) >= ORNATE_SLICE_THRESHOLD;
}

export function isRectangularBorderSource(naturalW, naturalH) {
  if (!naturalW || !naturalH) return false;
  const ratio = naturalW / naturalH;
  return ratio > RECTANGULAR_BORDER_ASPECT || ratio < 1 / RECTANGULAR_BORDER_ASPECT;
}

export function resolveBorderAssetKind(kind, naturalW, naturalH) {
  if (kind === BORDER_ASSET_KIND.RECTANGULAR || kind === BORDER_ASSET_KIND.SQUARE) {
    return kind;
  }
  return isRectangularBorderSource(naturalW, naturalH)
    ? BORDER_ASSET_KIND.RECTANGULAR
    : BORDER_ASSET_KIND.SQUARE;
}

export function isRectangularFrame(spec) {
  return resolveBorderAssetKind(spec?.borderAssetKind, spec?.borderImageNaturalWidth, spec?.borderImageNaturalHeight)
    === BORDER_ASSET_KIND.RECTANGULAR;
}

export function useSquareOrnateTuning(slicePercent, naturalW, naturalH, borderAssetKind) {
  if (resolveBorderAssetKind(borderAssetKind, naturalW, naturalH) === BORDER_ASSET_KIND.RECTANGULAR) {
    return false;
  }
  return isOrnateDesktopFrame(slicePercent);
}

export function effectiveFrameThickness(fw, slicePercent, naturalW, naturalH, borderAssetKind) {
  const w = Math.max(5, fw);
  if (useSquareOrnateTuning(slicePercent, naturalW, naturalH, borderAssetKind)) {
    return Math.max(w, 24);
  }
  return w;
}

export function defaultImageOutset(thickness, slicePercent, explicitOutset, naturalW, naturalH, borderAssetKind) {
  if (explicitOutset != null && !Number.isNaN(Number(explicitOutset))) {
    return Math.max(0, Number(explicitOutset));
  }
  if (useSquareOrnateTuning(slicePercent, naturalW, naturalH, borderAssetKind)) {
    return Math.max(6, Math.min(thickness, Math.round(thickness * 0.4)));
  }
  return thickness;
}

/** CSS border-image-slice from layer spec */
export function borderImageSliceCssForLayer(layer) {
  if (isRectangularFrame(layer)) {
    const v = layer.sliceVerticalPercent ?? layer.slicePercent ?? 10;
    const h = layer.sliceHorizontalPercent ?? layer.slicePercent ?? 10;
    return `${v}% ${h}% ${v}% ${h}%`;
  }
  const slice = layer.slicePercent ?? 5;
  const nw = layer.borderImageNaturalWidth;
  const nh = layer.borderImageNaturalHeight;
  if (!useSquareOrnateTuning(slice, nw, nh, layer.borderAssetKind)) {
    return `${slice}%`;
  }
  if (slice >= 24) {
    const horizontal = slice;
    const vertical = Math.max(20, slice - 6);
    return `${vertical}% ${horizontal}% ${vertical}% ${horizontal}%`;
  }
  return `${slice}%`;
}

export function borderImageRepeatCss() {
  return 'round';
}

export function desktopApertureShellPadding(frameBorder) {
  if (!frameBorder?.url) return 12;
  const fw = Math.max(5, frameBorder.width ?? 12);
  const slice = frameBorder.slicePercent ?? 5;
  const nw = frameBorder.borderImageNaturalWidth;
  const nh = frameBorder.borderImageNaturalHeight;
  const kind = frameBorder.borderAssetKind;
  return Math.max(5, effectiveFrameThickness(fw, slice, nw, nh, kind));
}

/**
 * @param {object} layer – frame layer spec from DesktopApertureFrame
 */
export function desktopApertureFrameLayerStyle(layer) {
  if (!layer?.url) {
    return { border: '0 solid transparent', boxShadow: 'none' };
  }

  const slice = layer.slicePercent;
  const nw = layer.borderImageNaturalWidth;
  const nh = layer.borderImageNaturalHeight;
  const kind = layer.borderAssetKind;
  const thickness = effectiveFrameThickness(layer.frameWidth, slice, nw, nh, kind);
  const sliceCss = borderImageSliceCssForLayer(layer);
  const repeat = borderImageRepeatCss();
  const outset = defaultImageOutset(thickness, slice, layer.imageOutset, nw, nh, kind);

  return {
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderImage: `url(${layer.url}) ${sliceCss} / ${thickness}px ${repeat}`,
    borderImageOutset: `${outset}px`,
    borderRadius: 0,
    boxShadow: 'none',
  };
}

/** After border image upload — dimensions drive asset kind and defaults */
export function suggestBorderCalibration(naturalW, naturalH) {
  const w = naturalW || 0;
  const h = naturalH || 0;
  if (!w || !h) {
    return {
      assetKind: BORDER_ASSET_KIND.SQUARE,
      slicePercent: 5,
      sliceVerticalPercent: null,
      sliceHorizontalPercent: null,
      borderWidth: 10,
      naturalWidth: w,
      naturalHeight: h,
    };
  }
  if (isRectangularBorderSource(w, h)) {
    const sliceVertical = Math.min(18, Math.max(8, Math.round(h * 0.1 / h * 100)));
    const sliceHorizontal = Math.min(18, Math.max(8, Math.round(w * 0.12 / w * 100)));
    const borderWidth = Math.max(32, Math.round(Math.min(w, h) * 0.045));
    return {
      assetKind: BORDER_ASSET_KIND.RECTANGULAR,
      slicePercent: sliceVertical,
      sliceVerticalPercent: sliceVertical,
      sliceHorizontalPercent: sliceHorizontal,
      borderWidth,
      naturalWidth: w,
      naturalHeight: h,
    };
  }
  const s = Math.min(w, h);
  if (s <= 512) {
    return {
      assetKind: BORDER_ASSET_KIND.SQUARE,
      slicePercent: 24,
      sliceVerticalPercent: null,
      sliceHorizontalPercent: null,
      borderWidth: Math.max(20, Math.round(s * 0.062)),
      naturalWidth: w,
      naturalHeight: h,
    };
  }
  const cornerThickness = s * 0.04;
  return {
    assetKind: BORDER_ASSET_KIND.SQUARE,
    slicePercent: Math.round((cornerThickness / s) * 100),
    sliceVerticalPercent: null,
    sliceHorizontalPercent: null,
    borderWidth: Math.round(cornerThickness / 5),
    naturalWidth: w,
    naturalHeight: h,
  };
}
