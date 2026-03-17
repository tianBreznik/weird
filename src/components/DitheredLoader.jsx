import { useEffect, useRef, useState } from 'react';
import './DitheredLoader.css';

// Shape noise only: fixed threshold, noise perturbs the line contours over time
const EDGE_ANIMATION = {
  speed: 0.04,
  threshold: 0.18,
  shapeNoiseAmount: 0.12,
  // Spatial scale of noise in pixels (higher = more structural, less speckly). e.g. 6–12
  noiseScale: 8,
};

// When true, skip the edge/dither pipeline and show just the simple
// "Loading..." label drawn directly to the canvas (same style as img.onerror).
const SIMPLE_LOADING_LABEL = true;

export const DitheredLoader = ({ active = true, inline = false }) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const sparkleCanvasRef = useRef(null);
  const labelCanvasRef = useRef(null);
  const imageRef = useRef(null);
  const sparkleAnimationRef = useRef(null);
  const ditherDataRef = useRef(null); // Store dithered image data for influence map
  const pixelScaleRef = useRef(2); // Downscale factor used for edge image (for sparkle alignment)
  const edgeCanvasRef = useRef(null); // Small canvas for edge map
  const edgeStrengthRef = useRef(null); // { data: Float32Array(nms), maxMag, w, h } for threshold animation
  // Extra refs for JS-driven pixel melt
  const originalImageDataRef = useRef(null);
  const pixelIndicesRef = useRef(null);
  const dissolveAnimationRef = useRef(null);
  const dissolveProgressRef = useRef(0);
  const noiseAnimationRef = useRef(null);
  const edgeDriftAnimationRef = useRef(null);
  const labelAnimationRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isDissolving, setIsDissolving] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const getSize = () => {
      if (inline && containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        return { w: w > 0 ? w : window.innerWidth, h: h > 0 ? h : window.innerHeight };
      }
      return { w: window.innerWidth, h: window.innerHeight };
    };

    const resizeCanvas = () => {
      const { w, h } = getSize();
      canvas.width = w;
      canvas.height = h;
      // Keep label canvas in sync so text is positioned correctly
      if (labelCanvasRef.current) {
        labelCanvasRef.current.width = w;
        labelCanvasRef.current.height = h;
      }
    };

    if (!inline) {
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);
    }

    const img = new Image();
    img.src = '/ditherfirst.jpg';

    const runPipeline = () => {
      const w = canvas.width;
      const h = canvas.height;
      if (w <= 0 || h <= 0) return;

      // Simple label-only mode (inline desktop): draw white background + \"Loading attachments...\" text and skip
      if (SIMPLE_LOADING_LABEL && inline) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff0000';
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Loading attachments...', w / 2, h / 2);
        return;
      }

      imageRef.current = img;
      ctx.drawImage(img, 0, 0, w, h);

      // Build edge-detected, pixelated loader from local image

      // Downscale for cheaper processing; milder = less pixelated (finer blocks)
      const scale = 1.2;
      pixelScaleRef.current = scale;
      const sw = Math.max(1, Math.floor(w / scale));
      const sh = Math.max(1, Math.floor(h / scale));
      const small = document.createElement('canvas');
      small.width = sw;
      small.height = sh;
      const sctx = small.getContext('2d');
      sctx.drawImage(canvas, 0, 0, sw, sh);

      // 1) Grayscale on small canvas + light Gaussian blur to suppress noise
      let imageData = sctx.getImageData(0, 0, sw, sh);
      const src = imageData.data;
      for (let i = 0; i < src.length; i += 4) {
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        src[i] = src[i + 1] = src[i + 2] = gray;
      }

      // 1b) Simple 3x3 Gaussian blur on grayscale buffer to reduce speckle
      const blurKernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
      const blurDiv = 16;
      const blurred = new Uint8ClampedArray(src.length);
      const getGraySmall = (x, y) => {
        if (x < 0 || x >= sw || y < 0 || y >= sh) return 0;
        const idx = (y * sw + x) * 4;
        return src[idx];
      };
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          let acc = 0;
          let k = 0;
          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              acc += getGraySmall(x + kx, y + ky) * blurKernel[k];
              k += 1;
            }
          }
          const g = acc / blurDiv;
          const idx = (y * sw + x) * 4;
          blurred[idx] = blurred[idx + 1] = blurred[idx + 2] = g;
          blurred[idx + 3] = 255;
        }
      }

      // 2) Canny-like edge detection on small canvas
      const edgeImageData = sctx.createImageData(sw, sh);
      const dst = edgeImageData.data;
      const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
      const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

      const getGray = (x, y) => {
        if (x < 0 || x >= sw || y < 0 || y >= sh) return 0;
        const idx = (y * sw + x) * 4;
        return blurred[idx];
      };

      const magBuf = new Float32Array(sw * sh);
      const dirBuf = new Float32Array(sw * sh);

      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          let gx = 0;
          let gy = 0;
          let k = 0;
          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              const g = getGray(x + kx, y + ky);
              gx += g * sobelX[k];
              gy += g * sobelY[k];
              k += 1;
            }
          }
          const mag = Math.sqrt(gx * gx + gy * gy);
          const angle = Math.atan2(gy, gx); // -pi..pi
          const idx = y * sw + x;
          magBuf[idx] = mag;
          dirBuf[idx] = angle;
        }
      }

      // 3) Non-maximum suppression (very simple)
      const nmsBuf = new Float32Array(sw * sh);
      const dirToBin = (angle) => {
        const a = (angle * 180) / Math.PI;
        const deg = (a < 0 ? a + 180 : a);
        if ((deg >= 0 && deg < 22.5) || (deg >= 157.5 && deg < 180)) return 0; // 0°
        if (deg >= 22.5 && deg < 67.5) return 45;
        if (deg >= 67.5 && deg < 112.5) return 90;
        return 135;
      };

      for (let y = 1; y < sh - 1; y += 1) {
        for (let x = 1; x < sw - 1; x += 1) {
          const idx = y * sw + x;
          const mag = magBuf[idx];
          const bin = dirToBin(dirBuf[idx]);
          let m1 = 0;
          let m2 = 0;
          if (bin === 0) {
            m1 = magBuf[idx - 1];
            m2 = magBuf[idx + 1];
          } else if (bin === 45) {
            m1 = magBuf[idx - sw + 1];
            m2 = magBuf[idx + sw - 1];
          } else if (bin === 90) {
            m1 = magBuf[idx - sw];
            m2 = magBuf[idx + sw];
          } else {
            m1 = magBuf[idx - sw - 1];
            m2 = magBuf[idx + sw + 1];
          }
          nmsBuf[idx] = mag >= m1 && mag >= m2 ? mag : 0;
        }
      }

      // 4) Store edge strength for threshold animation (before hysteresis)
      let maxMag = 0;
      for (let i = 0; i < nmsBuf.length; i += 1) {
        if (nmsBuf[i] > maxMag) maxMag = nmsBuf[i];
      }
      edgeStrengthRef.current = { data: new Float32Array(nmsBuf), maxMag, w: sw, h: sh };

      // 5) Hysteresis thresholding for initial binary edge map
      const high = maxMag * 0.2;
      const low = high * 0.45;
      const strong = 255;
      const weak = 75;
      const edgeMap = new Uint8Array(sw * sh);

      for (let i = 0; i < nmsBuf.length; i += 1) {
        const v = nmsBuf[i];
        if (v >= high) edgeMap[i] = strong;
        else if (v >= low) edgeMap[i] = weak;
        else edgeMap[i] = 0;
      }

      // Promote weak pixels connected to strong pixels
      const index = (x, y) => y * sw + x;
      for (let y = 1; y < sh - 1; y += 1) {
        for (let x = 1; x < sw - 1; x += 1) {
          const i = index(x, y);
          if (edgeMap[i] !== weak) continue;
          let hasStrong = false;
          for (let oy = -1; oy <= 1 && !hasStrong; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              if (ox === 0 && oy === 0) continue;
              const j = index(x + ox, y + oy);
              if (edgeMap[j] === strong) {
                hasStrong = true;
                break;
              }
            }
          }
          edgeMap[i] = hasStrong ? strong : 0;
        }
      }

      // Write edge map into small canvas as black edges on white
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const i = y * sw + x;
          const o = i * 4;
          const isEdge = edgeMap[i] === strong;
          const val = isEdge ? 0 : 255;
          dst[o] = dst[o + 1] = dst[o + 2] = val;
          dst[o + 3] = 255;
        }
      }
      sctx.putImageData(edgeImageData, 0, 0);
      edgeCanvasRef.current = small;

      // Upscale to full canvas with nearest-neighbor for pixelated look
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, w, h);

      // Use final edge image as working data
      imageData = ctx.getImageData(0, 0, w, h);

      // Store processed data for sparkle influence map and dissolve.
      const dataCopy = new Uint8ClampedArray(imageData.data);
      ditherDataRef.current = {
        data: dataCopy,
        width: canvas.width,
        height: canvas.height
      };
      // Pre-warm an ImageData instance so the dissolve doesn't need to call
      // getImageData again on first frame.
      originalImageDataRef.current = {
        imageData: new ImageData(dataCopy, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height
      };

      // Precompute a shuffled list of pixel "seed" indices once for dissolve.
      // Use a stride so we don't track every single pixel; each seed will clear
      // a small 2x2 block, making the effect chunkier and lighter.
      const pixelCount = canvas.width * canvas.height;
      const stride = 4; // sample every 4th pixel
      const indices = [];
      for (let i = 0; i < pixelCount; i += stride) {
        indices.push(i);
      }
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      pixelIndicesRef.current = indices;
    };

    img.onload = () => {
      if (inline) {
        resizeCanvas();
        if (canvas.width > 0 && canvas.height > 0) runPipeline();
      } else {
        runPipeline();
      }
    };

    let ro = null;
    if (inline && containerRef.current) {
      ro = new ResizeObserver(() => {
        resizeCanvas();
        if (imageRef.current && canvas.width > 0 && canvas.height > 0) runPipeline();
      });
      ro.observe(containerRef.current);
      resizeCanvas();
      if (canvas.width > 0 && canvas.height > 0 && imageRef.current) runPipeline();
    }

    img.onerror = () => {
      // Fallback if image fails to load
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.font = '16px serif';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
    };

    return () => {
      if (!inline) window.removeEventListener('resize', resizeCanvas);
      if (ro && containerRef.current) ro.disconnect();
      if (sparkleAnimationRef.current) cancelAnimationFrame(sparkleAnimationRef.current);
      if (dissolveAnimationRef.current) { cancelAnimationFrame(dissolveAnimationRef.current); dissolveAnimationRef.current = null; }
      if (noiseAnimationRef.current) { cancelAnimationFrame(noiseAnimationRef.current); noiseAnimationRef.current = null; }
      if (edgeDriftAnimationRef.current) { cancelAnimationFrame(edgeDriftAnimationRef.current); edgeDriftAnimationRef.current = null; }
      if (labelAnimationRef.current) { cancelAnimationFrame(labelAnimationRef.current); labelAnimationRef.current = null; }
    };
  }, [inline]);

  // Animate the three dots in "Loading attachments..." when using SIMPLE_LOADING_LABEL.
  useEffect(() => {
    if (!SIMPLE_LOADING_LABEL) return;
    // Desktop inline: draw label directly into the main canvas.
    // Mobile (full-screen): draw label into the overlay label canvas.
    const canvas = inline ? canvasRef.current : labelCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const animateLabel = () => {
      if (!active) {
        labelAnimationRef.current = null;
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      if (w <= 0 || h <= 0) {
        labelAnimationRef.current = requestAnimationFrame(animateLabel);
        return;
      }

      const dots = (Math.floor(frame / 30) % 4); // 0..3 dots, change slowly
      const text = `Loading attachments${'.'.repeat(dots)}`;

      // Clear previous text (transparent) and redraw
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ff0000';
      // Desktop inline: larger, classic serif; Mobile: slightly smaller, crisp sans-serif
      ctx.font = inline ? '16px serif' : '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);

      frame += 1;
      labelAnimationRef.current = requestAnimationFrame(animateLabel);
    };

    if (active && !labelAnimationRef.current) {
      labelAnimationRef.current = requestAnimationFrame(animateLabel);
    }

    return () => {
      if (labelAnimationRef.current) {
        cancelAnimationFrame(labelAnimationRef.current);
        labelAnimationRef.current = null;
      }
    };
  }, [active, inline]);

  // Edge threshold animation — lines come in and out of existence as threshold moves
  useEffect(() => {
    // In simple label-only inline mode we skip the edge animation; on mobile we can keep it
    if (SIMPLE_LOADING_LABEL && inline) return;
    const canvas = canvasRef.current;
    if (!canvas || !active || isDissolving) {
      if (edgeDriftAnimationRef.current) {
        cancelAnimationFrame(edgeDriftAnimationRef.current);
        edgeDriftAnimationRef.current = null;
      }
      return;
    }

    let frame = 0;
    const animateThreshold = () => {
      if (!active || isDissolving) {
        edgeDriftAnimationRef.current = null;
        return;
      }
      const strength = edgeStrengthRef.current;
      const edgeCanvas = edgeCanvasRef.current;
      if (!strength || !edgeCanvas) {
        edgeDriftAnimationRef.current = requestAnimationFrame(animateThreshold);
        return;
      }
      const { data: nms, maxMag, w: sw, h: sh } = strength;
      const t = frame * EDGE_ANIMATION.speed;
      const shapeNoise = EDGE_ANIMATION.shapeNoiseAmount ?? 0;
      const threshBase = maxMag * (EDGE_ANIMATION.threshold ?? 0.18);
      const ti = Math.floor(t);
      const tf = t - ti;
      const scale = Math.max(1, EDGE_ANIMATION.noiseScale ?? 8);
      const hash = (ix, iy, z) => {
        let n = (ix * 374761393) ^ (iy * 668265263) ^ (z * 1274126177);
        n = (n ^ (n >> 13)) * 1274126177;
        n = (n ^ (n >> 16)) >>> 0;
        return n / 4294967295;
      };
      const smoothNoise = (x, y) => {
        const sx = x / scale;
        const sy = y / scale;
        const ix0 = Math.floor(sx);
        const iy0 = Math.floor(sy);
        const fx = sx - ix0;
        const fy = sy - iy0;
        const n00 = hash(ix0, iy0, ti) + tf * (hash(ix0, iy0, ti + 1) - hash(ix0, iy0, ti));
        const n10 = hash(ix0 + 1, iy0, ti) + tf * (hash(ix0 + 1, iy0, ti + 1) - hash(ix0 + 1, iy0, ti));
        const n01 = hash(ix0, iy0 + 1, ti) + tf * (hash(ix0, iy0 + 1, ti + 1) - hash(ix0, iy0 + 1, ti));
        const n11 = hash(ix0 + 1, iy0 + 1, ti) + tf * (hash(ix0 + 1, iy0 + 1, ti + 1) - hash(ix0 + 1, iy0 + 1, ti));
        const nx0 = n00 + fx * (n10 - n00);
        const nx1 = n01 + fx * (n11 - n01);
        return nx0 + fy * (nx1 - nx0);
      };
      const sctx = edgeCanvas.getContext('2d');
      const imgData = sctx.createImageData(sw, sh);
      const d = imgData.data;
      for (let i = 0; i < nms.length; i += 1) {
        const x = i % sw;
        const y = (i / sw) | 0;
        const noise01 = smoothNoise(x, y);
        const offset = shapeNoise * (noise01 - 0.5) * maxMag * 0.25;
        const threshHere = threshBase + offset;
        const v = nms[i] >= threshHere ? 0 : 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
      sctx.putImageData(imgData, 0, 0);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(edgeCanvas, 0, 0, sw, sh, 0, 0, w, h);
      frame += 1;
      edgeDriftAnimationRef.current = requestAnimationFrame(animateThreshold);
    };

    edgeDriftAnimationRef.current = requestAnimationFrame(animateThreshold);
    return () => {
      if (edgeDriftAnimationRef.current) {
        cancelAnimationFrame(edgeDriftAnimationRef.current);
        edgeDriftAnimationRef.current = null;
      }
    };
  }, [active, isDissolving]);

  // White-area noise effect (skipped when edge drift is used)
  useEffect(() => {
    // In simple label-only inline mode we don't use noise; on mobile we can keep it
    if (SIMPLE_LOADING_LABEL && inline) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (edgeCanvasRef.current) return; // Use drift animation instead

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!active || isDissolving) {
      if (noiseAnimationRef.current) {
        cancelAnimationFrame(noiseAnimationRef.current);
        noiseAnimationRef.current = null;
      }
      return;
    }

    let frame = 0;
    let baseCopy = null;
    let width = 0;
    let height = 0;

    const amplitude = 45;
    const holdFrames = 10;

    const hash2 = (x, y, t) => {
      let n = (x * 374761393) ^ (y * 668265263) ^ (t * 1274126177);
      n = (n ^ (n >> 13)) * 1274126177;
      n = (n ^ (n >> 16)) >>> 0;
      return n / 4294967295;
    };

    const animateNoise = () => {
      if (!active || isDissolving) {
        noiseAnimationRef.current = null;
        return;
      }
      // Once edge canvas exists, drift animation takes over — stop noise so drift is visible
      if (edgeCanvasRef.current) {
        noiseAnimationRef.current = null;
        return;
      }

      if (!ditherDataRef.current) {
        noiseAnimationRef.current = requestAnimationFrame(animateNoise);
        return;
      }

      if (!baseCopy) {
        const { data, width: w, height: h } = ditherDataRef.current;
        baseCopy = new Uint8ClampedArray(data);
        width = w;
        height = h;
      }

      const img = ctx.getImageData(0, 0, width, height);
      const d = img.data;
      d.set(baseCopy);

      const tBucket = Math.floor(frame / holdFrames);
      const tFrac = (frame % holdFrames) / holdFrames;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const di = idx * 4;
          const baseVal = baseCopy[di];

          // Only operate on black pixels; keep them black and opaque (no gray).
          if (baseVal === 0) {
            const n0 = hash2(x, y, tBucket);
            const n1 = hash2(x, y, tBucket + 1);
            const n = n0 + tFrac * (n1 - n0);
            d[di] = 0;
            d[di + 1] = 0;
            d[di + 2] = 0;
            d[di + 3] = 255;
          }
        }
      }

      ctx.putImageData(img, 0, 0);
      frame += 1;
      noiseAnimationRef.current = requestAnimationFrame(animateNoise);
    };

    noiseAnimationRef.current = requestAnimationFrame(animateNoise);

    return () => {
      if (noiseAnimationRef.current) {
        cancelAnimationFrame(noiseAnimationRef.current);
        noiseAnimationRef.current = null;
      }
    };
  }, [active, isDissolving]);

  // Sparkle effect - random black blocks appearing and disappearing (temporarily disabled)
  const sparklesEnabled = false;
  useEffect(() => {
    if (!sparklesEnabled) return;
    const sparkleCanvas = sparkleCanvasRef.current;
    if (!sparkleCanvas) return;

    const sparkleCtx = sparkleCanvas.getContext('2d');
    if (!sparkleCtx) return;

    const resizeSparkleCanvas = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Only resize if dimensions changed to avoid clearing canvas unnecessarily
      if (sparkleCanvas.width !== width || sparkleCanvas.height !== height) {
        sparkleCanvas.width = width;
        sparkleCanvas.height = height;
      }
    };
    resizeSparkleCanvas();
    window.addEventListener('resize', resizeSparkleCanvas);

    // Helper function to sample dither pattern at a position
    const sampleDitherPattern = (x, y) => {
      if (!ditherDataRef.current) return 0; // No dither data yet
      
      const { data, width, height } = ditherDataRef.current;
      const px = Math.floor(x);
      const py = Math.floor(y);
      
      if (px < 0 || px >= width || py < 0 || py >= height) return 0;
      
      const index = (py * width + px) * 4;
      // Get luminance (since it's black/white, any channel works)
      const luminance = data[index]; // R channel (0 = black, 255 = white)
      return luminance / 255; // Normalize to 0-1
    };

    let animationRunning = true;
    let sparkles = [];

    const createSparkles = () => {
      if (!ditherDataRef.current) return; // Wait for dither data
      const scale = pixelScaleRef.current || 1.5;
      const w = sparkleCanvas.width;
      const h = sparkleCanvas.height;
      const gridW = Math.max(1, Math.floor(w / scale));
      const gridH = Math.max(1, Math.floor(h / scale));
      // Fewer sparkles; each is exactly one block (scale×scale) so they match edge pixelation
      const sparkleCount = 1200;
      sparkles = [];
      let attempts = 0;
      const maxAttempts = sparkleCount * 8;
      const used = new Set(); // avoid duplicate cells
      while (sparkles.length < sparkleCount && attempts < maxAttempts) {
        attempts++;
        const gx = Math.floor(Math.random() * gridW);
        const gy = Math.floor(Math.random() * gridH);
        const key = `${gx},${gy}`;
        if (used.has(key)) continue;
        const x = gx * scale + scale * 0.5;
        const y = gy * scale + scale * 0.5;
        const ditherValue = sampleDitherPattern(x, y);
        const placementProbability = ditherValue * 0.6 + 0.2;
        if (Math.random() < placementProbability) {
          used.add(key);
          sparkles.push({
            gx,
            gy,
            scale,
            baseOpacity: ditherValue * 0.35 + 0.3,
            opacity: Math.random(),
            speed: Math.random() * 0.12 + 0.08,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    };

    const animateSparkles = () => {
      if (!animationRunning) return;

      // Clear canvas
      sparkleCtx.clearRect(0, 0, sparkleCanvas.width, sparkleCanvas.height);
      
      // Draw each sparkle as one grid-aligned block (same pixelation as edge image)
      sparkles.forEach((sparkle) => {
        const sineOpacity = (Math.sin(sparkle.phase) + 1) / 2;
        sparkle.opacity = sineOpacity * sparkle.baseOpacity;
        sparkle.phase += sparkle.speed;
        if (sparkle.phase > Math.PI * 2) sparkle.phase -= Math.PI * 2;

        if (sparkle.opacity <= 0.05) return;
        const s = sparkle.scale;
        const x = sparkle.gx * s;
        const y = sparkle.gy * s;
        sparkleCtx.fillStyle = `rgba(0, 0, 0, ${sparkle.opacity})`;
        sparkleCtx.fillRect(x, y, s, s);
      });

      sparkleAnimationRef.current = requestAnimationFrame(animateSparkles);
    };

    // Wait for dither data, then create sparkles and start animation
    const checkDitherData = setInterval(() => {
      if (ditherDataRef.current) {
        clearInterval(checkDitherData);
        createSparkles();
        // Start animation
        sparkleAnimationRef.current = requestAnimationFrame(animateSparkles);
      }
    }, 100);
    
    // If dither data is already available, start immediately
    if (ditherDataRef.current) {
      clearInterval(checkDitherData);
      createSparkles();
      sparkleAnimationRef.current = requestAnimationFrame(animateSparkles);
    }

    return () => {
      clearInterval(checkDitherData);
      animationRunning = false;
      window.removeEventListener('resize', resizeSparkleCanvas);
      if (sparkleAnimationRef.current) {
        cancelAnimationFrame(sparkleAnimationRef.current);
        sparkleAnimationRef.current = null;
      }
    };
  }, []);

  // Respond to active flag from parent: when active becomes false, start a local
  // JS-driven dissolve. The original implementation re-processed all pixels
  // seen so far on every frame, which could be heavy and choppy on slower
  // devices. This version treats the dissolve more like a particle system by
  // processing a fixed batch of random pixels per frame.
  useEffect(() => {
    if (active) {
      setIsVisible(true);
      setIsDissolving(false);
      // Reset sparkle opacity in case it was faded during a previous dissolve
      if (sparkleCanvasRef.current) {
        sparkleCanvasRef.current.style.opacity = '';
      }
    } else if (!active && isVisible && !isDissolving) {
      // Start pixel melt only if we have image data ready
      const canvas = canvasRef.current;
      const ctx = canvas ? canvas.getContext('2d') : null;
      if (!canvas || !ctx || !originalImageDataRef.current || !pixelIndicesRef.current) {
        // If we can't safely animate, just hide
        setIsVisible(false);
        return;
      }
      setIsDissolving(true);
      dissolveProgressRef.current = 0;

      const { imageData, width, height } = originalImageDataRef.current;
      const totalPixels = pixelIndicesRef.current.length;
      // Cap the amount of work per frame so the effect stays light even on
      // large screens. Use a large batch so each frame clears a big chunk of
      // pixels (chunkier, more lightweight dissolve), aiming for ~30 frames.
      const targetFrames = 30;
      const maxBatch = 20000;
      const estimatedBatch = Math.max(1, Math.floor(totalPixels / targetFrames));
      const minBatch = Math.max(1, Math.floor(estimatedBatch * 0.8));
      let clearedCount = 0;

      // Work on a mutable copy of the image data (pre-warmed at load time)
      const img = new ImageData(
        new Uint8ClampedArray(imageData.data),
        width,
        height
      );
      const d = img.data;

      const animateDissolve = () => {
        if (!pixelIndicesRef.current) return;
        if (clearedCount >= totalPixels) {
          // Melt complete
          setIsDissolving(false);
          setIsVisible(false);
          dissolveAnimationRef.current = null;
          return;
        }

        // Ramp batch size up with progress: small at start, larger later.
        const progress = clearedCount / totalPixels;
        const dynamicBatch = Math.min(
          maxBatch,
          Math.floor(minBatch + progress * (estimatedBatch - minBatch))
        );
        const nextCount = Math.min(clearedCount + dynamicBatch, totalPixels);
        for (let i = clearedCount; i < nextCount; i += 1) {
          const base = pixelIndicesRef.current[i];
          const x = base % width;
          const y = Math.floor(base / width);
          // Clear a 2x2 block for chunkier pixels
          for (let oy = 0; oy < 2; oy += 1) {
            const py = y + oy;
            if (py >= height) continue;
            for (let ox = 0; ox < 2; ox += 1) {
              const px = x + ox;
              if (px >= width) continue;
              const idx = (py * width + px) * 4;
              d[idx + 3] = 0;
            }
          }
        }
        clearedCount = nextCount;
        const newProgress = clearedCount / totalPixels;
        dissolveProgressRef.current = newProgress;

        ctx.putImageData(img, 0, 0);

        // Fade sparkles in sync with dissolve
        if (sparkleCanvasRef.current) {
          sparkleCanvasRef.current.style.opacity = String(1 - newProgress);
        }

        dissolveAnimationRef.current = requestAnimationFrame(animateDissolve);
      };

      dissolveAnimationRef.current = requestAnimationFrame(animateDissolve);
    }
  }, [active, isVisible, isDissolving]);

  const classes = [
    'dithered-loader',
    inline ? 'dithered-loader--inline' : '',
    !inline && !isVisible ? 'dithered-loader--hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={classes}
      onAnimationEnd={(e) => {
        if (e.animationName === 'dither-noise-dissolve') {
          setIsDissolving(false);
          setIsVisible(false);
        }
      }}
    >
      <canvas ref={canvasRef} className="dithered-canvas" />
      <canvas ref={sparkleCanvasRef} className="sparkle-canvas" />
      <canvas ref={labelCanvasRef} className="dithered-label-canvas" />
    </div>
  );
};
