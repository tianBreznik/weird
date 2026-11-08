import { describe, it, expect } from 'vitest';
import {
  DESKTOP_POLICY,
  MOBILE_POLICY,
  createPackerProfile,
  getPaginationPolicy,
} from './paginationPolicies.js';
import { resolvePackerProfile } from './packPages.js';

describe('paginationPolicies', () => {
  it('selects desktop vs mobile policy by viewport width', () => {
    expect(getPaginationPolicy(true).id).toBe('desktop');
    expect(getPaginationPolicy(false).id).toBe('mobile');
  });

  it('desktop keeps whole paragraphs when they already fit', () => {
    expect(DESKTOP_POLICY.preferKeepTogetherWhenFits).toBe(true);
    expect(
      DESKTOP_POLICY.shouldSplitWhenFits({
        remainingContentHeight: 40,
        overflowAmount: 12,
        element: { textContent: 'x'.repeat(80) },
        isStandaloneFirstPage: false,
        elementIndex: 0,
        elementsLength: 3,
      })
    ).toBe(false);
  });

  it('mobile keeps whole when fits and word-splits when overflowing', () => {
    expect(MOBILE_POLICY.preferKeepTogetherWhenFits).toBe(true);
    expect(MOBILE_POLICY.preferWordSplit).toBe(true);
    expect(MOBILE_POLICY.shouldSplitWhenFits({})).toBe(false);
    expect(
      MOBILE_POLICY.shouldAttemptSplitWhenOverflow({ remainingContentHeight: 40 })
    ).toBe(true);
    expect(
      MOBILE_POLICY.shouldAttemptSplitWhenOverflow({ remainingContentHeight: 10 })
    ).toBe(false);
  });

  it('desktop pushes awkward leftovers; mobile accepts word-fill splits', () => {
    const desktopAwkward = {
      firstPartRemainingSpace: 50,
      overflowAmount: 25,
      firstPartWordCount: 12,
      secondPartWordCount: 20,
      second: '<p>more</p>',
      fullElementFitsRelaxed: false,
    };
    const mobileFill = {
      firstPartRemainingSpace: 20,
      overflowAmount: 40,
      firstPartWordCount: 24,
      secondPartWordCount: 18,
      second: '<p>more</p>',
      fullElementFitsRelaxed: false,
    };
    const mobileScrap = {
      firstPartRemainingSpace: 90,
      overflowAmount: 40,
      firstPartWordCount: 1,
      secondPartWordCount: 20,
      second: '<p>more</p>',
      fullElementFitsRelaxed: false,
    };
    expect(DESKTOP_POLICY.decideAfterProposedSplit(desktopAwkward)).toBe('push-whole');
    expect(MOBILE_POLICY.decideAfterProposedSplit(mobileFill)).toBe('accept-split');
    expect(MOBILE_POLICY.decideAfterProposedSplit(mobileScrap)).toBe('push-whole');
    expect(
      MOBILE_POLICY.decideAfterProposedSplit({
        ...mobileFill,
        fullElementFitsRelaxed: true,
      })
    ).toBe('keep-whole');
  });

  it('createPackerProfile uses fixed sheet on desktop and viewport height on mobile', () => {
    const desktop = createPackerProfile({ width: 1200, viewportHeight: 800 });
    expect(desktop.mode).toBe('desktop');
    expect(desktop.pageWidth).toBe(450);
    expect(desktop.pageHeight).toBe(636);

    const mobile = createPackerProfile({ width: 390, viewportHeight: 720 });
    expect(mobile.mode).toBe('mobile');
    expect(mobile.pageHeight).toBe(720);
    expect(mobile.pageWidth).toBeUndefined();
  });

  it('resolvePackerProfile can force either mode', () => {
    expect(resolvePackerProfile('desktop').mode).toBe('desktop');
    expect(resolvePackerProfile('mobile', { viewportHeight: 640 }).pageHeight).toBe(640);
  });
});
