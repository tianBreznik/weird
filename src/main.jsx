import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Generate canvas noise texture for background
const generateNoiseTexture = () => {
  const canvas = document.createElement('canvas');
  const size = 200; // Canvas size for grain texture
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return null;
  
  // Create image data
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  
  // Generate random noise
  for (let i = 0; i < data.length; i += 4) {
    const noise = Math.random() * 0.10; // lighter, more white noise
    data[i] = 0;     // R
    data[i + 1] = 0; // G
    data[i + 2] = 0; // B
    data[i + 3] = noise * 255; // A - opacity
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

// Apply texture to body::before
const applyTexture = () => {
  const texture = generateNoiseTexture();
  if (texture) {
    const style = document.createElement('style');
    style.textContent = `
      body::before {
        background-image: url(${texture});
        background-size: 100px 100px; /* Smaller size = smaller speckles */
        background-repeat: repeat;
        filter: blur(0.3px);
      }
    `;
    document.head.appendChild(style);
  }
};

// Apply texture when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyTexture);
} else {
  applyTexture();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
