/**
 * Shared image preload cache so page backgrounds, borders, and in-text images
 * stay warm across mobile swipes and desktop scroll (avoids decode/flicker).
 */

const cache = new Map(); // url -> Promise<HTMLImageElement | void>

export function isImageCached(url) {
  return !!(url && cache.has(url));
}

/**
 * Warm an image in the HTTP + decode cache.
 * Do NOT set crossOrigin by default — anonymous CORS often fails on storage CDNs
 * and then the cache "resolves" while the visible <img> still has to fetch again.
 */
export function preloadImage(url) {
  if (!url || typeof window === 'undefined') return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);

  const promise = new Promise((resolve) => {
    const img = new Image();
    const finish = () => {
      const done = () => resolve(img);
      if (typeof img.decode === 'function') {
        img.decode().then(done).catch(done);
      } else {
        done();
      }
    };
    img.onload = finish;
    img.onerror = () => {
      // Allow a retry later if the first attempt failed
      cache.delete(url);
      resolve(null);
    };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) finish();
  });

  cache.set(url, promise);
  return promise;
}

export function preloadImages(urls) {
  const list = Array.from(new Set((urls || []).filter(Boolean)));
  return Promise.all(list.map((url) => preloadImage(url)));
}

/** Collect background, border, and embedded image URLs from a page object. */
export function collectPageMediaUrls(page) {
  if (!page) return [];
  const urls = new Set();

  if (page.backgroundImageUrl) urls.add(page.backgroundImageUrl);
  if (page.borderImageUrl) urls.add(page.borderImageUrl);

  if (page.hasFieldNotes && page.content) {
    const fnMatch = page.content.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);
    if (fnMatch?.[1]) urls.add(fnMatch[1]);
  }

  const html = page.content || '';
  if (html) {
    for (const match of html.matchAll(/\bsrc=["']([^"']+)["']/gi)) {
      if (match[1]) urls.add(match[1]);
    }
    for (const match of html.matchAll(/url\(\s*['"]?([^"')]+)['"]?\s*\)/gi)) {
      if (match[1] && !match[1].startsWith('data:image/svg')) urls.add(match[1]);
    }
  }

  return Array.from(urls);
}

/** Preload media for a window of pages around an index (inclusive radius). */
export function preloadPagesMedia(pages, centerIndex, radius = 2) {
  if (!Array.isArray(pages) || pages.length === 0) return Promise.resolve();
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(pages.length - 1, centerIndex + radius);
  const urls = [];
  for (let i = start; i <= end; i += 1) {
    urls.push(...collectPageMediaUrls(pages[i]));
  }
  return preloadImages(urls);
}

/** Warm every unique media URL in the book (desktop scroll / first paint). */
export function preloadAllPagesMedia(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return Promise.resolve();
  const urls = [];
  pages.forEach((page) => urls.push(...collectPageMediaUrls(page)));
  return preloadImages(urls);
}

/** Ensure a page's background (and border) is decoded before fade-in. */
export async function ensurePageBackgroundReady(page, { timeoutMs = 2000 } = {}) {
  const urls = [page?.backgroundImageUrl, page?.borderImageUrl].filter(Boolean);
  if (urls.length === 0) return true;

  let settled = false;
  const preload = preloadImages(urls).then(() => {
    settled = true;
    return true;
  });

  if (timeoutMs <= 0) {
    await preload;
    return settled;
  }

  await Promise.race([
    preload,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  return settled || urls.every((url) => isImageCached(url));
}
