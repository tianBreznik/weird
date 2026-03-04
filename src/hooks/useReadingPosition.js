import { useState } from 'react';
import { getBookmark, setBookmark } from '../utils/bookmark';

/**
 * Hook to manage reading position for page-based reading
 * Saves and restores: { chapterId, pageIndex, subchapterId? }
 */
function readSavedPosition() {
  const saved = getBookmark();
  if (!saved) return null;
  return {
    chapterId: saved.chapterId,
    pageIndex: saved.pageIndex || 0,
    subchapterId: saved.subchapterId || null,
  };
}

export const useReadingPosition = () => {
  // Read synchronously so the initial value is available on the very first render.
  const [position, setPosition] = useState(readSavedPosition);

  const savePosition = (newPosition) => {
    const positionData = {
      chapterId: newPosition.chapterId,
      pageIndex: newPosition.pageIndex || 0,
      subchapterId: newPosition.subchapterId || null,
    };
    setPosition(positionData);
    setBookmark(positionData);
  };

  return { position, savePosition };
};

