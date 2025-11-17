// Generate or retrieve a unique device ID
export const getDeviceId = () => {
  const DEVICE_ID_KEY = 'overstimulata_device_id';
  
  // Check if device ID already exists
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    // Generate a new unique device ID
    deviceId = generateUniqueId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  
  return deviceId;
};

// Generate a unique ID based on timestamp and random string
const generateUniqueId = () => {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomStr}`;
};

// Whitelist of approved editor device IDs
// TODO: Move this to environment variables or Firebase config for production
const EDITOR_DEVICE_WHITELIST = [
  // Add device IDs here
  // Example: 'abc123-xyz789',
  'mgjxds3q-1rekdb1eb7y',
  'mi1jtuuj-9x6z4uj4kh',
  'mi37kcqh-j4cmiln4r1l',
  'mi38utyt-9colfarywk7',
  'mi3iteoy-2j8voox4ec6',
  'mi3jjwma-qsglzpy5daa',
  'mi3lpncq-ioxx55731f',
];

// Check if current device is authorized as editor
export const isEditorDevice = () => {
  const deviceId = getDeviceId();
  return EDITOR_DEVICE_WHITELIST.includes(deviceId);
};

// Add a new device to whitelist (for testing - remove in production)
export const addDeviceToWhitelist = (deviceId) => {
  if (!EDITOR_DEVICE_WHITELIST.includes(deviceId)) {
    EDITOR_DEVICE_WHITELIST.push(deviceId);
    return true;
  }
  return false;
};

