import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

/**
 * Converts an image file to base64 data URI with compression
 * Stores images directly in Firestore (no Firebase Storage billing)
 * @param {File} file - Image file to convert
 * @param {Object} options - Compression options
 * @param {number} options.maxWidth - Maximum width (default: 1200px)
 * @param {number} options.maxHeight - Maximum height (default: 1200px)
 * @param {number} options.quality - JPEG quality 0-1 (default: 0.8)
 * @returns {Promise<string>} Base64 data URI
 */
export async function convertImageToBase64(file, { maxWidth = 1200, maxHeight = 1200, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    // Check file size (Firestore limit is ~1MB per field, but we'll compress)
    if (file.size > 10 * 1024 * 1024) { // 10MB limit before compression
      reject(new Error('Image too large. Please use an image under 10MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }

        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to base64 JPEG (smaller than PNG)
        const dataUri = canvas.toDataURL('image/jpeg', quality);
        
        // Check final size (Firestore has ~1MB field limit)
        const base64Size = (dataUri.length * 3) / 4;
        if (base64Size > 900 * 1024) { // ~900KB to be safe
          reject(new Error('Image too large after compression. Please use a smaller image.'));
          return;
        }

        resolve(dataUri);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses an image file before upload
 * @param {File} file - Image file to compress
 * @param {Object} options - Compression options
 * @param {number} options.maxWidth - Maximum width (default: 1920px)
 * @param {number} options.maxHeight - Maximum height (default: 1920px)
 * @param {number} options.quality - JPEG quality 0-1 (default: 0.85)
 * @returns {Promise<Blob>} Compressed image blob
 */
async function compressImage(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image file to Firebase Storage
 * @param {File} file - Image file to upload
 * @param {Object} options - Upload options
 * @param {Function} options.onProgress - Progress callback (progress: number 0-100)
 * @param {boolean} options.compress - Whether to compress before upload (default: true)
 * @returns {Promise<string>} Download URL
 */
export async function uploadImageToStorage(file, { onProgress, compress = true } = {}) {
  try {
    // Compress image if requested
    const fileToUpload = compress
      ? await compressImage(file)
      : file;

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop() || 'jpg';
    const fileName = `images/${timestamp}_${randomId}.${extension}`;

    // Create storage reference
    const storageRef = ref(storage, fileName);

    // Upload file (convert Blob to File if needed)
    const fileForUpload = fileToUpload instanceof File 
      ? fileToUpload 
      : new File([fileToUpload], file.name, { type: fileToUpload.type || file.type });
    const uploadTask = uploadBytesResumable(storageRef, fileForUpload);

    // Set up progress tracking
    if (onProgress) {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          throw error;
        }
      );
    }

    // Wait for upload to complete
    const snapshot = await uploadTask;
    console.log('Image upload completed:', snapshot.metadata.fullPath);

    // Get download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('Image download URL:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('Image upload failed:', error);
    
    // Provide more helpful error messages
    if (error.code === 'storage/unauthorized' || error.code === 'storage/unknown') {
      throw new Error('Firebase Storage is not enabled or configured. Please enable Storage in your Firebase Console.');
    } else if (error.message?.includes('404') || error.code === 'storage/object-not-found') {
      throw new Error('Firebase Storage bucket not found. Please check your Firebase configuration and ensure Storage is enabled.');
    }
    
    throw new Error(`Failed to upload image: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Uploads a video file to Firebase Storage
 * @param {File} file - Video file to upload
 * @param {Object} options - Upload options
 * @param {Function} options.onProgress - Progress callback (progress: number 0-100)
 * @returns {Promise<string>} Download URL
 */
export async function uploadVideoToStorage(file, { onProgress } = {}) {
  try {
    // Check file size (e.g., 500MB limit)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      throw new Error(`Video file too large. Maximum size is ${maxSize / (1024 * 1024)}MB.`);
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const extension = file.name.split('.').pop() || 'mp4';
    const fileName = `videos/${timestamp}_${randomId}.${extension}`;

    // Create storage reference
    const storageRef = ref(storage, fileName);

    // Upload file
    const uploadTask = uploadBytesResumable(storageRef, file);

    // Set up progress tracking
    if (onProgress) {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress(progress);
        },
        (error) => {
          console.error('Upload error:', error);
          throw error;
        }
      );
    }

    // Wait for upload to complete
    const snapshot = await uploadTask;
    console.log('Video upload completed:', snapshot.metadata.fullPath);

    // Get download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log('Video download URL:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('Video upload failed:', error);
    
    // Provide more helpful error messages
    if (error.code === 'storage/unauthorized' || error.code === 'storage/unknown') {
      throw new Error('Firebase Storage is not enabled or configured. Please enable Storage in your Firebase Console.');
    } else if (error.message?.includes('404') || error.code === 'storage/object-not-found') {
      throw new Error('Firebase Storage bucket not found. Please check your Firebase configuration and ensure Storage is enabled.');
    }
    
    throw new Error(`Failed to upload video: ${error.message || 'Unknown error'}`);
  }
}


