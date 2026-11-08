/**
 * Dual pagination entry points.
 *
 * Desktop and mobile share atomic rules, split primitives, and footnote handling,
 * but use different policies + page geometry (fixed sheet vs Kindle viewport).
 *
 * The heavy packing loop currently lives in `usePagePagination`; these helpers
 * resolve the correct profile so that loop never invents platform rules inline.
 */

import { createMeasureContainer } from './paginationHelpers';
import {
  createPackerProfile,
  DESKTOP_POLICY,
  MOBILE_POLICY,
  getPaginationPolicy,
} from './paginationPolicies';

export { createPackerProfile, DESKTOP_POLICY, MOBILE_POLICY, getPaginationPolicy };

/**
 * @param {'desktop'|'mobile'|null|undefined} forcedMode
 * @param {{ width?: number, viewportHeight?: number }} [options]
 */
export function resolvePackerProfile(forcedMode = null, options = {}) {
  if (forcedMode === 'desktop') {
    return createPackerProfile({
      ...options,
      width: options.width ?? 1280,
    });
  }
  if (forcedMode === 'mobile') {
    return createPackerProfile({
      ...options,
      width: options.width ?? 390,
    });
  }
  return createPackerProfile(options);
}

/**
 * Build measure DOM + policy for one packer run.
 * Mobile measure height uses visualViewport when available.
 * Resolves a real contentWidth from the measure DOM so mobile never packs
 * with `width: undefinedpx` (which made measure narrower than the live page).
 */
export function beginPackerRun(forcedMode = null, options = {}) {
  const profile = resolvePackerProfile(forcedMode, options);
  const measure = createMeasureContainer(
    profile.isDesktop,
    profile.pageWidth,
    profile.pageHeight
  );
  // Force layout so clientWidth is real before the packing loop starts.
  void measure.container.offsetHeight;
  if (!profile.isDesktop) {
    measure.syncToLiveReader?.();
    void measure.container.offsetHeight;
  }
  const measuredWidth =
    measure.pageContent?.clientWidth ||
    measure.body?.clientWidth ||
    0;
  const contentWidth =
    profile.isDesktop
      ? (profile.contentWidth || measuredWidth)
      : (measuredWidth || profile.contentWidth || 0);
  return { ...profile, contentWidth, measure };
}
