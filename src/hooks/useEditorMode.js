import { useState, useEffect, useCallback } from 'react';
import { getDeviceId, isEditorDevice } from '../utils/deviceAuth';

const OVERRIDE_KEY = 'overstimulata_reader_preview';

const sharedState = {
  deviceId: null,
  baseEditor: null,
  forceReaderPreview: false,
  subscribers: new Set(),
};

const ensureInitialised = () => {
  if (sharedState.baseEditor !== null) return;

  const deviceId = getDeviceId();
  const baseEditor = isEditorDevice();
  const stored = localStorage.getItem(OVERRIDE_KEY);
  const forceReaderPreview = baseEditor ? stored === 'reader' : false;

  sharedState.deviceId = deviceId;
  sharedState.baseEditor = baseEditor;
  sharedState.forceReaderPreview = forceReaderPreview;
};

const notify = () => {
  const payload = {
    deviceId: sharedState.deviceId,
    baseEditor: sharedState.baseEditor,
    previewingAsReader: sharedState.baseEditor && sharedState.forceReaderPreview,
    isEditor: sharedState.baseEditor && !sharedState.forceReaderPreview,
  };
  sharedState.subscribers.forEach((cb) => cb(payload));
};

const setPreviewState = (forceReader) => {
  if (!sharedState.baseEditor) {
    sharedState.forceReaderPreview = false;
  } else {
    sharedState.forceReaderPreview = forceReader;
    if (forceReader) {
      localStorage.setItem(OVERRIDE_KEY, 'reader');
    } else {
      localStorage.removeItem(OVERRIDE_KEY);
    }
  }
  notify();
};

export const useEditorMode = () => {
  ensureInitialised();

  const [state, setState] = useState(() => ({
    deviceId: sharedState.deviceId,
    baseEditor: sharedState.baseEditor,
    previewingAsReader: sharedState.baseEditor && sharedState.forceReaderPreview,
    isEditor: sharedState.baseEditor && !sharedState.forceReaderPreview,
  }));

  useEffect(() => {
    const subscriber = (payload) => setState(payload);
    sharedState.subscribers.add(subscriber);
    // Sync immediately with current state
    subscriber({
      deviceId: sharedState.deviceId,
      baseEditor: sharedState.baseEditor,
      previewingAsReader: sharedState.baseEditor && sharedState.forceReaderPreview,
      isEditor: sharedState.baseEditor && !sharedState.forceReaderPreview,
    });
    return () => {
      sharedState.subscribers.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('reader-preview', state.previewingAsReader);
  }, [state.previewingAsReader]);

  const togglePreviewMode = useCallback(() => {
    if (!sharedState.baseEditor) return;
    setPreviewState(!sharedState.forceReaderPreview);
  }, []);

  return {
    isEditor: state.isEditor,
    deviceId: state.deviceId,
    canToggleEditorMode: state.baseEditor,
    previewingAsReader: state.previewingAsReader,
    togglePreviewMode,
  };
};

