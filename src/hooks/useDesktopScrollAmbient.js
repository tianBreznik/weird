import { useLayoutEffect } from 'react';

/**
 * Maps aperture scroll progress (0–1) to --scroll-ambient on the .pdf-viewer root.
 */
export function useDesktopScrollAmbient(scrollRef, active = true) {
  useLayoutEffect(() => {
    if (!active) return undefined;

    let scroller = null;
    let viewer = null;
    let raf = null;
    let pollId = null;

    const apply = () => {
      if (!scroller || !viewer) return;
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      const progress = Math.min(1, Math.max(0, scroller.scrollTop / max));
      viewer.style.setProperty('--scroll-ambient', String(progress));
      viewer.style.setProperty('--ambient-angle', `${118 + progress * 45}deg`);
    };

    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        apply();
      });
    };

    const attach = () => {
      scroller = scrollRef.current;
      if (!scroller) return false;
      viewer = scroller.closest('.pdf-viewer');
      if (!viewer) return false;
      apply();
      scroller.addEventListener('scroll', onScroll, { passive: true });
      return true;
    };

    if (!attach()) {
      let attempts = 0;
      pollId = window.setInterval(() => {
        attempts += 1;
        if (attach() || attempts > 40) {
          clearInterval(pollId);
          pollId = null;
        }
      }, 50);
    }

    return () => {
      if (pollId) clearInterval(pollId);
      if (raf !== null) cancelAnimationFrame(raf);
      if (scroller) scroller.removeEventListener('scroll', onScroll);
      if (viewer) {
        viewer.style.removeProperty('--scroll-ambient');
        viewer.style.removeProperty('--ambient-angle');
      }
    };
  }, [scrollRef, active]);
}
