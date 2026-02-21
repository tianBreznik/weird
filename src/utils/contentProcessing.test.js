import { describe, it, expect } from 'vitest';
import { buildChapterContentBlocks, extractVideosFromContent } from './contentProcessing.js';

describe('contentProcessing', () => {
  describe('buildChapterContentBlocks', () => {
    it('returns one block for chapter with contentHtml', () => {
      const chapter = {
        id: 'ch1',
        title: 'Chapter One',
        contentHtml: '<p>Hello</p>',
        content: '<p>Hello</p>',
      };
      const blocks = buildChapterContentBlocks(chapter);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('chapter');
      expect(blocks[0].chapterId).toBe('ch1');
      expect(blocks[0].content).toContain('<p>Hello</p>');
    });

    it('preserves TipTap FontSize spans in block content', () => {
      const htmlWithFontSize =
        '<p>Normal and <span style="font-size: 12px !important; line-height: 1.1 !important">small</span> text.</p>';
      const chapter = {
        id: 'ch1',
        title: 'Font Test',
        contentHtml: htmlWithFontSize,
        content: htmlWithFontSize,
      };
      const blocks = buildChapterContentBlocks(chapter);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toContain('font-size');
      expect(blocks[0].content).toContain('12px');
      expect(blocks[0].content).toContain('small');
    });

    it('preserves inline color and highlight in block content', () => {
      const html =
        '<p><span style="color: red">red</span> and <mark style="background-color: yellow">highlight</mark></p>';
      const chapter = {
        id: 'ch1',
        title: 'Colors',
        contentHtml: html,
        content: html,
      };
      const blocks = buildChapterContentBlocks(chapter);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toContain('color: red');
      expect(blocks[0].content).toContain('background-color: yellow');
    });

    it('includes subchapters and inherits fontFamily', () => {
      const chapter = {
        id: 'ch1',
        title: 'Parent',
        contentHtml: '<p>Intro</p>',
        fontFamily: 'Georgia, serif',
        children: [
          {
            id: 'sub1',
            title: 'Sub One',
            contentHtml: '<p>Sub content</p>',
          },
        ],
      };
      const blocks = buildChapterContentBlocks(chapter);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('chapter');
      expect(blocks[0].fontFamily).toBe('Georgia, serif');
      expect(blocks[1].type).toBe('subchapter');
      expect(blocks[1].subchapterId).toBe('sub1');
      expect(blocks[1].fontFamily).toBe('Georgia, serif');
    });

    it('prepends h4 when subchapter has title but no h4 in content', () => {
      const chapter = {
        id: 'ch1',
        title: 'Parent',
        contentHtml: '',
        children: [
          {
            id: 'sub1',
            title: 'My Subchapter',
            contentHtml: '<p>Only paragraph</p>',
          },
        ],
      };
      const blocks = buildChapterContentBlocks(chapter);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].content).toMatch(/<h4[^>]*>[\s\S]*My Subchapter[\s\S]*<\/h4>/i);
      expect(blocks[0].content).toContain('<p>Only paragraph</p>');
    });
  });

  describe('extractVideosFromContent', () => {
    it('extracts blank-page videos and removes them from htmlContent', () => {
      const html =
        '<p>Before</p><video src="/x.mp4" data-video-mode="blank-page"></video><p>After</p>';
      const { videoElements, htmlContent } = extractVideosFromContent(html);
      expect(videoElements).toHaveLength(1);
      expect(videoElements[0].src).toBe('/x.mp4');
      expect(videoElements[0].mode).toBe('blank-page');
      expect(htmlContent).not.toContain('<video');
      expect(htmlContent).toContain('Before');
      expect(htmlContent).toContain('After');
    });

    it('removes background videos from htmlContent but does not add to videoElements', () => {
      const html = '<p>Text</p><video src="/bg.mp4" data-video-mode="background"></video>';
      const { videoElements, htmlContent } = extractVideosFromContent(html);
      expect(videoElements).toHaveLength(0);
      expect(htmlContent).not.toContain('<video');
    });
  });
});
