import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';

// Simple hash function (djb2)
const hashString = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

// Get canvas fingerprint
const getCanvasFingerprint = () => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    
    // Draw text with specific styling
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Overstimulata', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Device ID', 4, 17);
    
    // Get data URL and hash it
    return hashString(canvas.toDataURL());
  } catch (e) {
    return 'canvas-error';
  }
};

// Get WebGL fingerprint
const getWebGLFingerprint = () => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'no-debug-info';
    
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
    return hashString(vendor + renderer);
  } catch (e) {
    return 'webgl-error';
  }
};

// Generate device fingerprint from hardware/browser characteristics
const generateDeviceFingerprint = () => {
  const components = [
    // Screen characteristics
    screen.width,
    screen.height,
    screen.colorDepth,
    window.devicePixelRatio || 1,
    
    // Timezone
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date().getTimezoneOffset(),
    
    // Language and platform
    navigator.language,
    navigator.platform,
    
    // Hardware hints
    navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0,
    navigator.maxTouchPoints || 0,
    
    // Canvas fingerprint
    getCanvasFingerprint(),
    
    // WebGL fingerprint
    getWebGLFingerprint(),
  ];
  
  const fingerprintString = components.join('|');
  return 'fp-' + hashString(fingerprintString);
};

// Cached fingerprint (computed once per page load)
let cachedFingerprint = null;

// Generate or retrieve a unique device ID based on fingerprinting
export const getDeviceId = () => {
  if (cachedFingerprint) {
    return cachedFingerprint;
  }
  
  cachedFingerprint = generateDeviceFingerprint();
  return cachedFingerprint;
};

// Cache keys
const CACHE_KEY = 'overstimulata_editor_auth_cache';
const CACHE_TIMESTAMP_KEY = 'overstimulata_editor_auth_cache_timestamp';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Get cached authorization status
const getCachedAuth = () => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    
    if (cached && timestamp) {
      const age = Date.now() - parseInt(timestamp, 10);
      if (age < CACHE_DURATION) {
        return JSON.parse(cached);
      }
    }
  } catch (e) {
  }
  return null;
};

// Cache authorization status
export const setCachedAuth = (deviceId, isAuthorized) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ deviceId, isAuthorized }));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (e) {
  }
};

// Clear cache (force refresh on next check)
export const clearAuthCache = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
  } catch (e) {
  }
};

// Fetch whitelist from Firestore
const fetchWhitelistFromFirestore = async () => {
  try {
    const whitelistRef = collection(db, 'editorWhitelist');
    const snapshot = await getDocs(whitelistRef);
    const whitelist = snapshot.docs.map(doc => doc.id); // Use document ID as device ID
    return whitelist;
  } catch (error) {
    return null;
  }
};

// Check if device is in Firestore whitelist
const checkFirestoreWhitelist = async (deviceId) => {
  try {
    const deviceDoc = await getDoc(doc(db, 'editorWhitelist', deviceId));
    return deviceDoc.exists();
  } catch (error) {
    return false;
  }
};

// Check if current device is authorized as editor
// Uses cache first, then checks Firestore, with fallback to hardcoded list
export const isEditorDevice = async () => {
  const deviceId = getDeviceId();
  
  // Check cache first
  const cached = getCachedAuth();
  if (cached && cached.deviceId === deviceId) {
    return cached.isAuthorized;
  }
  
  // Check Firestore
  const isAuthorized = await checkFirestoreWhitelist(deviceId);
  
  // Cache the result
  setCachedAuth(deviceId, isAuthorized);
  
  return isAuthorized;
};

// Synchronous version that uses cache (for initial render)
export const isEditorDeviceSync = () => {
  const deviceId = getDeviceId();
  const cached = getCachedAuth();
  
  if (cached && cached.deviceId === deviceId) {
    return cached.isAuthorized;
  }
  
  // No fallback - fingerprint-based IDs are checked against Firestore only
  // Users with allowed emails will auto-whitelist on sign-in
  return false;
};

// Add a new device to Firestore whitelist
// SECURITY: This function will fail with client-side Firestore security rules
// Devices should only be added via Firebase Console or Admin SDK
// This function is kept for admin/internal use only
export const addDeviceToWhitelist = async (deviceId) => {
  try {
    await setDoc(doc(db, 'editorWhitelist', deviceId), {
      addedAt: new Date().toISOString(),
      deviceId: deviceId
    });
    
    // Update cache immediately
    setCachedAuth(deviceId, true);
    
    return true;
  } catch (error) {
    return false;
  }
};

// Refresh authorization status from Firestore
export const refreshAuthStatus = async () => {
  const deviceId = getDeviceId();
  const isAuthorized = await checkFirestoreWhitelist(deviceId);
  setCachedAuth(deviceId, isAuthorized);
  return isAuthorized;
};

