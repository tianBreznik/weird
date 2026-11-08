/**
 * Sample visible page content colors for the desktop ambient backdrop (excludes full-bleed bg).
 */

const TEXT_SELECTORS =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, .epigraph-text, mark, span, strong, em';

function parseRgb(cssColor) {
  if (!cssColor || cssColor === 'transparent') return null;
  const m = cssColor.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  const a = cssColor.includes('rgba') ? parseFloat(cssColor.split(',')[3]) : 1;
  if (a < 0.05) return null;
  return {
    r: Math.round(Number(m[1])),
    g: Math.round(Number(m[2])),
    b: Math.round(Number(m[3])),
  };
}

function isNearBlack(rgb, threshold = 28) {
  return rgb.r <= threshold && rgb.g <= threshold && rgb.b <= threshold;
}

function isNearWhite(rgb, threshold = 238) {
  return rgb.r >= threshold && rgb.g >= threshold && rgb.b >= threshold;
}

function averageRgb(samples) {
  if (!samples.length) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  samples.forEach(({ rgb, weight }) => {
    r += rgb.r * weight;
    g += rgb.g * weight;
    b += rgb.b * weight;
    w += weight;
  });
  if (w <= 0) return null;
  return { r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) };
}

function sampleImageElement(img, size = 28) {
  return new Promise((resolve) => {
    if (!img?.src || img.naturalWidth === 0) {
      resolve(null);
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 40) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
      if (n === 0) {
        resolve(null);
        return;
      }
      resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
    } catch {
      resolve(null);
    }
  });
}

function sampleBorderImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const s = 32;
        canvas.width = s;
        canvas.height = s;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const patch = Math.max(4, Math.floor(Math.min(iw, ih) * 0.08));
        ctx.drawImage(img, 0, 0, patch, patch, 0, 0, s, s);
        ctx.drawImage(img, iw - patch, 0, patch, patch, 0, 0, s, s);
        const { data } = ctx.getImageData(0, 0, s, s);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        resolve(n ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) } : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * @param {HTMLElement} pageSlot — #pdf-page-N wrapper
 * @param {{ url?: string } | null} frameBorder
 */
export async function extractDesktopPageAmbientPalette(pageSlot, frameBorder = null) {
  if (!pageSlot || typeof window === 'undefined') return null;

  const sheet = pageSlot.querySelector('.page-sheet');
  const contentRoot =
    sheet?.querySelector('.page-body .page-content') ||
    sheet?.querySelector('.page-content');
  if (!contentRoot) return null;

  const inkSamples = [];
  const accentSamples = [];

  const nodes = contentRoot.querySelectorAll(TEXT_SELECTORS);
  const limit = Math.min(nodes.length, 120);
  for (let i = 0; i < limit; i += 1) {
    const el = nodes[i];
    if (el.closest('.pdf-page-background-image')) continue;
    const style = window.getComputedStyle(el);
    const fg = parseRgb(style.color);
    if (fg && !isNearBlack(fg) && !isNearWhite(fg)) {
      inkSamples.push({ rgb: fg, weight: 1 });
    }
    const bg = parseRgb(style.backgroundColor);
    if (bg && !isNearWhite(bg)) {
      accentSamples.push({ rgb: bg, weight: 2.5 });
    }
  }

  const marks = contentRoot.querySelectorAll('mark, [style*="background"]');
  marks.forEach((el) => {
    if (el.closest('.pdf-page-background-image')) return;
    const style = window.getComputedStyle(el);
    const bg = parseRgb(style.backgroundColor);
    if (bg && !isNearWhite(bg)) {
      accentSamples.push({ rgb: bg, weight: 3 });
    }
  });

  const imgs = [
    ...contentRoot.querySelectorAll('img:not(.pdf-page-background-image)'),
  ].slice(0, 6);
  const imgColors = await Promise.all(
    imgs.map((img) => sampleImageElement(img))
  );
  imgColors.filter(Boolean).forEach((rgb) => {
    if (!isNearWhite(rgb)) accentSamples.push({ rgb, weight: 2 });
  });

  const frameUrl = frameBorder?.url;
  const frameRgb = await sampleBorderImage(frameUrl);
  if (frameRgb && !isNearWhite(frameRgb)) {
    accentSamples.push({ rgb: frameRgb, weight: 1.8 });
  }

  const ink = averageRgb(inkSamples) || { r: 42, g: 40, b: 38 };
  const accent = averageRgb(accentSamples) || ink;

  return { ink, accent };
}

export function mixRgbIntoDarkBase(rgb, strength = 0.28) {
  const base = { r: 14, g: 14, b: 16 };
  return {
    r: Math.round(base.r + (rgb.r - base.r) * strength),
    g: Math.round(base.g + (rgb.g - base.g) * strength),
    b: Math.round(base.b + (rgb.b - base.b) * strength),
  };
}
