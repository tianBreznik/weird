/** Deterministic left/right edge and offset for a sticky note, based on a string seed. */
export function getStickyNoteEdgePosition(seed) {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const edgeIndex = h % 2;           // 0 = left, 1 = right
  const offsetPercent = 10 + (h % 71); // 10–80 along the edge
  const edges = ['left', 'right'];
  return { edge: edges[edgeIndex], offsetPercent };
}

/** Position a sticky so one side is flush with the page edge and the rest hangs off. */
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
