import { describe, it, expect } from 'vitest';
import {
  sortChapters,
  determineChapterIndex,
  createEmptyPage,
} from './paginationHelpers.js';

describe('paginationHelpers', () => {
  describe('sortChapters', () => {
    it('puts isFirstPage first, then isCover, then by order', () => {
      const chapters = [
        { id: 'c1', order: 100, isFirstPage: false, isCover: false },
        { id: 'cover', order: 0, isFirstPage: false, isCover: true },
        { id: 'first', order: 0, isFirstPage: true, isCover: false },
        { id: 'c2', order: 200, isFirstPage: false, isCover: false },
      ];
      const sorted = sortChapters(chapters);
      expect(sorted.map((c) => c.id)).toEqual(['first', 'cover', 'c1', 'c2']);
    });

    it('does not mutate input', () => {
      const chapters = [
        { id: 'c1', order: 200, isFirstPage: false, isCover: false },
        { id: 'c2', order: 100, isFirstPage: false, isCover: false },
      ];
      const sorted = sortChapters(chapters);
      expect(chapters[0].order).toBe(200);
      expect(sorted[0].id).toBe('c2');
    });
  });

  describe('determineChapterIndex', () => {
    it('returns -2 for isFirstPage', () => {
      expect(determineChapterIndex({ isFirstPage: true }, 0)).toBe(-2);
    });
    it('returns -1 for isCover', () => {
      expect(determineChapterIndex({ isCover: true }, 1)).toBe(-1);
    });
    it('returns order when present', () => {
      expect(determineChapterIndex({ order: 100 }, 2)).toBe(100);
    });
    it('returns chapterIdx when order undefined', () => {
      expect(determineChapterIndex({}, 3)).toBe(3);
    });
  });

  describe('createEmptyPage', () => {
    it('returns page object with chapter fields and empty content', () => {
      const chapter = {
        id: 'ch1',
        title: 'Empty Chapter',
        isFirstPage: false,
        isCover: true,
        pageBorder: true,
        pageBorderImageUrl: '/frame.png',
        backgroundImageUrl: '/bg.png',
      };
      const page = createEmptyPage(chapter, -1, 0, false);
      expect(page.chapterIndex).toBe(-1);
      expect(page.chapterId).toBe('ch1');
      expect(page.pageIndex).toBe(0);
      expect(page.content).toBe('');
      expect(page.hasBorder).toBe(true);
      expect(page.borderImageUrl).toBe('/frame.png');
      expect(page.backgroundImageUrl).toBe('/bg.png');
    });
  });
});
