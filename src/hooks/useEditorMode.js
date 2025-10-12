import { useState, useEffect } from 'react';
import { getDeviceId, isEditorDevice } from '../utils/deviceAuth';

export const useEditorMode = () => {
  const [isEditor, setIsEditor] = useState(false);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    const currentDeviceId = getDeviceId();
    const editorStatus = isEditorDevice();
    
    setDeviceId(currentDeviceId);
    setIsEditor(editorStatus);
    
    console.log('Device ID:', currentDeviceId);
    console.log('Editor Mode:', editorStatus);
  }, []);

  return { isEditor, deviceId };
};

