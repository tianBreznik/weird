import { useLayoutEffect, useRef } from 'react';
import {
  extractDesktopPageAmbientPalette,
  mixRgbIntoDarkBase,
} from '../utils/desktopPageAmbientPalette';

const DEFAULT_INK = { r: 38, g: 36, b: 34 };
const DEFAULT_ACCENT = { r: 52, g: 48, b: 44 };

function applyPaletteToViewer(viewer, ink, accent) {
  const a = mixRgbIntoDarkBase(ink, 0.32);
  const b = mixRgbIntoDarkBase(accent, 0.38);
  viewer.style.setProperty('--ambient-ink-r', String(a.r));
  viewer.style.setProperty('--ambient-ink-g', String(a.g));
  viewer.style.setProperty('--ambient-ink-b', String(a.b));
  viewer.style.setProperty('--ambient-accent-r', String(b.r));
  viewer.style.setProperty('--ambient-accent-g', String(b.g));
  viewer.style.setProperty('--ambient-accent-b', String(b.b));
}

/**
 * Tints the dark scroll backdrop from the centered page (text, highlights, inline images, frame).
 * Excludes full-bleed .pdf-page-background-image.
 */
export function useDesktopPageAmbientPalette({
  scrollRef,
  pageIndex,
  active,
  frameBorder,
}) {
  const runIdRef = useRef(0);

  useLayoutEffect(() => {
    if (!active || pageIndex == null || pageIndex < 0) return undefined;

    const scroller = scrollRef.current;
    const viewer = scroller?.closest('.pdf-viewer');
    if (!viewer) return undefined;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    const slot = document.getElementById(`pdf-page-${pageIndex}`);
    if (!slot) {
      applyPaletteToViewer(viewer, DEFAULT_INK, DEFAULT_ACCENT);
      return undefined;
    }

    let cancelled = false;
    const runSample = () => {
      extractDesktopPageAmbientPalette(slot, frameBorder).then((palette) => {
        if (cancelled || runId !== runIdRef.current || !palette) return;
        applyPaletteToViewer(viewer, palette.ink, palette.accent);
      });
    };
    const raf = requestAnimationFrame(runSample);
    const retry = window.setTimeout(runSample, 450);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(retry);
    };
  }, [scrollRef, pageIndex, active, frameBorder?.url, frameBorder?.width, frameBorder?.slicePercent]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const viewer = scrollRef.current?.closest('.pdf-viewer');
    if (!viewer) return undefined;
    applyPaletteToViewer(viewer, DEFAULT_INK, DEFAULT_ACCENT);
    return () => {
      [
        '--ambient-ink-r',
        '--ambient-ink-g',
        '--ambient-ink-b',
        '--ambient-accent-r',
        '--ambient-accent-g',
        '--ambient-accent-b',
      ].forEach((k) => viewer.style.removeProperty(k));
    };
  }, [scrollRef, active]);
}
