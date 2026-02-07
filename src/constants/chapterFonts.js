/**
 * Per-chapter font options for the editor.
 * Subchapters inherit the font from their parent chapter.
 * Using system fonts for reliable measurement and rendering.
 */
export const CHAPTER_FONT_OPTIONS = [
  {
    value: "'Times New Roman', 'Times', 'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif",
    label: 'Times New Roman',
  },
  {
    value: "Georgia, 'Times New Roman', Times, serif",
    label: 'Georgia',
  },
  {
    value: "'Garamond', 'Baskerville', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif",
    label: 'Garamond',
  },
  {
    value: "'Baskerville', 'Baskerville Old Face', 'Garamond', 'Caslon', 'Hoefler Text', 'Minion Pro', 'Palatino', 'Georgia', serif",
    label: 'Baskerville',
  },
  {
    value: "'Palatino Linotype', 'Book Antiqua', Palatino, 'Times New Roman', Times, serif",
    label: 'Palatino',
  },
  {
    value: "Helvetica, Arial, 'Helvetica Neue', sans-serif",
    label: 'Helvetica',
  },
  {
    value: "Arial, Helvetica, 'Helvetica Neue', sans-serif",
    label: 'Arial',
  },
  {
    value: "Verdana, Geneva, sans-serif",
    label: 'Verdana',
  },
  {
    value: "'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', sans-serif",
    label: 'Trebuchet MS',
  },
  {
    value: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
    label: 'Segoe UI',
  },
];

export const DEFAULT_CHAPTER_FONT = CHAPTER_FONT_OPTIONS[0].value;
