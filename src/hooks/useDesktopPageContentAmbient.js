import { useEffect, useRef } from 'react';
import { extractPageContentPalette } from '../utils/pageContentPalette';

const NEUTRAL_PRIMARY = 'hsl(0 0% 32%)';
const NEUTRAL_SECONDARY = 'hsl(0 0% 24%)';

/**
 * Tint the desktop viewport gradient from colors in the centered page (not page background img).
 */
export function useDesktopPageContentAmbient(scrollRef, pageIndex, active = true) {
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!active || pageIndex < 0) return undefined;

    const viewer = scrollRef.current?.closest('.pdf-viewer');
    if (!viewer) return undefined;

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    const applyNeutral = () => {
      viewer.style.setProperty('--page-tint-primary', NEUTRAL_PRIMARY);
      viewer.style.setProperty('--page-tint-secondary', NEUTRAL_SECONDARY);
    };

    let cancelled = false;

    const runExtract = async () => {
      const pageWrap = document.getElementById(`pdf-page-${pageIndex}`);
      const sheet = pageWrap?.querySelector('.page-sheet');
      if (!sheet) {
        applyNeutral();
        return;
      }
      const { primary, secondary } = await extractPageContentPalette(sheet);
      if (cancelled || runId !== runIdRef.current) return;
      viewer.style.setProperty('--page-tint-primary', primary);
      viewer.style.setProperty('--page-tint-secondary', secondary);
    };

    const raf = requestAnimationFrame(() => {
      void runExtract().catch(() => {
        if (!cancelled && runId === runIdRef.current) applyNeutral();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, pageIndex, active]);
}
