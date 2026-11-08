import { useEffect, useMemo, useRef, useState } from 'react';
import { desktopApertureFrameLayerStyle } from '../utils/desktopApertureBorderStyle';

/**
 * Picture-frame border-image: border-width 0, thickness via image width + outset into gutter.
 */
export function DesktopApertureFrame({ borderSpec, zoom = 1 }) {
  const normalized = useMemo(() => {
    if (!borderSpec?.url) return null;
    const frameWidth = Math.max(5, borderSpec.width || 10);
    const slicePercent = borderSpec.slicePercent ?? 5;
    const imageOutset = borderSpec.imageOutset ?? frameWidth;
    return {
      url: borderSpec.url,
      frameWidth,
      slicePercent,
      sliceVerticalPercent: borderSpec.sliceVerticalPercent ?? null,
      sliceHorizontalPercent: borderSpec.sliceHorizontalPercent ?? null,
      borderAssetKind: borderSpec.borderAssetKind ?? null,
      imageOutset,
      borderImageNaturalWidth: borderSpec.borderImageNaturalWidth ?? null,
      borderImageNaturalHeight: borderSpec.borderImageNaturalHeight ?? null,
    };
  }, [borderSpec]);

  const [layers, setLayers] = useState([normalized, normalized]);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const visibleIndexRef = useRef(0);
  const prevKeyRef = useRef(
    normalized ? `${normalized.url}|${normalized.frameWidth}|${normalized.slicePercent}` : 'none'
  );

  useEffect(() => {
    const key = normalized
      ? `${normalized.url}|${normalized.frameWidth}|${normalized.slicePercent}`
      : 'none';
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const back = 1 - visibleIndexRef.current;
    setLayers((prev) => {
      const next = [...prev];
      next[back] = normalized;
      return next;
    });
    const raf = requestAnimationFrame(() => {
      visibleIndexRef.current = back;
      setVisibleIndex(back);
    });
    return () => cancelAnimationFrame(raf);
  }, [normalized]);

  if (!layers[0]?.url && !layers[1]?.url) {
    return null;
  }

  const frameStyle = (layer) => desktopApertureFrameLayerStyle(layer);

  return (
    <div className="desktop-aperture-frame-stack" aria-hidden="true">
      {layers.map((layer, i) => (
        <div
          key={i}
          className={`desktop-aperture-frame-layer ${visibleIndex === i ? 'is-visible' : ''}`}
          style={frameStyle(layer)}
        />
      ))}
    </div>
  );
}
