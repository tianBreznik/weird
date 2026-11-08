import { useEffect, useState } from 'react';
import { isImageCached, preloadImage } from '../utils/mediaCache';

/**
 * Full-bleed page background — stays hidden until decode so the paper fallback shows underneath.
 */
export function PageBackgroundImage({ src, objectPosition = 'left center', className = '' }) {
  const [ready, setReady] = useState(() => isImageCached(src));

  useEffect(() => {
    if (!src) return undefined;
    let cancelled = false;
    if (isImageCached(src)) {
      setReady(true);
      return undefined;
    }
    setReady(false);
    preloadImage(src).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const handleLoad = (e) => {
    const img = e.currentTarget;
    const finish = () => setReady(true);
    if (typeof img.decode === 'function') {
      img.decode().then(finish).catch(finish);
    } else {
      finish();
    }
  };

  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      className={`pdf-page-background-image ${ready ? 'is-decoded' : ''} ${className}`.trim()}
      loading="eager"
      decoding="sync"
      fetchPriority="high"
      onLoad={handleLoad}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
