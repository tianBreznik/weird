/**
 * Explicit desktop vs mobile pagination policies.
 *
 * Desktop = fixed PDF/sheet geometry (print-like keep-together).
 * Mobile  = Kindle full-screen viewport (fill the screen; splits are normal).
 *
 * Shared packer primitives (atomic blocks, sentence/word split, footnotes)
 * stay in elementPagination / paginationHelpers; only fit/split *policy* differs.
 */

import {
  DESKTOP_OVERFLOW_TOLERANCE,
  MOBILE_MIN_SPLIT_REMAINING_PX,
  MOBILE_OVERFLOW_TOLERANCE,
  getOverflowTolerance,
  getPageBox,
  isDesktopViewport,
  isOrphanSplit,
  isWidowSplit,
  SUBCHAPTER_FLOW_FREE_RATIO,
} from './pageGeometry';

/** @typedef {'keep-whole' | 'push-whole' | 'accept-split'} SplitDecision */

/**
 * @typedef {object} PaginationPolicy
 * @property {'desktop'|'mobile'} id
 * @property {boolean} isDesktop
 * @property {number} overflowTolerance
 * @property {boolean} preferKeepTogetherWhenFits — if elementFits, never split
 * @property {boolean} preferWordSplit — mobile: last fitting word cut; desktop: sentence-first
 * @property {number} subchapterFlowFreeRatio
 * @property {(ctx: object) => boolean} shouldSplitWhenFits
 * @property {(ctx: object) => boolean} shouldAttemptSplitWhenOverflow
 * @property {(ctx: object) => SplitDecision} decideAfterProposedSplit
 */

/** Desktop: fixed sheet — keep paragraphs whole when they nearly fit. */
export const DESKTOP_POLICY = /** @type {PaginationPolicy} */ ({
  id: 'desktop',
  isDesktop: true,
  overflowTolerance: DESKTOP_OVERFLOW_TOLERANCE,
  preferKeepTogetherWhenFits: true,
  preferWordSplit: false,
  subchapterFlowFreeRatio: SUBCHAPTER_FLOW_FREE_RATIO,

  shouldSplitWhenFits() {
    // Once checkElementFits said yes (with desktop tolerance), do not split.
    return false;
  },

  shouldAttemptSplitWhenOverflow({ remainingContentHeight, element }) {
    const elementTextLength = element.textContent?.length || 0;
    // Tiny leftover + long paragraph → push whole to next page instead of a fragment.
    if (remainingContentHeight < 20 && remainingContentHeight > 0 && elementTextLength > 200) {
      return false;
    }
    return remainingContentHeight > 0;
  },

  decideAfterProposedSplit({
    firstPartRemainingSpace: R,
    overflowAmount: O = 0,
    firstPartWordCount,
    secondPartWordCount,
    second,
    fullElementFitsRelaxed,
  }) {
    if (second && (isOrphanSplit(firstPartWordCount) || isWidowSplit(secondPartWordCount))) {
      return 'push-whole';
    }
    if (fullElementFitsRelaxed) {
      return 'keep-whole';
    }
    // Good fill band: use the split to pack the fixed sheet tighter.
    if (R >= 0 && R <= 40) {
      return 'accept-split';
    }
    if (R > 40 && O < 20) {
      return 'keep-whole';
    }
    if (R < 10 && isOrphanSplit(firstPartWordCount)) {
      return 'push-whole';
    }
    // Awkward geometry on a fixed sheet → don't leave a scrap; start fresh.
    return 'push-whole';
  },
});

/**
 * Mobile: one fill rule.
 * - If the block fits → keep it (never split-when-fits).
 * - If it overflows → word-split at the last cut that still fits (max fill).
 * - Accept that split unless the first fragment is empty/scrap or the whole
 *   block still fits under tolerance (margin-collapse).
 * No short-tail / nearly-full / overflowAmount stacks — those fought each other.
 */
export const MOBILE_POLICY = /** @type {PaginationPolicy} */ ({
  id: 'mobile',
  isDesktop: false,
  overflowTolerance: MOBILE_OVERFLOW_TOLERANCE,
  preferKeepTogetherWhenFits: true,
  preferWordSplit: true,
  subchapterFlowFreeRatio: SUBCHAPTER_FLOW_FREE_RATIO,

  shouldSplitWhenFits() {
    return false;
  },

  shouldAttemptSplitWhenOverflow({ remainingContentHeight }) {
    return remainingContentHeight >= MOBILE_MIN_SPLIT_REMAINING_PX;
  },

  decideAfterProposedSplit({
    fullElementFitsRelaxed,
    firstPartWordCount = 0,
  }) {
    if (fullElementFitsRelaxed) {
      return 'keep-whole';
    }
    // Only reject an empty/near-empty first fragment.
    if (firstPartWordCount > 0 && firstPartWordCount < 2) {
      return 'push-whole';
    }
    return 'accept-split';
  },
});

export function getPaginationPolicy(isDesktop = isDesktopViewport()) {
  return isDesktop ? DESKTOP_POLICY : MOBILE_POLICY;
}

/**
 * Resolve mode + page box + policy for a packer run.
 * Mobile height prefers visualViewport (iOS chrome).
 */
export function createPackerProfile(options = {}) {
  const {
    width = typeof window !== 'undefined' ? window.innerWidth : 1024,
    viewportHeight:
      explicitHeight,
  } = options;

  const isDesktop = isDesktopViewport(width);
  const policy = getPaginationPolicy(isDesktop);

  let viewportHeight = explicitHeight;
  if (viewportHeight == null && typeof window !== 'undefined') {
    viewportHeight = window.visualViewport?.height ?? window.innerHeight ?? 0;
  }

  const box = getPageBox(isDesktop, viewportHeight);

  return {
    mode: policy.id,
    policy,
    isDesktop,
    overflowTolerance: getOverflowTolerance(isDesktop),
    ...box,
    viewportHeight: viewportHeight ?? 0,
  };
}
