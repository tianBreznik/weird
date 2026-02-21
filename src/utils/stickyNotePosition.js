/**
 * Stable "random" position along the LEFT or RIGHT edge of a page for sticky note overlay.
 * Given a seed string, returns the same edge and offset every time (for consistent rendering).
 * @param {string} seed - e.g. `${chapterId}-${pageIndex}-${noteIndex}`
 * @returns {{ edge: 'left'|'right', offsetPercent: number }} offsetPercent 10–80 along the vertical edge (from top)
 */
export function getStickyNoteEdgePosition(seed) {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const edgeIndex = h % 2; // 0 = left, 1 = right only
  const offsetPercent = 10 + (h % 71); // 10–80 along the edge
  const edges = ['left', 'right'];
  return { edge: edges[edgeIndex], offsetPercent };
}

/**
 * CSS style object to position a sticky note on the left or right edge so one side is
 * flush with the page (the "glue" side) and the rest hangs off the page.
 * - Left edge: sticky's right side touches the page; sticky extends off to the left.
 * - Right edge: sticky's left side touches the page; sticky extends off to the right.
 * @param {string} seed - same as getStickyNoteEdgePosition
 * @param {number} sizePx - max width/height of the sticky image (e.g. 72)
 */
export function getStickyNoteStyle(seed, sizePx = 72) {
  const { edge, offsetPercent } = getStickyNoteEdgePosition(seed);
  const base = {
    position: 'absolute',
    zIndex: 2,
    pointerEvents: 'none',
    maxWidth: sizePx,
    maxHeight: sizePx,
    objectFit: 'contain',
  };
  // Stuck to edge: one side flush with page, other side hanging off
  if (edge === 'left') {
    // Right edge of sticky on page boundary; sticky hangs off to the left
    return { ...base, left: 0, top: `${offsetPercent}%`, transform: 'translateX(-80%)' };
  }
  // Left edge of sticky on page boundary; sticky hangs off to the right
  return { ...base, right: 0, top: `${offsetPercent}%`, transform: 'translateX(80%)' };
}
