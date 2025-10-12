import { useState } from 'react';
import { useEditorMode } from '../hooks/useEditorMode';
import { addDeviceToWhitelist } from '../utils/deviceAuth';
import './EditorSetup.css';

export const EditorSetup = ({ onClose }) => {
  const { isEditor, deviceId } = useEditorMode();
  const [copied, setCopied] = useState(false);

  const handleCopyDeviceId = () => {
    navigator.clipboard.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddThisDevice = () => {
    addDeviceToWhitelist(deviceId);
    alert('Device added to whitelist! Please refresh the page.');
  };

  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="setup-header">
          <h2>Editor Setup</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="setup-content">
          <div className="status-section">
            <p className="label">Current Status:</p>
            <p className={`status ${isEditor ? 'editor' : 'reader'}`}>
              {isEditor ? '✓ Editor Mode Active' : '✗ Reader Mode'}
            </p>
          </div>

          <div className="device-section">
            <p className="label">Your Device ID:</p>
            <div className="device-id-display">
              <code>{deviceId}</code>
              <button onClick={handleCopyDeviceId} className="copy-btn">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="instructions">
            <h3>How to enable editor mode:</h3>
            <ol>
              <li>Copy your device ID above</li>
              <li>Add it to the EDITOR_DEVICE_WHITELIST in <code>src/utils/deviceAuth.js</code></li>
              <li>Refresh the page</li>
            </ol>
            
            <p className="note">
              <strong>Note:</strong> For testing, you can use the button below to temporarily add this device.
            </p>
            
            {!isEditor && (
              <button onClick={handleAddThisDevice} className="add-device-btn">
                Add This Device (Testing Only)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

